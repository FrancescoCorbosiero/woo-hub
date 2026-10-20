import type { FieldSpec, FieldValues } from "./types";

/**
 * Editable block fields — the rules golden-hive-blocks applies
 * (ghb_hub_field_specs in includes/hub-rails-core.php), mirrored here so the
 * phone can say what is wrong before anything is sent. The plugin checks
 * again on every write; keep the two lists in step.
 */
export const FIELD_SPECS: Record<string, Record<string, FieldSpec>> = {
  "golden-hive/shortcode-wrapper": {
    eyebrow: { type: "text", max: 80 },
    title: { type: "text", max: 120 },
    backgroundColor: { type: "enum", options: ["white", "gray", "black"] },
    buttonText: { type: "text", max: 60 },
    buttonUrl: { type: "url", max: 500 },
    // The section's switch (plugin 5.15.0): "yes" keeps it on the page and shows nothing.
    hidden: { type: "enum", options: ["", "yes"] },
  },
  "golden-hive/category-slider": { title: { type: "text", max: 120 } },
  "golden-hive/brand-marquee": { title: { type: "text", max: 120 } },
  "golden-hive/faq-schema": { title: { type: "text", max: 120 }, subtitle: { type: "text", max: 300 } },
  "golden-hive/social-proof": { title: { type: "text", max: 120 } },
  "golden-hive/whatsapp-button": { buttonText: { type: "text", max: 60 }, message: { type: "text", max: 300 } },
};

/**
 * A section's on/off switch: a field to the plugin ("hidden": "yes" or
 * nothing), a switch on the screen — never one of the texts.
 */
export const SWITCH_FIELD = "hidden";

/**
 * The fields of a block the customer may edit as texts: those the config
 * lists, within those the plugin allows, and present in what the site
 * returned (an older plugin returns none) — in the plugin's order. The
 * section's switch is not one of them (see switchable).
 */
export function editableFields(blockName: string, configured: readonly string[], present?: FieldValues): string[] {
  return Object.keys(FIELD_SPECS[blockName] ?? {}).filter(
    (field) => field !== SWITCH_FIELD && configured.includes(field) && (present == null || field in present),
  );
}

/** The customer may switch the section off and on: the config lets them, and the site's plugin reports the switch. */
export function switchable(blockName: string, allowed: boolean, present: FieldValues): boolean {
  return allowed && SWITCH_FIELD in (FIELD_SPECS[blockName] ?? {}) && SWITCH_FIELD in present;
}

export type FieldProblem = "not_editable" | "not_an_option" | "too_long" | "bad_url";

/** Characters as PHP's mb_strlen counts them (an emoji is one). */
const length = (text: string) => [...text].length;

/** What is wrong with a value, or null. Values are compared trimmed, as sent. */
export function fieldProblem(blockName: string, field: string, value: string): FieldProblem | null {
  const rule = FIELD_SPECS[blockName]?.[field];
  if (!rule) return "not_editable";
  const text = value.trim();
  if (rule.type === "enum") return rule.options?.includes(text) ? null : "not_an_option";
  if (rule.max != null && length(text) > rule.max) return "too_long";
  if (rule.type === "url" && text !== "" && !/^(https?:\/\/\S+|\/\S*)$/i.test(text)) return "bad_url";
  return null;
}

/** Fields whose value differs, in `after`'s order. */
export function changedFields(before: FieldValues, after: FieldValues): string[] {
  return Object.keys(after).filter((field) => (before[field] ?? "") !== (after[field] ?? ""));
}

/** Only the changed fields, trimmed: what a write sends. */
export function fieldChanges(before: FieldValues, after: FieldValues): FieldValues {
  const out: FieldValues = {};
  for (const field of changedFields(before, after)) out[field] = (after[field] ?? "").trim();
  return out;
}
