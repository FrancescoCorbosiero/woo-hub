import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/** The programmatic API's token on the test server (playwright.config.ts gives it to the app). */
export const API_TOKEN = process.env.E2E_API_TOKEN ?? "e2e-api-token-0123456789abcdef";

/**
 * A call to the Hub's API (/api/v1) with the token: its `data` once the
 * answer is the status expected, else the test fails on the answer itself.
 */
export async function api<T = unknown>(
  request: APIRequestContext,
  method: "GET" | "POST",
  path: string,
  { body, status = method === "GET" ? 200 : 202 }: { body?: unknown; status?: number } = {},
): Promise<T> {
  const res = await request.fetch(`/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${API_TOKEN}` },
    ...(body !== undefined ? { data: body } : {}),
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  expect(res.status(), json.error ?? "").toBe(status);
  return json.data as T;
}

/**
 * Opens a page and waits until its streamed parts are revealed. React sends
 * a Suspense boundary's content in a hidden <div id="S:…"> and moves it into
 * place a moment later; until then a locator can find the same text twice
 * (strict mode counts hidden elements too).
 */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'));
}

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
