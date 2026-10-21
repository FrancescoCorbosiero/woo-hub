import { expect, test, type Page } from "@playwright/test";
import { actionSheet, open, sheet, toast, undoFromToast } from "./helpers";

/**
 * A section's editor: what it shows, products added from the whole catalog
 * (pinned on top, published), the ones that must join its category first.
 */

const TRENDING = "/vetrina/sezione/category.featured-sneakers-originali-streetwear.0";
const TITLE = "PRODOTTI IN TENDENZA";

/** The editor's list: its rows, top to bottom. */
const rows = (page: Page) => page.getByRole("list").first().getByRole("listitem");

/** Everything back in automatic, published: the section as the demo shop starts it. */
async function unpinAllAndPublish(page: Page) {
  // The navbar's "⋯": an icon with its name, not a link anywhere.
  await page.getByLabel("Sezione", { exact: true }).click();
  await actionSheet(page).getByRole("button", { name: "Tutto in automatico" }).click();
  await page.getByRole("button", { name: "Pubblica", exact: true }).click();
  await expect(toast(page, "Salvato nel negozio demo")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await open(page, TRENDING);
  await expect(page.getByText("Categoria «Prodotti in tendenza»")).toBeVisible();
});

test("Cambia points the section at a brand; Annulla brings its category back", async ({ page }) => {
  await page.getByRole("button", { name: `Cambia cosa mostra «${TITLE}»` }).click();
  const change = sheet(page, "Cambia cosa mostra");
  await change.getByText("Brand", { exact: true }).click();
  // The brand's own row: "Adidas Samba" names its parent too.
  await change.getByRole("button", { name: /^Adidas \d/ }).click();
  await change.getByRole("button", { name: "Mostra «Adidas»" }).click();

  await expect(toast(page, "La sezione ora mostra «Adidas»")).toBeVisible();
  await expect(page).toHaveURL(/\/vetrina\/sezione\/brand\.adidas\.\d+$/);
  await expect(page.getByText("Brand «Adidas»")).toBeVisible();

  await undoFromToast(page, "La sezione ora mostra «Adidas»");
  await expect(toast(page, "Sezione com'era prima")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${TRENDING.replace(/\./g, "\\.")}$`));
  await expect(page.getByText("Categoria «Prodotti in tendenza»")).toBeVisible();
});

test("a product picked from the catalog goes on top, pinned, and is published", async ({ page }) => {
  const name = "Nike Air Force 1 Triple Black Sail";
  await page.getByRole("button", { name: `Aggiungi prodotti a «${TITLE}»` }).click();
  const picker = sheet(page, `Aggiungi a «${TITLE}»`);
  await picker.getByPlaceholder("Cerca per nome o SKU").fill("Triple Black Sail");
  // Already in the section, lower down: it says where.
  const row = picker.getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText(/^In sezione · #\d+$/)).toBeVisible();
  await row.click();
  await picker.getByRole("button", { name: "Aggiungi 1 prodotto" }).click();

  await expect(toast(page, "1 prodotto aggiunto: pubblica per vederlo sul sito")).toBeVisible();
  const top = rows(page).first();
  await expect(top).toContainText(name);
  await expect(top).toContainText("Nuovo");
  await expect(top).toContainText("Fissato");

  await page.getByRole("button", { name: "Pubblica", exact: true }).click();
  await expect(toast(page, "Salvato nel negozio demo")).toBeVisible();
  await expect(rows(page).first()).toContainText(name);
  await expect(rows(page).first()).not.toContainText("Nuovo");

  await unpinAllAndPublish(page);
  await expect(rows(page).first()).not.toContainText("Fissato");
});

test("a product from outside the category joins it when the section is published", async ({ page }) => {
  const name = "adidas Samba OG Cloud White White";
  const before = await page.getByText(/^\d+ prodotti · \d+ visibili$/).textContent();
  const members = Number(before?.match(/^(\d+)/)?.[1]);

  await page.getByRole("button", { name: `Aggiungi prodotti a «${TITLE}»` }).click();
  const picker = sheet(page, `Aggiungi a «${TITLE}»`);
  await picker.getByPlaceholder("Cerca per nome o SKU").fill("Samba OG Cloud White White");
  const row = picker.getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText("Entra in «Prodotti in tendenza»")).toBeVisible();
  await row.click();
  await picker.getByRole("button", { name: "Aggiungi 1 prodotto" }).click();

  const top = rows(page).first();
  await expect(top).toContainText(name);
  await expect(top).toContainText("Entra in «Prodotti in tendenza» quando pubblichi");

  await page.getByRole("button", { name: "Pubblica", exact: true }).click();
  await expect(toast(page, "Salvato nel negozio demo")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`${members + 1} prodotti`, { exact: false })).toBeVisible();
  await expect(rows(page).first()).toContainText(name);
  await expect(rows(page).first()).not.toContainText("quando pubblichi");

  // Put the demo shop back: the pin, then the product out of the category ("Annulla" on its line in the activity log,
  // where the section's publishes are lines of their own).
  await unpinAllAndPublish(page);
  await open(page, "/vetrina");
  await page.getByRole("link", { name: "Attività" }).filter({ visible: true }).first().click();
  const joined = sheet(page, "Attività").getByRole("listitem").filter({ hasText: "Categoria «Prodotti in tendenza» a 1 prodotto" }).first();
  await joined.getByRole("button", { name: "Annulla" }).click();
  await expect(joined.getByText("Annullata")).toBeVisible({ timeout: 30_000 });
  await open(page, TRENDING);
  await expect(page.getByText(`${members} prodotti`, { exact: false })).toBeVisible();
});
