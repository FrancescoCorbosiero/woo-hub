import type { SchedulerStepSummary } from "@/server/db/schema";
import type { shopIt } from "@/i18n/dictionaries/catalog/shop.it";

/**
 * What a sync by hand did, line by line, in the owner's words: the
 * supplier's list read, the prices and stock written, what was left for a
 * person (prices changed on WordPress, sizes held, changes for next time),
 * and what went wrong — a list past its safety limit said for what it is.
 * Pure: the scheduler's step summaries in, lines out.
 */

export interface ResultLine {
  tone: "ok" | "warn" | "error";
  text: string;
  /** Where the owner decides about it, in the Vetrina. */
  href?: string;
  /** The technical reason, folded under the line. */
  detail?: string;
}

type Words = (typeof shopIt)["sync"]["result"];

export function resultLines(summary: Record<string, SchedulerStepSummary>, words: Words): ResultLine[] {
  const lines: ResultLine[] = [];
  const gs = summary.gs;
  if (gs) {
    lines.push(
      gs.ok
        ? { tone: "ok", text: words.feed(gs.count ?? 0, gs.feed?.added ?? 0, gs.feed?.deactivated ?? 0) }
        : { tone: "error", text: words.stepFailed(words.stepName.gs), detail: gs.note },
    );
  }
  const publish = summary.publish;
  if (publish?.pullRunning) lines.push({ tone: "warn", text: words.pullRunning });
  else if (publish?.published) {
    const { created, failed, waiting } = publish.published;
    if (created > 0) lines.push({ tone: "ok", text: words.published(created) });
    if (failed > 0) lines.push({ tone: "error", text: words.publishFailed(failed), href: "/vetrina/negozio/nuovi", detail: publish.note });
    if (waiting > 0) lines.push({ tone: "warn", text: words.publishWaiting(waiting) });
  } else if (publish && !publish.ok) {
    lines.push({ tone: "error", text: words.stepFailed(words.stepName.publish), detail: publish.note });
  }
  for (const step of ["feedSync", "storeSync"] as const) {
    const outcome = summary[step];
    if (!outcome) continue;
    if (step === "storeSync" && summary.kicksdb && !summary.kicksdb.ok) {
      lines.push({ tone: "error", text: words.stepFailed(words.stepName.kicksdb), detail: summary.kicksdb.note });
    }
    if (outcome.pullRunning) {
      lines.push({ tone: "warn", text: words.pullRunning });
      continue;
    }
    if (outcome.capped) {
      lines.push({ tone: "error", text: words.capped(outcome.capped.planned, outcome.capped.limit), detail: outcome.note });
      continue;
    }
    const sync = outcome.sync;
    if (!sync) {
      if (!outcome.ok) lines.push({ tone: "error", text: words.stepFailed(words.stepName[step]), detail: outcome.note });
      continue;
    }
    lines.push({ tone: "ok", text: (step === "storeSync" ? words.writtenKicks : words.written)(sync.written) });
    if (sync.added > 0) lines.push({ tone: "ok", text: words.added(sync.added) });
    if (sync.failed > 0) lines.push({ tone: "error", text: words.failed(sync.failed), detail: outcome.note });
    if (sync.kept > 0) lines.push({ tone: "warn", text: words.kept(sync.kept), href: "/vetrina/negozio/prezzi" });
    if (sync.held > 0) lines.push({ tone: "warn", text: words.held(sync.held) });
    if (outcome.deferred) lines.push({ tone: "warn", text: words.deferred(outcome.deferred) });
  }
  return lines;
}
