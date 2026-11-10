import { expect, test, type Page } from "@playwright/test";
import { actionSheet, api, open, sheet, toast, undoFromToast } from "./helpers";

/**
 * The store's categories and brands managed from their screens' "⋯" on the
 * demo shop (its terms keep WordPress's rules): renamed, a sub-term made,
 * merged into another — each with "Annulla" — and what cannot be taken away
 * said first. And over the API, the tags among the terms.
 */

const ASICS = "/vetrina/catalogo/brand/208";
const OUTLET = "/vetrina/catalogo/categoria/102";
const NEW = "/vetrina/catalogo/categoria/104";

async function more(page: Page, entry: string): Promise<void> {
  await page.getByRole("link", { name: "Altre azioni" }).click();
  await actionSheet(page).getByRole("button", { name: entry, exact: true }).click();
}

/** The term screen's title, as its navbar shows it (the "⋯" sheet's own copy is out of sight). */
const title = (page: Page, name: string) => page.getByText(name, { exact: true }).filter({ visible: true }).first();

test("a brand is renamed from its screen, its address kept; Annulla gives the name back", async ({ page }) => {
  await open(page, ASICS);
  await more(page, "Rinomina");
  const rename = sheet(page, "Rinomina «Asics»");
  await expect(rename).toContainText("Il suo indirizzo sul sito resta lo stesso.");
  await rename.getByLabel("Nome").fill("Asics Tiger");
  await rename.getByRole("button", { name: "Salva" }).click();
  await expect(toast(page, "Ora si chiama «Asics Tiger»")).toBeVisible();
  await expect(title(page, "Asics Tiger")).toBeVisible();

  await undoFromToast(page, "Ora si chiama «Asics Tiger»");
  await expect(title(page, "Asics")).toBeVisible();
});

test("a sub-category is made and opens; merged into another, said first, its screen goes to the one it went into", async ({ page }) => {
  await open(page, NEW);
  await more(page, "Nuova sottocategoria");
  const create = sheet(page, "Nuova sottocategoria di «Nuove release»");
  await create.getByLabel("Nome").fill("Estate");
  await create.getByRole("button", { name: "Crea" }).click();
  await expect(toast(page, "Categoria «Estate» creata")).toBeVisible();
  await expect(title(page, "Estate")).toBeVisible();

  await more(page, "Unisci a…");
  const pick = sheet(page, "Unisci «Estate» a…");
  await pick.getByText("Saldi outlet", { exact: true }).click();
  const confirm = sheet(page, "Unisci «Estate» a «Saldi outlet»");
  await expect(confirm).toContainText("La categoria «Estate» non ha prodotti: viene eliminata, e il suo nome porta a «Saldi outlet».");
  await expect(confirm).toContainText("Publish metterà in «Saldi outlet» anche ciò che arriva col nome «Estate».");
  await confirm.getByRole("button", { name: "Unisci" }).click();
  await expect(page).toHaveURL(/\/vetrina\/catalogo\/categoria\/102$/);
  await expect(title(page, "Saldi outlet")).toBeVisible();
});

test("a category the homepage shows is not deleted: the sheet says why, and its button stays off", async ({ page }) => {
  await open(page, OUTLET);
  await more(page, "Elimina la categoria");
  const confirm = sheet(page, "Elimina «Saldi outlet»");
  await expect(confirm).toContainText("«Saldi outlet» è nella homepage («SALDI»): cambia prima la sezione.");
  await expect(confirm.getByRole("button", { name: /^Elimina/ })).toBeDisabled();
});

test("the terms over the API: tags listed with categories and brands, a tag made and taken back", async ({ request }) => {
  const tags = await api<{ id: number; name: string; parent: number }[]>(request, "GET", "/catalog/terms?taxonomy=tag");
  expect(tags.map((t) => t.name)).toEqual(expect.arrayContaining(["saldi", "estate", "esclusiva"]));

  const proposal = await api<{ id: string; summary: string[] }>(request, "POST", "/proposals", {
    body: { action: { kind: "termCreate", taxonomy: "tag", name: "Black Friday" } },
    status: 201,
  });
  expect(proposal.summary).toContain("Nasce il tag «Black Friday».");
  const { operation } = await api<{ operation: { id: string; status: string } }>(request, "POST", `/proposals/${proposal.id}/confirm`);
  expect(operation.status).toBe("done");
  expect((await api<{ name: string }[]>(request, "GET", "/catalog/terms?taxonomy=tag")).map((t) => t.name)).toContain("Black Friday");

  await api(request, "POST", `/operations/${operation.id}/undo`);
  expect((await api<{ name: string }[]>(request, "GET", "/catalog/terms?taxonomy=tag")).map((t) => t.name)).not.toContain("Black Friday");
});
