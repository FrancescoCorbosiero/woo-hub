import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { api, open, sheet, toast, undoFromToast } from "./helpers";

/**
 * Where each product comes from, on the demo shop, as the owner tells them
 * apart: every row in its source's colour, the product sheet in words, the
 * hidden products checked by source before they go — and the supplier's
 * products (GoldenSneakers) never deleted, nor hidden without a word.
 */

const TRENDING = "/vetrina/catalogo/categoria/101";
const HIDDEN = "/vetrina/catalogo/vista/hidden";

interface Row {
  name: string;
  source: string | null;
}

/** The list's rows, top to bottom, with their source: read from the page, rows off screen are not drawn. */
async function rows(page: Page): Promise<Row[]> {
  return page
    .getByRole("list")
    .last()
    .getByRole("listitem")
    .evaluateAll((items) =>
      items.map((item) => ({
        name: item.querySelector(".line-clamp-2")?.textContent?.trim() ?? "",
        source: item.querySelector("[data-source]")?.getAttribute("data-source") ?? null,
      })),
    );
}

const named = (page: Page, name: string) => page.getByRole("list").last().getByRole("listitem").filter({ hasText: name });

interface Operation {
  id: string;
  kind: string;
  status: string;
}

/** The newest hide taken back, through the API: the next test finds the shop as it was. */
async function undoNewestHide(request: APIRequestContext) {
  const log = await api<Operation[]>(request, "GET", "/operations?limit=10");
  const hide = log.find((o) => o.kind === "hide" && o.status === "done");
  if (!hide) return;
  await api(request, "POST", `/operations/${hide.id}/undo`);
  await expect
    .poll(async () => (await api<Operation>(request, "GET", `/operations/${hide.id}`)).status, { timeout: 30_000 })
    .toBe("undone");
}

test.beforeEach(async ({ page }) => {
  await open(page, TRENDING);
  await expect.poll(async () => (await rows(page))[0]?.name ?? "").not.toBe("");
});

test("every row says where it comes from, in its colour", async ({ page }) => {
  const sources = new Set((await rows(page)).map((r) => r.source));
  // The demo's trending category holds the supplier's products and the Hub's own.
  expect(sources).toContain("goldensneakers");
  expect(sources).toContain("kicksdb");
  expect(sources.has(null)).toBe(false);
});

test("the hidden products, checked by source: the KicksDB ones deleted from the bar, the supplier's left; Annulla brings them back", async ({
  page,
  request,
}) => {
  const list = await rows(page);
  const kicks = list.filter((r) => r.source === "kicksdb").slice(0, 2);
  const fed = list.filter((r) => r.source === "goldensneakers").slice(0, 2);

  // Hidden together, the supplier's included — which the hide says before it runs.
  await page.getByRole("button", { name: "Seleziona dei prodotti per agire su tutti insieme" }).click();
  for (const r of [...kicks, ...fed]) await named(page, r.name).click();
  await page.getByRole("button", { name: "Nascondi", exact: true }).click();
  const hide = sheet(page, "Nascondi");
  await expect(hide.getByText("2 arrivano dal feed GoldenSneakers (GS)", { exact: false })).toBeVisible();
  await hide.getByRole("button", { name: "Nascondi 4 prodotti" }).click();
  await expect(toast(page, /4 prodotti nascosti/)).toBeVisible({ timeout: 30_000 });

  try {
    await open(page, HIDDEN);
    const origin = page.getByRole("group", { name: "Provenienza" });
    await expect(origin.getByRole("button", { name: /GoldenSneakers\s*2/ })).toBeVisible();
    await origin.getByRole("button", { name: /KicksDB\s*2/ }).click();
    await expect.poll(async () => (await rows(page)).map((r) => r.source)).toEqual(["kicksdb", "kicksdb"]);

    await page.getByRole("button", { name: "Seleziona dei prodotti per agire su tutti insieme" }).click();
    await page.getByRole("button", { name: /Seleziona tutti|Tutti \(/ }).click();
    await page.getByRole("toolbar").getByRole("button", { name: "Elimina" }).click();
    const remove = sheet(page, "Elimina");
    await remove.getByRole("button", { name: "Elimina 2 prodotti" }).click();
    await expect(toast(page, "2 prodotti eliminati")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Con questi filtri non resta nessun prodotto.")).toBeVisible();
    // The supplier's are still there, hidden: theirs to show again, never to delete.
    await expect(origin.getByRole("button", { name: /GoldenSneakers\s*2/ })).toBeVisible();

    await undoFromToast(page, "2 prodotti eliminati");
    await open(page, HIDDEN);
    await expect
      .poll(async () => (await rows(page)).map((r) => r.name).sort(), { timeout: 30_000 })
      .toEqual([...kicks, ...fed].map((r) => r.name).sort());
  } finally {
    await undoNewestHide(request);
  }
});

test("the product sheet says whose product it is: the supplier's offers no Elimina, the Hub's does", async ({ page }) => {
  const list = await rows(page);
  const fed = list.find((r) => r.source === "goldensneakers")!;
  const kicks = list.find((r) => r.source === "kicksdb")!;

  await named(page, fed.name).getByText(fed.name).click();
  await expect(page.getByText("Lo porta il feed del fornitore, che decide se è nel negozio.", { exact: false })).toBeVisible();
  await expect(page.getByText(/^Arriva dal feed GoldenSneakers: non si elimina/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Elimina il prodotto" })).toHaveCount(0);

  await open(page, TRENDING);
  await expect.poll(async () => (await rows(page))[0]?.name ?? "").not.toBe("");
  await named(page, kicks.name).getByText(kicks.name).click();
  await expect(page.getByText("L'hai aggiunto tu dall'Hub", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Elimina il prodotto" })).toBeVisible();
});
