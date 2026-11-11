"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Block, Button, List, ListItem, Page, Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { codesIn, groupLookups, KICKSDB_UNREACHABLE, LOOKUP_BATCH, MAX_ENTRIES, NOT_ON_KICKSDB, type AddLookup } from "@/lib/add-products";
import { runPublishBatches } from "@/lib/publish-run";
import { skuKey } from "@/lib/skus";
import { lookupNewProducts } from "@/server/actions/vetrina-add";
import type { PublishOutcome, PublishProductReport } from "@/server/woo/publish";
import { FILL } from "../../catalog/act/parts";
import { NextLinkTag } from "../../catalog/home/ui";
import { HEADING } from "../../catalog/sheet/look";
import { TabbarSpacer } from "../../catalog/TabbarSpacer";
import { ShopConfirm, ShopSubNavbar, ShopThumb, type ConfirmAsk } from "../parts";
import { INPUT } from "./look";

/** The one tap's own route: on the Vetrina's address only /vetrina is served. */
const ROUTE = "/vetrina/negozio/aggiungi/importa";
const EDITOR = "/vetrina/negozio/aggiungi/nuovo";

/** The form for a code made by hand, starting from what is known of it. */
export function editorHref(sku: string | null, back = false): string {
  const query = new URLSearchParams();
  if (sku) query.set("sku", sku);
  if (back) query.set("da", "codici");
  const q = query.toString();
  return q ? `${EDITOR}?${q}` : EDITOR;
}

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
  const file = React.useRef<HTMLInputElement>(null);
  const running = progress != null;

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
    const codes = codesIn(content);
    if (codes.length === 0) {
      toast.error(w.fileEmpty);
      return;
    }
    setText(codes.join("\n"));
    await search(codes);
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
          onClick={() => void search(codesIn(text))}
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
      </div>

      {groups && (
        <>
          {groups.ready.length > 0 && (
            <>
              <h2 className="px-5 pb-0.5 pt-5 text-[13px] font-semibold uppercase tracking-wide opacity-50">
                {w.groups.ready(groups.ready.length)}
              </h2>
              <p className="px-5 pb-1 text-[13px] leading-snug opacity-60">{w.readyHint}</p>
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
                {running ? (
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
                  toAdd.length > 0 && (
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
              <p className="px-5 pb-1 text-[13px] leading-snug opacity-60">{w.byHandHint}</p>
              <List strong inset dividers className="!mt-2" aria-label={w.groups.byHand(groups.byHand.length)}>
                {groups.byHand.map((l) => (
                  <ListItem
                    key={l.sku}
                    link
                    linkComponent={NextLinkTag}
                    linkProps={{ href: editorHref(l.sku, true) }}
                    media={<ShopThumb src={l.image} />}
                    title={l.title ?? l.sku}
                    subtitle={w.route[l.route]}
                    text={l.title ? l.sku : undefined}
                    after={<span className="text-primary">{w.make}</span>}
                  />
                ))}
              </List>
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
