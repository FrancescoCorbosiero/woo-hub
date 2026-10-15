"use client";

import type * as React from "react";
import { useParams } from "next/navigation";
import { List, ListItem, Navbar, NavbarBackLink, Page } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { CatalogTaxonomy } from "@/lib/vetrina/catalog";
import { TabbarSpacer } from "../TabbarSpacer";
import { rememberedShape, useCatalogBack, type TermShape } from "./browse";
import { CATALOG_HOME, parseQuickView, parseTermId } from "./list-model";

const bar = "block rounded-full bg-black/[0.08] dark:bg-white/15";
const box = "block bg-black/[0.05] dark:bg-white/10";

/**
 * Text that has not arrived: as tall and as wide as `children` would be in
 * the same place (same font, same lines, same clamp), drawn as soft bars,
 * one per line. A placeholder with the real words' size is what keeps a
 * screen from jumping when they land.
 */
export function Ghost({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span aria-hidden className={className}>
      <span className="select-none rounded-md bg-black/[0.08] text-transparent [-webkit-box-decoration-break:clone] [box-decoration-break:clone] dark:bg-white/15">
        {children}
      </span>
    </span>
  );
}

// Names as long as most: a row's title takes the two lines a real one usually does.
const SAMPLE_NAMES = [
  "Nike Air Jordan 1 Retro High OG Chicago Lost and Found",
  "Adidas Samba OG Cloud White Core Black",
  "New Balance 550 White Green Leather Sneakers",
  "Nike Dunk Low Retro Panda Black White",
  "Asics Gel-Kayano 14 Cream Black Metallic Plum",
  "Yeezy Boost 350 V2 Onyx",
];

/** Placeholder rows shaped like ProductRow (its 64px photo, its two-line name, its price and badges), so the real ones land where these were. */
export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <List strong inset className="!my-0 motion-safe:animate-pulse" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <ListItem
          key={i}
          contentClassName="w-full"
          media={<span className={`${box} h-16 w-16 rounded-xl`} />}
          titleFontSizeIos="text-[16px]"
          titleFontSizeMaterial="text-[16px]"
          title={<Ghost className="line-clamp-2 leading-snug">{SAMPLE_NAMES[i % SAMPLE_NAMES.length]}</Ghost>}
          subtitle={
            <span className="mt-1 flex items-center gap-1.5">
              <span className={`${bar} h-3.5 w-14`} />
              {i % 3 === 1 && <span className={`${box} h-5 w-16 rounded-md`} />}
            </span>
          }
        />
      ))}
    </List>
  );
}

/** A row of chip-shaped placeholders, as tall as FilterChips' rows (a 32px chip in a 44px target). */
function ChipsSkeleton({ widths }: { widths: number[] }) {
  return (
    <div className="flex gap-2 overflow-hidden px-4 py-1.5">
      {widths.map((w, i) => (
        <span key={i} className={`${box} h-8 shrink-0 rounded-full`} style={{ width: w }} />
      ))}
    </div>
  );
}

/** An iOS Settings tile, as the panel's rows have. */
const tile = <span className={`${box} h-[30px] w-[30px] rounded-[8px]`} />;

/**
 * A category's, a brand's or a quick view's screen while the server reads it:
 * the navbar with its search, then the parts the real screen will have, in
 * the places and at the heights they take. For a term, what the catalog's
 * home (or an earlier visit) told of it: its rule, its homepage sections,
 * its actions, its sub-terms, the other taxonomy's chips. For a quick view,
 * its own line. The panel's fixed words are drawn as ghosts of themselves.
 */
