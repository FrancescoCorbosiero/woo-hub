"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Block, Button, List, ListItem, Page, Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { codesIn, groupLookups, KICKSDB_UNREACHABLE, LOOKUP_BATCH, MAX_ENTRIES, NOT_ON_KICKSDB, type AddLookup } from "@/lib/add-products";
import { checkHandmade, type HandmadeInput } from "@/lib/handmade";
import { matchCategories, readProductSheet, sheetToHandmade, type SheetProduct } from "@/lib/product-sheet";
import { runPublishBatches } from "@/lib/publish-run";
import { skuKey } from "@/lib/skus";
import { getHandmadeSetup, lookupNewProducts, makeHandmadeProduct } from "@/server/actions/vetrina-add";
import type { PublishOutcome, PublishProductReport } from "@/server/woo/publish";
import { FILL } from "../../catalog/act/parts";
import { NextLinkTag } from "../../catalog/home/ui";
import { HEADING } from "../../catalog/sheet/look";
import { TabbarSpacer } from "../../catalog/TabbarSpacer";
import { ShopConfirm, ShopSubNavbar, ShopThumb, type ConfirmAsk } from "../parts";
import { INPUT } from "./look";
import { editorHref, SHEET_DRAFT } from "./routes";

/** The one tap's own route: on the Vetrina's address only /vetrina is served. */
const ROUTE = "/vetrina/negozio/aggiungi/importa";

/**
 * "Aggiungi prodotti" (src/lib/add-products.ts): the one way in for new
 * products. One box for codes — typed, scanned, pasted, a whole column of a
 * spreadsheet, or a file — and the Hub says how each comes in: the ready
 * ones with one tap (Publish, batch by batch, as "Nuovi prodotti" runs it),
 * the unknown ones by hand, in the form that opens with the code filled in.
 * A single code the Hub cannot add itself opens that form straight away.
 */
