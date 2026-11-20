import "server-only";
import { checkMarkup, CHECKED_NAMESPACE, usesNamespace } from "@/lib/pages/check";
import { diffMarkup } from "@/lib/pages/diff";
import type { BlockTypeSpec, PageAccess, PageCheck, PageRead, PageSaved, PageSummary, PageVersion } from "@/lib/pages/types";
import type { PageSource } from "./source";

/**
 * The "Pagine" tab's server half: a page opened, a pasted version checked
 * and compared, and saved — only when the check finds no error, the
 * WordPress user may save pages, and the page is still exactly the one that
 * was opened.
 *
 * "Still the one that was opened" is a check, then a write: the page is
 * read again right before the save, its modified time and markup compared
 * with what the screen showed, and the save sent at once. Something that
 * lands on the page between that read and the write (moments apart) is
 * still overwritten. Core WordPress offers nothing stronger: wp/v2 takes no
 * "only if unchanged since" condition on a save (no If-Match, no
 * expected-modified field; the Vetrina's own writes get one from the
 * golden-hive-blocks plugin). Every save leaves a revision, so nothing is
 * lost for good.
 */

export interface PagesOverview {
  pages: PageSummary[];
  /** The page the Vetrina edits (the front page), null when it cannot be told. */
  vetrinaPageId: number | null;
}

export interface PageScreenData {
  page: PageRead;
  /** Who saves, and what they lack; null when WordPress could not be asked. */
  access: PageAccess | null;
  /** The Vetrina edits this page too (the front page). */
  vetrinaPage: boolean;
}

export async function pagesOverview(source: PageSource): Promise<PagesOverview> {
  const [pages, vetrinaPageId] = await Promise.all([source.list(), source.vetrinaPageId().catch(() => null)]);
  return { pages, vetrinaPageId };
}

export async function openPage(source: PageSource, id: number): Promise<PageScreenData> {
  const [page, access, vetrinaPageId] = await Promise.all([
    source.read(id),
    source.access().catch((e: unknown) => {
      console.error("[pages] could not read the WordPress user's capabilities:", e);
      return null;
    }),
    source.vetrinaPageId().catch(() => null),
  ]);
  return { page, access, vetrinaPage: vetrinaPageId === id };
}

/** The golden-hive block types, when the markup has any: null when the registry cannot be read (the check says so). */
async function registryFor(source: PageSource, markup: string): Promise<BlockTypeSpec[] | null> {
  if (!usesNamespace(markup)) return [];
  try {
    return await source.blockTypes(CHECKED_NAMESPACE);
  } catch (e) {
    console.error("[pages] could not read the block registry:", e);
    return null;
  }
}

/** A version is the one presented: same modified time, same markup. */
export const sameVersion = (a: PageVersion, b: PageVersion) => a.modifiedGmt === b.modifiedGmt && a.digest === b.digest;

/** The check of a markup against the page as it is now (what a save would replace). */
function checked(markup: string, current: string, registry: BlockTypeSpec[] | null): PageCheck {
  const issues = checkMarkup(markup, { registry });
  const errors = issues.filter((i) => i.level === "error").length;
  return { issues, errors, warnings: issues.length - errors, diff: diffMarkup(current, markup) };
}

export interface PageInput {
  id: number;
  markup: string;
  /** The page's version as the screen showed it. */
  expected: PageVersion;
}

/** "Controlla": the issues, what saving would change, and whether the page moved since it was opened. */
export async function checkPage(source: PageSource, input: PageInput): Promise<{ check: PageCheck; stale: boolean }> {
  const [current, registry] = await Promise.all([source.read(input.id), registryFor(source, input.markup)]);
  return { check: checked(input.markup, current.markup, registry), stale: !sameVersion(current.version, input.expected) };
}

export type SaveOutcome =
  | { outcome: "saved"; saved: PageSaved }
  /** The check found errors: nothing was sent. */
  | { outcome: "blocked"; check: PageCheck }
  /** The WordPress user may not save pages: nothing was sent. */
  | { outcome: "noAccess"; access: PageAccess }
  /** The page changed since it was opened: nothing was sent. */
  | { outcome: "stale"; current: PageVersion }
  /** The page already holds exactly this markup. */
  | { outcome: "unchanged" };

/**
 * "Aggiorna": checked again (never trust a screen's earlier check), then
 * the page read again and compared with the version the screen showed, then
 * one write — never retried.
 */
export async function savePage(source: PageSource, input: PageInput): Promise<SaveOutcome> {
  const registry = await registryFor(source, input.markup);
  const issues = checkMarkup(input.markup, { registry });
  if (issues.some((i) => i.level === "error")) {
    const current = await source.read(input.id).catch(() => null);
    return { outcome: "blocked", check: checked(input.markup, current?.markup ?? input.markup, registry) };
  }

  const access = await source.access().catch(() => null);
  // Unknown access is not a refusal: WordPress itself answers for it (unauthorized).
  if (access && access.missing.length > 0) return { outcome: "noAccess", access };

  // The last read before the write: the page must still be the one shown.
  const current = await source.read(input.id);
  if (current.markup === input.markup) return { outcome: "unchanged" };
  if (!sameVersion(current.version, input.expected)) return { outcome: "stale", current: current.version };

  const stored = await source.save(input.id, input.markup);
  return {
    outcome: "saved",
    saved: {
      url: stored.url,
      version: stored.version,
      altered: stored.markup !== input.markup,
      revisions: stored.revisions,
      revisionsUrl: stored.revisionsUrl,
    },
  };
}