export function TermSkeleton({ taxonomy }: { taxonomy: CatalogTaxonomy | null }) {
  const { t } = useI18n();
  const back = useCatalogBack(CATALOG_HOME);
  const params = useParams<{ id?: string; view?: string }>();
  const id = taxonomy && params?.id ? parseTermId(params.id) : null;
  const view = !taxonomy && params?.view ? parseQuickView(params.view) : null;
  const shape = taxonomy ? rememberedShape(taxonomy, id) : null;

  return (
    <Page>
      <Navbar
        title={<span className={`${bar} mx-auto h-4 w-36`} />}
        left={<NavbarBackLink onClick={back} aria-label={t.vetrinaCatalog.term.back} />}
        subnavbar={<span className={`${box} h-11 w-full rounded-full`} />}
      />
      <div aria-busy className="motion-safe:animate-pulse">
        {taxonomy && shape ? (
          <TermTop taxonomy={taxonomy} shape={shape} />
        ) : (
          <p className="px-5 pb-1 pt-3 text-[15px] leading-snug">
            <Ghost>{view ? t.vetrinaCatalog.term.views[view].hint : t.vetrinaCatalog.term.views.soldout.hint}</Ghost>
          </p>
        )}
        <div className="space-y-0.5 py-1">
          {/* The status chips (terms only), then the other taxonomy's, when they narrow the list. */}
          {taxonomy && <ChipsSkeleton widths={[72, 104, 92, 96, 88]} />}
          {(!shape || shape.within) && <ChipsSkeleton widths={[88, 64, 112, 80]} />}
        </div>
        <div className="flex min-h-11 items-center justify-between pe-4 ps-5 pt-2">
          <span className={`${bar} h-3 w-24`} />
          <span className={`${bar} h-3 w-28`} />
        </div>
      </div>
      <SkeletonRows count={8} />
      <TabbarSpacer />
    </Page>
  );
}

/** A term's panel, its actions and its sub-terms, as TermScreen draws them. */
function TermTop({ taxonomy, shape }: { taxonomy: CatalogTaxonomy; shape: TermShape }) {
  const { t } = useI18n();
  const v = t.vetrinaCatalog.term;
  const p = v.panel;
  const m = t.vetrinaCatalog.margins;
  return (
    <>
      <List strong inset className="!mb-5 !mt-3">
        {taxonomy === "category" &&
          (shape.automatic ? (
            <ListItem
              media={tile}
              title={<Ghost className="line-clamp-2">{p.automatic(p.automaticSample)}</Ghost>}
            />
          ) : (
            <ListItem
              media={tile}
              title={<Ghost>{t.vetrina.auto.make}</Ghost>}
              text={<Ghost>{p.makeHint}</Ghost>}
            />
          ))}
        {Array.from({ length: shape.sections }, (_, i) => (
          <ListItem key={i} media={tile} title={<Ghost>{p.notInHomepage}</Ghost>} />
        ))}
        {shape.counted && <ListItem media={tile} title={<Ghost>{p.allGood}</Ghost>} />}
      </List>

      {shape.counted && (
        <List strong inset className="!mb-5 !mt-0">
          <ListItem
            media={tile}
            title={<Ghost>{p.visible}</Ghost>}
            text={<Ghost>{p.visibleHint}</Ghost>}
            after={<span className={`${box} h-7 w-16 rounded-full`} />}
          />
          {shape.partlyHidden && <ListItem media={tile} title={<Ghost>{p.showHidden(2)}</Ghost>} />}
          <ListItem media={tile} title={<Ghost>{p.saleStart}</Ghost>} text={<Ghost>{p.saleHint}</Ghost>} />
          {/* The margin row (MarginRow) draws its ghost from the first frame on a term with products. */}
          <ListItem link linkComponent="div" media={tile} title={<Ghost>{m.row.standard}</Ghost>} text={<Ghost>{m.row.loading}</Ghost>} />
        </List>
      )}

      {shape.children && (
        <div className="pb-1">
          <div className="px-5 pb-0.5 text-[13px] font-semibold uppercase tracking-wide">
            <Ghost>{v.children[taxonomy]}</Ghost>
          </div>
          <ChipsSkeleton widths={[120, 96, 132]} />
        </div>
      )}
    </>
  );
}
