"use client";

import * as React from "react";
import { Block, Button, Checkbox, Link as KLink, List, ListItem, Page, Segmented, SegmentedButton } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { hasMixedSources, type PublishSourceLens } from "@/lib/publish-page";
import { runPublishBatches } from "@/lib/publish-run";
import { getPublishState, listPublishSkus, type PublishPageState } from "@/server/actions/publish";
import type { PublishOutcome } from "@/server/woo/publish";
import type { VetrinaResult } from "@/server/vetrina/service";
import { FILL } from "../catalog/act/parts";
import { TabbarSpacer } from "../catalog/TabbarSpacer";
import { ErrorState } from "../ErrorState";
import { SEGMENTED_COLORS } from "../segmented";
import { ShopConfirm, ShopSubNavbar, ShopThumb, type ConfirmAsk } from "./parts";

/** This screen's own publish route: on the Vetrina's address only /vetrina is served. */
const ROUTE = "/vetrina/negozio/nuovi/pubblica";

/**
 * "Nuovi prodotti": the catalog's products the store does not have yet — the
 * supplier's new ones first of all — published from the phone. All of them
 * with one button, or a few chosen. They are created hidden, and go on sale
 * with their first photo (the photo queue). The run is the Hub's Publish tab's,
 * batch by batch (src/lib/publish-run.ts): it needs this page open until it
 * ends, and says so; it can be stopped between batches.
 */
