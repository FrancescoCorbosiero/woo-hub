import { expect, type Locator, type Page } from "@playwright/test";

/** A toast (sonner) saying `text`. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/** Taps "Annulla" in the toast saying `text`, and waits for that toast to go. */
export async function undoFromToast(page: Page, text: string | RegExp): Promise<void> {
  const shown = toast(page, text);
  await shown.getByRole("button", { name: "Annulla" }).click();
  await expect(shown).toHaveCount(0);
}

/** The bottom sheet open with this title: a sheet's content exists only while it is open. */
export function sheet(page: Page, title: string | RegExp): Locator {
  return page.locator(".react-modal-sheet-container").filter({ has: page.getByRole("heading", { name: title }) });
}

/**
 * The open action sheet (Konsta's Actions): a closed one stays in the page,
 * moved below the screen — "visible" to a locator, out of a finger's reach.
 */
export function actionSheet(page: Page): Locator {
  return page.locator(".k-actions:not(.translate-y-full)");
}

/** The homepage's product sections, top to bottom, by the titles their "⋯" names. */
export async function sectionTitles(page: Page): Promise<string[]> {
  const labels = await page.getByRole("button", { name: /^Azioni per «/ }).evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? ""),
  );
  return labels.map((label) => label.replace(/^Azioni per «/, "").replace(/»$/, ""));
}

/** The homepage's card for a section, by its title. */
export function sectionCard(page: Page, title: string): Locator {
  return page.locator("[id^='sezione-']").filter({ has: page.getByRole("button", { name: `Azioni per «${title}»`, exact: true }) });
}
