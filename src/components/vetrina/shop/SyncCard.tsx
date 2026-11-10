"use client";

import * as React from "react";
import Link from "next/link";
import { Block, Button, Preloader } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { startShopSync } from "@/server/actions/vetrina-shop";
import type { ShopOverview } from "@/server/vetrina/shop";
import { FILL } from "../catalog/act/parts";
import { Refresh } from "../icons";
import { resultLines, type ResultLine } from "./result";
import { whenText } from "./when";

/** The last sync by hand is shown while it is news: for a day. */
const RESULT_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * The store's sync, at a glance: when it was last brought in step and when
 * it is next; "Sincronizza ora", which follows the run step by step while it
 * goes; and what the last one by hand did, in plain words. A scheduled run
 * going is followed the same way — the button waits for it.
 */
export function SyncCard({ overview, onChange }: { overview: ShopOverview; onChange: (next: ShopOverview) => void }) {
  const { t, locale } = useI18n();
  const s = t.vetrinaCatalog.shop;
  const [starting, setStarting] = React.useState(false);
  const [said, setSaid] = React.useState<string | null>(null);
  const when = (at: number) => whenText(at, overview.now, overview.timeZone, locale, s.when);
  const settings = overview.automation.settings;
  const run = overview.running;
  const canSync = overview.woo && (overview.feed || (overview.kicksdb && settings.dailyStoreSync));

  async function start() {
    setStarting(true);
    setSaid(null);
    const res = await startShopSync().catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setStarting(false);
    if (!res.ok) {
      setSaid(`${s.sync.failed} ${res.error}`);
      return;
    }
    onChange(res.data.overview);
    const { answer } = res.data;
    if (!answer.started) {
      setSaid(answer.reason === "running" ? s.sync.running : answer.reason === "nothing" ? s.sync.nothing : s.sync.notWriter);
    }
  }

  const stepIndex = run?.step ? run.steps.indexOf(run.step) : -1;
  const manual = overview.lastManual;
  const fresh = manual && !run && overview.now - manual.at < RESULT_FRESH_MS;
  const lines = fresh ? resultLines(manual.summary, s.sync.result) : [];

  return (
    <Block strong inset className="!my-3 space-y-3">
      <div className="space-y-0.5">
        <p className="text-[17px] font-semibold leading-snug">
          {overview.last
            ? overview.last.error
              ? s.sync.lastFailed(when(overview.last.at))
              : s.sync.last(when(overview.last.at))
            : s.sync.never}
        </p>
        <p className="text-[14px] leading-snug opacity-60">
          {!settings.storeSync
            ? s.sync.autoOff
            : !overview.scheduled
              ? s.sync.devOff
              : overview.nextAt
                ? s.sync.next(when(overview.nextAt))
                : null}
        </p>
      </div>

      {!overview.woo ? (
        <p className="text-[15px] leading-snug">{s.notConnected}</p>
      ) : (
        <>
          <Button large rounded colors={FILL} disabled={!canSync || run != null || starting} onClick={() => void start()} className="w-full gap-2">
            {run || starting ? (
              <>
                <Preloader className="!h-5 !w-5 shrink-0" />
                <span className="truncate">{run?.step ? (s.sync.step[run.step] ?? s.sync.working) : s.sync.working}</span>
              </>
            ) : (
              <>
                <Refresh className="h-5 w-5 shrink-0" />
                <span className="truncate">{s.sync.now}</span>
              </>
            )}
          </Button>
          {run && (
            <div className="space-y-1.5" role="status">
              <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${Math.round(((Math.max(stepIndex, 0) + 0.5) / Math.max(run.steps.length, 1)) * 100)}%` }}
                />
              </div>
              <p className="text-[13px] opacity-60">
                {stepIndex >= 0 && s.sync.stepOf(stepIndex + 1, run.steps.length)}
                {run.kind !== "manual" && ` · ${s.sync.scheduled}`}
              </p>
            </div>
          )}
          {!canSync && <p className="text-[14px] leading-snug opacity-60">{s.sync.nothing}</p>}
        </>
      )}
      {said && (
        <p role="status" className="text-[14px] leading-snug">
          {said}
        </p>
      )}

      {lines.length > 0 && manual && (
        <div className="space-y-1.5 border-t border-black/[0.06] pt-3 dark:border-white/10">
          <p className="text-[15px] font-semibold">{manual.error ? s.sync.result.titleFailed(when(manual.at)) : s.sync.result.title(when(manual.at))}</p>
          <ul className="space-y-1">
            {lines.map((line, i) => (
              <ResultRow key={i} line={line} details={s.sync.result.details} />
            ))}
          </ul>
        </div>
      )}
    </Block>
  );
}

const TONE: Record<ResultLine["tone"], { mark: string; className: string }> = {
  ok: { mark: "✓", className: "text-[#34c759] dark:text-[#30d158]" },
  warn: { mark: "!", className: "text-[#ff9500] dark:text-[#ff9f0a]" },
  error: { mark: "✕", className: "text-red-600 dark:text-red-400" },
};

function ResultRow({ line, details }: { line: ResultLine; details: string }) {
  const tone = TONE[line.tone];
  const text = line.href ? (
    <Link href={line.href} className="text-primary underline-offset-2 hover:underline">
      {line.text}
    </Link>
  ) : (
    line.text
  );
  return (
    <li className="flex gap-2 text-[14px] leading-snug">
      <span aria-hidden className={`w-3 shrink-0 text-center font-bold ${tone.className}`}>
        {tone.mark}
      </span>
      <span className="min-w-0">
        {text}
        {line.detail && (
          <details className="mt-0.5 text-[12px] opacity-60">
            <summary className="cursor-pointer">{details}</summary>
            <p className="mt-1 whitespace-pre-wrap break-words font-mono">{line.detail}</p>
          </details>
        )}
      </span>
    </li>
  );
}