export function AddProductsScreen({ wpAdmin, kicksdb }: { wpAdmin: string; kicksdb: boolean }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.shop.add;
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [lookups, setLookups] = React.useState<AddLookup[] | null>(null);
  const [searching, setSearching] = React.useState<{
    done: number;
    total: number;
  } | null>(null);
  const [ask, setAsk] = React.useState<ConfirmAsk | null>(null);
  const [progress, setProgress] = React.useState<{
    done: number;
    total: number;
    msLeft: number | null;
  } | null>(null);
  const [reports, setReports] = React.useState<ReadonlyMap<string, PublishProductReport>>(new Map());
  const [outcome, setOutcome] = React.useState<PublishOutcome | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  // A product sheet given instead of codes: its products by code, and the shop's categories they are filed under.
  const [sheet, setSheet] = React.useState<ReadonlyMap<string, SheetProduct> | null>(null);
  const [categories, setCategories] = React.useState<{ id: number; path: string }[]>([]);
  const [sheetNotes, setSheetNotes] = React.useState<string[]>([]);
  const [making, setMaking] = React.useState<{ done: number; total: number } | null>(null);
  const [made, setMade] = React.useState<ReadonlyMap<string, { text: string; good: boolean }>>(new Map());
  const file = React.useRef<HTMLInputElement>(null);
  const running = progress != null || making != null;

  // Leaving the page mid-run would stop it: the browser asks first.
  React.useEffect(() => {
    if (!running) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [running]);

  async function search(codes: string[]) {
    if (codes.length === 0) {
      toast.error(w.none);
      return;
    }
    if (codes.length > MAX_ENTRIES) toast.message(w.tooMany(MAX_ENTRIES));
    const asked = codes.slice(0, MAX_ENTRIES);
    setOutcome(null);
    setReports(new Map());
    setNote(null);
    setSearching({ done: 0, total: asked.length });
    const found: AddLookup[] = [];
    try {
      for (let i = 0; i < asked.length; i += LOOKUP_BATCH) {
        const res = await lookupNewProducts(asked.slice(i, i + LOOKUP_BATCH));
        if (!res.ok) {
          toast.error(`${w.failed} ${res.error}`);
          break;
        }
        found.push(...res.data);
        setSearching({
          done: Math.min(i + LOOKUP_BATCH, asked.length),
          total: asked.length,
        });
        setLookups([...found]);
      }
    } finally {
      setSearching(null);
    }
    // One code the Hub cannot add itself: straight to its form.
    if (asked.length === 1 && found.length === 1 && ["noSizes", "delisted", "unknown"].includes(found[0].route)) {
      router.push(editorHref(found[0].sku));
    }
  }

  /** What the box or a file holds: a product sheet, whose codes are looked up with its data kept, or codes. */
  async function begin(content: string) {
    const read = readProductSheet(content);
    setMade(new Map());
    if (!read) {
      setSheet(null);
      setSheetNotes([]);
      await search(codesIn(content));
      return;
    }
    setSheet(new Map(read.products.map((p) => [skuKey(p.sku), p])));
    const setup = await getHandmadeSetup(null);
    const shop = setup.ok ? setup.data.categories : [];
    setCategories(shop);
    const unknown = [...new Set(read.products.flatMap((p) => matchCategories(p.categories, shop).unknown))];
    setSheetNotes(
      [
        w.sheetFound(read.products.length),
        unknown.length > 0 ? w.unknownCategories(unknown) : null,
        read.unattached.length > 0 ? w.unattached(read.unattached) : null,
      ].filter((line): line is string => line != null),
    );
    await search(read.products.map((p) => p.sku));
  }

  /** A sheet's product as the form's, filed under the shop's categories it names. */
  function draftOf(product: SheetProduct): HandmadeInput {
    return sheetToHandmade(product, matchCategories(product.categories, categories).ids);
  }

  /** The sheet's products ready to be made as they are, one after the other. */
  async function makeFromSheet(products: SheetProduct[]) {
    setMaking({ done: 0, total: products.length });
    try {
      for (const [i, product] of products.entries()) {
        const res = await makeHandmadeProduct(draftOf(product));
        const key = skuKey(product.sku);
        const line = !res.ok
          ? { text: `${w.notAdded}: ${res.error}`, good: false }
          : res.data.ok
            ? { text: res.data.status === "publish" ? w.madeLive : w.madeHidden, good: true }
            : res.data.code === "skuTaken"
              ? { text: w.taken, good: false }
              : { text: `${t.vetrinaCatalog.shop.handmade.invalid} ${res.data.invalid.map((f) => t.vetrinaCatalog.shop.handmade.fields[f]).join(", ")}`, good: false };
        setMade((current) => new Map(current).set(key, line));
        setMaking({ done: i + 1, total: products.length });
      }
    } finally {
      setMaking(null);
    }
    const count = products.length;
    toast.success(w.madeCount(count));
  }

  async function retry(codes: string[]) {
    const keep = (lookups ?? []).filter((l) => !codes.includes(l.sku));
    const res = await lookupNewProducts(codes.slice(0, LOOKUP_BATCH));
    if (!res.ok) {
      toast.error(`${w.failed} ${res.error}`);
      return;
    }
    setLookups([...keep, ...res.data]);
  }

  async function readFile(chosen: File | undefined) {
    if (!chosen) return;
    let content: string;
    try {
      content = await chosen.text();
    } catch {
      toast.error(w.fileUnreadable);
      return;
    }
    if (!readProductSheet(content) && codesIn(content).length === 0) {
      toast.error(w.fileEmpty);
      return;
    }
    setText(content.replace(/^\uFEFF/, ""));
    await begin(content);
  }

  async function add(skus: string[]) {
    setOutcome(null);
    setNote(null);
    setProgress({ done: 0, total: skus.length, msLeft: null });
    try {
      const end = await runPublishBatches(
        ROUTE,
        skus,
        {
          dryRun: false,
          includeGallery: false,
          force: false,
          replaceMedia: false,
        },
        {
          progress: setProgress,
          outcome: setOutcome,
          unanswered: () => undefined,
          stop: () => false,
        },
      );
      const merged = end.merged;
      if (merged) {
        setReports(new Map(merged.products.map((p) => [skuKey(p.sku), p])));
        if (merged.created > 0) toast.success(w.done(merged.created));
        // What KicksDB turned out not to know is made by hand; what it did not answer, asked again.
        const missing = new Set(merged.products.filter((p) => p.error === NOT_ON_KICKSDB).map((p) => skuKey(p.sku)));
        const unanswered = new Set(merged.products.filter((p) => p.error === KICKSDB_UNREACHABLE).map((p) => skuKey(p.sku)));
        if (missing.size + unanswered.size > 0) {
          setLookups((current) =>
            (current ?? []).map((l) =>
              missing.has(skuKey(l.sku)) ? { ...l, route: "unknown" } : unanswered.has(skuKey(l.sku)) ? { ...l, route: "unreachable" } : l,
            ),
          );
        }
      }
      const said = t.vetrinaCatalog.shop.publish;
      if (end.error?.kind === "proxy") setNote(said.proxyGaveUp);
      else if (end.error?.kind === "unexpected") setNote(said.unexpected(end.error.status));
      else if (end.error) setNote(`${w.failed} ${end.error.message ?? ""}`);
    } finally {
      setProgress(null);
    }
  }

  const groups = lookups ? groupLookups(lookups) : null;
  const toAdd = (groups?.ready ?? []).filter((l) => !reports.has(skuKey(l.sku)));

  function reportLine(report: PublishProductReport | undefined): { text: string; good: boolean } | null {
    if (!report) return null;
    if (report.error === NOT_ON_KICKSDB) return { text: w.notOnKicksdb, good: false };
    if (report.error === KICKSDB_UNREACHABLE) return { text: w.kicksdbUnreachable, good: false };
    if (report.error) return { text: `${w.notAdded}: ${report.error}`, good: false };
    if (report.action === "skip") return { text: w.already, good: true };
    return { text: w.added, good: true };
  }

  return (
    <Page>
      <ShopSubNavbar title={w.title} />
      <p className="px-5 pb-1 pt-3 text-[15px] leading-snug opacity-60">{w.intro}</p>

      <div className="space-y-2 px-4 pt-2">
        <label className="block">
          <span className={HEADING}>{w.label}</span>
          <textarea
            value={text}
            rows={4}
            spellCheck={false}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            placeholder={w.placeholder}
            disabled={searching != null || running}
            onChange={(e) => setText(e.target.value)}
            className={`${INPUT} resize-y font-mono text-[15px] leading-snug`}
          />
        </label>
        <Button
          large
          rounded
          colors={FILL}
          className="w-full"
          disabled={searching != null || running || text.trim() === ""}
          onClick={() => void begin(text)}
        >
          {searching ? (
            <span className="flex items-center gap-2">
              <Preloader className="!h-5 !w-5" />
              {w.searching(searching.done, searching.total)}
            </span>
          ) : (
            w.search
          )}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            rounded
            tonal
            className="!h-11 !px-2 text-[14px]"
            disabled={searching != null || running}
            onClick={() => file.current?.click()}
          >
            <span className="truncate">{w.file}</span>
          </Button>
          <Button rounded tonal className="!h-11 !px-2 text-[14px]" disabled={running} onClick={() => router.push(editorHref(null))}>
            <span className="truncate">{w.withoutCode}</span>
          </Button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
          className="hidden"
          onChange={(e) => {
            void readFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <p className="px-1 text-[13px] leading-snug opacity-60">{w.fileHint}</p>
        {!kicksdb && <p className="px-1 text-[13px] leading-snug opacity-60">{w.kicksdbOff}</p>}
        {sheet && sheetNotes.length > 0 && (
          <div className="space-y-1 rounded-xl bg-black/[0.04] px-3 py-2.5 text-[13px] leading-snug dark:bg-white/[0.08]" role="status">
            {sheetNotes.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {groups && (
        <>
          {groups.ready.length > 0 && (
            <>
              <h2 className="px-5 pb-0.5 pt-5 text-[13px] font-semibold uppercase tracking-wide opacity-50">
                {w.groups.ready(groups.ready.length)}
              </h2>
              <p className="px-5 pb-1 text-[13px] leading-snug opacity-60">{sheet ? `${w.readyHint} ${w.sheetSourceNote}` : w.readyHint}</p>
              <List strong inset dividers className="!mt-2" aria-label={w.groups.ready(groups.ready.length)}>
                {groups.ready.map((l) => {
                  const line = reportLine(reports.get(skuKey(l.sku)));
                  return (
                    <ListItem
                      key={l.sku}
                      media={<ShopThumb src={l.image} />}
                      title={l.title ?? l.sku}
                      subtitle={[l.brand, w.route[l.route]].filter(Boolean).join(" · ")}
                      text={
                        line ? (
                          <span className={line.good ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                            {line.text}
                          </span>
                        ) : (
                          l.sku
                        )
                      }
                      after={<span className="tabular-nums">{w.sizes(l.sizes)}</span>}
                    />
                  );
                })}
              </List>
              <div className="px-4">
                {progress ? (
                  <Block strong inset className="!mx-0 !my-0 space-y-2" role="status">
                    <p className="text-[15px] font-semibold">{w.progress(progress.done, progress.total)}</p>
                    <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                        style={{
                          width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-[13px] opacity-60">{t.vetrinaCatalog.shop.publish.keepOpen}</p>
                  </Block>
                ) : (
                  toAdd.length > 0 &&
                  !running && (
                    <Button
                      large
                      rounded
                      colors={FILL}
                      className="w-full"
                      onClick={() =>
                        setAsk({
                          title: w.confirmTitle,
                          body: w.confirmBody(toAdd.length),
                          confirm: w.confirm,
                          // The alert closes at once; the run goes on on this page, with its progress.
                          run: async () => void add(toAdd.map((l) => l.sku)),
                        })
                      }
                    >
                      <span className="truncate">{w.addAll(toAdd.length)}</span>
                    </Button>
                  )
                )}
              </div>
            </>
          )}
          {outcome && !running && outcome.created > 0 && <p className="px-5 pt-2 text-[14px] leading-snug">{w.done(outcome.created)}</p>}
          {note && <p className="px-5 pt-2 text-[14px] leading-snug text-red-600 dark:text-red-400">{note}</p>}

          {groups.byHand.length > 0 && (
            <>
              <h2 className="px-5 pb-0.5 pt-5 text-[13px] font-semibold uppercase tracking-wide opacity-50">
                {w.groups.byHand(groups.byHand.length)}
              </h2>
              <p className="px-5 pb-1 text-[13px] leading-snug opacity-60">{sheet ? w.byHandSheetHint : w.byHandHint}</p>
              <List strong inset dividers className="!mt-2" aria-label={w.groups.byHand(groups.byHand.length)}>
                {groups.byHand.map((l) => {
                  const fromSheet = sheet?.get(skuKey(l.sku));
                  const ready = fromSheet ? checkHandmade(draftOf(fromSheet)).ok : false;
                  const line = made.get(skuKey(l.sku));
                  if (line?.good) {
                    return (
                      <ListItem
                        key={l.sku}
                        media={<ShopThumb src={fromSheet?.photos[0] ?? l.image} />}
                        title={fromSheet?.title || l.title || l.sku}
                        subtitle={l.sku}
                        text={<span className="text-green-700 dark:text-green-400">{line.text}</span>}
                      />
                    );
                  }
                  return (
                    <ListItem
                      key={l.sku}
                      link
                      linkComponent={NextLinkTag}
                      linkProps={{
                        href: editorHref(l.sku, true),
                        // The form opens with the sheet's row filled in.
                        onClick: () => {
                          if (!fromSheet) return;
                          try {
                            sessionStorage.setItem(`${SHEET_DRAFT}${skuKey(l.sku)}`, JSON.stringify(draftOf(fromSheet)));
                          } catch {
                            // No storage (a private window): the form opens with what the Hub knows.
                          }
                        },
                      }}
                      media={<ShopThumb src={fromSheet?.photos[0] ?? l.image} />}
                      title={fromSheet?.title || l.title || l.sku}
                      subtitle={fromSheet ? (ready ? w.sheetReady : w.sheetIncomplete) : w.route[l.route]}
                      text={
                        line ? (
                          <span className="text-red-600 dark:text-red-400">{line.text}</span>
                        ) : fromSheet?.title || l.title ? (
                          l.sku
                        ) : undefined
                      }
                      after={<span className="text-primary">{fromSheet ? w.complete : w.make}</span>}
                    />
                  );
                })}
              </List>
              {sheet &&
                (() => {
                  const ready = groups.byHand
                    .map((l) => sheet.get(skuKey(l.sku)))
                    .filter((p): p is SheetProduct => p != null && !made.has(skuKey(p.sku)) && checkHandmade(draftOf(p)).ok);
                  if (making) {
                    return (
                      <div className="px-4">
                        <Block strong inset className="!mx-0 !my-0 space-y-2" role="status">
                          <p className="text-[15px] font-semibold">{w.making(making.done, making.total)}</p>
                          <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
                            <div
                              className="h-full rounded-full bg-primary transition-[width] duration-500"
                              style={{ width: `${Math.round((making.done / Math.max(making.total, 1)) * 100)}%` }}
                            />
                          </div>
                          <p className="text-[13px] opacity-60">{t.vetrinaCatalog.shop.publish.keepOpen}</p>
                        </Block>
                      </div>
                    );
                  }
                  return ready.length > 0 && !running ? (
                    <div className="px-4">
                      <Button
                        large
                        rounded
                        colors={FILL}
                        className="w-full"
                        onClick={() =>
                          setAsk({
                            title: w.makeConfirmTitle,
                            body: w.makeConfirmBody(ready.length),
                            confirm: w.makeConfirm,
                            run: async () => void makeFromSheet(ready),
                          })
                        }
                      >
                        <span className="truncate">{w.makeFromSheet(ready.length)}</span>
                      </Button>
                    </div>
                  ) : null;
                })()}
            </>
          )}

          {groups.unreachable.length > 0 && (
            <>
              <h2 className="px-5 pb-0.5 pt-5 text-[13px] font-semibold uppercase tracking-wide opacity-50">
                {w.groups.unreachable(groups.unreachable.length)}
              </h2>
              <List strong inset dividers className="!mt-2" aria-label={w.groups.unreachable(groups.unreachable.length)}>
                {groups.unreachable.map((l) => (
                  <ListItem key={l.sku} title={l.sku} subtitle={w.route.unreachable} />
                ))}
              </List>
              <div className="px-4">
                <Button rounded tonal className="!h-11 w-full" onClick={() => void retry(groups.unreachable.map((l) => l.sku))}>
                  {w.retry}
                </Button>
              </div>
            </>
          )}

          {groups.onStore.length > 0 && (
            <>
              <h2 className="px-5 pb-0.5 pt-5 text-[13px] font-semibold uppercase tracking-wide opacity-50">
                {w.groups.onStore(groups.onStore.length)}
              </h2>
              <List strong inset dividers className="!mt-2" aria-label={w.groups.onStore(groups.onStore.length)}>
                {groups.onStore.map((l) => (
                  <ListItem
                    key={l.sku}
                    media={<ShopThumb src={l.image} />}
                    title={l.title ?? l.sku}
                    subtitle={l.productId == null ? w.hidden : l.sku}
                    after={
                      l.productId != null ? (
                        <a
                          href={`${wpAdmin}/post.php?post=${l.productId}&action=edit`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary active:opacity-50"
                        >
                          {w.open}
                        </a>
                      ) : undefined
                    }
                  />
                ))}
              </List>
            </>
          )}

          {!running && (
            <div className="px-4 pt-4">
              <Button
                rounded
                tonal
                className="!h-11 w-full"
                onClick={() => {
                  setLookups(null);
                  setText("");
                  setSheet(null);
                  setSheetNotes([]);
                  setMade(new Map());
                  setReports(new Map());
                  setOutcome(null);
                  setNote(null);
                }}
              >
                {w.again}
              </Button>
            </div>
          )}
        </>
      )}
      <TabbarSpacer />
      <ShopConfirm ask={ask} onClose={() => setAsk(null)} />
    </Page>
  );
}
