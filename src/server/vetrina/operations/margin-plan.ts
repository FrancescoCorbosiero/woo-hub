import "server-only";
import type { AppConfig, RuleScope, ScopedPricingRule } from "@core/config";
import { declaresMarkup, marginKindOf, resolveEffectiveRule } from "@core/config";
import {
  computePrice,
  exceedsDelta,
  medianTierAsk,
  samePrice,
  storeEditOf,
  type SourceProduct,
  type SourceVariant,
} from "@core/core-spine";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import type { MarginValue, TermMarginState } from "@/lib/vetrina/catalog-ops";
import { euro } from "./plan";
import { words, type Words } from "./words";

/**
 * "Cambia il ricarico", decided: which pricing rule is a category's or a
 * brand's own margin, the rule list after setting or removing it, what an
 * undo may put back, and what the margin does to each product's prices —
 * computed by the engine itself (resolveEffectiveRule + computePrice), under
 * the rules in force and under the draft, for the same market prices. Pure —
 * no store, no database — so plan's margin tests pin every rule down.
 */

/** A category or a brand of the store. */
export interface MarginTerm {
  taxonomy: CatalogTaxonomy;
  id: number;
}

/** The rule's scope field a store term is matched by. */
const scopeKey = (taxonomy: CatalogTaxonomy) => (taxonomy === "category" ? "storeCategory" : "storeBrand");

/**
 * A term's margin rule's scope: the term, and its name as a label (never
 * matched). The name is the term's path ("Saldi › Nike"), as the Hub's
 * Margins tab saves it: a sub-category is told from a top-level term of the
 * same name on its card, in the drawer and on the product sheet.
 */
export function termScope(term: MarginTerm, name: string): RuleScope {
  const label = name.trim().slice(0, 200);
  return {
    [scopeKey(term.taxonomy)]: term.id,
    ...(label ? { storeTermName: label } : {}),
  };
}

/**
 * A term's own margin rule: scoped to exactly this store term. A rule that
 * narrows it any further — the other taxonomy too, a size range, a brand —
 * is one the operator wrote on the Hub's Margins tab: it stays his, and the
 * Vetrina neither shows it as the term's margin nor rewrites it.
 */
export function isTermMarginRule(rule: ScopedPricingRule, term: MarginTerm): boolean {
  const key = scopeKey(term.taxonomy);
  if (rule.scope[key] !== term.id) return false;
  return Object.entries(rule.scope).every(([k, v]) => k === key || k === "storeTermName" || v == null || v === "");
}

/** The term's margin rule, and where it sits — the last, as the later of two equal rules is the one that prices. */
export function findTermMarginRule(
  rules: readonly ScopedPricingRule[],
  term: MarginTerm,
): { rule: ScopedPricingRule; index: number } | null {
  for (let i = rules.length - 1; i >= 0; i--) {
    if (isTermMarginRule(rules[i], term)) return { rule: rules[i], index: i };
  }
  return null;
}

/** A rule's margin, as the owner reads it; null when it states none. */
export function marginValueOf(rule: ScopedPricingRule): MarginValue | null {
  switch (marginKindOf(rule)) {
    case "bands":
      return { kind: "bands" };
    case "fixed":
      return { kind: "fixed", amount: rule.markupFixed! };
    case "percent":
      return { kind: "percent", percent: rule.markupPercent! };
    case "none":
      return null;
  }
}

/** A rule that prices: enabled, and stating a margin. */
const pricing = (rule: ScopedPricingRule | undefined): rule is ScopedPricingRule => rule != null && rule.enabled && declaresMarkup(rule);

/**
 * What a term's "Ricarico" row says: its own margin; the one of the nearest
 * term above it that has one — what it follows without its own, and where
 * "Torna allo standard" takes it; and the shop's standard (the general rule
 * — the last of them, as the engine reads a tie).
 */
export function termMarginOf(
  rules: readonly ScopedPricingRule[],
  term: MarginTerm,
  /** The term's ancestors, the nearest first. */
  ancestors: readonly { id: number; name: string }[],
): Pick<TermMarginState, "own" | "inherited" | "standard"> {
  const own = findTermMarginRule(rules, term)?.rule;
  let inherited: TermMarginState["inherited"] = null;
  for (const a of ancestors) {
    const rule = findTermMarginRule(rules, {
      taxonomy: term.taxonomy,
      id: a.id,
    })?.rule;
    if (pricing(rule)) {
      inherited = { term: a.name, value: marginValueOf(rule)! };
      break;
    }
  }
  const general = [...rules].reverse().find((r) => pricing(r) && Object.keys(r.scope).length === 0);
  return {
    own: pricing(own) ? marginValueOf(own) : null,
    inherited,
    standard: general ? marginValueOf(general) : null,
  };
}

