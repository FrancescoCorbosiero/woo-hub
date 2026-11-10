"use client";

import * as React from "react";
import type { AutomationConfig } from "@core/config";
import { AUTOMATION_LIMITS, type AutomationDraft, type AutomationField } from "@/lib/automation";
import { cn } from "@/lib/utils";
import { saveAutomationSettings, type AutomationView, type FeedsState } from "@/server/actions/feeds";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

/**
 * The Automatic sync settings, under the scheduler's status on the Feeds tab.
 * The everyday choice up front — keep the store in step with the feed, every
 * so many minutes, and when the full sync runs; everything else under
 * Advanced, with its default. Saved whole; the scheduler follows within a
 * minute, with nothing to restart (src/server/automation/settings.ts).
 */

/** The form as typed: numbers as text, so a field can be blank while it is being edited. */
interface Draft {
  storeSync: boolean;
  feedsEveryMinutes: string;
  dailyStoreSync: boolean;
  dailyTimes: string;
  timeZone: string;
  maxChanges: string;
  storeMaxChanges: string;
  ordersEveryMinutes: string;
  collectionsEveryMinutes: string;
  collectionsMaxChanges: string;
  autoRepair: boolean;
  heartbeatUrl: string;
  feedsHeartbeatUrl: string;
}

function toDraft(s: AutomationConfig): Draft {
  return {
    storeSync: s.storeSync,
    feedsEveryMinutes: String(s.feedsEveryMinutes),
    dailyStoreSync: s.dailyStoreSync,
    dailyTimes: s.dailyTimes.join(", "),
    timeZone: s.timeZone,
    maxChanges: String(s.maxChanges),
    storeMaxChanges: String(s.storeMaxChanges),
    ordersEveryMinutes: String(s.ordersEveryMinutes),
    collectionsEveryMinutes: String(s.collectionsEveryMinutes),
    collectionsMaxChanges: String(s.collectionsMaxChanges),
    autoRepair: s.autoRepair,
    heartbeatUrl: s.heartbeatUrl ?? "",
    feedsHeartbeatUrl: s.feedsHeartbeatUrl ?? "",
  };
}

/** A typed number, or null for a blank or anything that is not one: the save names the field. */
function numberOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function fromDraft(d: Draft): AutomationDraft {
  return {
    storeSync: d.storeSync,
    feedsEveryMinutes: numberOf(d.feedsEveryMinutes),
    dailyStoreSync: d.dailyStoreSync,
    dailyTimes: d.dailyTimes
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
    timeZone: d.timeZone.trim(),
    maxChanges: numberOf(d.maxChanges),
    storeMaxChanges: numberOf(d.storeMaxChanges),
    ordersEveryMinutes: numberOf(d.ordersEveryMinutes),
    collectionsEveryMinutes: numberOf(d.collectionsEveryMinutes),
    collectionsMaxChanges: numberOf(d.collectionsMaxChanges),
    autoRepair: d.autoRepair,
    heartbeatUrl: d.heartbeatUrl.trim() || null,
    feedsHeartbeatUrl: d.feedsHeartbeatUrl.trim() || null,
  };
}

/** The fields under Advanced: a mistake in one opens it. */
const ADVANCED: readonly AutomationField[] = [
  "timeZone",
  "maxChanges",
  "storeMaxChanges",
  "ordersEveryMinutes",
  "collectionsEveryMinutes",
  "collectionsMaxChanges",
  "autoRepair",
  "heartbeatUrl",
  "feedsHeartbeatUrl",
];

type Outcome = { kind: "saved" } | { kind: "invalid" } | { kind: "failed"; error: string } | null;

