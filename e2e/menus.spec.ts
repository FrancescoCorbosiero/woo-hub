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

  // The theme's places, and the menu each shows.
  const places = await api<{ slug: string; name: string; menu: { id: number; name: string } | null }[]>(request, "GET", "/menu-locations");
  expect(places.map((p) => [p.slug, p.name, p.menu?.name ?? null])).toEqual([
    ["primary", "Menu principale", "Menu principale"],
    ["footer", "Menu del footer", "Footer"],
    ["mobile", "Menu mobile", null],
  ]);
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

test("the theme's places say which menu each shows; one changes after a yes, and Annulla puts it back", async ({ page }) => {
  await open(page, "/vetrina/menu");
  const mobile = page.getByRole("button", { name: /^Menu mobile/ });
  await expect(mobile).toContainText("Nessun menu");
  await expect(page.getByRole("button", { name: /^Menu del footer/ })).toContainText("Footer");

  await mobile.click();
  await actionSheet(page).getByRole("button", { name: "Footer", exact: true }).click();
  await expect(page.getByText("In «Menu mobile» il sito mostrerà subito «Footer».")).toBeVisible();
  await page.getByRole("button", { name: "Cambia", exact: true }).click();
  await expect(toast(page, "«Footer» ora è in Menu mobile")).toBeVisible();
  await expect(mobile).toContainText("Footer");
  await expect(page.getByRole("link", { name: /^Footer/ })).toContainText("Sul sito in: Menu del footer e Menu mobile");

  await undoFromToast(page, "«Footer» ora è in Menu mobile");
  await expect(mobile).toContainText("Nessun menu");
});

test("the main menu copied, shown in its place, put back, then the copy deleted, asked first", async ({ page }) => {
  await open(page, "/vetrina/menu");
  await page.getByRole("button", { name: "Nuovo menu" }).click();
  const create = sheet(page, "Nuovo menu");
  await create.getByLabel("Nome").fill("Menu Black Friday");
  await create.getByText("Una copia di «Menu principale»").click();
  await create.getByRole("button", { name: "Crea il menu" }).click();
  await expect(toast(page, "Menu «Menu Black Friday» creato")).toBeVisible();
  // The copy opens at once, its items the main menu's, on no place of the site.
  await expect(page).toHaveURL(/\/vetrina\/menu\/\d+$/);
  await expect.poll(() => itemTitles(page)).toEqual(AS_READ);
  await expect(page.getByText("Il tema non lo mostra da nessuna parte", { exact: true })).toBeVisible();

  // Shown where the main menu was, after a yes; Annulla puts the main menu back.
  await page.getByRole("link", { name: "Azioni del menu" }).click();
  await actionSheet(page).getByRole("button", { name: "Mostra in «Menu principale»" }).click();
  await expect(page.getByText("In «Menu principale» il sito mostrerà subito «Menu Black Friday» al posto di «Menu principale».")).toBeVisible();
  await page.getByRole("button", { name: "Cambia", exact: true }).click();
  await expect(toast(page, "«Menu Black Friday» ora è in Menu principale")).toBeVisible();
  await expect(page.getByText("Sul sito in: Menu principale", { exact: true })).toBeVisible();
  await undoFromToast(page, "«Menu Black Friday» ora è in Menu principale");
  await expect(page.getByText("Il tema non lo mostra da nessuna parte", { exact: true })).toBeVisible();

  // Deleted, asked first: back to the list, without it.
  await page.getByRole("link", { name: "Azioni del menu" }).click();
  await actionSheet(page).getByRole("button", { name: "Elimina il menu" }).click();
  await expect(page.getByText("«Menu Black Friday» sparisce, con le sue 8 voci. Categorie, brand e pagine restano.")).toBeVisible();
  await page.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(toast(page, "Menu «Menu Black Friday» eliminato")).toBeVisible();
  await expect(page).toHaveURL(/\/vetrina\/menu$/);
  await expect(page.getByRole("link", { name: /Menu principale/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Menu Black Friday/ })).toHaveCount(0);
});

test("a menu is renamed, Annulla gives its name back; the menu the site shows is not deleted", async ({ page }) => {
  await open(page, "/vetrina/menu/2");
  await page.getByRole("link", { name: "Azioni del menu" }).click();
  await actionSheet(page).getByRole("button", { name: "Rinomina il menu" }).click();
  const rename = sheet(page, "Rinomina il menu");
  await rename.getByLabel("Nome").fill("Piè di pagina");
  await rename.getByRole("button", { name: "Salva" }).click();
  await expect(toast(page, "Il menu ora si chiama «Piè di pagina»")).toBeVisible();
  await expect(page.getByText("Piè di pagina", { exact: true })).toBeVisible();
  await undoFromToast(page, "Il menu ora si chiama «Piè di pagina»");
  await expect(page.getByText("Footer", { exact: true })).toBeVisible();

  await open(page, `/vetrina/menu/${MAIN}`);
  await page.getByRole("link", { name: "Azioni del menu" }).click();
  await actionSheet(page).getByRole("button", { name: "Elimina il menu" }).click();
  await expect(page.getByText("«Menu principale» è sul sito in: Menu principale. Prima metti un altro menu in quella posizione, o lasciala vuota.")).toBeVisible();
  await page.getByRole("button", { name: "Ho capito" }).click();
  expect(await itemTitles(page)).toEqual(AS_READ);
});