export function PublishScreen({ result }: { result: VetrinaResult<PublishPageState> }) {
  const { t, locale } = useI18n();
  const number = (count: number) => count.toLocaleString(locale === "en" ? "en-GB" : "it-IT");
  const w = t.vetrinaCatalog.shop.publish;
  const [page, setPage] = React.useState<PublishPageState | null>(result.ok ? result.data : null);
  const [lens, setLens] = React.useState<PublishSourceLens>("all");
  const [choosing, setChoosing] = React.useState(false);
  const [chosen, setChosen] = React.useState<ReadonlySet<string>>(new Set());
  const [ask, setAsk] = React.useState<ConfirmAsk | null>(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number; msLeft: number | null } | null>(null);
  const [outcome, setOutcome] = React.useState<PublishOutcome | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [stopping, setStopping] = React.useState(false);
  const stop = React.useRef(false);
  const running = progress != null;

  // Leaving the page mid-run would stop it: the browser asks first.
  React.useEffect(() => {
    if (!running) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [running]);

  async function load(next: PublishSourceLens) {
    setLens(next);
    const res = await getPublishState({ source: next }).catch(() => null);
    if (res) setPage(res);
  }

  async function publish(skus: string[]) {
    stop.current = false;
    setStopping(false);
    setOutcome(null);
    setNote(null);
    setProgress({ done: 0, total: skus.length, msLeft: null });
    let unanswered = 0;
    try {
      const end = await runPublishBatches(
        ROUTE,
        skus,
        { dryRun: false, includeGallery: false, force: false, replaceMedia: false },
        { progress: setProgress, outcome: setOutcome, unanswered: (n) => (unanswered = n), stop: () => stop.current },
      );
      const notes = [
        end.stopped ? w.stopped(end.stopped.done, end.stopped.total) : null,
        unanswered > 0 ? w.unanswered(unanswered) : null,
        end.error?.kind === "proxy"
          ? w.proxyGaveUp
          : end.error?.kind === "unexpected"
            ? w.unexpected(end.error.status)
            : end.error
              ? `${w.failed} ${end.error.message ?? ""}`
              : null,
      ].filter((line): line is string => line != null);
      setNote(notes.length > 0 ? notes.join(" ") : null);
      if (end.merged && end.merged.created > 0) toast.success(w.done(end.merged.created));
    } finally {
      setProgress(null);
      setStopping(false);
      setChosen(new Set());
      setChoosing(false);
      await load(lens);
    }
  }

  async function publishAll() {
    const res = await listPublishSkus({ source: lens });
    if (!res.ok) {
      toast.error(`${w.failed} ${res.error}`);
      return;
    }
    await publish(res.skus);
  }

  if (!result.ok || !page) {
    return (
      <Page>
        <ShopSubNavbar title={w.title} />
        {!result.ok && (
          <div className="pt-3">
            <ErrorState code={result.code} error={result.error} />
          </div>
        )}
        <TabbarSpacer />
      </Page>
    );
  }

  const count = lens === "all" ? page.counts.all : page.counts[lens];
  const mixed = hasMixedSources(page.counts);
  const failedProducts = outcome?.products.filter((p) => p.error) ?? [];

  return (
    <Page>
      <ShopSubNavbar
        title={w.title}
        right={
          page.candidates.length > 0 && !running ? (
            <KLink
              onClick={() => {
                setChoosing((on) => !on);
                setChosen(new Set());
              }}
            >
              {choosing ? w.selectDone : w.select}
            </KLink>
          ) : undefined
        }
      />
      <p className="px-5 pb-1 pt-3 text-[15px] leading-snug opacity-60">{w.intro}</p>

      {!page.wooConfigured ? (
        <Block strong inset className="text-[15px] leading-snug">
          {t.vetrinaCatalog.shop.notConnected}
        </Block>
      ) : !page.hasSnapshot ? (
        <Block strong inset className="text-[15px] leading-snug">
          {w.noSnapshot}
        </Block>
      ) : (
        <>
          {mixed && (
            <div className="px-4 pt-2">
              <Segmented strong rounded colors={SEGMENTED_COLORS}>
                {(["all", "goldensneakers", "kicksdb"] as const).map((source) => (
                  <SegmentedButton key={source} className="!h-11" active={lens === source} disabled={running} onClick={() => void load(source)}>
                    {w.sources[source]} ({number(source === "all" ? page.counts.all : page.counts[source])})
                  </SegmentedButton>
                ))}
              </Segmented>
            </div>
          )}

          <div className="space-y-2 px-4 pt-3">
            {running ? (
              <Block strong inset className="!mx-0 !my-0 space-y-2" role="status">
                <p className="text-[15px] font-semibold">
                  {w.progress(progress.done, progress.total)}
                  {progress.msLeft != null && ` · ${w.minutesLeft(Math.round(progress.msLeft / 60_000))}`}
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                  />
                </div>
                <p className="text-[13px] opacity-60">{stopping ? w.stopping : w.keepOpen}</p>
                <Button
                  rounded
                  tonal
                  disabled={stopping}
                  className="!h-11 w-full"
                  onClick={() => {
                    stop.current = true;
                    setStopping(true);
                  }}
                >
                  {w.stop}
                </Button>
              </Block>
            ) : (
              count > 0 && (
                <Button
                  large
                  rounded
                  colors={FILL}
                  disabled={choosing && chosen.size === 0}
                  className="w-full"
                  onClick={() => {
                    const some = choosing && chosen.size > 0;
                    const total = some ? chosen.size : count;
                    setAsk({
                      title: w.confirmTitle,
                      body: w.confirmAll(total),
                      confirm: w.confirm,
                      // The alert closes at once; the run goes on on this page, with its progress.
                      run: async () => void (some ? publish([...chosen]) : publishAll()),
                    });
                  }}
                >
                  <span className="truncate">{choosing ? w.publishSome(chosen.size) : w.publishAll(count)}</span>
                </Button>
              )
            )}
          </div>

          {outcome && !running && (
            <Block strong inset className="space-y-1 text-[14px] leading-snug">
              <p className="text-[15px] font-semibold">{w.done(outcome.created + outcome.completed)}</p>
              {outcome.created > 0 && <p className="opacity-70">{w.photosNext}</p>}
              {outcome.skipped > 0 && <p className="opacity-70">{w.skipped(outcome.skipped)}</p>}
              {failedProducts.length > 0 && (
                <>
                  <p className="text-red-600 dark:text-red-400">{w.failedCount(failedProducts.length)}</p>
                  <ul className="list-disc ps-5 text-[13px] opacity-70">
                    {failedProducts.slice(0, 10).map((p) => (
                      <li key={p.sku}>
                        {p.title}: {p.error}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Block>
          )}
          {note && <p className="px-5 pt-2 text-[14px] leading-snug">{note}</p>}

          {page.candidates.length === 0 ? (
            <Block strong inset className="text-center text-[15px] leading-snug">
              {w.empty}
            </Block>
          ) : (
            <List strong inset dividers aria-label={w.title}>
              {page.candidates.map((p) => {
                const on = chosen.has(p.sku);
                const toggle = () =>
                  setChosen((current) => {
                    const next = new Set(current);
                    if (on) next.delete(p.sku);
                    else next.add(p.sku);
                    return next;
                  });
                return (
                  <ListItem
                    key={p.sku}
                    label={choosing}
                    media={
                      choosing ? (
                        <span className="flex items-center gap-3">
                          <Checkbox component="div" checked={on} onChange={toggle} aria-label={p.title} />
                          <ShopThumb src={p.image || null} />
                        </span>
                      ) : (
                        <ShopThumb src={p.image || null} />
                      )
                    }
                    title={p.title}
                    subtitle={[p.brand, w.sources[p.source] ?? p.source].filter(Boolean).join(" · ")}
                    after={<span className="tabular-nums">{w.sizes(p.variantCount)}</span>}
                  />
                );
              })}
            </List>
          )}
          {page.matched > page.candidates.length && (
            <p className="px-5 text-[13px] leading-snug opacity-60">
              {w.more(page.candidates.length, page.matched)}
            </p>
          )}
        </>
      )}
      <TabbarSpacer />
      <ShopConfirm ask={ask} onClose={() => setAsk(null)} />
    </Page>
  );
}
