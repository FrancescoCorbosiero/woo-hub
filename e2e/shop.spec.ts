import { expect, test, type Page } from "@playwright/test";
import { open, sheet, toast } from "./helpers";

/**
 * The Vetrina's "Negozio" tab on the test server, which has no store
 * connected (no WooCommerce keys, no supplier feed): "Sincronizza ora" says
 * why it is not there, while the automatic update's settings — the Hub's, in
 * its database — are saved from the phone and hold after a reload. Each test
 * puts back what it changed.
 */

const SAVED = "Salvato: vale da subito";

/** The automatic update's switch: Konsta's label around a hidden checkbox. */
function storeSyncSwitch(page: Page) {
  return page.locator('label[aria-label="Aggiorna il negozio da solo"]');
}

/** The full update's row, which says its times. */
function dailyRow(page: Page) {
  return page.getByRole("button", { name: /^Aggiornamento completo/ });
}

test("without a store, the sync says why; the automatic update's switch is saved and holds after a reload", async ({ page }) => {
  await open(page, "/vetrina/negozio");
  await expect(page.getByText(/Il negozio non è collegato/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sincronizza ora" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Ordini da evadere/ })).toBeVisible();

  const switched = storeSyncSwitch(page).locator("input");
  await expect(switched).toBeChecked();
  await storeSyncSwitch(page).click();
  await expect(toast(page, SAVED)).toBeVisible();
  await expect(page.getByText(/L'aggiornamento automatico è spento/)).toBeVisible();

  await open(page, "/vetrina/negozio");
  await expect(switched).not.toBeChecked();
  // Back on, as it was.
  await storeSyncSwitch(page).click();
  await expect(switched).toBeChecked();
  await expect(page.getByText(/L'aggiornamento automatico è spento/)).toHaveCount(0);
});

test("the full update's times: one added from the phone's time picker, saved in order, then taken away", async ({ page }) => {
  await open(page, "/vetrina/negozio");
  await expect(dailyRow(page)).toContainText("04:30");

  await dailyRow(page).click();
  const times = sheet(page, "Aggiornamento completo");
  await expect(times).toBeVisible();
  await times.getByRole("button", { name: "Aggiungi un orario" }).click();
  await times.locator('input[type="time"]').nth(1).fill("01:15");
  await times.getByRole("button", { name: "Salva" }).click();
  await expect(toast(page, SAVED)).toBeVisible();
  // In order, whatever order they were typed in.
  await expect(dailyRow(page)).toContainText("01:15, 04:30");

  await dailyRow(page).click();
  await expect(times).toBeVisible();
  await times.getByRole("button", { name: "Togli questo orario" }).first().click();
  await times.getByRole("button", { name: "Salva" }).click();
  await expect(dailyRow(page)).not.toContainText("01:15");
  await expect(dailyRow(page)).toContainText("04:30");
});

test("the Hub's orders lead to the Vetrina's", async ({ page }) => {
  await open(page, "/orders");
  await expect(page).toHaveURL(/\/vetrina\/negozio\/ordini$/);
  // Next keeps the page a redirect came through, hidden, for an instant back: the one on screen.
  await expect(page.getByText("Nessun ordine da evadere.").filter({ visible: true })).toBeVisible();
});
