import { expect, test } from "@playwright/test";
import { actionSheet, open, sectionCard, sectionTitles, sheet, toast, undoFromToast } from "./helpers";

/**
 * The homepage tab: the sections themselves — a new one, their places, one
 * switched off — each written at once, each put back by its "Annulla".
 */

test.beforeEach(async ({ page }) => {
  await open(page, "/vetrina");
  await expect(page.getByRole("button", { name: /^Azioni per «/ }).first()).toBeVisible();
});

test("the homepage lists its sections, with their tools", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Sposta le sezioni" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuova sezione" }).first()).toBeVisible();
  const titles = await sectionTitles(page);
  expect(titles).toContain("PRODOTTI IN TENDENZA");
  expect(titles.length).toBeGreaterThan(3);
  await expect(sectionCard(page, "PRODOTTI IN TENDENZA").getByRole("link", { name: /^Aggiungi prodotti a/ })).toBeVisible();
});

test("a new section joins the page, ringed in view; Annulla takes it away", async ({ page }) => {
  const before = await sectionTitles(page);

  await page.getByRole("button", { name: "Nuova sezione" }).first().click();
  const add = sheet(page, "Nuova sezione");
  await add.getByText("Liste", { exact: true }).click();
  await add.getByText("Più venduti", { exact: true }).click();
  await expect(add.getByRole("textbox").first()).toHaveValue("PIÙ VENDUTI");
  await add.getByRole("button", { name: "Aggiungi alla homepage" }).click();

  await expect(toast(page, "«PIÙ VENDUTI» aggiunta alla homepage")).toBeVisible();
  const card = sectionCard(page, "PIÙ VENDUTI");
  await expect(card).toBeInViewport();
  await expect(card).toHaveClass(/ring-2/);
  expect(await sectionTitles(page)).toEqual(["PIÙ VENDUTI", ...before]);

  await undoFromToast(page, "«PIÙ VENDUTI» aggiunta alla homepage");
  await expect(toast(page, "Sezione tolta")).toBeVisible();
  await expect.poll(() => sectionTitles(page)).toEqual(before);
});

test("Sposta le sezioni moves one down; Annulla puts it back", async ({ page }) => {
  const before = await sectionTitles(page);
  const [first, second] = before;

  await page.getByRole("button", { name: "Sposta le sezioni" }).click();
  const arrange = sheet(page, "Sposta le sezioni");
  await expect(arrange.getByRole("button", { name: "Nessuno spostamento da salvare" })).toBeDisabled();
  await arrange.getByRole("button", { name: `Sposta giù «${first}»` }).click();
  await arrange.getByRole("button", { name: "Salva" }).click();

  await expect(toast(page, "Sezioni spostate")).toBeVisible();
  await expect.poll(() => sectionTitles(page)).toEqual([second, first, ...before.slice(2)]);

  await undoFromToast(page, "Sezioni spostate");
  await expect.poll(() => sectionTitles(page)).toEqual(before);
});

test("a section switched off stays on the page, faded; switched on again", async ({ page }) => {
  const title = "PRODOTTI IN TENDENZA";
  const card = sectionCard(page, title);

  await card.getByRole("button", { name: `Azioni per «${title}»` }).click();
  await actionSheet(page).getByRole("button", { name: "Spegni sul sito" }).click();
  await expect(card.getByText("Spenta", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: `Azioni per «${title}»` }).click();
  await actionSheet(page).getByRole("button", { name: "Riaccendi sul sito" }).click();
  await expect(card.getByText("Spenta", { exact: true })).toHaveCount(0);
});
