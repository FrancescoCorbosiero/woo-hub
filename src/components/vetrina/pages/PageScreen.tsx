"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Block, Button, Navbar, NavbarBackLink, Page, Preloader } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { PageCheck, PageSaved } from "@/lib/pages/types";
import { checkPageMarkup, savePageMarkup, type PageMarkupInput } from "@/server/actions/vetrina-pages";
import type { VetrinaResult } from "@/server/vetrina/service";
import type { PageScreenData } from "@/server/wordpress/pages/service";
import { useShopTime } from "../../use-shop-time";
import { call } from "../catalog/act/call";
import { FILL, HEADING } from "../catalog/act/parts";
import { TabbarSpacer } from "../catalog/TabbarSpacer";
import { ErrorState } from "../ErrorState";
import { INPUT } from "../shop/add/look";
import { useBack } from "../use-back";
import { CheckView, DiffView, Note } from "./parts";
import { SaveSheet } from "./SaveSheet";

/** What the last "Controlla" said, for the markup it was given. */
interface Checked {
  markup: string;
  check: PageCheck;
  stale: boolean;
}

/**
 * One page of the site: its block markup as WordPress stores it, "Copia"
 * to take it to an LLM (or anywhere), a box for the new version, then
 * "Controlla" (the check and what would change) and "Aggiorna" (the check
 * again, then what changes and a confirmation, then one write). The page
 * read when the screen opened is the version a save is checked against:
 * changed since — by the Vetrina, WordPress, another tab — and the save is
 * refused until the page is read again (what was pasted stays).
 */
