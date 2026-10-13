"use client";

import { List, ListItem, Navbar, NavbarBackLink, Page } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { TabbarSpacer } from "../TabbarSpacer";
import { useCatalogBack } from "./browse";
import { CATALOG_HOME } from "./list-model";

const bar = "block rounded-full bg-black/[0.08] dark:bg-white/15";
const box = "block bg-black/[0.05] dark:bg-white/10";

/** Placeholder rows shaped like ProductRow, so the real ones land where these were. */
export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <List strong inset className="!my-0 motion-safe:animate-pulse" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <ListItem
          key={i}
          media={<span className={`${box} h-16 w-16 rounded-xl`} />}
          title={
            <span className="block w-full space-y-2 py-0.5">
              <span className={`${bar} h-3.5 w-[85%]`} />
              <span className={`${bar} h-3.5 w-[55%]`} />
            </span>
          }
          subtitle={<span className={`${bar} mt-2.5 h-3 w-20`} />}
        />
      ))}
    </List>
  );
}

/** A row of chip-shaped placeholders, as tall as FilterChips' rows. */
function ChipsSkeleton({ widths }: { widths: number[] }) {
  return (
    <div className="flex gap-2 overflow-hidden px-4 py-1.5">
      {widths.map((w) => (
        <span key={w} className={`${box} h-8 shrink-0 rounded-full`} style={{ width: w }} />
      ))}
    </div>
  );
}

/**
 * A category's, a brand's or a quick view's screen while the server reads it:
 * the navbar with its search, the control panel (terms: a category's rule
 * row is two lines, a brand has none), the chips and the list, in the places
 * the real ones take.
 */
export function TermSkeleton({ taxonomy }: { taxonomy: CatalogTaxonomy | null }) {
  const { t } = useI18n();
  const back = useCatalogBack(CATALOG_HOME);
  return (
    <Page>
      <Navbar
        title={<span className={`${bar} mx-auto h-4 w-36`} />}
        left={<NavbarBackLink onClick={back} aria-label={t.vetrinaCatalog.term.back} />}
        subnavbar={<span className={`${box} h-11 w-full rounded-full`} />}
      />
      <div aria-busy className="motion-safe:animate-pulse">
        {taxonomy ? (
          <List strong inset className="!mb-5 !mt-3">
            {taxonomy === "category" && (
              <ListItem
                media={<span className={`${box} h-[30px] w-[30px] rounded-[8px]`} />}
                title={<span className={`${bar} h-3.5 w-48`} />}
                text={<span className={`${bar} mt-1.5 h-3 w-56`} />}
              />
            )}
            {[0, 1].map((i) => (
              <ListItem
                key={i}
                media={<span className={`${box} h-[30px] w-[30px] rounded-[8px]`} />}
                title={<span className={`${bar} h-3.5 w-36`} />}
              />
            ))}
          </List>
        ) : (
          <div className="space-y-2 px-5 pb-1 pt-3">
            <span className={`${bar} h-3 w-[80%]`} />
          </div>
        )}
        <div className="space-y-0.5 py-1">
          {/* The status chips (terms only), then the other taxonomy's. */}
          {taxonomy && <ChipsSkeleton widths={[72, 104, 92, 96]} />}
          <ChipsSkeleton widths={[88, 64, 112, 80]} />
        </div>
        <div className="flex h-11 items-center justify-between px-5 pt-2">
          <span className={`${bar} h-3 w-24`} />
          <span className={`${bar} h-3 w-28`} />
        </div>
      </div>
      <SkeletonRows count={8} />
      <TabbarSpacer />
    </Page>
  );
}
