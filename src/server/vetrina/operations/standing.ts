import "server-only";
import { env } from "@/lib/env";
import { readIndexRowsById } from "@/server/collections/repo";
import { demoMode } from "@/server/collections/store";
import type { VetrinaOperationRow } from "@/server/db/schema";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { ancestorIds, readTermMembers, type CatalogTrees } from "@/server/vetrina/catalog";
import { demoShop } from "@/server/vetrina/fixture-source";
import { parseTermKey } from "./context";
import { dayIn, standingHide, standingSales } from "./plan";
import * as repo from "./repo";

/**
 * Which actions of the log still hold, where the log alone cannot say:
 * the actions this shop knows (demo mode), the whole-term hides that still
 * hide something and the products they hold, and the products a whole
 * term's sale put on sale.
 */

const DEFAULT_TIME_ZONE = "Europe/Rome";

/** Today in the shop's time zone (the scheduler's), YYYY-MM-DD: a sale's last day is the shop's. */
export function shopToday(at = new Date()): string {
  return dayIn(env.SCHEDULER_TIMEZONE ?? DEFAULT_TIME_ZONE, at);
}

// One start per demo shop, kept with it on globalThis: the server bundles share the shop, and a new shop starts again.
const g = globalThis as { __vetrinaDemoLogSince?: WeakMap<object, Promise<Date>> };

/**
 * The log's start for this shop: in demo mode, the demo shop of this
 * process — a restart puts it back as it always is, so what was done to an
 * earlier one is gone with it. Taken on the database's clock, which dates
 * the rows, the first time an action is filed or read on this shop (every
 * entry asks before it files anything). Null: the whole log (the real shop).
 */
export async function logSince(): Promise<Date | null> {
  if (!demoMode()) return null;
  const starts = (g.__vetrinaDemoLogSince ??= new WeakMap());
  const shop = demoShop();
  let since = starts.get(shop);
  if (!since) {
    since = repo.databaseNow();
    starts.set(shop, since);
    // Asked again next time: a database not up yet is not the shop's start.
    since.catch(() => starts.delete(shop));
  }
  return since;
}

/**
 * Whether a whole term's hide still hides something. A hide whose products
 * are all visible again — shown another way, from a selection's "Mostra" or
 * in WordPress — no longer stands: it is closed for good (endedAt), so the
 * term reads as visible, can be hidden again, and a product of it hidden
 * later one by one never brings the old hide back. One under way, one that
 * filed nothing, or one whose products the index no longer holds is taken
 * at its word.
 */
export async function stillHiding(op: VetrinaOperationRow): Promise<boolean> {
  if (op.endedAt || op.undoneAt) return false;
  if (op.status === "running" || op.status === "undoing") return true;
  const ids = await repo.filedProducts(op.id, "visibility");
  if (ids.length === 0) return true;
  const rows = await readIndexRowsById(ids);
  if (rows.length === 0 || rows.some((r) => r.visibility === "hidden")) return true;
  await repo.endOperation(op.id);
  return false;
}

/**
 * The hide standing on a whole term: standing in the log, and still hiding
 * something — the newest such; an older one that no longer hides anything
 * is closed on the way. `before`: only hides filed before that one (a hide
 * starting checks for an earlier one).
 */
export async function standingTermHide(termKey: string, before?: VetrinaOperationRow): Promise<VetrinaOperationRow | null> {
  const rows = (await repo.termHides(termKey, await logSince())).filter(
    (r) => !before || (r.id !== before.id && r.createdAt <= before.createdAt),
  );
  for (let hide = standingHide(rows); hide; hide = standingHide(rows.slice(rows.indexOf(hide) + 1))) {
    if (await stillHiding(hide)) return hide;
  }
  return null;
}

/** Every whole-term hide that still stands, newest first (those that no longer hide anything closed on the way). */
export async function standingTermHides(): Promise<VetrinaOperationRow[]> {
  const out: VetrinaOperationRow[] = [];
  for (const row of await repo.termHideRows(await logSince())) {
    if (await stillHiding(row)) out.push(row);
  }
  return out;
}

