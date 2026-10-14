import { samePrice } from "@core/core-spine";
import { followSaleRuleFor, manualPriceFor, type StoreOverrides } from "@/server/overrides/model";
import { hasActiveSale, managedStock, parsePrice } from "@/server/store-json/match";
import type { StoreVariation } from "@/server/store-json/model";
import type { ApplyChange } from "./apply";

/**
 * The last look before a live write — pure, so it is tested.
 *
 * A plan is made against the snapshot: the store as the Hub last read it, up
 * to a day old between two daily pulls. The store moves meanwhile — someone
 * changes a price or starts a sale in WordPress, the Vetrina writes a price —
 * and the feed cycle writes every quarter of an hour with nobody watching. So
 * right before writing a product, the apply reads its sizes again and asks,
 * per change, whether the store is still where the plan left it:
 *
 *  - the price is what the plan was made against → written as planned;
 *  - the price moved since (someone changed it in WordPress meanwhile) → KEPT:
 *    the change loses its price, keeps its stock — the same rule the plan
 *    applies to an edit it can already see. Unless a person decided that
 *    size's price just now (a lock set in the Vetrina, "use the Hub's price"):
 *    theirs is the newer word, and it is written;
 *  - the size went on sale since → its price is left alone, as the plan would
 *    have left it had it seen the sale: the product follows the sale rule and
 *    the size has no lock (a lock wins over a sale price, there as here);
 *  - the variation is gone → nothing is written to it;
 *  - an identifier appeared meanwhile → it is not overwritten.
 *
 * Stock is written whatever the store shows: orders move it, and the feed's
 * quantity is what the supplier can still deliver — the truth the sync writes.
 */

/** The fields of a live variation the check reads. */
export interface LiveVariation {
  id: number;
  regular_price?: string | null;
  sale_price?: string | null;
  global_unique_id?: string | null;
  manage_stock?: unknown;
  stock_quantity?: unknown;
}

export interface LiveWrites {
  /** The changes to write, a kept price taken out of its change. */
  write: ApplyChange[];
  /** Prices the store moved after the plan was made: kept, with what it shows. */
  kept: { change: ApplyChange; storePrice: number }[];
  /** Prices left alone: the size went on sale after the plan was made. */
  onSale: ApplyChange[];
  /** Changes aimed at a variation the store no longer has. */
  gone: ApplyChange[];
  /** Prices not written: the size's lock changed after the plan was made. */
  superseded: ApplyChange[];
}

/** What the check knows besides the store: the Hub's own rules, as they stand at the write. */
export interface LiveRules {
  /**
   * Whether a size's price gives way to a sale price on the store: its product
   * follows the sale rule and the size carries no lock. Omitted: none does.
   */
  yieldsToSale?: (change: ApplyChange) => boolean;
  /** A size whose price a person decided just now: written even where the store moved. */
  decided?: (change: ApplyChange) => boolean;
  /**
   * A size whose lock changed after the plan was made (set, moved, cleared):
   * the plan's price is not written, whatever the store shows. Omitted: none.
   */
  superseded?: (change: ApplyChange) => boolean;
}

export function decideLiveWrites(changes: ApplyChange[], live: LiveVariation[], rules: LiveRules = {}): LiveWrites {
  const byId = new Map(live.map((v) => [v.id, v]));
  const out: LiveWrites = { write: [], kept: [], onSale: [], gone: [], superseded: [] };
  for (const c of changes) {
    const v = byId.get(c.storeVariationId);
    if (!v) {
      out.gone.push(c);
      continue;
    }
    let next = c;
    if (c.newPrice != null && (rules.superseded?.(c) ?? false)) {
      out.superseded.push(c);
      next = withoutPrice(next, v);
    } else if (c.newPrice != null) {
      const storePrice = parsePrice(v.regular_price);
      const asPlanned =
        storePrice == null
          ? c.currentPrice == null
          : c.currentPrice != null && samePrice(storePrice, c.currentPrice);
      // Someone set exactly the price the Hub is about to write: nothing is lost.
      const asWanted = storePrice != null && samePrice(storePrice, c.newPrice);
      const moved = !asPlanned && !asWanted && !(rules.decided?.(c) ?? false);
      const onSale = !moved && !asWanted && hasActiveSale(v.sale_price) && (rules.yieldsToSale?.(c) ?? false);
      if (moved || onSale) {
        // A price taken off the store has nothing to keep, and nothing is
        // written over its absence either.
        if (moved && storePrice != null) out.kept.push({ change: c, storePrice });
        if (onSale) out.onSale.push(c);
        next = withoutPrice(next, v);
      }
    }
    if (next.newGtin != null && (v.global_unique_id ?? "").trim()) next = { ...next, newGtin: null };
    if (next.newPrice == null && next.newStock == null && next.newGtin == null) continue;
    out.write.push(next);
  }
  return out;
}

/**
 * A change with its price taken out. A feed row carries its quantity along
 * with its price: alone, it is worth a write only when the store's differs.
 */
function withoutPrice(c: ApplyChange, v: LiveVariation): ApplyChange {
  const next = { ...c, newPrice: null };
  if (next.newStock != null && managedStock(v as StoreVariation) === next.newStock) return { ...next, newStock: null };
  return next;
}

/**
 * The Hub's rules for the live check, as they stand at the write — not as they
 * stood when the plan was made:
 *  - a size gives way to a sale price on the store when its product follows
 *    the sale rule and the size carries no lock (a lock wins over a sale
 *    price, as in buildPlan);
 *  - a size whose lock changed since the plan was made — set or moved (the
 *    Hub drawer saves a lock without writing it), or cleared — is not written
 *    at the plan's price: that price is nobody's word any more. The next plan
 *    writes the lock, or the rules' price.
 */
export function liveRulesFrom(overrides: StoreOverrides, decided?: (change: ApplyChange) => boolean): LiveRules {
  return {
    yieldsToSale: (c) =>
      followSaleRuleFor(overrides, c.sku) && (!c.euSize || manualPriceFor(overrides, c.sku, c.euSize) == null),
    superseded: (c) => {
      if (!c.euSize || c.newPrice == null) return false;
      const lock = manualPriceFor(overrides, c.sku, c.euSize);
      if (lock == null) return c.locked === true;
      return !samePrice(lock, c.newPrice);
    },
    decided,
  };
}
