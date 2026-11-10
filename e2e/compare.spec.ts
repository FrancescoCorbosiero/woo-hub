import { expect, test, type APIRequestContext } from "@playwright/test";
import { api, ASSISTANT_TOKEN, open, PHONE_TOKEN, sheet, toast, undoFromToast } from "./helpers";

/**
 * A ranking from another shop compared with the demo shop: the prices off by
 * more than 2% — brought to the other shop's with "Allinea", and back with
 * "Annulla" — the products the shop lacks, an uncertain one paired by hand;
 * on the screen, and over the API as an assistant would.
 */

interface Product {
  id: number;
  sku: string;
  name: string;
  price: number | null;
  onSale: boolean;
}

interface Compared {
  summary: { items: number; matched: number; differ: number; dearer: number; cheaper: number; missing: number; importable: number; ambiguous: number };
  items: {
    position: number;
    status: string;
    paired: boolean;
    gap: number | null;
    differs: boolean;
    product: { id: number; price: number | null } | null;
    candidates: { id: number; name: string }[];
  }[];
}

interface Operation {
  id: string;
  status: string;
  label: string;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * A ranking of the demo's products as another shop prices them: the first
 * two 10% under the shop, one at the shop's price but a cent, one the shop
 * lacks (by code), and a name two of the shop's products fit.
 */
async function upload(request: APIRequestContext, name: string) {
  const { products } = await api<{ products: Product[] }>(request, "GET", "/catalog/products?limit=100");
  const own = products.filter((p) => !p.onSale && p.price != null && !p.name.includes("Panda"));
  const [a, b, c] = own;
  const ranking = {
    format: "woo-hub.order-source/1",
    name,
    items: [
      { sku: a.sku, name: a.name, price: cents(a.price! * 0.9) },
      { name: b.name, price: `${cents(b.price! * 0.9).toFixed(2).replace(".", ",")} €` },
      { name: c.name, price: cents(c.price! + 0.001) },
      { sku: "DD1391-100", name: "Nike Dunk Low Retro White Black Panda", price: 119.99 },
      { name: "Nike Dunk Low Panda", price: 120 },
    ],
  };
  const { source } = await api<{ source: { id: string } }>(request, "POST", "/order-sources", { body: ranking, status: 201 });
  return { id: source.id, a, b, c };
}

async function remove(request: APIRequestContext, id: string) {
  await api(request, "DELETE", `/order-sources/${id}`, { status: 200 });
}

const status = async (request: APIRequestContext, id: string) => (await api<Operation>(request, "GET", `/operations/${id}`)).status;

test("a ranking compared on the phone: two prices matched and put back, an uncertain one paired", async ({ page, request }) => {
  const { id, a, b } = await upload(request, "Concorrente");
  await open(page, `/vetrina/catalogo/classifica/${id}`);
  await expect(page.getByText("3 di 5 prodotti nel negozio")).toBeVisible();

  // Prices off by more than 2%: both 10% under the shop, both chosen.
  await expect(page.getByRole("button", { name: "Prezzi diversi · 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: a.name })).toContainText("+11,1%");
  await page.getByRole("button", { name: "Allinea 2 prezzi" }).click();
  const align = sheet(page, "Allinea i prezzi");
  await expect(align).toContainText("Cambiano 2 prodotti");
  await align.getByRole("button", { name: "Allinea 2 prezzi" }).click();
  await expect(toast(page, "Prezzi allineati a «Concorrente» · 2 prodotti")).toBeVisible();
  // The comparison reads the shop again: no price is off any more.
  await expect(page.getByText("Nessun prezzo si scosta oltre la soglia.")).toBeVisible();
  const matched = await api<Compared>(request, "GET", `/order-sources/${id}/compare`);
  expect(matched.items[0].product?.price).toBe(cents(a.price! * 0.9));
  expect(matched.items[1].product?.price).toBe(cents(b.price! * 0.9));

  await undoFromToast(page, "Prezzi allineati a «Concorrente» · 2 prodotti");
  await expect(page.getByRole("button", { name: "Prezzi diversi · 2" })).toBeVisible();
  const back = await api<Compared>(request, "GET", `/order-sources/${id}/compare`);
  expect(back.items[0].product?.price).toBe(a.price);

  // The name two products fit, paired by hand with one of them.
  const [candidate] = back.items[4].candidates;
  await page.getByRole("button", { name: "Da verificare · 1" }).click();
  await page.getByRole("button", { name: /Nike Dunk Low Panda/ }).click();
  await sheet(page, "Quale prodotto è?").getByText(candidate.name, { exact: true }).click();
  await expect(toast(page, `Abbinato a «${candidate.name}»`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Da verificare · 0" })).toBeVisible();

  // The missing one: on the demo shop, nothing is imported.
  await page.getByRole("button", { name: "Mancanti · 1" }).click();
  await expect(page.getByText("Sul negozio di prova il confronto si vede, ma non si importa.")).toBeVisible();

  await remove(request, id);
});

test("a ranking compared over the API: an assistant proposes the prices, a person says yes, and undoes", async ({ request }) => {
  const { id, a } = await upload(request, "Concorrente API");
  const assistant = { token: ASSISTANT_TOKEN };
  const phone = { token: PHONE_TOKEN };

  const compared = await api<Compared>(request, "GET", `/order-sources/${id}/compare`, assistant);
  expect(compared.summary).toEqual({ items: 5, matched: 3, differ: 2, dearer: 2, cheaper: 0, missing: 1, importable: 0, ambiguous: 1 });
  // A cent is no difference; and at 20% nothing differs.
  expect(compared.items[2]).toMatchObject({ gap: 0, differs: false });
  expect((await api<Compared>(request, "GET", `/order-sources/${id}/compare?threshold=20`)).summary.differ).toBe(0);

  // Paired by hand: the missing one is "none of the shop's", then the matcher's again.
  const none = await api<Compared>(request, "POST", `/order-sources/${id}/pairs`, { ...assistant, body: { position: 1, pair: "none" }, status: 200 });
  expect(none.items[0]).toMatchObject({ status: "missing", paired: true });
  const auto = await api<Compared>(request, "POST", `/order-sources/${id}/pairs`, { ...assistant, body: { position: 1, pair: "auto" }, status: 200 });
  expect(auto.items[0]).toMatchObject({ status: "matched", paired: false, product: { id: a.id } });

  // The preview, then the assistant's proposal: nothing moves until a person says yes.
  const dry = await api<{ preview: { changes: number } }>(request, "POST", `/order-sources/${id}/prices`, { ...assistant, body: { dryRun: true }, status: 200 });
  expect(dry.preview.changes).toBe(2);
  const { proposal } = await api<{ proposal: { id: string } }>(request, "POST", `/order-sources/${id}/prices`, { ...assistant, body: {}, status: 201 });
  const { operation } = await api<{ operation: Operation }>(request, "POST", `/proposals/${proposal.id}/confirm`, phone);
  expect(operation.label).toBe("Prezzi allineati a «Concorrente API» · 2 prodotti");
  await expect.poll(() => status(request, operation.id)).toBe("done");
  expect((await api<Compared>(request, "GET", `/order-sources/${id}/compare`)).summary.differ).toBe(0);
  await api(request, "POST", `/operations/${operation.id}/undo`, phone);
  await expect.poll(() => status(request, operation.id)).toBe("undone");
  expect((await api<Compared>(request, "GET", `/order-sources/${id}/compare`)).summary.differ).toBe(2);

  // The demo shop publishes nothing: the import says so, a dry run included.
  const refused = await request.post(`/api/v1/order-sources/${id}/import`, {
    headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
    data: { missing: true, dryRun: true },
  });
  expect(refused.status()).toBe(400);
  expect(((await refused.json()) as { error: string }).error).toContain("negozio di prova");

  await remove(request, id);
});
