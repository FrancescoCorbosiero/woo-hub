"use client";

import * as React from "react";
import type { CatalogTaxonomy, CatalogTerm } from "@/lib/vetrina/catalog";
import { loadCatalogOverview } from "@/server/actions/vetrina-catalog";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";
import { pickableTerms } from "./rule-text";

/**
 * Picking one of the SHOP's categories or brands for a margin rule. The terms
 * come from the same place the Vetrina's Catalogo tab reads them (the store
 * index and the store's term trees), so the ids a rule saves here are the ids
 * the engine finds on the products. A pick, never free text: a rule scoped to
 * a term id that does not exist would simply price nothing.
 *
 * Read once per page, and only when someone opens a picker — the tab itself
 * never needs the store to show a rule.
 */

type TermsState =
  | { status: "idle" | "loading" | "failed" }
  | { status: "ready"; categories: CatalogTerm[]; brands: CatalogTerm[]; demo: boolean };

interface StoreTermsValue {
  state: TermsState;
  load: () => void;
}

const StoreTermsContext = React.createContext<StoreTermsValue | null>(null);

export function StoreTermsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<TermsState>({ status: "idle" });
  const busy = React.useRef(false);

  const load = React.useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setState({ status: "loading" });
    loadCatalogOverview()
      .then((res) => {
        if (!res.ok) throw new Error(res.error);
        setState({
          status: "ready",
          categories: res.data.categories,
          brands: res.data.brands,
          demo: res.data.demo,
        });
      })
      .catch(() => {
        // Free to try again: the store may simply have been slow.
        busy.current = false;
        setState({ status: "failed" });
      });
  }, []);

  const value = React.useMemo(() => ({ state, load }), [state, load]);
  return <StoreTermsContext.Provider value={value}>{children}</StoreTermsContext.Provider>;
}

function useStoreTerms(): StoreTermsValue {
  const value = React.useContext(StoreTermsContext);
  if (!value) throw new Error("StoreTermPicker needs a StoreTermsProvider above it.");
  return value;
}

/** Rows rendered at once; typing narrows the rest. */
const VISIBLE_TERMS = 150;

export function StoreTermPicker({
  initialTaxonomy = "category",
  selected,
  ruled,
  onPick,
  onCancel,
  className,
}: {
  initialTaxonomy?: CatalogTaxonomy;
  /** The term the rule names now, marked in the list. */
  selected?: { taxonomy: CatalogTaxonomy; id: number } | null;
  /** Term ids that some rule already names, per taxonomy. */
  ruled: Record<CatalogTaxonomy, Set<number>>;
  onPick: (term: CatalogTerm) => void;
  onCancel: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const { state, load } = useStoreTerms();
  const [taxonomy, setTaxonomy] = React.useState<CatalogTaxonomy>(initialTaxonomy);
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (state.status === "idle") load();
  }, [state.status, load]);

  // Ready to type where there is a keyboard to type on; on a phone the
  // keyboard popping up on its own would hide the list it is for.
  React.useEffect(() => {
    if (state.status !== "ready") return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [state.status, taxonomy]);

  const terms = state.status === "ready" ? (taxonomy === "category" ? state.categories : state.brands) : [];
  // The demo shop's ids are not the real shop's: a rule saved on one would
  // land on whatever real term has the same id once the demo is off (the
  // Vetrina refuses the same, margin.ts). Shown to browse, never picked.
  const locked = state.status === "ready" && state.demo;
  const rows = React.useMemo(() => pickableTerms(terms, query), [terms, query]);
  const shown = rows.slice(0, VISIBLE_TERMS);

  return (
    <div
      className={cn("rounded-xl border border-line bg-surface p-3 shadow-sm", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">{t.margins.storePickTitle}</span>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink"
          onClick={onCancel}
        >
          {t.margins.storePickCancel}
        </button>
      </div>

      {/* Category or brand: the two taxonomies hold different terms with
          possibly the same names, so they are never mixed in one list. */}
      <div role="tablist" className="mb-2 inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
        {(["category", "brand"] as const).map((tax) => (
          <button
            key={tax}
            type="button"
            role="tab"
            aria-selected={taxonomy === tax}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              taxonomy === tax ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink",
            )}
            onClick={() => {
              setTaxonomy(tax);
              setQuery("");
            }}
          >
            {tax === "category" ? t.margins.storePickCategories : t.margins.storePickBrands}
          </button>
        ))}
      </div>

      {locked && <p className="mb-2 text-[11px] font-medium leading-snug text-warn">{t.margins.storePickDemo}</p>}

      <input
        ref={searchRef}
        type="search"
        aria-label={t.margins.storePickSearch}
        placeholder={t.margins.storePickSearch}
        disabled={state.status !== "ready"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter takes the first row: type "nike", press Enter.
          if (e.key === "Enter" && shown[0] && !locked) {
            e.preventDefault();
            onPick(shown[0]);
          }
        }}
        className="mb-2 h-9 w-full rounded-md border border-line bg-surface-2 px-2.5 text-sm text-ink shadow-xs placeholder:text-faint focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15 disabled:opacity-50 sm:h-8 sm:text-xs"
      />

      {(state.status === "idle" || state.status === "loading") && (
        <p className="px-1 py-3 text-xs text-muted">{t.margins.storePickLoading}</p>
      )}
      {state.status === "failed" && (
        <div className="flex flex-wrap items-center gap-2 px-1 py-2 text-xs">
          <span className="text-skip">{t.margins.storePickFailed}</span>
          <button
            type="button"
            className="font-medium text-accent-text underline-offset-2 hover:underline"
            onClick={load}
          >
            {t.margins.storePickRetry}
          </button>
        </div>
      )}
      {state.status === "ready" && (
        <ul role="listbox" aria-label={t.margins.storePickTitle} className="max-h-72 overflow-y-auto overscroll-contain">
          {terms.length === 0 && <li className="px-1 py-3 text-xs text-faint">{t.margins.storePickNoTerms}</li>}
          {terms.length > 0 && rows.length === 0 && (
            <li className="px-1 py-3 text-xs text-faint">{t.margins.storePickNoMatch}</li>
          )}
          {shown.map((term) => {
            const isSelected = selected?.taxonomy === term.taxonomy && selected.id === term.id;
            const hasRule = ruled[term.taxonomy].has(term.id);
            const depth = term.path.split(" › ").length - 1;
            return (
              <li key={term.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={locked || undefined}
                  disabled={locked}
                  onClick={() => onPick(term)}
                  className={cn(
                    "flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors enabled:hover:bg-accent/12 disabled:cursor-not-allowed sm:min-h-8 sm:text-xs",
                    isSelected && "bg-accent/12",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    {/* The parents in faint, the term itself in ink: a list of
                        paths that all start with "Saldi ›" reads as noise. */}
                    <span className="block truncate">
                      {depth > 0 && (
                        <span className="text-faint">{term.path.slice(0, term.path.length - term.name.length)}</span>
                      )}
                      <span className={cn("text-ink", isSelected && "font-semibold")}>{term.name}</span>
                    </span>
                    {hasRule && (
                      <span className="block text-[10px] font-medium text-accent-text">{t.margins.storePickRuled}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] text-faint tnum">{t.margins.storePickProducts(term.count)}</span>
                </button>
              </li>
            );
          })}
          {rows.length > shown.length && (
            <li className="px-2 py-1.5 text-[10px] text-faint">{t.margins.storePickMore(rows.length - shown.length)}</li>
          )}
        </ul>
      )}
    </div>
  );
}
