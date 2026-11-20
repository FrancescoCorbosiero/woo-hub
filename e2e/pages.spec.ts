import { expect, test, type Page } from "@playwright/test";
import { open, sheet, toast } from "./helpers";

/**
 * The Vetrina's "Pagine" tab on the demo shop (its pages keep WordPress's
 * rules for a save: the markup stored as sent, a new modified time, one
 * more revision): a page's markup copied out, a new version pasted in,
 * checked, compared block by block and saved — and a save refused when the
 * page changed since it was opened. Each test puts back what it changed.
 */

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const ABOUT = "Chi siamo";

const current = (page: Page) => page.getByTestId("current-markup");
const box = (page: Page) => page.getByLabel(/La nuova versione/);

async function openPage(page: Page, title: string): Promise<void> {
  await open(page, "/vetrina/pagine");
  // A row's name starts with the page's title (the tab bar's "Homepage" does not, followed by a space).
  await page.getByRole("link", { name: new RegExp(`^${title}\\s`) }).click();
  await expect(page.getByRole("button", { name: "Copia" })).toBeVisible();
}

/** "Aggiorna", then the confirmation's "Salva su WordPress": the toast says it is saved. */
async function saveAs(page: Page, markup: string): Promise<void> {
  await box(page).fill(markup);
  await page.getByRole("button", { name: "Aggiorna" }).click();
  const confirm = sheet(page, "Salvare la pagina?");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Salva su WordPress" }).click();
  await expect(toast(page, "Pagina salvata")).toBeVisible();
  await expect(current(page)).toHaveText(markup);
}

