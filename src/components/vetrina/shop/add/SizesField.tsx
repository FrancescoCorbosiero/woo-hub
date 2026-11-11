"use client";

import * as React from "react";
import { Button, Segmented, SegmentedButton } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { duplicateSizes, EU_SIZES, HANDMADE_LIMITS, LETTER_SIZES, sizeKey, sortSizes } from "@/lib/handmade";
import { SEGMENTED_COLORS } from "../../segmented";
import { FIELD, INPUT, INVALID } from "./look";

/** One size in the form, as typed: the check reads the numbers when the product is made. */
export interface SizeRow {
  key: string;
  label: string;
  price: string;
  stock: string;
  barcode: string;
}

export interface OneSize {
  price: string;
  stock: string;
  barcode: string;
}

let nextKey = 0;
const rowKey = () => `s${++nextKey}`;

export function sizeRow(label: string, price = "", stock = "1"): SizeRow {
  return { key: rowKey(), label, price, stock, barcode: "" };
}

const CHIP = "h-9 min-w-[3.25rem] rounded-full px-3 text-[15px] tabular-nums active:opacity-60";
const CHIP_OFF = "bg-black/[0.06] dark:bg-white/10";
const CHIP_ON = "bg-primary font-semibold text-white dark:text-black";

/**
 * The form's sizes and prices: a product with sizes — picked in a tap from
 * the usual EU run and the clothes sizes, or typed — each with its price,
 * its pieces and, if the owner has it, its barcode; or one that comes in one
 * size. "Prezzo per tutte" fills every size at once.
 */
