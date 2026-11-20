"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import { blockName } from "@/i18n/dictionaries/catalog/pages.it";
import type { BlockChange, PageCheck, PageDiff, PageIssue } from "@/lib/pages/types";

/** How many issues or changes a list shows before "…and N more". */
const SHOWN = 40;

const TONE = {
  info: "bg-black/[0.04] dark:bg-white/[0.08]",
  warning: "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  error: "bg-red-500/12 text-red-800 dark:text-red-200",
};

/** A line of context in a tinted box: the front page's warning, what the WordPress user lacks, a stale page. */
export function Note({ tone = "info", children }: { tone?: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "note"} className={`rounded-xl px-3.5 py-2.5 text-[14px] leading-snug ${TONE[tone]}`}>
      {children}
    </div>
  );
}

function IssueRow({ issue }: { issue: PageIssue }) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.pages.check;
  const error = issue.level === "error";
  const excerpt = issue.problem.kind === "badJson" || issue.problem.kind === "freeform" ? issue.problem.excerpt : null;
  return (
    <li className="space-y-1 px-3.5 py-2.5" data-level={issue.level}>
      <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
        <span className={`rounded-md px-1.5 py-px font-semibold ${error ? "bg-red-600 text-white" : "bg-amber-500 text-black"}`}>{error ? c.error : c.warning}</span>
        <span className="opacity-60">{issue.at ? c.where(issue.at.line, issue.at.path, issue.at.name) : c.page}</span>
      </p>
      <p className="text-[15px] leading-snug">{c.problem(issue.problem)}</p>
      {excerpt && <code className="block break-all rounded-md bg-black/[0.05] px-2 py-1 font-mono text-[12px] dark:bg-white/10">{excerpt}</code>}
    </li>
  );
}

/** What the check found: the counts in one line, then each issue — where, and what it means. */
export function CheckView({ check }: { check: PageCheck }) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.pages.check;
  const d = t.vetrinaCatalog.pages.diff;
  const head =
    check.issues.length === 0
      ? c.ok
      : [check.errors > 0 ? c.errors(check.errors) : null, check.warnings > 0 ? c.warnings(check.warnings) : null].filter(Boolean).join(" · ");
  return (
    <div className="space-y-2">
      <p
        role="status"
        data-testid="check-summary"
        className={`px-1 text-[15px] font-semibold ${check.errors > 0 ? "text-red-600 dark:text-red-400" : check.warnings > 0 ? "" : "text-green-700 dark:text-green-400"}`}
      >
        {head}
      </p>
      {check.errors === 0 && check.warnings > 0 && <p className="px-1 text-[13px] opacity-60">{c.warningsOnly}</p>}
      {check.issues.length > 0 && (
        <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl bg-white dark:divide-white/10 dark:bg-[#1c1c1e]" aria-label={c.title}>
          {check.issues.slice(0, SHOWN).map((issue, i) => (
            <IssueRow key={i} issue={issue} />
          ))}
          {check.issues.length > SHOWN && <li className="px-3.5 py-2.5 text-[14px] opacity-60">{d.more(check.issues.length - SHOWN)}</li>}
        </ul>
      )}
    </div>
  );
}

function ChangeRow({ change }: { change: BlockChange }) {
  const { t } = useI18n();
  const d = t.vetrinaCatalog.pages.diff;
  const [label, tint, block, where] =
    change.kind === "added"
      ? [d.added, "text-green-700 dark:text-green-400", change.after, d.at(change.after.path)]
      : change.kind === "removed"
        ? [d.removed, "text-red-600 dark:text-red-400", change.before, d.was(change.before.path)]
        : [d.changed, "text-amber-700 dark:text-amber-400", change.after, d.at(change.after.path)];
  const what =
    change.kind === "changed" ? [change.attrs.length > 0 ? d.attrs(change.attrs) : null, change.content ? d.content : null].filter(Boolean).join(" · ") : null;
  return (
    <li className="px-3.5 py-2" data-change={change.kind}>
      <p className="text-[15px] leading-snug">
        <span className={`font-semibold ${tint}`}>{label}</span> <span className="font-mono text-[13px]">{blockName(block.name)}</span>
        <span className="opacity-60"> · {where}</span>
      </p>
      {what && <p className="text-[13px] opacity-60">{what}</p>}
    </li>
  );
}

/** What saving would change, block by block: added, removed, changed — by name and place. */
export function DiffView({ diff }: { diff: PageDiff }) {
  const { t } = useI18n();
  const d = t.vetrinaCatalog.pages.diff;
  if (diff.identical) return <p className="px-1 text-[15px]">{d.identical}</p>;
  return (
    <div className="space-y-1.5" data-testid="diff">
      {diff.changes.length === 0 ? (
        <p className="px-1 text-[15px]">{d.none}</p>
      ) : (
        <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl bg-white dark:divide-white/10 dark:bg-[#1c1c1e]" aria-label={d.title}>
          {diff.changes.slice(0, SHOWN).map((change, i) => (
            <ChangeRow key={i} change={change} />
          ))}
          {diff.changes.length > SHOWN && <li className="px-3.5 py-2 text-[14px] opacity-60">{d.more(diff.changes.length - SHOWN)}</li>}
        </ul>
      )}
      {diff.unchanged > 0 && <p className="px-1 text-[13px] opacity-60">{d.unchanged(diff.unchanged)}</p>}
    </div>
  );
}