test("open → copy → paste → check → save, the previous version left in the revisions", async ({ page }) => {
  // The tab, in the Vetrina's tab bar.
  await open(page, "/vetrina/menu");
  await expect(page.getByRole("link", { name: "Pagine", exact: true })).toHaveAttribute("href", "/vetrina/pagine");
  await open(page, "/vetrina/pagine");
  // The front page is the Vetrina's, and says so.
  await expect(page.getByRole("link", { name: /^Home\s/ })).toContainText("Homepage · la modifica anche la Vetrina");

  await page.getByRole("link", { name: new RegExp(`^${ABOUT}\\s`) }).click();
  await expect(page.getByRole("button", { name: "Copia" })).toBeVisible();
  const original = (await current(page).textContent()) ?? "";
  expect(original).toContain("wp:golden-hive/about-hero");

  // Copy: the clipboard holds the page's markup exactly.
  await page.getByRole("button", { name: "Copia" }).click();
  await expect(toast(page, "Codice copiato")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(original);

  // A version with a bare quote inside a value: an error on its line, and "Aggiorna" refuses.
  const broken = original.replace('"title":"NATI A PIACENZA"', '"title":"NATI A "PIACENZA""');
  await box(page).fill(broken);
  await page.getByRole("button", { name: "Controlla" }).click();
  await expect(page.getByTestId("check-summary")).toHaveText("1 errore");
  await expect(page.locator('li[data-level="error"]')).toContainText("Riga 1 · blocco 1 · golden-hive/about-hero");
  await expect(page.locator('li[data-level="error"]')).toContainText("non sono JSON valido");
  await page.getByRole("button", { name: "Aggiorna" }).click();
  await expect(toast(page, "Ci sono errori")).toBeVisible();
  await expect(sheet(page, "Salvare la pagina?")).toHaveCount(0);

  // An unknown attribute and HTML outside blocks: an error and a warning, each said.
  await box(page).fill(`<p>Ciao</p>\n${original.replace('"eyebrow":"La storia"', '"eyebrow":"La storia","sottotitolo":"x"')}`);
  await page.getByRole("button", { name: "Controlla" }).click();
  await expect(page.getByTestId("check-summary")).toHaveText("1 errore · 1 avviso");
  await expect(page.locator('li[data-level="error"]')).toContainText("non ha l'attributo «sottotitolo»");
  await expect(page.locator('li[data-level="warning"]')).toContainText("blocco Classico");

  // The good version: no errors, and what changes, block by block.
  const next = original.replace('"title":"NATI A PIACENZA"', '"title":"DAL 2019 A PIACENZA"').replace("<!-- wp:golden-hive/authenticity-guarantee /-->\n\n", "");
  await box(page).fill(next);
  await page.getByRole("button", { name: "Controlla" }).click();
  await expect(page.getByTestId("check-summary")).toHaveText("Nessun errore: si può salvare.");
  const diff = page.getByTestId("diff");
  await expect(diff.locator('li[data-change="changed"]')).toContainText("about-hero · posizione 1");
  await expect(diff.locator('li[data-change="changed"]')).toContainText("attributi: title");
  await expect(diff.locator('li[data-change="removed"]')).toContainText("authenticity-guarantee · era in posizione 2");
  await expect(diff).toContainText("1 blocco resta uguale");

  // "Aggiorna": the same changes in the confirmation, then one write.
  await page.getByRole("button", { name: "Aggiorna" }).click();
  const confirm = sheet(page, "Salvare la pagina?");
  await expect(confirm).toContainText("about-hero");
  await expect(confirm).not.toContainText("homepage");
  await confirm.getByRole("button", { name: "Salva su WordPress" }).click();
  await expect(toast(page, "Pagina salvata")).toBeVisible();
  const saved = page.getByRole("status").filter({ hasText: "Pagina salvata" });
  await expect(saved).toContainText("La versione di prima è nelle revisioni della pagina");
  await expect(saved).toContainText("La pagina ha 4 revisioni.");
  await expect(saved.getByRole("link", { name: "Vedi le revisioni" })).toHaveAttribute("href", /revision\.php\?revision=\d+/);
  await expect(current(page)).toHaveText(next);
  await expect(box(page)).toHaveValue("");

  // Put back: the same screen, now on the new version.
  await saveAs(page, original);
});

test("a page changed since it was opened is not saved over: reload, the paste stays", async ({ browser }) => {
  const context = await browser.newContext({ ...test.info().project.use });
  const first = await context.newPage();
  const second = await context.newPage();
  await openPage(first, "Contatti");
  await openPage(second, "Contatti");
  const original = (await current(first).textContent()) ?? "";

  // Another tab saves the page first.
  const theirs = original.replace('"title":"Scrivici"', '"title":"Scrivici quando vuoi"');
  await saveAs(second, theirs);

  // This tab's save is refused: nothing written over theirs.
  const mine = original.replace('"title":"Scrivici"', '"title":"Contattaci"');
  await box(first).fill(mine);
  await first.getByRole("button", { name: "Aggiorna" }).click();
  await expect(toast(first, "la pagina è cambiata da quando l'hai aperta")).toBeVisible();
  await expect(sheet(first, "Salvare la pagina?")).toHaveCount(0);
  await expect(first.getByRole("alert").filter({ hasText: "La pagina è cambiata" })).toBeVisible();

  // Reload: the page as it is now, the paste kept, and now it compares with theirs.
  await first.getByRole("button", { name: "Ricarica la pagina" }).click();
  await expect(current(first)).toHaveText(theirs);
  await expect(box(first)).toHaveValue(mine);

  // Put back.
  await saveAs(first, original);
  await context.close();
});

test("the front page warns that a whole-page paste replaces the Vetrina's latest edits", async ({ page }) => {
  await openPage(page, "Home");
  await expect(page.getByRole("note").filter({ hasText: "Questa è la homepage: la modifica anche la Vetrina" })).toBeVisible();
  const original = (await current(page).textContent()) ?? "";
  // A rail written outside a wrapper: shown on the site, invisible to the Vetrina — a warning, not a block.
  const next = `${original}\n<!-- wp:shortcode -->\n[gh_product_rail category='saldi']\n<!-- /wp:shortcode -->\n`;
  await box(page).fill(next);
  await page.getByRole("button", { name: "Aggiorna" }).click();
  const confirm = sheet(page, "Salvare la pagina?");
  await expect(confirm).toContainText("sostituisci le ultime modifiche della Vetrina");
  await expect(confirm).toContainText("la Vetrina non la vede");
  await expect(confirm.locator('li[data-change="added"]')).toContainText("shortcode");
  // Not saved: the sheet closed, nothing written.
  await confirm.getByRole("button", { name: "Chiudi" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(current(page)).toHaveText(original);
});