/** An id no other rule has: the base, else the base numbered. */
export function freshRuleId(rules: readonly ScopedPricingRule[], base: string): string {
  const taken = new Set(rules.map((r) => r.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** What setting or removing a term's margin does to the rule list — and what the log keeps for "Annulla". */
export interface MarginChange {
  rules: ScopedPricingRule[];
  /** The term's rule before (null: it had none) and after (null: it has none). */
  before: ScopedPricingRule | null;
  after: ScopedPricingRule | null;
  /** Where the rule was, or is now: an undo puts a removed rule back there. */
  index: number;
}

/** The rule without its margin: what it keeps when its term goes back to the margin above it. */
function withoutMargin(rule: ScopedPricingRule): ScopedPricingRule {
  const { markupPercent: _p, markupBands: _b, markupFixed: _f, ...rest } = rule;
  return rest;
}

/** Whether a rule holds anything but its scope, its switch and its margin: a net the operator set on the Margins tab. */
function holdsNets(rule: ScopedPricingRule): boolean {
  return Object.keys(withoutMargin(rule)).some((k) => k !== "id" && k !== "scope" && k !== "enabled");
}

/**
 * The rule list with the term's margin set to `percent` — or removed (null).
 *
 * Removed, the rule goes — unless the operator gave it more than a margin on
 * the Margins tab (a rounding, a minimum margin, a delta guard): then only
 * its margin goes, and the rule stays to keep those for the term's products,
 * merged field by field as every rule without a margin is.
 *
 * A rule the term already has is changed where it stands: same id, same
 * place in the list, and every field that is not the margin kept (a
 * rounding the operator gave it on the Margins tab stays). It is switched
 * on, and its margin becomes the percent, alone: bands or a fixed amount
 * would otherwise win over it (the whole-margin takeover reads them first).
 *
 * A new one only states the margin: everything else — rounding, VAT, the
 * €20 minimum margin, the outlier guard — it inherits from the broader
 * rules, field by field, as every scoped rule does. It goes at the END of
 * the list: never in place of the general rule (the Hub's pricing bar edits
 * pricingRules[0]), and later wins a tie with another term's rule at the
 * same depth, as the owner's latest word should.
 */
export function withTermMargin(rules: readonly ScopedPricingRule[], term: MarginTerm, name: string, percent: number | null): MarginChange {
  const found = findTermMarginRule(rules, term);
  if (percent == null) {
    if (!found) return { rules: [...rules], before: null, after: null, index: -1 };
    // A rule that states no margin already: nothing to take away.
    if (!declaresMarkup(found.rule)) return { rules: [...rules], before: found.rule, after: found.rule, index: found.index };
    if (holdsNets(found.rule)) {
      const after = withoutMargin(found.rule);
      const next = [...rules];
      next[found.index] = after;
      return { rules: next, before: found.rule, after, index: found.index };
    }
    return {
      rules: rules.filter((_, i) => i !== found.index),
      before: found.rule,
      after: null,
      index: found.index,
    };
  }
  if (found) {
    const { markupBands: _bands, markupFixed: _fixed, ...rest } = found.rule;
    const after: ScopedPricingRule = {
      ...rest,
      scope: termScope(term, name),
      enabled: true,
      markupPercent: percent,
    };
    const next = [...rules];
    next[found.index] = after;
    return { rules: next, before: found.rule, after, index: found.index };
  }
  const after: ScopedPricingRule = {
    id: freshRuleId(rules, `store-${term.taxonomy}-${term.id}`),
    scope: termScope(term, name),
    enabled: true,
    markupPercent: percent,
  };
  return { rules: [...rules, after], before: null, after, index: rules.length };
}

/** Two rules alike, field by field — whatever order the stored JSON keeps their keys in. */
export function sameRule(a: ScopedPricingRule | null, b: ScopedPricingRule | null): boolean {
  if (a == null || b == null) return a == b;
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * "Annulla" on a margin, given the rule list now. As for every action
 * (plan.ts, undoVerdict): the term's rule is put back only where it is
 * still exactly what the action wrote — someone who changed it since, here
 * or on the Hub's Margins tab, has the newer word.
 */
export type MarginUndo = { verdict: "restore"; rules: ScopedPricingRule[] } | { verdict: "already" } | { verdict: "changed" };

export function undoTermMargin(
  rules: readonly ScopedPricingRule[],
  term: MarginTerm,
  record: Pick<MarginChange, "before" | "after" | "index">,
): MarginUndo {
  const found = findTermMarginRule(rules, term);
  const now = found?.rule ?? null;
  if (sameRule(record.before, record.after) || sameRule(now, record.before)) return { verdict: "already" };
  if (!sameRule(now, record.after)) return { verdict: "changed" };
  const next = [...rules];
  if (found && record.before) next[found.index] = record.before;
  else if (found) next.splice(found.index, 1);
  else if (record.before) next.splice(Math.max(0, Math.min(record.index, next.length)), 0, record.before);
  return { verdict: "restore", rules: next };
}

/* ---------------------------------------------------------------- *
 * What the margin does to prices
 * ---------------------------------------------------------------- */

/** A product the margin may price, as the preview weighs it. */
export interface MarginSubject {
  /** With its store terms (src/server/pricing/store-terms.ts): what a store-term rule is matched against. */
  product: SourceProduct;
  /**
   * The sizes the shop sells (every size the source has, when the store's
   * are unknown): whether a person locked its price, whether it is on a
   * sale the product follows — the plan holds its regular price while it
   * lasts — and, where the Hub's copy of the shop has it, the regular price
   * the store shows and the one the Hub last wrote there.
   */
  sizes: {
    variant: SourceVariant;
    locked: boolean;
    onSale?: boolean;
    store?: { price: number | null; hubPrice?: number | null };
  }[];
}

/**
 * One product under the margin:
 * - covered: the term's margin decides at least one of its sizes — the
 *   prices of those sizes before and after, in order; locked sizes and
 *   sizes on sale are left out and counted (they keep their price);
 * - otherRule: it has prices, but a more specific rule decides every one
 *   (a SKU rule, a deeper category's or brand's, a brand rule later in the list);
 * - noQuote: the market gives no price for any of its sizes.
 */
export type MarginOutcome =
  | {
      kind: "covered";
      before: number[];
      after: number[];
      lockedSizes: number;
      saleSizes: number;
      /** Sizes the sync would leave as they are, as its plan does (see assessMarginSubject). */
      guard?: { belowMin: number; overMax: number; edited: number };
    }
  | { kind: "otherRule" }
  | { kind: "noQuote" };

/**
 * A product's prices under the rules in force (`current`) and under the
 * draft — the same market prices, the engine's own rule resolution and
 * price, so what the preview shows is what the reprice computes. The
 * term's rule decides a size when it is the one setting its margin in
 * either list: `ids.draft` (the rule being set) or `ids.current` (the
 * term's rule now, being changed or removed).
 *
 * Where the store's price of a size is known, it is the "before" — what
 * the shop shows — and the size moves only as the sync's plan would move it
 * (buildPlan): not when the new price is within the rule's minimum change
 * (the anti-churn threshold: a 2-point margin change on a cheap shoe can be
 * below it), not past its maximum change, and not where the price was
 * changed on WordPress since the Hub wrote it. Those are counted apart, so
 * the preview never promises a move the reprice will not make.
 */
export function assessMarginSubject(
  subject: MarginSubject,
  current: AppConfig,
  draft: AppConfig,
  ids: { current: string | null; draft: string | null },
): MarginOutcome {
  const { product } = subject;
  const before: number[] = [];
  const after: number[] = [];
  let decided = 0;
  let lockedSizes = 0;
  let saleSizes = 0;
  const guard = { belowMin: 0, overMax: 0, edited: 0 };
  let priced = false;
  for (const { variant, locked, onSale, store } of subject.sizes) {
    const ruleBefore = resolveEffectiveRule(product, variant, current);
    const ruleAfter = resolveEffectiveRule(product, variant, draft);
    const priceBefore = ruleBefore
      ? computePrice(variant, ruleBefore, {
          medianAsk: medianTierAsk(product, ruleBefore.sourceDeliveryType),
        })
      : null;
    const priceAfter = ruleAfter
      ? computePrice(variant, ruleAfter, {
          medianAsk: medianTierAsk(product, ruleAfter.sourceDeliveryType),
        })
      : null;
    const quoted = priceBefore != null && priceAfter != null;
    priced ||= quoted;
    const ours =
      (ids.draft != null && ruleAfter?.markupRuleId === ids.draft) || (ids.current != null && ruleBefore?.markupRuleId === ids.current);
    if (!ours || !quoted) continue;
    decided += 1;
    // A locked size keeps the owner's price, whatever the margin (a lock wins over a sale, as in the plan).
    if (locked) {
      lockedSizes += 1;
      continue;
    }
    // On sale: the regular price waits for the sale's end, then follows the margin.
    if (onSale) {
      saleSizes += 1;
      continue;
    }
    const shown = store?.price ?? null;
    if (shown == null || ruleAfter == null) {
      before.push(priceBefore);
      after.push(priceAfter);
      continue;
    }
    // The plan's own order: already there; within the minimum change; past
    // the maximum; changed on WordPress since the Hub wrote it.
    if (samePrice(shown, priceAfter)) {
      before.push(shown);
      after.push(shown);
      continue;
    }
    if (ruleAfter.minDeltaPercent != null && !exceedsDelta(shown, priceAfter, ruleAfter.minDeltaPercent)) {
      guard.belowMin += 1;
      continue;
    }
    if (ruleAfter.maxDeltaPercent != null && exceedsDelta(shown, priceAfter, ruleAfter.maxDeltaPercent)) {
      guard.overMax += 1;
      continue;
    }
    if (storeEditOf({ currentPrice: shown, hubPrice: store?.hubPrice ?? undefined })) {
      guard.edited += 1;
      continue;
    }
    before.push(shown);
    after.push(priceAfter);
  }
  if (decided > 0) {
    const guarded = guard.belowMin + guard.overMax + guard.edited > 0;
    return { kind: "covered", before, after, lockedSizes, saleSizes, ...(guarded ? { guard } : {}) };
  }
  return priced ? { kind: "otherRule" } : { kind: "noQuote" };
}

export type MarginMove = "up" | "down" | "same";

const cents = (price: number) => Math.round(price * 100);

/** How a covered product's prices move: by the sum of its sizes (in cents, so rounding never reads as a move). */
export function marginMove(outcome: Extract<MarginOutcome, { kind: "covered" }>): MarginMove {
  const delta = outcome.after.reduce((s, p) => s + cents(p), 0) - outcome.before.reduce((s, p) => s + cents(p), 0);
  return delta > 0 ? "up" : delta < 0 ? "down" : "same";
}

export interface MarginSummary {
  applies: number;
  up: number;
  down: number;
  same: number;
  /** The mean of each product's change (its sizes' prices together), in percent, one decimal; null with none to compare. */
  averageChange: number | null;
  lockedSizes: number;
  saleSizes: number;
  /** Sizes the sync leaves as they are: within the minimum change, past the maximum, changed on WordPress. */
  belowMinSizes: number;
  overMaxSizes: number;
  editedSizes: number;
  otherRule: number;
  noQuote: number;
}

export function summarizeMargin(outcomes: readonly MarginOutcome[]): MarginSummary {
  const out: MarginSummary = {
    applies: 0,
    up: 0,
    down: 0,
    same: 0,
    averageChange: null,
    lockedSizes: 0,
    saleSizes: 0,
    belowMinSizes: 0,
    overMaxSizes: 0,
    editedSizes: 0,
    otherRule: 0,
    noQuote: 0,
  };
  const changes: number[] = [];
  for (const o of outcomes) {
    if (o.kind !== "covered") {
      out[o.kind] += 1;
      continue;
    }
    out.applies += 1;
    out.lockedSizes += o.lockedSizes;
    out.saleSizes += o.saleSizes;
    out.belowMinSizes += o.guard?.belowMin ?? 0;
    out.overMaxSizes += o.guard?.overMax ?? 0;
    out.editedSizes += o.guard?.edited ?? 0;
    out[marginMove(o)] += 1;
    const before = o.before.reduce((s, p) => s + p, 0);
    const after = o.after.reduce((s, p) => s + p, 0);
    if (before > 0) changes.push((after / before - 1) * 100);
  }
  if (changes.length > 0) {
    const mean = changes.reduce((s, c) => s + c, 0) / changes.length;
    // −0.0 reads as "−0%": a mean that rounds to nothing is nothing.
    out.averageChange = Math.round(mean * 10) / 10 || 0;
  }
  return out;
}

/** A product's prices before → after in words: the lowest, "da" when its sizes differ — as a sale's preview says them. */
export function marginPriceWords(
  outcome: Extract<MarginOutcome, { kind: "covered" }>,
  w: Words = words(),
): { before: string; after: string } {
  const say = (list: number[]) => {
    if (list.length === 0) return w.state.noPrice;
    const low = Math.min(...list.map(cents));
    return new Set(list.map(cents)).size > 1 ? w.state.from(euro(low, w)) : euro(low, w);
  };
  return { before: say(outcome.before), after: say(outcome.after) };
}
