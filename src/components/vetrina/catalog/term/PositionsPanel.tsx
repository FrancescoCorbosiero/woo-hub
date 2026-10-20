"use client";

import * as React from "react";
import { List, ListItem } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogTerm } from "@/lib/vetrina/catalog";
import { Grip } from "../../icons";
import { OrderLines, ToTop } from "../act/icons";
import { RankingActions } from "../sources/RankingActions";
import { useOrderSourceNames } from "../sources/use-order-sources";
import { PanelIcon } from "./PanelIcon";

/**
 * "Posizioni nel negozio": how the term's page in the shop lines up its
 * products, and the three ways to change it, each a button in sight —
 * dragged by hand, copied from a ranking of another shop, or a few products
 * sent to the top (a selection, then "Posiziona"). Never called "ordine":
 * in a shop that word is a customer's order.
 */
export function PositionsPanel({
  term,
  onArrange,
  onRanking,
  onManageRankings,
  onPlace,
}: {
  term: CatalogTerm;
  onArrange: () => void;
  onRanking: (source: { id: string; name: string }) => void;
  onManageRankings: () => void;
  onPlace: () => void;
}) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.term.positions;
  const rankings = useOrderSourceNames();
  const [rankingsOpen, setRankingsOpen] = React.useState(false);
  return (
    <>
      <div className="px-5 pb-1.5">
        <div className="text-[13px] font-semibold uppercase tracking-wide opacity-50">{p.title}</div>
        <p className="mt-0.5 text-[13px] leading-snug opacity-60">{p.hint(term.name)}</p>
      </div>
      <List strong inset className="!mb-5 !mt-0">
        <ListItem
          link
          linkComponent="button"
          linkProps={{ type: "button", onClick: onArrange }}
          contentClassName="w-full text-start"
          media={
            <PanelIcon tone="ink">
              <Grip className="h-[18px] w-[18px]" />
            </PanelIcon>
          }
          title={p.arrange}
          subtitle={p.arrangeHint}
        />
        <ListItem
          link
          linkComponent="button"
          linkProps={{ type: "button", onClick: () => setRankingsOpen(true), "aria-haspopup": "dialog" }}
          contentClassName="w-full text-start"
          media={
            <PanelIcon tone="gold">
              <OrderLines className="h-[18px] w-[18px]" />
            </PanelIcon>
          }
          title={p.ranking}
          subtitle={<span className="line-clamp-2">{p.rankingHint(rankings.data?.length ?? 0)}</span>}
        />
        <ListItem
          link
          linkComponent="button"
          linkProps={{ type: "button", onClick: onPlace }}
          contentClassName="w-full text-start"
          media={
            <PanelIcon tone="muted">
              <ToTop className="h-[18px] w-[18px]" />
            </PanelIcon>
          }
          title={p.place}
          subtitle={p.placeHint}
        />
      </List>
      <RankingActions
        open={rankingsOpen}
        termName={term.name}
        onClose={() => setRankingsOpen(false)}
        onUse={onRanking}
        onManage={onManageRankings}
      />
    </>
  );
}
