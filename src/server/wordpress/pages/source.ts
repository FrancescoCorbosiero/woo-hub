import "server-only";
import { createHash } from "node:crypto";
import { hubConfig } from "@/config";
import { env } from "@/lib/env";
import type { BlockTypeSpec, PageAccess, PageRead, PageSummary, PageVersion } from "@/lib/pages/types";

/**
 * Where the Vetrina's "Pagine" tab reads and saves a page's block markup.
 * Two implementations with one contract, as the menus have: the live site
 * over WordPress's own REST API (wp-pages.ts) and the demo shop's pages in
 * memory (fixture-pages.ts). VETRINA_SOURCE picks one for both.
 *
 * The source only reads and writes; whether a save may go ahead (the check,
 * the page unchanged since it was opened) is the service's (service.ts).
 */

/** A page as WordPress stored it, after a save. */
export interface StoredPage {
  markup: string;
  url: string;
  version: PageVersion;
  revisions: number | null;
  /** WordPress's screen of the page's latest revision, when it said which one that is. */
  revisionsUrl: string | null;
}

export interface PageSource {
  readonly kind: "wordpress" | "fixture";
  /** The published pages. */
  list(): Promise<PageSummary[]>;
  /** A page as stored, read now; not_found when there is none. */
  read(id: number): Promise<PageRead>;
  /** The page's markup replaced: one write, never retried. */
  save(id: number, markup: string): Promise<StoredPage>;
  /** The block types registered under a namespace, read live. */
  blockTypes(namespace: string): Promise<BlockTypeSpec[]>;
  /** Whether the signed-in user may save pages. */
  access(): Promise<PageAccess>;
  /** The page the Vetrina's homepage editor works on (the front page); null when it cannot be told. */
  vetrinaPageId(): Promise<number | null>;
}

/** The configured source; VETRINA_SOURCE overrides hub.config.ts, as for the homepage and the menus. */
export async function getPageSource(): Promise<PageSource> {
  const kind = env.VETRINA_SOURCE ?? hubConfig.vetrina.source;
  if (kind === "fixture") {
    const { fixturePages } = await import("./fixture-pages");
    return fixturePages();
  }
  const { wordpressPages } = await import("./wp-pages");
  return wordpressPages();
}

/** A page's markup fingerprint: what a save checks the page against, with its modified time. */
export function markupDigest(markup: string): string {
  return createHash("sha256").update(markup).digest("hex").slice(0, 32);
}

/** The capabilities saving a page needs: any page, published, someone else's (the front page usually is). */
export const PAGE_CAPABILITIES = ["edit_pages", "edit_published_pages", "edit_others_pages"] as const;

/** Access, from a user's capabilities (wp/v2/users/me, context=edit: all of them, by name). */
export function accessOf(user: string, capabilities: Record<string, unknown>): PageAccess {
  return {
    user,
    missing: PAGE_CAPABILITIES.filter((cap) => capabilities[cap] !== true),
    filtered: capabilities.unfiltered_html !== true,
  };
}
