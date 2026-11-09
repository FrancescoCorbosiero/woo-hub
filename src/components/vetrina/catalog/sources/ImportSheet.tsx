"use client";

import * as React from "react";
import { useI18n } from "@/i18n/provider";
import type { SourceImport } from "@/lib/vetrina/order-sources";
import type { VetrinaResult } from "@/server/vetrina/service";
import {
  ActSheetFrame,
  CARD,
  HEADING,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  useLastShown,
} from "../act/parts";
import { External } from "../../icons";

/**
 * "Importa": the missing products of a ranking made in the shop, a few at a
 * time through /api/order-sources/import (Publish itself: the same checks,
 * prices and photos as its tab) — the progress while it goes, then what was
 * made (with its link), what was left as it is and why, the codes KicksDB
 * does not know, and those it did not answer for. Products made cannot be
 * taken back from here: the sheet says what it will do before it starts.
 */

export interface ImportPick {
  position: number;
  sku: string;
  name: string;
}

export interface ImportRequest {
  picks: ImportPick[];
}

/** SKUs per request: each is a product made, its sizes and photos — a slice stays well within a request's time. */
const SLICE = 5;

type Outcome = Pick<SourceImport, "products" | "notFound" | "unreachable">;

const EMPTY: Outcome = { products: [], notFound: [], unreachable: [] };

async function importSlice(skus: string[], networkError: string): Promise<VetrinaResult<SourceImport>> {
  try {
    const res = await fetch("/api/order-sources/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus, dryRun: false }),
    });
    return (await res.json()) as VetrinaResult<SourceImport>;
  } catch {
    return { ok: false, code: "failed", error: networkError };
  }
}

export function ImportSheet({
  request,
  onClose,
  onDone,
}: {
  request: ImportRequest | null;
  onClose: () => void;
  /** Something was made: the comparison reads the shop again. */
  onDone: () => void;
}) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose} detent="content">
      {shown && <ImportContent request={shown} onClose={onClose} onDone={onDone} />}
    </ActSheetFrame>
  );
}

function ImportContent({ request, onClose, onDone }: { request: ImportRequest; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.sources.compare;
  const s = c.importSheet;
  const total = request.picks.length;
  const [phase, setPhase] = React.useState<"confirm" | "running" | "done">("confirm");
  const [done, setDone] = React.useState(0);
  const [outcome, setOutcome] = React.useState<Outcome>(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [stopping, setStopping] = React.useState(false);
  const stopped = React.useRef(false);

  // Closed while running: the slice on its way finishes on the server, no other starts.
  React.useEffect(
    () => () => {
      stopped.current = true;
    },
    [],
  );

  async function start() {
    setPhase("running");
    setError(null);
    let made = false;
    const skus = [...new Set(request.picks.map((p) => p.sku))];
    for (let i = 0; i < skus.length && !stopped.current; i += SLICE) {
      const slice = skus.slice(i, i + SLICE);
      const res = await importSlice(slice, t.vetrinaCatalog.act.sheet.network);
      if (!res.ok) {
        setError(res.error);
        break;
      }
      made ||= res.data.created > 0;
      setOutcome((o) => ({
        products: [...o.products, ...res.data.products],
        notFound: [...o.notFound, ...res.data.notFound],
        unreachable: [...o.unreachable, ...res.data.unreachable],
      }));
      setDone((d) => Math.min(total, d + slice.length));
    }
    setPhase("done");
    if (made) onDone();
  }

  const created = outcome.products.filter((p) => p.action !== "skip" && !p.error);
  const skipped = outcome.products.filter((p) => p.action === "skip" && !p.error);
  const failed = outcome.products.filter((p) => p.error);
  const nameOf = (sku: string) => request.picks.find((p) => p.sku.toUpperCase() === sku.toUpperCase())?.name ?? sku;

  return (
    <>
      <SheetHead title={s.title(total)} onClose={onClose} />
      <SheetBody>
        {phase === "confirm" ? (
          <>
            <p className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>{s.intro}</p>
            <ul className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>
              {request.picks.map((p) => (
                <li key={p.position} className="flex gap-3 px-4 py-2.5 text-[14px] leading-snug">
                  <span className="w-9 shrink-0 text-end tabular-nums opacity-45">#{p.position}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{p.name}</span>
                    <span className="mt-0.5 block text-[12px] opacity-55">{p.sku}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {phase === "running" && (
              <p role="status" className={`${CARD} px-4 py-3 text-[15px] leading-snug`}>
                {s.progress(done, total)}
              </p>
            )}
            {error && (
              <p role="alert" className="px-1 text-[14px] leading-snug text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            {created.length > 0 && (
              <ResultGroup title={s.created}>
                {created.map((p) => (
                  <li key={p.sku} className="flex items-center gap-3 px-4 py-2.5 text-[14px] leading-snug">
                    <span className="min-w-0 flex-1">
                      <span className="block break-words">{p.title}</span>
                      <span className="mt-0.5 block text-[12px] opacity-55">{[p.sku, s.sizes(p.sizes)].join(" · ")}</span>
                    </span>
                    {p.permalink && (
                      <a href={p.permalink} target="_blank" rel="noreferrer" aria-label={p.title} className="grid h-11 w-11 shrink-0 place-items-center text-primary">
                        <External className="h-5 w-5" />
                      </a>
                    )}
                  </li>
                ))}
              </ResultGroup>
            )}
            {skipped.length > 0 && (
              <ResultGroup title={s.skipped}>
                {skipped.map((p) => (
                  <ResultRow key={p.sku} name={p.title} note={[p.sku, p.reason ? s.reasons[p.reason] : null].filter(Boolean).join(" · ")} />
                ))}
              </ResultGroup>
            )}
            {failed.length > 0 && (
              <ResultGroup title={s.failed}>
                {failed.map((p) => (
                  <ResultRow key={p.sku} name={p.title} note={[p.sku, p.error].filter(Boolean).join(" · ")} />
                ))}
              </ResultGroup>
            )}
            {outcome.notFound.length > 0 && (
              <ResultGroup title={s.notFound}>
                {outcome.notFound.map((sku) => (
                  <ResultRow key={sku} name={nameOf(sku)} note={sku} />
                ))}
              </ResultGroup>
            )}
            {outcome.unreachable.length > 0 && (
              <ResultGroup title={s.unreachable}>
                {outcome.unreachable.map((sku) => (
                  <ResultRow key={sku} name={nameOf(sku)} note={sku} />
                ))}
              </ResultGroup>
            )}
            {phase === "done" && created.length > 0 && <p className="px-1 text-[13px] leading-snug opacity-60">{c.later}</p>}
          </>
        )}
      </SheetBody>
      <SheetFooter>
        {phase === "confirm" ? (
          <PrimaryButton onClick={() => void start()}>{c.import(total)}</PrimaryButton>
        ) : phase === "running" ? (
          // Stops after the slice on its way: what it makes is made.
          <PrimaryButton
            disabled={stopping}
            onClick={() => {
              stopped.current = true;
              setStopping(true);
            }}
          >
            {s.stop}
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={onClose}>{s.close}</PrimaryButton>
        )}
      </SheetFooter>
    </>
  );
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={HEADING}>{title}</span>
      <ul className={`${CARD} divide-y divide-black/5 dark:divide-white/10`}>{children}</ul>
    </div>
  );
}

function ResultRow({ name, note }: { name: string; note: string }) {
  return (
    <li className="px-4 py-2.5 text-[14px] leading-snug">
      <span className="block break-words">{name}</span>
      {note && <span className="mt-0.5 block text-[12px] opacity-55">{note}</span>}
    </li>
  );
}
