import type { FieldValues, RailFallback, RailSource } from "./types";

/**
 * The homepage's own actions — its sections and its blocks' texts — filed in
 * the same log as the catalog's actions on products (catalog-ops.ts), with
 * the same "Annulla". Each is one write to the page (a WordPress revision
 * through golden-hive-blocks), done at once rather than in the background,
 * and filed with its way back: "Annulla" finds the section again by its
 * fingerprint wherever it is now, and refuses when someone changed it since
 * (src/server/vetrina/operations/page.ts). Client components import only
 * these types.
 */

/**
 * The page as a screen read it, presented back with the action: refused
 * when the page changed since (a section's `attrsHash` too, for an action on
 * one section). Absent: the page as it is when the action runs — what an
 * action asked from outside the screens checks its own way.
 */
export interface PageExpected {
  modifiedGmt: string;
  attrsHash?: string;
}

export type PageActionInput =
  /** A section switched off (it stays on the page and shows nothing) or on again. */
  | { kind: "sectionSwitch"; key: string; on: boolean; expected?: PageExpected }
  /** One section to a place among the sections, 1-based. */
  | { kind: "sectionMove"; key: string; position: number; expected?: PageExpected }
  /** Every section, each once, in a new order. */
  | { kind: "sectionsArrange"; keys: string[]; expected?: PageExpected }
  /** A new section next to another: what it shows, its texts, how many products. */
  | {
      kind: "sectionAdd";
      anchorKey: string;
      place: "after" | "before";
      source: RailSource;
      fields: FieldValues;
      limit?: number;
      expected?: PageExpected;
    }
  /** A section taken off the homepage (its products stay in the shop). */
  | { kind: "sectionRemove"; key: string; expected?: PageExpected }
  /** A section pointed at another category, brand or shop-wide list. */
  | { kind: "sectionSource"; key: string; source: RailSource; fields?: FieldValues; expected?: PageExpected }
  /**
   * A section's own settings, as its editor publishes them: its products in
   * fixed places (`pin`, in order) and hidden (`exclude`), the automatic
   * order after them, its texts and how many products it shows. What is
   * left out stays as it is.
   */
  | {
      kind: "sectionEdit";
      key: string;
      pin?: number[];
      exclude?: number[];
      fallback?: RailFallback;
      fields?: FieldValues;
      limit?: number;
      expected?: PageExpected;
    }
  /** A block that is not a section (a slider, the FAQ): its texts. */
  | { kind: "blockEdit"; path: string; blockName: string; fields: FieldValues; expected?: PageExpected };

export type PageActionKind = PageActionInput["kind"];

export const PAGE_ACTION_KINDS = [
  "sectionSwitch",
  "sectionMove",
  "sectionsArrange",
  "sectionAdd",
  "sectionRemove",
  "sectionSource",
  "sectionEdit",
  "blockEdit",
] as const satisfies readonly PageActionKind[];

const PAGE_KINDS: ReadonlySet<string> = new Set(PAGE_ACTION_KINDS);

/** A homepage action, not one on products. */
export function isPageActionKind(kind: string): kind is PageActionKind {
  return PAGE_KINDS.has(kind);
}

/** A section as an action left it: its key then, and its fingerprint — how "Annulla" finds it again. */
export interface SectionRef {
  key: string;
  attrsHash: string;
  title: string;
}

/** What a section showed and how, before it was pointed elsewhere. */
export interface SourceBefore {
  source: RailSource;
  title: string;
  buttonUrl: string;
  pin: number[];
  exclude: number[];
  fallback: RailFallback;
}

/** A section's settings before its editor published new ones. */
export interface SectionSettings {
  pin: number[];
  exclude: number[];
  fallback: RailFallback;
  /** The fields the publish changed, as they were. */
  fields: FieldValues;
  limit: number;
}

/** A section taken away, as it goes back: next to the same neighbour, with everything it had. */
export interface SectionRestore {
  anchorKey: string;
  place: "after" | "before";
  source: RailSource;
  fields: FieldValues;
  limit: number;
  restore: { pin: number[]; exclude: number[]; fallback: RailFallback; layout: Record<string, string> };
}

/**
 * A homepage action's way back, filed with it (vetrina_operations.page).
 * `section`: the section as the action left it. `order`: every section's
 * fingerprint, top to bottom, before and after.
 */
export type OperationPageRecord =
  | { kind: "sectionSwitch"; section: SectionRef; wasOn: boolean }
  | { kind: "sectionMove" | "sectionsArrange"; order: { before: string[]; after: string[] } }
  | { kind: "sectionAdd"; section: SectionRef }
  | { kind: "sectionRemove"; title: string; restore: SectionRestore; neighbour: SectionRef }
  | { kind: "sectionSource"; section: SectionRef; before: SourceBefore }
  | { kind: "sectionEdit"; section: SectionRef; before: SectionSettings }
  | { kind: "blockEdit"; block: { path: string; blockName: string; attrsHash: string; label: string }; before: FieldValues };
