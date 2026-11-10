"use client";

import * as React from "react";
import { Actions, ActionsButton, ActionsGroup, ActionsLabel, Block, Button, List, ListItem, Page } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { keepStoreEdits, repriceStoreEdits } from "@/server/actions/store-edits";
import type { StoreEditView, StoreEditsState } from "@/server/sync/store-edits";
import type { VetrinaResult } from "@/server/vetrina/service";
import { TabbarSpacer } from "../catalog/TabbarSpacer";
import { ErrorState } from "../ErrorState";
import { ShopConfirm, ShopSubNavbar, useEuro, type ConfirmAsk } from "./parts";

/**
 * "Prezzi cambiati su WordPress": the sizes whose price someone changed on
 * the store after the Hub last wrote it. The sync keeps them — the automatic
 * one too — and only a person can say which price is right: WordPress's
 * (kept, and locked on its size, so the Hub writes it from now on), or the
 * Hub's (written now). One size from its row, or all of them at once.
 * The Hub's own list (Sync tab) is the same one: deciding here clears it there.
 */
export function PricesScreen({ result }: { result: VetrinaResult<StoreEditsState> }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.shop.prices;
  const eur = useEuro();
  const [state, setState] = React.useState<StoreEditsState | null>(result.ok ? result.data : null);
  const [picked, setPicked] = React.useState<StoreEditView | null>(null);
  const [ask, setAsk] = React.useState<ConfirmAsk | null>(null);

  async function act(kind: "keep" | "reprice", ids: number[] | "all") {
    const res = await (kind === "keep" ? keepStoreEdits({ ids }) : repriceStoreEdits({ ids })).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (!res.ok) {
      toast.error(`${w.failed} ${res.error}`);
      return;
    }
    setState(res.data.state);
    if ("kept" in res.data) {
      toast.success(w.kept(res.data.kept));
      if (res.data.notLockable > 0) toast.message(w.notLockable);
    } else if (res.data.error) {
      toast.error(`${w.failed} ${res.data.error}`);
    } else {
      toast.success(w.repriced(res.data.handed));
    }
  }

  const rows = state?.rows ?? [];
  const total = state?.total ?? 0;

  return (
    <Page>
      <ShopSubNavbar title={w.title} />
      {!result.ok || !state ? (
        result.ok ? null : (
          <div className="pt-3">
            <ErrorState code={result.code} error={result.error} />
          </div>
        )
      ) : total === 0 ? (
        <Block strong inset className="text-center text-[15px] leading-snug">
          {w.empty}
        </Block>
      ) : (
        <>
          <p className="px-5 pb-1 pt-3 text-[15px] leading-snug opacity-60">{w.intro}</p>
          <div className="space-y-2 px-4 pt-2">
            <Button
              rounded
              tonal
              className="!h-11 w-full"
              onClick={() => setAsk({ title: w.keepAll, body: w.keepAllConfirm(total), confirm: w.confirm, run: () => act("keep", "all") })}
            >
              <span className="truncate">{w.keepAll}</span>
            </Button>
            <Button
              rounded
              tonal
              className="!h-11 w-full"
              onClick={() =>
                setAsk({ title: w.repriceAll, body: w.repriceAllConfirm(total), confirm: w.confirm, run: () => act("reprice", "all") })
              }
            >
              <span className="truncate">{w.repriceAll}</span>
            </Button>
          </div>
          <List strong inset dividers aria-label={w.title}>
            {rows.map((row) => (
              <ListItem
                key={row.variationId}
                link
                linkComponent="button"
                linkProps={{ type: "button", onClick: () => setPicked(row) }}
                contentClassName="w-full text-start"
                title={row.title}
                subtitle={w.size(row.sizeLabel)}
                text={w.row(eur(row.storePrice), eur(row.hubPrice))}
              />
            ))}
          </List>
          {total > rows.length && <p className="px-5 text-[13px] leading-snug opacity-60">{w.more(rows.length, total)}</p>}
        </>
      )}
      <TabbarSpacer />

      <Actions opened={picked != null} onBackdropClick={() => setPicked(null)}>
        <ActionsGroup>
          {picked && (
            <ActionsLabel className="!h-auto min-h-14 py-3">
              <span className="flex flex-col items-center gap-0.5 text-center">
                <span className="font-semibold">{picked.title}</span>
                <span>{picked.lockable ? w.size(picked.sizeLabel) : w.notLockable}</span>
              </span>
            </ActionsLabel>
          )}
          {picked?.lockable && (
            <ActionsButton
              onClick={() => {
                setPicked(null);
                void act("keep", [picked.variationId]);
              }}
            >
              {w.keep(eur(picked.storePrice))}
            </ActionsButton>
          )}
          {picked && (
            <ActionsButton
              onClick={() => {
                setPicked(null);
                void act("reprice", [picked.variationId]);
              }}
            >
              {w.reprice(eur(picked.hubPrice))}
            </ActionsButton>
          )}
        </ActionsGroup>
        <ActionsGroup>
          <ActionsButton onClick={() => setPicked(null)}>{t.vetrinaCatalog.act.bar.cancel}</ActionsButton>
        </ActionsGroup>
      </Actions>
      <ShopConfirm ask={ask} onClose={() => setAsk(null)} />
    </Page>
  );
}
