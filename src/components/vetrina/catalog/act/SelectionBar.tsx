"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Toolbar, ToolbarPane } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogQuery } from "@/lib/vetrina/catalog";
import { MAX_OPERATION_PRODUCTS, type OperationView } from "@/lib/vetrina/catalog-ops";
import { EyeOff } from "../../icons";
import { Folder, House, Tag } from "../term/glyphs";
import { ActSheets, type ActRequest, type ActSheetKind } from "./ActSheets";
import { useHoldBottomBar } from "./bottom-bar";
import { Eye, OrderLines, Percent } from "./icons";
import type { OrderTerm } from "./OrderSheet";
import { selectedCount, selectionTarget, visibilityAction, type PickedProduct } from "./model";
import type { ProductSelection } from "./selection";

/**
 * While selecting: the action bar in the tab bar's place (which steps aside)
 * — how many are chosen, "Seleziona tutti (N)" for everything the list's
 * query matches, "Annulla" to leave; then Saldo, Nascondi or Mostra, Tag,
 * Categoria, Homepage — and Ordina on a category's or brand's list — each
 * opening its sheet on the selection; Nascondi's and Mostra's lead on to
 * Elimina (a seventh button would leave none of their words whole on a
 * phone). Starting an
 * action leaves selection: the progress pill and the toast take it from
 * there.
 */
export function SelectionBar({
  selection,
  query,
  total,
  pending = false,
  onScreen,
  listName,
  narrowed = false,
  orderTerm,
  onStarted,
}: {
  selection: ProductSelection;
  /** The list's query: what "Seleziona tutti" acts on. */
  query: CatalogQuery;
  /** Products that query matches, not only those loaded. */
  total: number;
  /** The list is reading a new query: `total` is the old one's, so "all" waits for it. */
  pending?: boolean;
  /** The rows loaded, in their order: a hand-picked selection keeps it. */
  onScreen: readonly PickedProduct[];
  /** The list's name ("Nike", "Esauriti"), for "Tutti i 120 prodotti di «Nike»". */
  listName?: string;
  /** The list is not a whole term (a quick view, a search, a chip): "all" is what it found — "I 12 prodotti trovati in «Nike»". */
  narrowed?: boolean;
  /** A category's or brand's list: "Ordina" places the chosen products in its order. None: no "Ordina". */
  orderTerm?: OrderTerm;
  onStarted?: (view: OperationView) => void;
}) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.act;
  const b = a.bar;
  const [request, setRequest] = React.useState<ActRequest | null>(null);
  useHoldBottomBar(selection.active);

  const count = selectedCount(selection, total);
  const tooMany = count > MAX_OPERATION_PRODUCTS;
  const canAct = count > 0 && !tooMany && !(selection.all && pending);
  const visibility = visibilityAction(selection, query);

  const label = selection.all
    ? (narrowed ? a.target.found : a.target.all)(total, listName ?? null)
    : count === 1
      ? ([...selection.picked.values()][0]?.name ?? a.target.products(1))
      : a.target.products(count);

  function open(kind: ActSheetKind) {
    const target = selectionTarget(
      selection,
      query,
      onScreen.map((p) => p.id),
    );
    if (target && canAct) setRequest({ kind, target, label, ...(kind === "order" && orderTerm ? { term: orderTerm } : {}) });
  }

  const countText = tooMany
    ? b.tooMany(MAX_OPERATION_PRODUCTS)
    : count === 0
      ? b.none
      : selection.all
        ? b.all(count)
        : b.count(count);

  const actions: { kind: ActSheetKind; label: string; icon: React.ReactNode }[] = [
    { kind: "sale", label: b.actions.sale, icon: <Percent className={ICON} /> },
    visibility === "show"
      ? { kind: "show", label: b.actions.show, icon: <Eye className={ICON} /> }
      : { kind: "hide", label: b.actions.hide, icon: <EyeOff className={ICON} /> },
    { kind: "tag", label: b.actions.tag, icon: <Tag className={ICON} /> },
    { kind: "category", label: b.actions.category, icon: <Folder className={ICON} /> },
    { kind: "pin", label: b.actions.pin, icon: <House className={ICON} /> },
    ...(orderTerm ? [{ kind: "order" as const, label: b.actions.order, icon: <OrderLines className={ICON} /> }] : []),
  ];

  return (
    <>
      <AnimatePresence initial={false}>
        {selection.active && (
          <motion.div
            key="selection-bar"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 340 }}
            className="pointer-events-none fixed inset-x-0 bottom-0 z-20"
          >
            <Toolbar
              role="toolbar"
              aria-label={b.label}
              className="pointer-events-none"
              innerClassName="!h-auto !w-full flex-col !gap-2"
              bgClassName="!h-[calc(var(--k-safe-area-bottom)+16px+120px+16px)]"
            >
              {/* Each row in its own box: on Material a pane is no box of its own. */}
              <ToolbarPane className="pointer-events-auto !h-12 w-full">
                <div className="flex h-12 w-full items-center">
                  <button
                    type="button"
                    onClick={selection.exit}
                    className="h-full shrink-0 px-4 text-[16px] text-primary transition-opacity active:opacity-50"
                  >
                    {b.cancel}
                  </button>
                  <span
                    aria-live="polite"
                    className={`min-w-0 flex-1 truncate text-center text-[15px] font-semibold tabular-nums ${tooMany ? "text-amber-700 dark:text-amber-400" : ""}`}
                  >
                    {countText}
                  </span>
                  <button
                    type="button"
                    onClick={selection.all ? selection.clear : selection.selectAll}
                    disabled={!selection.all && (total === 0 || pending)}
                    aria-label={selection.all ? undefined : b.selectAll(total)}
                    className="h-full shrink-0 px-4 text-[15px] font-medium text-primary transition-opacity active:opacity-50 disabled:opacity-30"
                  >
                    {selection.all ? (
                      b.deselect
                    ) : (
                      <>
                        {/* The whole words where they fit; a narrow phone gets the short form. */}
                        <span className="max-[399px]:hidden">{b.selectAll(total)}</span>
                        <span className="min-[400px]:hidden">{b.selectAllShort(total)}</span>
                      </>
                    )}
                  </button>
                </div>
              </ToolbarPane>
              <ToolbarPane className="pointer-events-auto !h-16 w-full">
                <div className="flex h-16 w-full items-stretch">
                  {actions.map((action) => (
                    <button
                      key={action.kind}
                      type="button"
                      disabled={!canAct}
                      onClick={() => open(action.kind)}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium text-black transition-opacity active:opacity-50 disabled:opacity-30 dark:text-white"
                    >
                      {action.icon}
                      <span className="max-w-full truncate">{action.label}</span>
                    </button>
                  ))}
                </div>
              </ToolbarPane>
            </Toolbar>
          </motion.div>
        )}
      </AnimatePresence>

      <ActSheets
        request={request}
        onClose={() => setRequest(null)}
        onSwitch={setRequest}
        onStarted={(view) => {
          selection.exit();
          onStarted?.(view);
        }}
      />
    </>
  );
}

const ICON = "h-6 w-6";
