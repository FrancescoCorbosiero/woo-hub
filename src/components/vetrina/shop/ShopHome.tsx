"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Actions,
  ActionsButton,
  ActionsGroup,
  ActionsLabel,
  List,
  ListItem,
  Navbar,
  Page,
  Preloader,
  Toggle,
  Link as KLink,
} from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { getShopOverview, saveShopSettings, type ShopSettingsPatch } from "@/server/actions/vetrina-shop";
import type { VetrinaResult } from "@/server/vetrina/service";
import type { ShopOverview } from "@/server/vetrina/shop";
import { ActivityLink } from "../catalog/act/ActivityLink";
import { NextLinkTag } from "../catalog/home/ui";
import { TabbarSpacer } from "../catalog/TabbarSpacer";
import { ErrorState } from "../ErrorState";
import { ChevronLeft, Refresh } from "../icons";
import { useStandalone } from "../sheet-mount";
import { SyncCard } from "./SyncCard";
import { TimesSheet } from "./TimesSheet";

/** How often the tab reads the store again: while a sync runs, and while it does not. */
const POLL_RUNNING_MS = 2_000;
const POLL_IDLE_MS = 30_000;
/** The intervals offered for the automatic update; the one set stays offered if it is none of these. */
const INTERVALS = [5, 10, 15, 20, 30, 45, 60, 120];
/** iOS's green, as the section editor's switches. */
const TOGGLE_COLORS = { checkedBgIos: "bg-[#34c759] dark:bg-[#30d158]" };
/** A switch's finger-sized target, as the catalog's: only the switch flips, a tap on the row's words starts nothing. */
const SWITCH_TARGET = "relative before:absolute before:-inset-x-2 before:-inset-y-2 before:content-['']";

/**
 * "Negozio": the store kept in step with the supplier's list. Up top,
 * "Sincronizza ora" and what the last sync did; then what waits for the
 * owner (orders to fulfil, prices changed on WordPress, new products to
 * publish); then the few settings of the automatic update — on or off, how
 * often, the KicksDB prices too, when the full update runs. The rest of the
 * settings, and the review of a sync, are the Hub's.
 */
