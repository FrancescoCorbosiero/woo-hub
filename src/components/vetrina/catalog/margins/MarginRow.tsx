"use client";

import * as React from "react";
import useSWR from "swr";
import { Button, ListItem } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogTaxonomy, CatalogTerm } from "@/lib/vetrina/catalog";
import type { TermMarginState } from "@/lib/vetrina/catalog-ops";
import { loadTermMargin } from "@/server/actions/vetrina-operations";
import { useOperations, useOperationSettled } from "../act/operations-context";
import { Ghost } from "../term/TermSkeleton";
import { MarginTag } from "./glyphs";
import { MarginSheet } from "./MarginSheet";
import { activeMargin, idleRowShown, rowShown, rowText, rowTitle, runningText } from "./model";

/**
 * "Ricarico" in a category's or a brand's panel, next to "Saldo": the margin
 * the Hub prices its products with — its own ("Ricarico di questa categoria:
 * 25%"), a term above it's, or the standard — and how many products it
 * applies to. A tap opens the margin sheet; while a margin of the term runs,
 * the row follows it and a tap opens the log. Where no margin can act — a
 * term none of whose products the Hub prices from the market, with no margin
 * of its own to remove — a quiet row says so instead: its ghost held the
 * room while it was read, and the panel does not shrink when it lands.
 */

const KEY = "vetrina-term-margin";

async function fetchMargin([, taxonomy, id]: readonly [string, CatalogTaxonomy, number]): Promise<TermMarginState> {
  const res = await loadTermMargin({ taxonomy, id });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** As the panel's own icons: iOS Settings' rounded squares, the primary while the term has a margin of its own. */
function Icon({ own }: { own: boolean }) {
  // White on the primary: globals.css turns it dark when the primary turns white.
  const tone = own ? "bg-primary text-white" : "bg-black/[0.07] text-black/55 dark:bg-white/15 dark:text-white/70";
  return (
    <span className={`grid h-[30px] w-[30px] place-items-center rounded-[8px] ${tone}`}>
      <MarginTag className="h-[18px] w-[18px]" />
    </span>
  );
}

export function MarginRow({
  term,
  ready = true,
}: {
  term: Pick<CatalogTerm, "taxonomy" | "id" | "name" | "count">;
  /**
   * Whether to read yet. The panel's own read (hide, sale) goes first: the
   * browser sends server actions one at a time, and the margin's — which
   * weighs every product of the term — would hold the switch and the sale
   * row up behind it.
   */
  ready?: boolean;
}) {
  const { t } = useI18n();
  const m = t.vetrinaCatalog.margins;
  const ops = useOperations();
  // Read when the screen opens (kept for the next visit), and again whenever an action ends.
  const swr = useSWR(ready ? ([KEY, term.taxonomy, term.id] as const) : null, fetchMargin, {
    shouldRetryOnError: false,
    dedupingInterval: 2_000,
  });
  useOperationSettled(() => void swr.mutate());
  const [open, setOpen] = React.useState(false);
  const running = activeMargin(ops.active, term.taxonomy, term.id);
  const state = swr.data;
  const ref = React.useMemo(() => ({ taxonomy: term.taxonomy, id: term.id, name: term.name }), [term.taxonomy, term.id, term.name]);

  if (!state) {
    if (swr.error) {
      return (
        <ListItem
          media={<Icon own={false} />}
          title={m.row.title}
          text={m.row.failed}
          after={
            <Button small rounded tonal inline onClick={() => void swr.mutate()} className="!h-11 !px-4">
              {m.row.retry}
            </Button>
          }
        />
      );
    }
    // Most terms have products the Hub prices: the row it will most likely have, as a ghost of the same shape
    // (a link, with its chevron), so nothing jumps when it lands.
    if (term.count === 0) return null;
    return (
      <ListItem
        link
        linkComponent="div"
        contentClassName="w-full text-start"
        media={<Icon own={false} />}
        title={<Ghost className="motion-safe:animate-pulse">{m.row.standard}</Ghost>}
        text={<Ghost className="motion-safe:animate-pulse">{m.row.loading}</Ghost>}
      />
    );
  }
  if (!rowShown(state) && !running) {
    if (!idleRowShown(state, term.count)) return null;
    return (
      <ListItem
        media={<Icon own={false} />}
        title={<span className="opacity-50">{m.row.title}</span>}
        text={<span className="line-clamp-1">{m.row.noneHere}</span>}
      />
    );
  }

  return (
    <>
      <ListItem
        link
        linkComponent="button"
        linkProps={{
          type: "button",
          // While it runs, the log is where it can be followed.
          onClick: running ? ops.openActivity : () => setOpen(true),
          "aria-haspopup": "dialog",
        }}
        contentClassName="w-full text-start"
        media={<Icon own={state.own != null} />}
        title={<span className="line-clamp-1">{rowTitle(state, m)}</span>}
        text={running ? runningText(running, m) : rowText(state, term.taxonomy, m)}
      />
      <MarginSheet open={open} term={ref} state={state} onClose={() => setOpen(false)} onStarted={() => void swr.mutate()} />
    </>
  );
}
