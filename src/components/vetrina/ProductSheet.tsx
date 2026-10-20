"use client";

import * as React from "react";
import { Sheet } from "react-modal-sheet";
import { Button, List, ListItem, Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import type { DrawerData } from "@/components/catalog/drawer-data";
import type { OperationView } from "@/lib/vetrina/catalog-ops";
import type { ProductCard } from "@/lib/vetrina/types";
import { loadProductPrices, publishProductPrices } from "@/server/actions/vetrina-prices";
import { setProductManualPrices } from "@/server/actions/overrides";
import { updateStoreVariation } from "@/server/actions/store-edit";
import { repriceStoreEdits } from "@/server/actions/store-edits";
import { useChanged } from "../use-changed";
import { useLastShown } from "./catalog/act/parts";
import { ROW, ROW_INNER, ROWS, SHEET_CARD, SHEET_LIST, SHEET_LIST_COLORS } from "./catalog/sheet/look";
import { PlacementSection } from "./catalog/sheet/PlacementSection";
import { cardShows } from "./catalog/sheet/placement-model";
import { formatCardPrice, formatEuro, parsePrice } from "./format";
import { External, Lock } from "./icons";
import { useSheetMount, useStandalone } from "./sheet-mount";
import { TagsSection } from "./TagsSection";

const toInput = (n: number | null | undefined) => (n == null ? "" : n.toFixed(2).replace(".", ","));

/**
 * A product's prices, from the rail editor or the catalog. Each size shows
 * the market ask and the price the Hub computes; typing a price locks it,
 * clearing it unlocks. "Salva e pubblica" saves the locks in the Hub and
 * pushes this one product's prices to the site. Store-only products have no
 * source price: their shelf price is edited directly.
 *
 * Below the prices, the product's tags: what the automatic categories read,
 * so changing them here moves the product in or out of those sections. Then
 * its place in the shop — visibility, categories, brands, homepage sections,
 * sale — each a way to that screen, and each an action on this one product
 * (hide, a category, the homepage, a sale), run like the catalog's own and
 * undone the same way. Last, the links out: the site, WordPress, the Hub.
 */
export function ProductSheet({
  card,
  onClose,
  onLocksChanged,
  onPricesChanged,
  onTagsChanged,
  confirmLeave,
  demo,
}: {
  card: ProductCard | null;
  onClose: () => void;
  onLocksChanged: (sku: string, count: number) => void;
  /**
   * What the product's card shows changed on the site — its prices, or (from
   * "Nel negozio") its sale or its visibility: the list re-reads this card.
   */
  onPricesChanged: (id: number) => void;
  /**
   * The product may have moved in or out of what the screen shows: its tags
   * moved it in or out of an automatic category, or an action from "Nel
   * negozio" ended (hidden, a category, the homepage, a sale) or was undone.
   * The section or the list reloads.
   */
  onTagsChanged?: () => void;
  /** Asked before a link in the sheet leaves the screen; false stays (the section editor's unpublished changes). */
  confirmLeave?: () => boolean;
  demo: boolean;
}) {
  const { t, locale } = useI18n();
  const mountPoint = useSheetMount();
  const standalone = useStandalone();
  const p = t.vetrina.product;
  // While the sheet slides away it keeps showing the product it was opened on.
  const shown = useLastShown(card);
  const [data, setData] = React.useState<DrawerData | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  // Tags that moved the product change its categories: its place is read again.
  const [moved, setMoved] = React.useState(0);

  // The product last asked for: an answer for one opened before is dropped.
  const asked = React.useRef("");
  const read = React.useCallback((sku: string) => {
    asked.current = sku;
    return loadProductPrices({ sku }).then((res) => {
      if (asked.current !== sku) return;
      if (!res.ok) {
        setError(res.error);
        setData(null);
        return;
      }
      setData(res.data);
      const next: Record<string, string> = {};
      if (res.data?.store) {
        for (const v of res.data.store.variants) next[String(v.variationId)] = toInput(v.price);
      } else if (res.data) {
        for (const v of res.data.variants) if (v.euSize) next[v.euSize] = toInput(v.manual);
      }
      setEdits(next);
    });
  }, []);
  /** Read again after a write: the sheet waits for it, as when it opens. */
  const load = React.useCallback(
    (sku: string) => {
      setData(undefined);
      setError(null);
      return read(sku);
    },
    [read],
  );

  // Keyed on the SKU, not the card: a card refreshed after a publish must not
  // reload the sheet under the operator's fingers. Another product: the sheet
  // waits for it from this very render.
  const sku = card?.sku ?? "";
  const skuChanged = useChanged(sku);
  if (skuChanged && sku && !demo) {
    setData(undefined);
    setError(null);
  }
  React.useEffect(() => {
    if (!sku || demo) return;
    void read(sku);
  }, [sku, demo, read]);

  async function saveCatalog(d: DrawerData) {
    const prices: { euSize: string; price: number | null }[] = [];
    for (const v of d.variants) {
      if (!v.euSize) continue;
      const text = (edits[v.euSize] ?? "").trim();
      const next = text === "" ? null : parsePrice(text);
      if (text !== "" && next == null) {
        toast.error(`${p.invalidPrice}: ${v.euSize}`);
        return;
      }
      if (next !== v.manual) prices.push({ euSize: v.euSize, price: next });
    }
    if (prices.length === 0) {
      toast(p.nothingToSave);
      return;
    }
    setSaving(true);
    try {
      const locked = await setProductManualPrices({ parentSku: d.sku, prices });
      if (!locked.ok) {
        toast.error(locked.error ?? t.vetrina.errors.failed);
        return;
      }
      const lockedCount = d.variants.filter((v) => v.euSize && (edits[v.euSize] ?? "").trim() !== "").length;
      onLocksChanged(d.sku, lockedCount);
      // The sizes decided here are written even where the store moved since
      // the Hub last read it; the others keep what the store shows.
      const published = await publishProductPrices({ sku: d.sku, sizes: prices.map((x) => x.euSize) });
      if (!published.ok) toast.error(`${p.savedLocked}. ${published.noSnapshot ? p.noSnapshot : published.error}`);
      else if (published.failed > 0) toast.error(p.someFailed(published.failed));
      else if (published.updated > 0) toast.success(p.saved(published.updated));
      else if (published.unpriced) toast.warning(p.notPriced);
      else if (published.kept === 0 && published.onSale === 0) toast(p.upToDate);
      if (published.ok && published.kept > 0) toast.warning(p.keptChanged(published.kept));
      if (published.ok && published.onSale > 0) toast(p.keptOnSale(published.onSale));
      if (published.ok && published.updated > 0 && card) onPricesChanged(card.id);
      await load(d.sku);
    } finally {
      setSaving(false);
    }
  }

  /** A size changed on WordPress goes back to the Hub's price, written now. */
  async function restoreHubPrice(d: DrawerData, variationId: number) {
    setSaving(true);
    try {
      const res = await repriceStoreEdits({ ids: [variationId] });
      if (!res.ok) toast.error(res.error);
      else if (res.data.error) toast.error(res.data.error);
      else {
        toast.success(p.storeEditRepriced);
        if (card && res.data.updated > 0) onPricesChanged(card.id);
      }
      await load(d.sku);
    } finally {
      setSaving(false);
    }
  }

  async function saveStore(d: DrawerData) {
    const store = d.store!;
    const writes: { variationId: number; price: number }[] = [];
    for (const v of store.variants) {
      const text = (edits[String(v.variationId)] ?? "").trim();
      const next = parsePrice(text);
      if (next == null) {
        if (text !== "") toast.error(`${p.invalidPrice}: ${v.sizeLabel}`);
        if (text !== "") return;
        continue;
      }
      if (next !== v.price) writes.push({ variationId: v.variationId, price: next });
    }
    if (writes.length === 0) {
      toast(p.nothingToSave);
      return;
    }
    setSaving(true);
    try {
      let done = 0;
      for (const w of writes) {
        const res = await updateStoreVariation({ storeProductId: store.productId, ...w });
        if (!res.ok) {
          toast.error(res.error ?? t.vetrina.errors.failed);
          break;
        }
        done += 1;
      }
      if (done > 0) {
        toast.success(p.saved(done));
        if (card) onPricesChanged(card.id);
      }
      await load(d.sku);
    } finally {
      setSaving(false);
    }
  }

  /**
   * An action from "Nel negozio" ended (or its "Annulla" did): the screen
   * behind re-reads the product's card. Its lists and the section editor
   * hear of every action that ends on their own (useOperationSettled):
   * telling them again here made the editor read the section twice, and say
   * it had changed when nothing had. The sizes above stay as they are: a
   * sale writes sale prices, never the prices shown there, and reading them
   * again would drop what the owner is typing.
   */
  const acted = (view: OperationView) => {
    if (!shown) return;
    if (cardShows(view.kind)) onPricesChanged(shown.id);
  };

  const hubLink = shown?.sku && !demo && !standalone ? `/?product=${encodeURIComponent(shown.sku)}` : null;

  const ruleLabel = (d: DrawerData) => {
    const r = d.appliedRule;
    if (!r) return null;
    // A category's or brand's margin says whose it is: the shop's own term,
    // not a catalog brand of the same name.
    const scope = r.isGeneral
      ? p.generalRule
      : r.storeTerm
        ? p.storeTermRule(r.storeTerm.name ?? r.scopeLabel, r.storeTerm.taxonomy)
        : r.scopeLabel;
    const amount =
      r.kind === "percent" && r.markupPercent != null
        ? ` · ${r.markupPercent}%`
        : r.kind === "fixed" && r.markupFixed != null
          ? ` · ${t.vetrinaCatalog.margins.value.fixed(r.markupFixed)}`
          : "";
    return p.rule(`${scope}${amount}`);
  };

  return (
    <Sheet isOpen={card != null} onClose={onClose} detent="content" avoidKeyboard mountPoint={mountPoint}>
      <Sheet.Container className="!bg-[#f2f2f7] dark:!bg-[#1c1c1e]">
        <Sheet.Header />
        <Sheet.Content>
          {shown && (
            <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
              <div className="flex items-center gap-3">
                {/* A catalog row opened before its store card arrived has no photo yet: an empty tile, not src="". */}
                {/* eslint-disable-next-line @next/next/no-img-element -- the shop's own thumbnail sizes */}
                <img
                  src={shown.image || undefined}
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-2xl bg-white object-contain dark:bg-white/10"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="line-clamp-2 text-[18px] font-bold leading-snug">{shown.name}</h2>
                  <div className="mt-0.5 font-mono text-[12px] opacity-50">{shown.sku}</div>
                  <div className="mt-1 text-[14px]">
                    <span className="opacity-60">{p.priceOnSite}:</span>{" "}
                    <span className="font-semibold tabular-nums">{formatCardPrice(shown, locale)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5">
                {demo ? (
                  <p className={`${SHEET_CARD} p-4 text-[15px] text-black/70 dark:text-white/70`}>{t.vetrina.demo}</p>
                ) : !shown.sku ? (
                  <p className={`${SHEET_CARD} p-4 text-[15px]`}>{p.notInHub}</p>
                ) : data === undefined ? (
                  <div className="grid place-items-center gap-2 py-8 text-[14px] opacity-60">
                    <Preloader />
                    {p.loading}
                  </div>
                ) : data === null ? (
                  <p className={`${SHEET_CARD} p-4 text-[15px]`}>{error ?? p.notInHub}</p>
                ) : data.store ? (
                  <>
                    <p className="mb-2 px-1 text-[13px] opacity-60">{p.storeOnly}</p>
                    <ul className={`${SHEET_CARD} ${ROWS}`}>
                      {data.store.variants.map((v) => (
                        <li key={v.variationId} className={ROW}>
                          <div className={`${ROW_INNER} flex items-center gap-3 py-2.5`}>
                            <span className="w-16 text-[17px] font-semibold">{v.sizeLabel}</span>
                            <span className="flex-1 text-[13px] opacity-50">{v.stock != null ? `stock ${v.stock}` : ""}</span>
                            <PriceInput
                              value={edits[String(v.variationId)] ?? ""}
                              placeholder={toInput(v.price)}
                              onChange={(text) => setEdits((e) => ({ ...e, [String(v.variationId)]: text }))}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                    <Button large rounded className="mt-4" disabled={saving} onClick={() => saveStore(data)}
                      colors={{ fillTextIos: "text-white dark:text-black", fillTextMaterial: "text-white dark:text-black" }}>
                      {saving ? p.saving : p.save}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="mb-2 space-y-0.5 px-1 text-[13px] opacity-60">
                      <div>{p.source[data.owner] ?? ""}</div>
                      {ruleLabel(data) && <div>{ruleLabel(data)}</div>}
                    </div>
                    {data.storeTermsUnknown && (
                      <p role="status" className="mb-2 px-1 text-[13px] leading-snug text-amber-700 dark:text-amber-400">
                        {/* On the demo shop its categories and brands are not the real shop's: said so, not as a failure. */}
                        {demo ? p.storeTermsDemo : p.storeTermsUnknown}
                      </p>
                    )}
                    <div className="mb-1 flex items-center justify-between px-1">
                      <span className="text-[13px] font-semibold uppercase tracking-wide opacity-50">{p.sizes}</span>
                      {/* 44px to the finger, drawn as small as the heading beside them. */}
                      <span className="-my-2 flex gap-1">
                        <Button small clear inline className="!h-11" onClick={() =>
                          setEdits((e) => {
                            const next = { ...e };
                            for (const v of data.variants) {
                              if (v.euSize && !(next[v.euSize] ?? "").trim() && v.proposed != null) next[v.euSize] = toInput(v.proposed);
                            }
                            return next;
                          })
                        }>
                          {p.lockAll}
                        </Button>
                        <Button small clear inline className="!h-11" onClick={() =>
                          setEdits((e) => Object.fromEntries(Object.keys(e).map((k) => [k, ""])))
                        }>
                          {p.unlockAll}
                        </Button>
                      </span>
                    </div>
                    <ul className={`${SHEET_CARD} ${ROWS}`}>
                      {data.variants.map((v) => {
                        const text = v.euSize ? edits[v.euSize] ?? "" : "";
                        const typed = text.trim() === "" ? null : parsePrice(text);
                        const below = typed != null && v.ask != null && typed < v.ask;
                        return (
                          <li key={v.id} className={ROW}>
                            <div className={`${ROW_INNER} flex items-center gap-3 py-2.5`}>
                              <span className="w-14 shrink-0 text-[17px] font-semibold">{v.euSize ?? v.sizeLabel}</span>
                              <span className="min-w-0 flex-1 text-[12px] leading-tight">
                                <span className="block opacity-50">
                                  {p.market} {formatEuro(v.ask, locale)}
                                </span>
                                <span className="block opacity-50">
                                  {p.computed} {formatEuro(v.proposed, locale)}
                                </span>
                                {below && <span className="block text-amber-700 dark:text-amber-400">{p.belowMarket(formatEuro(v.ask, locale))}</span>}
                                {v.storeEdit && v.euSize && (
                                  <span className="mt-0.5 block text-amber-700 dark:text-amber-400">
                                    <span className="font-semibold">{p.storeEdit(formatEuro(v.storeEdit.storePrice, locale))}</span>
                                    <span className="mt-0.5 flex gap-3">
                                      <button
                                        type="button"
                                        className="relative font-semibold text-primary before:absolute before:-inset-x-1.5 before:-inset-y-3.5"
                                        onClick={() => setEdits((e) => ({ ...e, [v.euSize!]: toInput(v.storeEdit!.storePrice) }))}
                                      >
                                        {p.storeEditKeep}
                                      </button>
                                      <button
                                        type="button"
                                        className="relative font-semibold text-primary before:absolute before:-inset-x-1.5 before:-inset-y-3.5 disabled:opacity-40"
                                        disabled={saving}
                                        onClick={() => void restoreHubPrice(data, v.storeEdit!.variationId)}
                                      >
                                        {p.storeEditReprice}
                                      </button>
                                    </span>
                                  </span>
                                )}
                              </span>
                              {v.euSize ? (
                                <>
                                  <PriceInput
                                    value={text}
                                    placeholder={toInput(v.proposed)}
                                    onChange={(next) => setEdits((e) => ({ ...e, [v.euSize!]: next }))}
                                  />
                                  <Lock className={`h-4 w-4 shrink-0 ${text.trim() ? "opacity-80" : "opacity-15"}`} />
                                </>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 px-1 text-[12px] opacity-50">{p.lockHint}</p>
                    <Button large rounded className="mt-4" disabled={saving} onClick={() => saveCatalog(data)}
                      colors={{ fillTextIos: "text-white dark:text-black", fillTextMaterial: "text-white dark:text-black" }}>
                      {saving ? p.saving : p.save}
                    </Button>
                  </>
                )}
              </div>

              {!shown.missing && (
                <>
                  <div className="mt-5">
                    <TagsSection
                      key={shown.id}
                      productId={shown.id}
                      onChanged={() => {
                        setMoved((n) => n + 1);
                        onTagsChanged?.();
                      }}
                    />
                  </div>
                  <div className="mt-5">
                    <PlacementSection
                      key={shown.id}
                      productId={shown.id}
                      name={shown.name}
                      stockStatus={shown.stockStatus}
                      onSale={shown.onSale}
                      price={shown.price != null ? formatCardPrice(shown, locale) : undefined}
                      refreshKey={moved}
                      onLeave={onClose}
                      confirmLeave={confirmLeave}
                      onActed={acted}
                    />
                  </div>
                </>
              )}

              {(shown.permalink || shown.editLink || hubLink) && (
                // Grouped rows, as iOS lists its links: each a full-width, 44px-plus target.
                <div className="mt-5">
                  <List strong inset dividers colors={SHEET_LIST_COLORS} className={SHEET_LIST}>
                    {shown.permalink && <OutLink href={shown.permalink} title={p.openSite} />}
                    {shown.editLink && <OutLink href={shown.editLink} title={p.editWp} />}
                    {hubLink && (
                      <ListItem
                        link
                        href={hubLink}
                        title={p.openHub}
                        titleFontSizeIos="text-[16px]"
                        titleFontSizeMaterial="text-[16px]"
                        // It leaves the Vetrina in this tab: the section editor's unpublished changes are asked about first.
                        onClick={(e: React.MouseEvent) => {
                          if (confirmLeave && !confirmLeave()) e.preventDefault();
                        }}
                      />
                    )}
                  </List>
                </div>
              )}
            </div>
          )}
        </Sheet.Content>
      </Sheet.Container>
      <Sheet.Backdrop onTap={onClose} />
    </Sheet>
  );
}

/** A link out of the app (the site, WordPress): a row with the arrow that says it leaves. */
function OutLink({ href, title }: { href: string; title: string }) {
  return (
    <ListItem
      link
      href={href}
      target="_blank"
      linkProps={{ rel: "noreferrer" }}
      chevron={false}
      title={title}
      after={<External className="h-[18px] w-[18px]" />}
      titleFontSizeIos="text-[16px]"
      titleFontSizeMaterial="text-[16px]"
    />
  );
}

function PriceInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (text: string) => void;
}) {
  return (
    <span className="relative w-28 shrink-0">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] opacity-50">€</span>
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-black/10 bg-black/[0.03] py-2 pl-7 pr-2 text-right text-[16px] font-semibold tabular-nums outline-none placeholder:font-normal placeholder:opacity-40 focus:border-black/30 dark:border-white/15 dark:bg-white/10"
      />
    </span>
  );
}
