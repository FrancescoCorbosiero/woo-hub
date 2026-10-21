import "server-only";
import { createHash } from "node:crypto";
import type { OperationPreview } from "@/lib/vetrina/catalog-ops";
import type { OperationLabelParams } from "@/server/db/schema";
import { labelText } from "./plan";
import { words, type Words } from "./words";

/**
 * A proposal's decisions that need neither the shop nor the database, kept
 * apart so the tests reach them: the preview's fingerprint, and the preview
 * told in sentences.
 */

/** JSON with every object's keys in order: the same value, the same text, however it was built. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The preview's fingerprint: every word and number the owner was shown. A
 * confirmation runs the action only while the shop gives the same one.
 */
export function digestOf(preview: OperationPreview): string {
  return createHash("sha256").update(stableJson(preview)).digest("hex");
}

/** How many products the preview counts, changed or left as they are. */
const counted = (preview: OperationPreview) => preview.changes + preview.untouched.reduce((sum, u) => sum + u.count, 0);

/**
 * The preview in sentences, for a reader without the screens: what the
 * action is, what it changes (a few products, before → after), what it
 * leaves as it is and why, and what to know — the warnings last.
 */
export function summaryOf(label: OperationLabelParams, preview: OperationPreview, w: Words = words()): string[] {
  const p = w.proposal;
  const lines = [labelText(label, w)];
  if (preview.page) {
    lines.push(...preview.page.lines);
  } else {
    lines.push(p.changes(preview.changes));
    if (preview.untouched.length > 0) lines.push(p.untouched(preview.untouched.map((u) => p.untouchedPart(u.reason, u.count))));
    for (const s of preview.sample.slice(0, 5)) lines.push(p.example(s.name, s.before, s.after));
    if (preview.sampled != null && preview.sampled < counted(preview)) lines.push(p.sampled(preview.sampled));
    if (preview.margin) lines.push(p.prices(preview.margin.up, preview.margin.down));
  }
  lines.push(...preview.warnings);
  return lines;
}
