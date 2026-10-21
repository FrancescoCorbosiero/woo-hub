import type { SectionRef } from "./page-ops";

/**
 * The homepage actions' decisions that need neither the page nor the shop,
 * kept apart so the tests reach them: finding a section again by its
 * fingerprint, the sections' places after a move, how many moved, and the
 * way back of a move (src/server/vetrina/operations/page.ts uses them).
 */

/** A section as these decisions see it. */
export interface PlacedSection {
  key: string;
  /** Its fingerprint: a hash of its settings, wherever it is on the page (two equal sections have equal ones). */
  attrsHash: string;
}

/** A section as an action leaves it: its key, its fingerprint, and its title for the words. */
export function refOf(rail: PlacedSection & { title: string }): SectionRef {
  return { key: rail.key, attrsHash: rail.attrsHash, title: rail.title.trim() || rail.key };
}

/**
 * The section an action left, found again by its fingerprint, wherever it
 * is now: none when it changed since, or is gone. Two equal sections (one
 * fingerprint) are interchangeable — undoing either leaves the same page:
 * the one under the same key when there is one, else the first.
 */
export function findSection<T extends PlacedSection>(sections: readonly T[], ref: PlacedSection): T | null {
  const same = sections.filter((s) => s.attrsHash === ref.attrsHash);
  return same.find((s) => s.key === ref.key) ?? same[0] ?? null;
}

/** The keys with `key` taken out and put back at `position` (1-based; past the end means last). */
export function movedKeys(keys: readonly string[], key: string, position: number): string[] {
  const rest = keys.filter((k) => k !== key);
  const at = Math.min(Math.max(1, Math.round(position)), rest.length + 1) - 1;
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

/**
 * How many items were moved between two orders of the same items — those
 * that left their place among the others, not the ones only pushed along:
 * all of them minus the longest run still in its old order. One section
 * taken from the fourth place to the first is one moved, not four.
 */
export function movedCount<T>(original: readonly T[], now: readonly T[]): number {
  const was = new Map(original.map((item, i) => [item, i]));
  // Patience sorting: tails[k] is the smallest old place ending a run of k + 1.
  const tails: number[] = [];
  for (const item of now) {
    const place = was.get(item);
    if (place == null) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < place) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = place;
  }
  return now.length - tails.length;
}

/** The sections' fingerprints, top to bottom: what a move's record keeps of the page. */
export const fingerprints = (sections: readonly PlacedSection[]): string[] => sections.map((s) => s.attrsHash);

/**
 * The fingerprints in a new order of the same sections: each key's own,
 * where the keys say. Null when a key names no section of the page.
 */
export function fingerprintsIn(sections: readonly PlacedSection[], keys: readonly string[]): string[] | null {
  const byKey = new Map(sections.map((s) => [s.key, s.attrsHash]));
  const out: string[] = [];
  for (const key of keys) {
    const hash = byKey.get(key);
    if (hash == null) return null;
    out.push(hash);
  }
  return out;
}

/**
 * The way back of a move: the sections' keys as they are called now, in
 * their order before it — when the page's sections are exactly as the move
 * left them (the same fingerprints, in the same order). Null when anything
 * changed since: a section edited, added, taken away or moved again.
 * Equal fingerprints are equal sections: any of their keys will do.
 */
export function orderBack(sections: readonly PlacedSection[], order: { before: readonly string[]; after: readonly string[] }): string[] | null {
  const now = fingerprints(sections);
  if (now.length !== order.after.length || now.some((hash, i) => hash !== order.after[i])) return null;
  const keysOf = new Map<string, string[]>();
  for (const s of sections) keysOf.set(s.attrsHash, [...(keysOf.get(s.attrsHash) ?? []), s.key]);
  const keys: string[] = [];
  for (const hash of order.before) {
    const key = keysOf.get(hash)?.shift();
    if (key == null) return null;
    keys.push(key);
  }
  return keys;
}