export function ShopHome({ result }: { result: VetrinaResult<ShopOverview> }) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.shop;
  const router = useRouter();
  const standalone = useStandalone();
  const [overview, setOverview] = React.useState<ShopOverview | null>(result.ok ? result.data : null);
  const [intervalOpen, setIntervalOpen] = React.useState(false);
  const [timesOpen, setTimesOpen] = React.useState(false);
  // The server's read wins when the page is read again (the refresh button, a new visit).
  const [seen, setSeen] = React.useState(result);
  if (seen !== result) {
    setSeen(result);
    if (result.ok) setOverview(result.data);
  }

  // Read again: often while a sync runs (its step, then its outcome), now and then while none does.
  const running = overview?.running != null;
  const loaded = overview != null;
  React.useEffect(() => {
    if (!loaded) return;
    let live = true;
    const timer = setInterval(
      async () => {
        const next = await getShopOverview().catch(() => null);
        if (live && next?.ok) setOverview(next.data);
      },
      running ? POLL_RUNNING_MS : POLL_IDLE_MS,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [running, loaded]);

  /** A setting changed: shown at once, saved, put back if the save fails. */
  async function save(patch: ShopSettingsPatch) {
    if (!overview) return false;
    const before = overview;
    setOverview({ ...overview, automation: { ...overview.automation, settings: { ...overview.automation.settings, ...patch } } });
    const res = await saveShopSettings(patch).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    if (res.ok) {
      setOverview(res.data);
      toast.success(s.settings.saved);
      return true;
    }
    setOverview(before);
    toast.error(`${s.settings.failed} ${"invalid" in res && res.invalid.includes("dailyTimes") ? s.settings.invalidTimes : res.error}`);
    return false;
  }

  const settings = overview?.automation.settings;
  const offered = settings ? [...new Set([...INTERVALS, settings.feedsEveryMinutes])].sort((a, b) => a - b) : INTERVALS;

  return (
    <Page>
      <ShopNavbar
        refresh={
          <KLink iconOnly onClick={() => router.refresh()} aria-label={t.vetrina.refresh}>
            <Refresh className="h-5 w-5" />
          </KLink>
        }
      />
      {!result.ok || !overview || !settings ? (
        result.ok ? null : <ErrorState code={result.code} error={result.error} />
      ) : (
        <>
          <p className="px-5 pb-1 pt-1 text-[15px] leading-snug opacity-60">{s.intro}</p>
          <SyncCard overview={overview} onChange={setOverview} />

          <h2 className="px-5 pb-0.5 pt-4 text-[13px] font-semibold uppercase tracking-wide opacity-50">{s.todo.title}</h2>
          <List strong inset dividers aria-label={s.todo.title} className="!mt-2">
            <TodoRow href="/vetrina/negozio/ordini" title={s.todo.orders} count={overview.todo.orders} none={s.todo.none} />
            <TodoRow href="/vetrina/negozio/prezzi" title={s.todo.storeEdits} count={overview.todo.storeEdits} none={s.todo.none} />
            <TodoRow href="/vetrina/negozio/nuovi" title={s.todo.toPublish} count={overview.todo.toPublish} none={s.todo.none} />
          </List>

          <h2 className="px-5 pb-0.5 pt-4 text-[13px] font-semibold uppercase tracking-wide opacity-50">{s.settings.title}</h2>
          <List strong inset dividers aria-label={s.settings.title} className="!mt-2">
            <ListItem
              title={s.settings.storeSync}
              after={
                <Toggle
                  className={SWITCH_TARGET}
                  checked={settings.storeSync}
                  colors={TOGGLE_COLORS}
                  aria-label={s.settings.storeSync}
                  onChange={() => void save({ storeSync: !settings.storeSync })}
                />
              }
            />
            {overview.feed && (
              <ListItem
                link
                linkComponent="button"
                linkProps={{ type: "button", onClick: () => setIntervalOpen(true), disabled: !settings.storeSync }}
                contentClassName="w-full text-start"
                className={settings.storeSync ? undefined : "opacity-50"}
                title={s.settings.every}
                after={s.settings.interval(settings.feedsEveryMinutes)}
              />
            )}
            {overview.kicksdb && (
              <ListItem
                title={s.settings.kicksdb}
                after={
                  <Toggle
                    className={SWITCH_TARGET}
                    checked={settings.dailyStoreSync}
                    colors={TOGGLE_COLORS}
                    aria-label={s.settings.kicksdb}
                    onChange={() => void save({ dailyStoreSync: !settings.dailyStoreSync })}
                  />
                }
              />
            )}
            <ListItem
              link
              linkComponent="button"
              linkProps={{ type: "button", onClick: () => setTimesOpen(true) }}
              contentClassName="w-full text-start"
              title={s.settings.daily}
              after={<span className="tabular-nums">{s.settings.times(settings.dailyTimes)}</span>}
            />
          </List>
          <p className="px-5 pt-1 text-[13px] leading-snug opacity-60">
            {s.settings.storeSyncHint} {overview.kicksdb ? s.settings.kicksdbHint : ""}
          </p>
          {!standalone && (
            <List strong inset className="!mt-4">
              <ListItem link linkComponent="a" linkProps={{ href: "/feeds" }} title={s.settings.more} />
            </List>
          )}

          <Actions opened={intervalOpen} onBackdropClick={() => setIntervalOpen(false)}>
            <ActionsGroup>
              <ActionsLabel>{s.settings.everyTitle}</ActionsLabel>
              {offered.map((minutes) => (
                <ActionsButton
                  key={minutes}
                  bold={minutes === settings.feedsEveryMinutes}
                  onClick={() => {
                    setIntervalOpen(false);
                    if (minutes !== settings.feedsEveryMinutes) void save({ feedsEveryMinutes: minutes });
                  }}
                >
                  {minutes === settings.feedsEveryMinutes ? `✓ ${s.settings.interval(minutes)}` : s.settings.interval(minutes)}
                </ActionsButton>
              ))}
            </ActionsGroup>
            <ActionsGroup>
              <ActionsButton onClick={() => setIntervalOpen(false)}>{t.vetrinaCatalog.act.bar.cancel}</ActionsButton>
            </ActionsGroup>
          </Actions>
          <TimesSheet
            open={timesOpen}
            times={settings.dailyTimes}
            onClose={() => setTimesOpen(false)}
            onSave={(dailyTimes) => save({ dailyTimes })}
          />
        </>
      )}
      <TabbarSpacer />
    </Page>
  );
}

/** A row of "Da fare": what waits, and how many. */
function TodoRow({ href, title, count, none }: { href: string; title: string; count: number | null; none: string }) {
  const { locale } = useI18n();
  return (
    <ListItem
      link
      linkComponent={NextLinkTag}
      linkProps={{ href }}
      title={title}
      after={
        count == null ? undefined : count === 0 ? (
          <span className="opacity-50">{none}</span>
        ) : (
          <span className="min-w-6 rounded-full bg-primary px-2 py-0.5 text-center text-[13px] font-semibold tabular-nums text-white dark:text-black">
            {count.toLocaleString(locale === "en" ? "en-GB" : "it-IT")}
          </span>
        )
      }
    />
  );
}

/** The tab's navbar: a large title named like its tab, the way back to the Hub, refresh, the log. */
function ShopNavbar({ refresh }: { refresh: React.ReactNode }) {
  const { t } = useI18n();
  const standalone = useStandalone();
  return (
    <Navbar
      large
      transparent
      centerTitle
      title={t.vetrinaCatalog.shop.title}
      titleClassName={`truncate ${standalone ? "max-w-[calc(100%-176px)]" : "max-w-[calc(100%-272px)]"}`}
      left={
        <>
          {!standalone && (
            <KLink href="/" component="a" className="gap-0.5 !px-2">
              <ChevronLeft className="h-5 w-5" />
              {t.vetrina.backToHub}
            </KLink>
          )}
          {refresh}
        </>
      }
      right={<ActivityLink />}
    />
  );
}

/** The tab while the store is read: the same navbar, then the shape of its card and rows. For negozio/loading.tsx. */
export function ShopHomeSkeleton() {
  const { t } = useI18n();
  const bar = "block rounded-full bg-black/[0.08] dark:bg-white/[0.12]";
  return (
    <Page>
      <ShopNavbar
        refresh={
          <KLink iconOnly aria-label={t.vetrina.refresh}>
            <Preloader className="!h-5 !w-5" />
          </KLink>
        }
      />
      <div aria-hidden className="space-y-3 px-4 pb-1 pt-1 motion-safe:animate-pulse">
        <div className="space-y-2 px-1 py-0.5">
          <span className={`${bar} h-3.5 w-[90%]`} />
          <span className={`${bar} h-3.5 w-[60%]`} />
        </div>
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-[#1c1c1e]">
          <span className={`${bar} h-4 w-44`} />
          <span className={`${bar} h-3.5 w-32`} />
          <span className="block h-12 rounded-full bg-black/[0.06] dark:bg-white/10" />
        </div>
        {[0, 1].map((group) => (
          <div key={group} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-[#1c1c1e]">
            {[0, 1, 2].map((row) => (
              <span key={row} className={`${bar} h-4 w-[70%]`} />
            ))}
          </div>
        ))}
      </div>
      <TabbarSpacer />
    </Page>
  );
}
