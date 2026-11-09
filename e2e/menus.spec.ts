import { expect, test, type Page } from "@playwright/test";
import { actionSheet, api, open, sheet, toast, undoFromToast } from "./helpers";

/**
 * The site's navigation menus on the demo shop (its menus keep WordPress's
 * own rules): read and changed over the API, and arranged from the
 * Vetrina's "Menu" tab — each change with "Annulla", which puts the menu
 * back as it was.
 */

interface MenuRead {
  id: number;
  name: string;
  digest: string;
  locations: { slug: string; name: string }[];
  items: { id: number; parent: number; depth: number; position: number; title: string; label: string | null }[];
}

const MAIN = 1;
const AS_READ = ["Home", "Novità", "Brand", "Nike", "Adidas", "New Balance", "Saldi outlet", "Chi siamo"];

/** The menu screen's items, top to bottom, by the titles their "⋯" names. */
async function itemTitles(page: Page): Promise<string[]> {
  const labels = await page.getByRole("button", { name: /^Azioni per «/ }).evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  return labels.map((label) => label.replace(/^Azioni per «/, "").replace(/»$/, ""));
}

async function itemMenu(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: `Azioni per «${title}»`, exact: true }).click();
  await expect(actionSheet(page)).toBeVisible();
}

test("the menus over the API: read, proposed with the menu's fingerprint, confirmed, undone", async ({ request }) => {
  const menus = await api<{ id: number; name: string; count: number; locations: { slug: string }[] }[]>(request, "GET", "/menus");
  expect(menus.map((m) => [m.name, m.count, m.locations.map((l) => l.slug)])).toEqual([
    ["Menu principale", 8, ["primary"]],
    ["Footer", 3, ["footer"]],
  ]);
  const menu = await api<MenuRead>(request, "GET", `/menus/${MAIN}`);
  expect(menu.items.map((i) => i.title)).toEqual(AS_READ);
  expect(menu.items.find((i) => i.title === "Adidas")).toMatchObject({ depth: 1, position: 2 });
  const pages = await api<{ id: number; title: string }[]>(request, "GET", "/pages");
  const guide = pages.find((p) => p.title === "Guida alle taglie")!;

  const proposal = await api<{ id: string; summary: string[] }>(request, "POST", "/proposals", {
    body: { action: { kind: "menuItemAdd", menuId: MAIN, items: [{ kind: "page", id: guide.id }], place: { position: 2 }, expected: { digest: menu.digest } } },
    status: 201,
  });
  expect(proposal.summary).toContain("«Guida alle taglie» entra nel menu «Menu principale», al 2° posto del menu.");
  const { operation } = await api<{ operation: { id: string; status: string } }>(request, "POST", `/proposals/${proposal.id}/confirm`);
  expect(operation.status).toBe("done");
  expect((await api<MenuRead>(request, "GET", `/menus/${MAIN}`)).items.map((i) => i.title).slice(0, 3)).toEqual(["Home", "Guida alle taglie", "Novità"]);

  await api(request, "POST", `/operations/${operation.id}/undo`);
  expect((await api<MenuRead>(request, "GET", `/menus/${MAIN}`)).items.map((i) => i.title)).toEqual(AS_READ);
  await api(request, "GET", "/menus/abc", { status: 404 });
});

test("the Menu tab lists the site's menus, where the theme shows them, and opens one", async ({ page }) => {
  await open(page, "/vetrina/menu");
  const main = page.getByRole("link", { name: /Menu principale/ });
  await expect(main).toContainText("Sul sito in: Menu principale");
  await expect(main).toContainText("8 voci");
  await main.click();
  await expect(page.getByRole("button", { name: "Aggiungi voci" })).toBeVisible();
  expect(await itemTitles(page)).toEqual(AS_READ);
});

test("an item moves up; Annulla puts it back", async ({ page }) => {
  await open(page, `/vetrina/menu/${MAIN}`);
  await itemMenu(page, "Chi siamo");
  await actionSheet(page).getByRole("button", { name: "Sposta su" }).click();
  await expect(toast(page, "«Chi siamo» spostata")).toBeVisible();
  await expect.poll(() => itemTitles(page)).toEqual(["Home", "Novità", "Brand", "Nike", "Adidas", "New Balance", "Chi siamo", "Saldi outlet"]);
  await undoFromToast(page, "«Chi siamo» spostata");
  await expect.poll(() => itemTitles(page)).toEqual(AS_READ);
});

test("a brand is added under «Brand»; Annulla takes it away", async ({ page, request }) => {
  await open(page, `/vetrina/menu/${MAIN}`);
  await itemMenu(page, "Brand");
  await actionSheet(page).getByRole("button", { name: "Aggiungi voci qui sotto" }).click();
  const add = sheet(page, "Aggiungi voci");
  await expect(add).toContainText("Sotto «Brand», in fondo");
  await add.getByRole("button", { name: "Brand", exact: true }).click();
  await add.getByText("Asics", { exact: true }).click();
  await add.getByRole("button", { name: "Aggiungi 1 voce" }).click();
  await expect(toast(page, "«Asics» aggiunta al menu")).toBeVisible();
  await expect.poll(() => itemTitles(page)).toContain("Asics");
  const asics = (await api<MenuRead>(request, "GET", `/menus/${MAIN}`)).items.find((i) => i.title === "Asics");
  expect(asics).toMatchObject({ depth: 1, position: 4 });

  await undoFromToast(page, "«Asics» aggiunta al menu");
  await expect.poll(() => itemTitles(page)).toEqual(AS_READ);
});

test("an item is renamed; Annulla gives it back its category's name", async ({ page }) => {
  await open(page, `/vetrina/menu/${MAIN}`);
  await itemMenu(page, "Saldi outlet");
  await actionSheet(page).getByRole("button", { name: "Rinomina" }).click();
  const rename = sheet(page, "Rinomina «Saldi outlet»");
  await rename.getByLabel("Nome nel menu").fill("Saldi");
  await rename.getByRole("button", { name: "Salva" }).click();
  await expect(toast(page, "Ora si chiama «Saldi»")).toBeVisible();
  await expect.poll(() => itemTitles(page)).toContain("Saldi");
  await undoFromToast(page, "Ora si chiama «Saldi»");
  await expect.poll(() => itemTitles(page)).toEqual(AS_READ);
});

test("an item with items is taken out, asked first, its items in its place; Annulla brings it back with them", async ({ page, request }) => {
  await open(page, `/vetrina/menu/${MAIN}`);
  await itemMenu(page, "Brand");
  await actionSheet(page).getByRole("button", { name: "Togli dal menu" }).click();
  await expect(page.getByText("«Brand» esce dal menu; le sue 3 voci salgono al suo posto.")).toBeVisible();
  await page.getByRole("button", { name: "Togli", exact: true }).click();
  await expect(toast(page, "«Brand» tolta dal menu")).toBeVisible();
  await expect.poll(() => itemTitles(page)).toEqual(["Home", "Novità", "Nike", "Adidas", "New Balance", "Saldi outlet", "Chi siamo"]);

  await undoFromToast(page, "«Brand» tolta dal menu");
  await expect.poll(() => itemTitles(page)).toEqual(AS_READ);
  const nike = (await api<MenuRead>(request, "GET", `/menus/${MAIN}`)).items.find((i) => i.title === "Nike");
  expect(nike?.depth).toBe(1);
});