export function PageScreen({ result, timeZone }: { result: VetrinaResult<PageScreenData>; timeZone: string }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.pages;
  const back = useBack("/vetrina/pagine");
  const router = useRouter();
  const when = useShopTime(timeZone);
  const data = result.ok ? result.data : null;
  const page = data?.page ?? null;

  const [next, setNext] = React.useState("");
  const [checked, setChecked] = React.useState<Checked | null>(null);
  const [busy, setBusy] = React.useState<"check" | "save" | null>(null);
  const [confirming, setConfirming] = React.useState<PageCheck | null>(null);
  const [saved, setSaved] = React.useState<PageSaved | null>(null);
  const current = React.useRef<HTMLPreElement>(null);

  // A page read again (a reload, a save) is a new version: what the last check said of the old one is gone.
  const version = page ? `${page.version.modifiedGmt}|${page.version.digest}` : "";
  const [seen, setSeen] = React.useState(version);
  if (seen !== version) {
    setSeen(version);
    setChecked(null);
  }

  const missing = data?.access?.missing ?? [];
  const canSave = missing.length === 0;
  const shown = checked && checked.markup === next ? checked : null;
  const input = (): PageMarkupInput | null => (page ? { id: page.id, markup: next, expected: page.version } : null);

  async function copy() {
    if (!page) return;
    try {
      await navigator.clipboard.writeText(page.markup);
      toast.success(w.page.copied);
    } catch {
      // No clipboard API (an old browser, an insecure address): the text selected, for the phone's own Copy.
      const node = current.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
      toast.error(w.page.copyFailed);
    }
  }

  /** "Controlla", and the first half of "Aggiorna": what the check says, or null when it could not run. */
  async function runCheck(): Promise<Checked | null> {
    const asked = input();
    if (!asked) return null;
    const res = await call(() => checkPageMarkup(asked), t.vetrinaCatalog.act.sheet.network);
    if (!res.ok) {
      toast.error(res.error || w.errors[res.code] || t.vetrina.errors[res.code] || w.errors.failed!);
      return null;
    }
    const out = { markup: asked.markup, ...res.data };
    setChecked(out);
    setSaved(null);
    return out;
  }

  async function check() {
    setBusy("check");
    try {
      await runCheck();
    } finally {
      setBusy(null);
    }
  }

  async function update() {
    setBusy("save");
    try {
      const out = await runCheck();
      if (!out) return;
      if (out.stale) toast.error(w.saved.stale);
      else if (out.check.errors > 0) toast.error(w.check.blocked);
      else if (out.check.diff.identical) toast.message(w.saved.unchanged);
      else setConfirming(out.check);
    } finally {
      setBusy(null);
    }
  }

  /** The write, once: a save that failed or timed out is never sent again from here (it may have landed). */
  async function save() {
    const asked = input();
    if (!asked) return;
    setBusy("save");
    try {
      const res = await call(() => savePageMarkup(asked), w.saved.failed);
      setConfirming(null);
      if (!res.ok) {
        toast.error(res.code === "failed" ? w.saved.failed : (w.errors[res.code] ?? w.saved.failed));
        return;
      }
      const out = res.data;
      switch (out.outcome) {
        case "saved":
          setSaved(out.saved);
          setNext("");
          setChecked(null);
          toast.dismiss();
          toast.success(w.saved.toast);
          router.refresh();
          return;
        case "blocked":
          setChecked({ markup: asked.markup, check: out.check, stale: false });
          toast.error(w.check.blocked);
          return;
        case "stale":
          setChecked((c) => (c ? { ...c, stale: true } : c));
          toast.error(w.saved.stale);
          return;
        case "unchanged":
          toast.message(w.saved.unchanged);
          return;
        case "noAccess":
          toast.error(w.saved.noAccess);
          router.refresh();
          return;
      }
    } finally {
      setBusy(null);
    }
  }

  const lines = page ? page.markup.split("\n").length : 0;

  return (
    <Page>
      <Navbar
        title={page?.title || w.title}
        subtitle={page ? w.page.modified(when.dateTime(`${page.version.modifiedGmt}Z`)) : undefined}
        titleClassName="truncate max-w-[calc(100%-176px)]"
        subtitleClassName="truncate"
        left={<NavbarBackLink onClick={back} text={w.back} />}
      />
      {!result.ok || !data || !page ? (
        <div className="pt-3">{!result.ok && <ErrorState code={result.code} error={result.error} words={w.errors} />}</div>
      ) : (
        <div className="space-y-4 px-4 pb-4 pt-3">
          {data.vetrinaPage && <Note tone="warning">{w.page.vetrina}</Note>}
          {data.access == null ? (
            <Note>{w.page.accessUnknown}</Note>
          ) : missing.length > 0 ? (
            <Note tone="error">{w.page.noAccess(data.access.user, missing)}</Note>
          ) : (
            data.access.filtered && <Note>{w.page.filtered(data.access.user)}</Note>
          )}

          {saved && (
            <Block strong inset className="!mx-0 !my-0 space-y-2" role="status">
              <p className="text-[17px] font-semibold">{w.saved.title}</p>
              <p className="text-[15px] leading-snug">{w.saved.body}</p>
              {saved.revisions != null && <p className="text-[14px] opacity-60">{w.saved.revisions(saved.revisions)}</p>}
              {saved.altered && <p className="text-[14px] leading-snug text-amber-700 dark:text-amber-400">{w.saved.altered}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[15px] font-medium text-primary">
                <a href={saved.url} target="_blank" rel="noreferrer">
                  {w.saved.open}
                </a>
                {saved.revisionsUrl && (
                  <a href={saved.revisionsUrl} target="_blank" rel="noreferrer">
                    {w.saved.openRevisions}
                  </a>
                )}
              </div>
            </Block>
          )}

          <section className="space-y-2" aria-label={w.page.current}>
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <span className={HEADING}>{w.page.current}</span>
                <p className="px-1 text-[13px] opacity-60">{w.page.currentHint(lines, page.markup.length)}</p>
              </div>
              <a href={page.url} target="_blank" rel="noreferrer" className="shrink-0 px-1 pb-0.5 text-[15px] font-medium text-primary">
                {w.page.open}
              </a>
            </div>
            <pre
              ref={current}
              aria-label={w.page.current}
              data-testid="current-markup"
              className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-black/10 bg-white p-3 font-mono text-[12px] leading-snug dark:border-white/15 dark:bg-white/10"
            >
              {page.markup}
            </pre>
            <Button large rounded tonal onClick={() => void copy()} className="w-full">
              {w.page.copy}
            </Button>
          </section>

          <section className="space-y-2">
            <label className="block">
              <span className={HEADING}>{w.page.next}</span>
              <span className="mb-1.5 block px-1 text-[13px] leading-snug opacity-60">{w.page.nextHint}</span>
              <textarea
                value={next}
                rows={10}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                placeholder={w.page.placeholder}
                disabled={busy != null}
                onChange={(e) => setNext(e.target.value)}
                className={`${INPUT} resize-y font-mono !text-[16px] leading-snug`}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button large rounded tonal disabled={busy != null || next.trim() === ""} onClick={() => void check()}>
                {busy === "check" ? <Preloader className="!h-5 !w-5" /> : w.page.check}
              </Button>
              <Button large rounded colors={FILL} disabled={busy != null || next.trim() === "" || !canSave} onClick={() => void update()}>
                {busy === "save" && !confirming ? <Preloader className="!h-5 !w-5" /> : w.page.save}
              </Button>
            </div>
          </section>

          {shown && (
            <section className="space-y-3" aria-label={w.check.title}>
              {shown.stale && (
                <Note tone="error">
                  <span className="block">{w.check.stale}</span>
                  <button type="button" onClick={() => router.refresh()} className="mt-1.5 font-semibold text-primary">
                    {w.check.reload}
                  </button>
                </Note>
              )}
              <CheckView check={shown.check} />
              <div>
                <span className={HEADING}>{w.diff.title}</span>
                <DiffView diff={shown.check.diff} />
              </div>
            </section>
          )}
        </div>
      )}
      <TabbarSpacer />

      {page && (
        <SaveSheet
          check={confirming}
          title={page.title}
          front={data?.vetrinaPage ?? false}
          busy={busy === "save"}
          onSave={() => void save()}
          onClose={() => setConfirming(null)}
        />
      )}
    </Page>
  );
}

/** The screen while WordPress answers. */
export function PageScreenSkeleton() {
  const { t } = useI18n();
  const back = useBack("/vetrina/pagine");
  return (
    <Page>
      <Navbar left={<NavbarBackLink onClick={back} text={t.vetrinaCatalog.pages.back} />} />
      <div className="grid place-items-center pt-24">
        <Preloader className="!h-8 !w-8" />
      </div>
    </Page>
  );
}
