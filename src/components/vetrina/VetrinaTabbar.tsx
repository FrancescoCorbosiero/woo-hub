"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Tabbar, TabbarLink, ToolbarPane } from "konsta/react";
import { useI18n } from "@/i18n/provider";

/**
 * The Vetrina's two tabs, Homepage and Catalogo: Konsta's floating glass tab
 * bar, above the home indicator. It steps aside in the section editor, which
 * has its own publish bar down there.
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

export function VetrinaTabbar({ active }: { active: VetrinaTab | null }) {
  const { t } = useI18n();
  const tabs = t.vetrinaCatalog.home.tabs;
  const lastCatalog = useLastCatalog(active);
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
      {active && (
        <motion.nav
          key="tabbar"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 340 }}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-20"
        >
          <Tabbar labels icons>
            <ToolbarPane className="pointer-events-auto">
              {link("home", tabs.homepage, <HomeIcon className={iconSize} />)}
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

/** A house: the shop's front page. */
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M3.5 10.6 12 3.8l8.5 6.8" />
      <path d="M5.5 9.2V19a1 1 0 0 0 1 1H10v-5.2a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8V20h3.5a1 1 0 0 0 1-1V9.2" />
    </svg>
  );
}

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