export function AutomationSettings({
  view,
  onSaved,
}: {
  view: AutomationView;
  onSaved: (automation: AutomationView, scheduler: FeedsState["scheduler"]) => void;
}) {
  const { t } = useI18n();
  const a = t.feeds.automation;
  const [draft, setDraft] = React.useState(() => toDraft(view.settings));
  const [invalid, setInvalid] = React.useState<ReadonlySet<AutomationField>>(new Set());
  const [outcome, setOutcome] = React.useState<Outcome>(null);
  const [saving, setSaving] = React.useState(false);
  const [advanced, setAdvanced] = React.useState(false);
  // The browser's time zones, as the field's suggestions. Only once Advanced
  // is open — never on the server's render, which has it closed.
  const zones = React.useMemo(() => (advanced ? timeZones() : []), [advanced]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(view.settings));

  function set<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
    setOutcome(null);
    if (invalid.has(field)) {
      setInvalid((current) => {
        const next = new Set(current);
        next.delete(field);
        return next;
      });
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setOutcome(null);
    try {
      const res = await saveAutomationSettings(fromDraft(draft));
      if (res.ok) {
        setInvalid(new Set());
        setDraft(toDraft(res.automation.settings));
        onSaved(res.automation, res.scheduler);
        setOutcome({ kind: "saved" });
      } else if (res.invalid.length > 0) {
        setInvalid(new Set(res.invalid));
        if (res.invalid.some((field) => ADVANCED.includes(field))) setAdvanced(true);
        setOutcome({ kind: "invalid" });
      } else {
        setOutcome({ kind: "failed", error: res.error ?? "" });
      }
    } catch (e) {
      setOutcome({ kind: "failed", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(toDraft(view.settings));
    setInvalid(new Set());
    setOutcome(null);
  }

  const L = AUTOMATION_LIMITS;
  const bad = (field: AutomationField) => invalid.has(field);
  const legacy = view.legacyEnv.join(", ");

  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-faint">{a.title}</div>

      {/* The everyday choice: the store follows the feed, every so many minutes. */}
      <div className="flex items-start gap-3">
        <Switch
          checked={draft.storeSync}
          onChange={(on) => set("storeSync", on)}
          label={a.storeSync}
          id="automation-store-sync"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor="automation-store-sync" className="block cursor-pointer text-sm font-medium">
            {a.storeSync}
          </label>
          {view.feedConnected ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span>{a.storeSyncWhat}</span>
              {/* "every [20] minutes" stays on one line, a phone's included. */}
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                {a.every}
                <NumberInput
                  value={draft.feedsEveryMinutes}
                  onChange={(v) => set("feedsEveryMinutes", v)}
                  min={L.feedsEveryMinutes.min}
                  max={L.feedsEveryMinutes.max}
                  disabled={!draft.storeSync}
                  invalid={bad("feedsEveryMinutes")}
                  label={`${a.storeSyncWhat} ${a.every} … ${a.minutes}`}
                />
                {a.minutes}
              </span>
              {bad("feedsEveryMinutes") && (
                <span className="w-full text-xs text-skip">{a.range(L.feedsEveryMinutes.min, L.feedsEveryMinutes.max)}</span>
              )}
            </div>
          ) : (
            <p className="text-xs text-faint">{a.noFeed}</p>
          )}
          {!draft.storeSync && <p className="text-xs text-warn">{a.storeSyncOff}</p>}
        </div>
      </div>

      {/* Under the switch: a part of the store sync, off with it. */}
      {view.kicksdbConnected && (
        <CheckRow
          className="pl-12"
          id="automation-daily-store-sync"
          checked={draft.storeSync && draft.dailyStoreSync}
          disabled={!draft.storeSync}
          onChange={(on) => set("dailyStoreSync", on)}
          label={a.dailyStoreSync}
          hint={a.dailyStoreSyncHint}
        />
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <label htmlFor="automation-daily-times" className="font-medium">
            {a.daily}
          </label>
          <Input
            id="automation-daily-times"
            className={cn("h-8 w-36 tnum", bad("dailyTimes") && "border-skip")}
            value={draft.dailyTimes}
            onChange={(e) => set("dailyTimes", e.target.value)}
            aria-invalid={bad("dailyTimes") || undefined}
            placeholder="04:30"
            inputMode="numeric"
          />
        </div>
        <p className={cn("text-xs", bad("dailyTimes") ? "text-skip" : "text-faint")}>{a.dailyHint}</p>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAdvanced((open) => !open)}
          aria-expanded={advanced}
          className="flex items-center gap-1.5 text-xs font-semibold text-muted transition-colors hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-90")}
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
          {a.advanced}
        </button>

        {advanced && (
          <div className="mt-3 space-y-4 rounded-lg border border-line bg-surface-2/50 p-3 animate-fade-up">
            <Field label={a.timeZone} hint={a.timeZoneHint} invalid={bad("timeZone")} htmlFor="automation-time-zone">
              <Input
                id="automation-time-zone"
                className={cn("h-8 w-56", bad("timeZone") && "border-skip")}
                value={draft.timeZone}
                onChange={(e) => set("timeZone", e.target.value)}
                aria-invalid={bad("timeZone") || undefined}
                list="automation-time-zones"
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="automation-time-zones">
                {zones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </Field>

            {view.feedConnected && (
              <Field
                label={a.maxChanges}
                hint={bad("maxChanges") ? a.range(L.changes.min, L.changes.max) : a.maxChangesHint}
                invalid={bad("maxChanges")}
              >
                <NumberInput
                  value={draft.maxChanges}
                  onChange={(v) => set("maxChanges", v)}
                  min={L.changes.min}
                  max={L.changes.max}
                  invalid={bad("maxChanges")}
                  label={a.maxChanges}
                  wide
                />
                <span className="text-sm text-muted">{a.changes}</span>
              </Field>
            )}

            {view.kicksdbConnected && draft.storeSync && draft.dailyStoreSync && (
              <Field
                label={a.storeMaxChanges}
                hint={bad("storeMaxChanges") ? a.range(L.changes.min, L.changes.max) : a.storeMaxChangesHint}
                invalid={bad("storeMaxChanges")}
              >
                <NumberInput
                  value={draft.storeMaxChanges}
                  onChange={(v) => set("storeMaxChanges", v)}
                  min={L.changes.min}
                  max={L.changes.max}
                  invalid={bad("storeMaxChanges")}
                  label={a.storeMaxChanges}
                  wide
                />
                <span className="text-sm text-muted">{a.changes}</span>
              </Field>
            )}

            <Field
              label={a.orders}
              hint={
                bad("ordersEveryMinutes")
                  ? a.range(L.ordersEveryMinutes.min, L.ordersEveryMinutes.max)
                  : a.ordersHint
              }
              invalid={bad("ordersEveryMinutes")}
            >
              <NumberInput
                value={draft.ordersEveryMinutes}
                onChange={(v) => set("ordersEveryMinutes", v)}
                min={L.ordersEveryMinutes.min}
                max={L.ordersEveryMinutes.max}
                invalid={bad("ordersEveryMinutes")}
                label={a.orders}
              />
              <span className="text-sm text-muted">{a.minutes}</span>
            </Field>

            <Field
              label={a.collections}
              hint={
                bad("collectionsEveryMinutes")
                  ? a.range(L.collectionsEveryMinutes.min, L.collectionsEveryMinutes.max)
                  : a.collectionsHint
              }
              invalid={bad("collectionsEveryMinutes")}
            >
              <NumberInput
                value={draft.collectionsEveryMinutes}
                onChange={(v) => set("collectionsEveryMinutes", v)}
                min={L.collectionsEveryMinutes.min}
                max={L.collectionsEveryMinutes.max}
                invalid={bad("collectionsEveryMinutes")}
                label={a.collections}
              />
              <span className="text-sm text-muted">{a.minutes}</span>
            </Field>

            <Field
              label={a.collectionsMax}
              hint={bad("collectionsMaxChanges") ? a.range(L.changes.min, L.changes.max) : a.collectionsMaxHint}
              invalid={bad("collectionsMaxChanges")}
            >
              <NumberInput
                value={draft.collectionsMaxChanges}
                onChange={(v) => set("collectionsMaxChanges", v)}
                min={L.changes.min}
                max={L.changes.max}
                invalid={bad("collectionsMaxChanges")}
                label={a.collectionsMax}
                wide
              />
              <span className="text-sm text-muted">{a.products}</span>
            </Field>

            <CheckRow
              id="automation-auto-repair"
              checked={draft.autoRepair}
              onChange={(on) => set("autoRepair", on)}
              label={a.autoRepair}
              hint={a.autoRepairHint}
            />

            <Field label={a.heartbeat} hint={a.heartbeatHint} invalid={bad("heartbeatUrl")} htmlFor="automation-heartbeat">
              <UrlInput
                id="automation-heartbeat"
                value={draft.heartbeatUrl}
                onChange={(v) => set("heartbeatUrl", v)}
                invalid={bad("heartbeatUrl")}
              />
            </Field>

            {view.feedConnected && (
              <Field
                label={a.feedsHeartbeat}
                hint={a.heartbeatHint}
                invalid={bad("feedsHeartbeatUrl")}
                htmlFor="automation-feeds-heartbeat"
              >
                <UrlInput
                  id="automation-feeds-heartbeat"
                  value={draft.feedsHeartbeatUrl}
                  onChange={(v) => set("feedsHeartbeatUrl", v)}
                  invalid={bad("feedsHeartbeatUrl")}
                />
              </Field>
            )}
          </div>
        )}
      </div>

      {view.legacyEnv.length > 0 && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-ink">
          {view.saved ? a.leftInEnv(legacy) : a.fromEnv(legacy)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="accent" size="sm" onClick={save} disabled={saving || (!dirty && view.saved)}>
          {saving ? (
            <>
              <span className="spin h-3.5 w-3.5 rounded-full border-2 border-accent-fg/30 border-t-accent-fg" />
              {a.saving}
            </>
          ) : (
            a.save
          )}
        </Button>
        {dirty && !saving && (
          <Button type="button" variant="ghost" size="sm" onClick={discard}>
            {a.discard}
          </Button>
        )}
        <span role="status" className="text-xs">
          {outcome?.kind === "saved" && <span className="text-up">{a.saved}</span>}
          {outcome?.kind === "invalid" && <span className="text-skip">{a.invalid}</span>}
          {outcome?.kind === "failed" && (
            <span className="text-skip">
              {a.failed} {outcome.error}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** Every IANA time zone the browser knows; none in an older one, where the field still takes any name. */
function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

/** An on/off switch: the store sync, the one setting that decides whether the Hub writes on its own. */
function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20",
        checked ? "border-accent-strong bg-accent" : "border-line-strong bg-surface-2",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-surface shadow-xs transition-transform duration-150",
          checked ? "translate-x-[18px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

function CheckRow({
  id,
  checked,
  disabled,
  onChange,
  label,
  hint,
  className,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(state) => onChange(state === true)}
      />
      <div className="min-w-0">
        <label htmlFor={id} className={cn("block text-sm font-medium", disabled ? "text-faint" : "cursor-pointer")}>
          {label}
        </label>
        <p className="text-xs text-faint">{hint}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  invalid,
  htmlFor,
  children,
}: {
  label: string;
  hint: string;
  invalid: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {children}
      </div>
      <p className={cn("text-xs", invalid ? "text-skip" : "text-faint")}>{hint}</p>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  disabled,
  invalid,
  label,
  wide,
}: {
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  disabled?: boolean;
  invalid: boolean;
  label: string;
  wide?: boolean;
}) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={cn("h-8 tnum", wide ? "w-28" : "w-20", invalid && "border-skip")}
    />
  );
}

function UrlInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  return (
    <Input
      id={id}
      type="url"
      inputMode="url"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="https://hc-ping.com/…"
      aria-invalid={invalid || undefined}
      autoComplete="off"
      spellCheck={false}
      className={cn("h-8 w-full sm:w-96", invalid && "border-skip")}
    />
  );
}
