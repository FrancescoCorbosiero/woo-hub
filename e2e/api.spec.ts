import { expect, test } from "@playwright/test";
import { api, open, sectionCard, sheet } from "./helpers";

/**
 * The programmatic API (/api/v1) on the demo shop: an action asked from
 * outside the Vetrina is the same action, filed in the same log, undone the
 * same way — and the log says where it came from.
 */

/** "Prodotti in tendenza" in the demo shop. */
const TRENDING = 101;

interface Listed {
  position: number;
  id: number;
  name: string;
}
interface Operation {
  id: string;
  label: string;
  status: string;
  via: string;
}

const order = async (request: Parameters<typeof api>[0]) =>
  (await api<{ products: Listed[] }>(request, "GET", `/catalog/order?id=${TRENDING}&limit=200`)).products.map((p) => p.id);

const status = async (request: Parameters<typeof api>[0], id: string) => (await api<Operation>(request, "GET", `/operations/${id}`)).status;

test("the actions are described for a script or an assistant", async ({ request }) => {
  const { actions } = await api<{ actions: { kind: string; scope: string; input: { properties: { kind: { const: string } } } }[] }>(
    request,
    "GET",
    "/actions",
  );
  expect(actions.map((a) => a.kind)).toEqual(expect.arrayContaining(["sale", "pin", "sectionSwitch", "sectionEdit"]));
  for (const action of actions) expect(action.input.properties.kind.const).toBe(action.kind);
  expect(actions.find((a) => a.kind === "sectionMove")?.scope).toBe("homepage");
});

test("an action from the API is filed as the API's; its undo puts the shop back", async ({ page, request }) => {
  const before = await order(request);
  expect(before.length).toBeGreaterThan(2);
  const last = before[before.length - 1];

  const { operation } = await api<{ operation: Operation }>(request, "POST", "/catalog/order", {
    body: { id: TRENDING, ids: [last], position: "top" },
  });
  expect(operation.via).toBe("api");
  await expect.poll(() => status(request, operation.id)).toBe("done");
  expect((await order(request))[0]).toBe(last);

  // The log on the phone shows it among the others, saying how it came.
  await open(page, "/vetrina");
  await page.getByRole("link", { name: "Attività" }).filter({ visible: true }).first().click();
  const row = sheet(page, "Attività").getByRole("listitem").filter({ hasText: operation.label }).first();
  await expect(row).toContainText("via API");

  await api(request, "POST", `/operations/${operation.id}/undo`);
  await expect.poll(() => status(request, operation.id)).toBe("undone");
  expect(await order(request)).toEqual(before);
});

interface Proposal {
  id: string;
  status: string;
  summary: string[];
}

/** "PRODOTTI IN TENDENZA", the demo homepage's first product section. */
const TRENDING_SECTION = "category:featured-sneakers-originali-streetwear#0";
const TRENDING_TITLE = "PRODOTTI IN TENDENZA";

test("a proposal writes nothing until confirmed; confirmed once, it is the API's in the log", async ({ page, request }) => {
  const proposal = await api<Proposal>(request, "POST", "/proposals", {
    body: { action: { kind: "sectionSwitch", key: TRENDING_SECTION, on: false } },
    status: 201,
  });
  expect(proposal.status).toBe("open");
  expect(proposal.summary).toContain(`«${TRENDING_TITLE}» resta nella homepage ma non si vede più sul sito.`);

  const card = sectionCard(page, TRENDING_TITLE);
  await open(page, "/vetrina");
  await expect(card).toBeVisible();
  await expect(card.getByText("Spenta", { exact: true })).toHaveCount(0);

  const { operation } = await api<{ operation: Operation }>(request, "POST", `/proposals/${proposal.id}/confirm`);
  expect(operation).toMatchObject({ status: "done", via: "api" });
  // Confirmed again, the same action: a retry never runs it twice.
  expect((await api<{ operation: Operation }>(request, "POST", `/proposals/${proposal.id}/confirm`)).operation.id).toBe(operation.id);
  await open(page, "/vetrina");
  await expect(card.getByText("Spenta", { exact: true })).toBeVisible();

  await api(request, "POST", `/operations/${operation.id}/undo`);
  await open(page, "/vetrina");
  await expect(card.getByText("Spenta", { exact: true })).toHaveCount(0);
});

test("a proposal confirmed over a shop that changed runs nothing, and answers the new one", async ({ request }) => {
  const move = (key: string, position: number) =>
    api<Proposal>(request, "POST", "/proposals", { body: { action: { kind: "sectionMove", key, position } }, status: 201 });
  const confirm = (id: string, status = 202) => api<{ operation?: Operation; proposal?: Proposal }>(request, "POST", `/proposals/${id}/confirm`, { status });

  // The demo homepage's third section ("SNEAKERS") to the top…
  const third = "category:saldi-sneakers-in-offerta#0";
  const asked = await move(third, 1);
  expect(asked.summary).toContain("«SNEAKERS» passa dal 3° al 1° posto tra le sezioni.");
  // …while the first goes third: the proposed one is second now, not where its preview said.
  const meanwhile = (await confirm((await move(TRENDING_SECTION, 3)).id)).operation!;

  const answer = await confirm(asked.id, 409);
  expect(answer.proposal).toMatchObject({ status: "open" });
  expect(answer.proposal!.id).not.toBe(asked.id);
  expect(answer.proposal!.summary).toContain("«SNEAKERS» passa dal 2° al 1° posto tra le sezioni.");
  const moved = (await confirm(answer.proposal!.id)).operation!;
  expect(moved.status).toBe("done");

  // The demo homepage as it was: the newest undone first.
  await api(request, "POST", `/operations/${moved.id}/undo`);
  await api(request, "POST", `/operations/${meanwhile.id}/undo`);
});

test("the reads an assistant starts from: the homepage, the products, the log", async ({ request }) => {
  const home = await api<{
    powers: { switchOff: boolean };
    blocks: { kind: string; key?: string; position?: number; title?: string; shows?: unknown; products?: unknown[] }[];
  }>(request, "GET", "/homepage");
  const sections = home.blocks.filter((b) => b.kind === "section");
  expect(sections[0]).toMatchObject({
    key: TRENDING_SECTION,
    position: 1,
    title: TRENDING_TITLE,
    shows: { taxonomy: "category", slug: "featured-sneakers-originali-streetwear" },
  });
  expect(sections[0].products!.length).toBeGreaterThan(0);
  expect(home.powers.switchOff).toBe(true);

  const found = await api<{ total: number; products: { id: number; name: string; sections: unknown[] }[] }>(
    request,
    "GET",
    "/catalog/products?q=samba&limit=5",
  );
  expect(found.total).toBeGreaterThan(0);
  expect(found.products[0].name).toMatch(/samba/i);

  const log = await api<{ id: string; via: string }[]>(request, "GET", "/operations?limit=5");
  expect(Array.isArray(log)).toBe(true);
  await api(request, "GET", "/operations?limit=0", { status: 400 });
});