export function SizesField({
  mode,
  onMode,
  sizes,
  onSizes,
  one,
  onOne,
  invalid,
}: {
  mode: "sizes" | "one";
  onMode: (mode: "sizes" | "one") => void;
  sizes: SizeRow[];
  onSizes: (change: (current: SizeRow[]) => SizeRow[]) => void;
  one: OneSize;
  onOne: (one: OneSize) => void;
  invalid: boolean;
}) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.shop.handmade;
  const [picking, setPicking] = React.useState(sizes.length === 0);
  const [other, setOther] = React.useState("");
  const [allPrice, setAllPrice] = React.useState("");
  const [allStock, setAllStock] = React.useState("");
  const [barcodes, setBarcodes] = React.useState(false);
  const present = new Set(sizes.map((s) => sizeKey(s.label)));
  const twice = duplicateSizes(sizes.map((s) => s.label));

  function toggle(label: string) {
    const key = sizeKey(label);
    onSizes((current) =>
      current.some((s) => sizeKey(s.label) === key)
        ? current.filter((s) => sizeKey(s.label) !== key)
        : current.length >= HANDMADE_LIMITS.sizes
          ? current
          : sortSizes([...current, sizeRow(label, allPrice)], (s) => s.label),
    );
  }

  function addOther() {
    const label = other.trim().replace(/\s+/g, " ").slice(0, HANDMADE_LIMITS.sizeLabel);
    if (!label) return;
    if (!present.has(sizeKey(label))) toggle(label);
    setOther("");
  }

  function update(key: string, change: Partial<SizeRow>) {
    onSizes((current) => current.map((s) => (s.key === key ? { ...s, ...change } : s)));
  }

  function applyAll() {
    onSizes((current) =>
      current.map((s) => ({
        ...s,
        price: allPrice.trim() ? allPrice : s.price,
        stock: allStock.trim() ? allStock : s.stock,
      })),
    );
  }

  const chips = (labels: readonly string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => {
        const on = present.has(sizeKey(label));
        return (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
            onClick={() => toggle(label)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      <Segmented strong rounded colors={SEGMENTED_COLORS}>
        <SegmentedButton className="!h-10" active={mode === "sizes"} onClick={() => onMode("sizes")}>
          {w.withSizes}
        </SegmentedButton>
        <SegmentedButton className="!h-10" active={mode === "one"} onClick={() => onMode("one")}>
          {w.oneSize}
        </SegmentedButton>
      </Segmented>

      {mode === "one" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block px-1 text-[13px] opacity-60">{w.price} (€)</span>
            <input
              className={`${INPUT} tabular-nums ${invalid && !one.price.trim() ? INVALID : ""}`}
              inputMode="decimal"
              value={one.price}
              placeholder="0,00"
              onChange={(e) => onOne({ ...one, price: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block px-1 text-[13px] opacity-60">{w.stock}</span>
            <input
              className={`${INPUT} tabular-nums`}
              inputMode="numeric"
              value={one.stock}
              onChange={(e) => onOne({ ...one, stock: e.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block px-1 text-[13px] opacity-60">{w.barcode}</span>
            <input
              className={`${INPUT} tabular-nums`}
              inputMode="numeric"
              value={one.barcode}
              placeholder="EAN / UPC"
              onChange={(e) => onOne({ ...one, barcode: e.target.value.replace(/\s/g, "") })}
            />
          </label>
        </div>
      ) : (
        <>
          {picking ? (
            <div className="space-y-3 rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.06]">
              <p className="text-[13px] font-semibold opacity-60">{w.shoes}</p>
              {chips(EU_SIZES)}
              <p className="text-[13px] font-semibold opacity-60">{w.clothes}</p>
              {chips(LETTER_SIZES)}
              <div className="flex gap-2">
                <input
                  className={`${FIELD} min-w-0 flex-1`}
                  value={other}
                  placeholder={w.otherSizePlaceholder}
                  aria-label={w.otherSize}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addOther();
                    }
                  }}
                />
                <Button rounded tonal className="!h-auto !w-auto shrink-0 !px-4" onClick={addOther}>
                  {w.add}
                </Button>
              </div>
              <Button rounded className="!h-10 w-full" onClick={() => setPicking(false)} disabled={sizes.length === 0}>
                {w.done}
              </Button>
            </div>
          ) : (
            <Button rounded tonal className="!h-10 w-full" onClick={() => setPicking(true)}>
              {w.addSizes}
            </Button>
          )}

          {sizes.length > 1 && (
            <div className="flex items-end gap-2">
              <label className="block min-w-0 flex-1">
                <span className="mb-1 block px-1 text-[13px] opacity-60">{w.priceAll} (€)</span>
                <input
                  className={`${INPUT} tabular-nums`}
                  inputMode="decimal"
                  value={allPrice}
                  placeholder="0,00"
                  onChange={(e) => setAllPrice(e.target.value)}
                />
              </label>
              <label className="block w-24 shrink-0">
                <span className="mb-1 block px-1 text-[13px] opacity-60">{w.stock}</span>
                <input
                  className={`${INPUT} tabular-nums`}
                  inputMode="numeric"
                  value={allStock}
                  onChange={(e) => setAllStock(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <Button
                rounded
                tonal
                className="!h-[46px] !w-auto shrink-0 !px-4"
                onClick={applyAll}
                disabled={!allPrice.trim() && !allStock.trim()}
              >
                {w.apply}
              </Button>
            </div>
          )}

          {sizes.length > 0 && (
            <div className="space-y-2">
              <div className="flex gap-2 px-1 text-[12px] font-semibold uppercase tracking-wide opacity-50">
                <span className="w-16 shrink-0">{w.sizeColumn}</span>
                <span className="min-w-0 flex-1">{w.price} (€)</span>
                <span className="w-20 shrink-0">{w.stock}</span>
                <span className="w-9 shrink-0" />
              </div>
              {sizes.map((s) => {
                const repeated = twice.includes(s.label.trim());
                return (
                  <div key={s.key} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`grid h-[46px] w-16 shrink-0 place-items-center rounded-xl bg-black/[0.06] text-[15px] font-semibold tabular-nums dark:bg-white/10 ${repeated ? "text-red-600 dark:text-red-400" : ""}`}
                      >
                        {s.label}
                      </span>
                      <input
                        className={`${FIELD} min-w-0 flex-1 tabular-nums ${invalid && !s.price.trim() ? INVALID : ""}`}
                        inputMode="decimal"
                        value={s.price}
                        placeholder="0,00"
                        aria-label={`${w.size(s.label)} — ${w.price}`}
                        onChange={(e) => update(s.key, { price: e.target.value })}
                      />
                      <input
                        className={`${FIELD} w-20 shrink-0 tabular-nums`}
                        inputMode="numeric"
                        value={s.stock}
                        aria-label={`${w.size(s.label)} — ${w.stock}`}
                        onChange={(e) =>
                          update(s.key, {
                            stock: e.target.value.replace(/\D/g, ""),
                          })
                        }
                      />
                      <button
                        type="button"
                        aria-label={`${w.removeSize} ${s.label}`}
                        onClick={() => onSizes((current) => current.filter((r) => r.key !== s.key))}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[20px] leading-none opacity-50 active:opacity-30"
                      >
                        ×
                      </button>
                    </div>
                    {barcodes && (
                      <input
                        className={`${INPUT} tabular-nums`}
                        inputMode="numeric"
                        value={s.barcode}
                        placeholder={`${w.barcode} ${s.label}`}
                        aria-label={`${w.size(s.label)} — ${w.barcode}`}
                        onChange={(e) =>
                          update(s.key, {
                            barcode: e.target.value.replace(/\s/g, ""),
                          })
                        }
                      />
                    )}
                  </div>
                );
              })}
              {twice.length > 0 && <p className="px-1 text-[13px] text-red-600 dark:text-red-400">{w.twice(twice)}</p>}
              <button
                type="button"
                className="h-11 px-1 text-[14px] text-primary active:opacity-50"
                onClick={() => setBarcodes((on) => !on)}
              >
                {w.barcodes}
              </button>
              {barcodes && <p className="px-1 text-[13px] leading-snug opacity-60">{w.barcodesHint}</p>}
            </div>
          )}
          {invalid && sizes.length === 0 && <p className="px-1 text-[13px] text-red-600 dark:text-red-400">{w.noSizes}</p>}
        </>
      )}
    </div>
  );
}