/**
 * A whole term's products hidden everywhere, newcomers too: the products
 * that joined the term after its hide (published into it, added by a rule,
 * moved there in WordPress or from the Vetrina) and that the hide never
 * met, still listed in the shop. The owner's later word on a product the
 * hide did meet — shown one by one — is left alone. From the index.
 */
export async function termNewcomers(hide: VetrinaOperationRow): Promise<number[]> {
  const term = hide.termKey ? parseTermKey(hide.termKey) : null;
  if (!term) return [];
  const members = (await readTermMembers([term])).get(hide.termKey!) ?? new Set<number>();
  if (members.size === 0) return [];
  const met = await repo.metProducts(hide.id);
  const fresh = [...members].filter((id) => !met.has(id));
  if (fresh.length === 0) return [];
  return (await readIndexRowsById(fresh)).filter((r) => r.visibility !== "hidden").map((r) => r.id);
}

/**
 * Which of these products the standing hide of a whole category or brand
 * holds: those inside a term the owner hid, whose hide still stands —
 * hiding a term hides its products everywhere, until its own "Mostra".
 * Each goes to the newest such hide. `skip`: hides that do not count (the
 * one being undone, the term's own).
 */
export async function heldByTermHides(
  ids: readonly number[],
  skip: (hide: VetrinaOperationRow) => boolean = () => false,
): Promise<Map<number, VetrinaOperationRow>> {
  const held = new Map<number, VetrinaOperationRow>();
  if (ids.length === 0) return held;
  const others = (await standingTermHides()).filter((row) => row.termKey && !skip(row));
  if (others.length === 0) return held;
  const terms = others.flatMap((row) => {
    const term = parseTermKey(row.termKey!);
    return term ? [term] : [];
  });
  const members = await readTermMembers(terms);
  for (const row of others) {
    const inTerm = members.get(row.termKey!);
    if (!inTerm) continue;
    for (const id of ids) if (!held.has(id) && inTerm.has(id)) held.set(id, row);
  }
  return held;
}

/**
 * The hidden category (or brand) a product put into this term would be
 * hidden by: the term itself, or one above it, whose hide stands. Its name,
 * or null when none is hidden.
 */
export async function hiddenOver(taxonomy: CatalogTaxonomy, id: number, trees: CatalogTrees): Promise<string | null> {
  const keys = new Set([...ancestorIds(id, trees[taxonomy].parents), id].map((t) => `${taxonomy}:${t}`));
  const hide = (await standingTermHides()).find((row) => row.termKey != null && keys.has(row.termKey));
  if (!hide) return null;
  const parsed = parseTermKey(hide.termKey!);
  return (parsed && trees[parsed.taxonomy].terms.get(parsed.id)?.name) || hide.labelParams?.term || hide.termKey;
}

/** The terms holding products (heldByTermHides), by name, the most first: "Adidas" holds 6. */
export function heldTerms(held: ReadonlyMap<number, VetrinaOperationRow>, trees: CatalogTrees): { term: string; count: number }[] {
  const per = new Map<string, { term: string; count: number }>();
  for (const row of held.values()) {
    const key = row.termKey!;
    const parsed = parseTermKey(key);
    // The store's name now; the one it had when hidden, if the store no longer has it.
    const term = (parsed && trees[parsed.taxonomy].terms.get(parsed.id)?.name) || row.labelParams?.term || key;
    const entry = per.get(key) ?? { term, count: 0 };
    entry.count += 1;
    per.set(key, entry);
  }
  return [...per.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, "it"));
}

/**
 * The products a whole term's own sale put on sale, while it stands: those
 * its standing sales — the newest, and every one it took the place of —
 * wrote a sale for. Their sale is the term's, not one of their own: a new
 * discount on the term replaces it, it takes nothing of theirs away. Rows
 * newest first, as termOperationRows reads them.
 */
export async function termSaleProducts(rows: readonly VetrinaOperationRow[]): Promise<Set<number>> {
  const out = new Set<number>();
  for (const op of standingSales(rows, shopToday(), Number.POSITIVE_INFINITY)) {
    for (const id of await repo.filedProducts(op.id, "sale")) out.add(id);
  }
  return out;
}
