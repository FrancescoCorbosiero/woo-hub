"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Tabbar, TabbarLink, ToolbarPane } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { useSelectionBarShown } from "./catalog/act/bottom-bar";
import { House } from "./catalog/term/glyphs";

/**
 * The Vetrina's two tabs, Homepage and Catalogo: Konsta's floating glass tab
 * bar, above the home indicator. It steps aside in the section editor, which
 * has its own publish bar down there, and while a catalog list is selecting:
 * the selection's action bar takes its place.
 */

export type VetrinaTab = "home" | "catalog";

/**
 * The tab an address belongs to, or null where the bar is not shown (the
 * section editor, anything else). "/" is the Vetrina too, on its own address.
 */
export function tabOf(pathname: string): VetrinaTab | null {
  if (pathname === "/vetrina" || pathname === "/") return "home";
  if (pathname === "/vetrina/catalogo" || pathname.startsWith("/vetrina/catalogo/")) return "catalog";
  return null;
}

/**
 * The room the bar takes, for --vetrina-tabbar (see catalog/TabbarSpacer):
 * Konsta's bar is 64px of links plus 16px under them on iOS (80px on
 * Material), then the phone's bottom safe area. A fixed value, not a
 * measure, so the first paint already leaves the right room.
 */
export const TABBAR_SPACE = "calc(80px + env(safe-area-inset-bottom))";

const HREF: Record<VetrinaTab, string> = { home: "/vetrina", catalog: "/vetrina/catalogo" };

/** At the tab's first screen, nothing searched or chosen in the address. */
function atStart(tab: VetrinaTab): boolean {
  const { pathname, search } = window.location;
  return !search && (pathname === HREF[tab] || (tab === "home" && pathname === "/"));
}

/**
 * Where the catalog was left (a category, a search), so its tab opens there
 * again from the homepage, as a phone's tabs do.
 */
function useLastCatalog(active: VetrinaTab | null): string {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [last, setLast] = React.useState(HREF.catalog);
  React.useEffect(() => {
    if (active === "catalog") setLast(search ? `${pathname}?${search}` : pathname);
  }, [active, pathname, search]);
  return last;
}

/**
 * On a touch, Konsta's iOS tab bar opens the tab itself, with a click of its
 * own on the link (which next/link turns into an in-app navigation), and then
 * only stops the finger's real click from spreading — it does not cancel it,
 * so the browser would follow the link too and reload the whole app. This
 * cancels that one real click. React sees it first: its listener sits on the
 * document, Konsta's on the bar.
 */
function useNoDoubleClick(): (e: React.MouseEvent) => void {
  const pending = React.useRef(false);
  return React.useCallback((e: React.MouseEvent) => {
    if (!e.nativeEvent.isTrusted) {
      pending.current = true;
    } else if (pending.current) {
      pending.current = false;
      e.preventDefault();
    }
  }, []);
}

export function VetrinaTabbar({ active }: { active: VetrinaTab | null }) {
  const { t } = useI18n();
  const tabs = t.vetrinaCatalog.home.tabs;
  const lastCatalog = useLastCatalog(active);
  const onClickCapture = useNoDoubleClick();
  const aside = useSelectionBarShown();
  // On its own tab, a tab leads back to its first screen.
  const hrefOf = (tab: VetrinaTab) => (tab === "catalog" && active !== "catalog" ? lastCatalog : HREF[tab]);

  // Tapping the tab you are on, at its first screen, scrolls back up instead
  // of reloading it (the homepage reads the live site: slow, and pointless).
  // From deeper in the catalog, or with a search open, it goes back to the start.
  const onTap = (tab: VetrinaTab) => (e: React.MouseEvent) => {
    if (tab !== active || !atStart(tab)) return;
    e.preventDefault();
    document.querySelector(".k-page")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const link = (tab: VetrinaTab, label: string, icon: React.ReactNode) => (
    <TabbarLink
      key={tab}
      active={active === tab}
      component={Link}
      linkProps={{ href: hrefOf(tab), onClick: onTap(tab), "aria-current": active === tab ? "page" : undefined }}
      icon={icon}
      label={label}
      colors={{ textIos: "text-black/55 dark:text-white/60", textActiveIos: "text-black dark:text-white" }}
      className="pointer-events-auto"
    />
  );

  return (
    <AnimatePresence initial={false}>
      {active && !aside && (
        <motion.nav
          key="tabbar"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 340 }}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-20"
          onClickCapture={onClickCapture}
        >
          <Tabbar labels icons>
            <ToolbarPane className="pointer-events-auto">
              {link("home", tabs.homepage, <House className={iconSize} />)}
              {link("catalog", tabs.catalog, <CatalogIcon className={iconSize} />)}
            </ToolbarPane>
          </Tabbar>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

const iconSize = "h-[26px] w-[26px]";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Four tiles: the shop by category and brand. */
function CatalogIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
    </svg>
  );
}
