import { expect, test, type Page } from "@playwright/test";
import { open, sheet, toast, undoFromToast } from "./helpers";

/**
 * "Elimina" on the demo shop: a product out of the shop — from a selection,
 * by way of Nascondi's sheet, and from its own sheet — and back with the
 * toast's "Annulla".
 */

const TRENDING = "/vetrina/catalogo/categoria/101";
const SHOTS = process.env.E2E_SHOTS;

/** The products listed, top to bottom, by name (rows off screen are not drawn, so read from the text). */
async function names(page: Page): Promise<string[]> {
  return page
    .getByRole("list")
    .last()
    .getByRole("listitem")
    .evaluateAll((rows) => rows.map((row) => row.querySelector(".line-clamp-2")?.textContent?.trim() ?? ""));
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.beforeEach(async ({ page }) => {
  await open(page, TRENDING);
  await expect.poll(async () => (await names(page))[0] ?? "").not.toBe("");
});

test("Nascondi leads on to Elimina, which takes the products out of the shop; Annulla brings them back", async ({ page }) => {
  const before = await names(page);
  const target = before[1];

  await page.getByRole("button", { name: "Seleziona dei prodotti per agire su tutti insieme" }).click();
  await page.getByRole("list").last().getByRole("listitem").filter({ hasText: target }).click();
  await page.getByRole("button", { name: "Nascondi", exact: true }).click();
  const hide = sheet(page, "Nascondi");
  const deleteInstead = hide.getByRole("button", { name: "Non lo vendi più? Eliminalo" });
  await expect(deleteInstead).toBeVisible();
  await shot(page, "1-hide-sheet");
  await deleteInstead.click();

  const confirm = sheet(page, "Elimina");
  await expect(confirm.getByText(/^Per un prodotto che non vendi più/)).toBeVisible();
  await expect(confirm.getByText(/Esce dal negozio e dall'Hub/)).toBeVisible();
  await shot(page, "2-delete-sheet");
  await confirm.getByRole("button", { name: "Elimina 1 prodotto" }).click();

  await expect(toast(page, "1 prodotto eliminato")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => names(page)).not.toContain(target);
  await shot(page, "3-deleted-toast");

  await undoFromToast(page, "1 prodotto eliminato");
  await open(page, TRENDING);
  await expect.poll(async () => names(page), { timeout: 30_000 }).toEqual(before);
});

test("a product's sheet deletes it, asked first; Annulla brings it back", async ({ page }) => {
  const before = await names(page);
  const target = before[2];

  await page.getByRole("list").last().getByRole("listitem").filter({ hasText: target }).getByText(target).click();
  const button = page.getByRole("button", { name: "Elimina il prodotto" });
  await button.scrollIntoViewIfNeeded();
  await shot(page, "4-product-sheet");
  await button.click();

  const dialog = page.locator(".k-dialog").filter({ hasText: "Eliminare il prodotto?" });
  await expect(dialog.getByText(/va nel cestino di WordPress/).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Elimina" })).toBeEnabled();
  await shot(page, "5-confirm");
  await dialog.getByRole("button", { name: "Elimina" }).click();

  await expect(toast(page, "1 prodotto eliminato")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => names(page)).not.toContain(target);

  await undoFromToast(page, "1 prodotto eliminato");
  await open(page, TRENDING);
  await expect.poll(async () => names(page), { timeout: 30_000 }).toEqual(before);
});
