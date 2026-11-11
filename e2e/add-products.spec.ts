import { expect, test } from "@playwright/test";
import { open, toast } from "./helpers";

/**
 * "Aggiungi prodotti" on the demo shop (VETRINA_SOURCE=fixture): one box
 * for codes, and the form for a product made by hand. The demo shop takes
 * no new products — what is tested is the screens: what they read, what
 * they check, what they say when the shop refuses.
 */

test("the codes' box reads a pasted list, and says the demo shop takes no new products", async ({ page }) => {
  await open(page, "/vetrina/negozio/aggiungi");
  const box = page.getByRole("textbox", { name: "Codici" });
  await expect(page.getByRole("button", { name: "Cerca" })).toBeDisabled();
  await box.fill("SKU\nDD1391-100\nFV5029-010");
  await page.getByRole("button", { name: "Cerca" }).click();
  await expect(toast(page, /Sul negozio di prova non si aggiungono prodotti/)).toBeVisible();
  // The way to a product with no code at all.
  await page.getByRole("button", { name: "Crea a mano" }).click();
  await expect(page).toHaveURL(/\/vetrina\/negozio\/aggiungi\/nuovo$/);
  await expect(page.getByRole("button", { name: "Generane uno" }).filter({ visible: true })).toBeVisible();
});

test("the form for a product made by hand checks it, shows it as Google would, and says the shop's refusal", async ({ page }) => {
  await open(page, "/vetrina/negozio/aggiungi/nuovo?sku=hm-e2e-1");
  const form = page.locator("main, body").first();
  await expect(form.getByRole("textbox", { name: "Codice (SKU)" }).filter({ visible: true })).toHaveValue("hm-e2e-1");

  // Nothing filled in: the check names what is missing.
  await page.getByRole("button", { name: "Crea prodotto" }).filter({ visible: true }).click();
  await expect(toast(page, "Controlla: il nome, le taglie e i prezzi")).toBeVisible();

  await page.getByRole("textbox", { name: "Nome" }).filter({ visible: true }).fill("Borsa in pelle fatta a mano");
  // Google's preview follows the name: the address too.
  await expect(page.getByText("Borsa in pelle fatta a mano").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/› borsa-in-pelle-fatta-a-mano/).filter({ visible: true })).toBeVisible();

  // One size, its price.
  await page.getByRole("button", { name: "Taglia unica" }).filter({ visible: true }).click();
  await page.getByRole("textbox", { name: "Prezzo (€)" }).filter({ visible: true }).fill("89,90");
  await page.getByRole("button", { name: "Crea prodotto" }).filter({ visible: true }).click();
  await expect(toast(page, /Il prodotto non è stato creato: Sul negozio di prova non si aggiungono prodotti/)).toBeVisible();
});

test("sizes are picked in a tap, priced all at once, and a size twice is named", async ({ page }) => {
  await open(page, "/vetrina/negozio/aggiungi/nuovo");
  const visible = { visible: true } as const;
  for (const size of ["42", "42.5", "43"]) await page.getByRole("button", { name: size, exact: true }).filter(visible).click();
  await page.getByRole("button", { name: "Fatto" }).filter(visible).first().click();
  await page.getByRole("textbox", { name: "Prezzo per tutte (€)" }).filter(visible).fill("120");
  await page.getByRole("button", { name: "Applica" }).filter(visible).click();
  for (const size of ["42", "42.5", "43"]) {
    await expect(page.getByRole("textbox", { name: `Taglia ${size} — Prezzo` }).filter(visible)).toHaveValue("120");
  }
  // "42,0" is 42 again.
  await page.getByRole("button", { name: "Aggiungi taglie" }).filter(visible).click();
  await page.getByRole("textbox", { name: "Un'altra taglia" }).filter(visible).fill("42,0");
  await page.getByRole("button", { name: "Aggiungi", exact: true }).filter(visible).last().click();
  // Already there: nothing added twice.
  await expect(page.getByRole("textbox", { name: /— Prezzo$/ }).filter(visible)).toHaveCount(3);
});
