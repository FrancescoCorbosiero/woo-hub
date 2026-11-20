"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { List, ListItem, Navbar, Page, Preloader, Link as KLink } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { PageSummary } from "@/lib/pages/types";
import type { VetrinaResult } from "@/server/vetrina/service";
import type { PagesOverview } from "@/server/wordpress/pages/service";
import { NextLinkTag } from "../catalog/home/ui";
import { House } from "../catalog/term/glyphs";
import { TabbarSpacer } from "../catalog/TabbarSpacer";
import { ErrorState } from "../ErrorState";
import { ChevronLeft, Refresh } from "../icons";
import { useStandalone } from "../sheet-mount";

/** Pages as WordPress nests them: each page followed by its sub-pages, by title; with its depth. */
export function nested(pages: readonly PageSummary[]): { page: PageSummary; depth: number }[] {
  const ids = new Set(pages.map((p) => p.id));
  const children = new Map<number, PageSummary[]>();
  for (const p of pages) {
    // A sub-page of a page not listed (a draft's) stands at the top.
    const parent = ids.has(p.parent) ? p.parent : 0;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  const out: { page: PageSummary; depth: number }[] = [];
  const walk = (parent: number, depth: number) => {
    for (const p of children.get(parent) ?? []) {
      out.push({ page: p, depth });
      if (depth < 8) walk(p.id, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}

const pathOf = (url: string) => {
  try {
    return decodeURI(new URL(url).pathname);
  } catch {
    return url;
  }
};

/**
 * "Pagine": the site's published pages, read live from WordPress on every
 * visit; a tap opens one, to copy its block markup out and paste a new
 * version back. The page the Vetrina's homepage editor works on is marked.
 */
export function PagesHome({ result }: { result: VetrinaResult<PagesOverview> }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.pages;
  const router = useRouter();
  const rows = result.ok ? nested(result.data.pages) : [];

  return (
    <Page>
      <PagesNavbar
        refresh={
          <KLink iconOnly onClick={() => router.refresh()} aria-label={t.vetrina.refresh}>
            <Refresh className="h-5 w-5" />
          </KLink>
        }
      />
      {!result.ok ? (
        <ErrorState code={result.code} error={result.error} words={w.errors} />
      ) : (
        <>
          <p className="px-5 pb-1 pt-1 text-[15px] leading-snug opacity-60">{rows.length === 0 ? w.empty : w.intro}</p>
          {rows.length > 0 && (
            <List strong inset dividers aria-label={w.title}>
              {rows.map(({ page, depth }) => {
                const vetrina = page.id === result.data.vetrinaPageId;
                return (
                  <ListItem
                    key={page.id}
                    link
                    linkComponent={NextLinkTag}
                    linkProps={{ href: `/vetrina/pagine/${page.id}` }}
                    title={
                      <span className="flex items-center gap-1.5" style={{ paddingInlineStart: depth * 14 }}>
                        {vetrina && <House className="h-4 w-4 shrink-0 opacity-60" />}
                        <span className="truncate">{page.title || `#${page.id}`}</span>
                      </span>
                    }
                    subtitle={<span style={{ paddingInlineStart: depth * 14 }}>{vetrina ? w.vetrinaBadge : pathOf(page.url)}</span>}
                  />
                );
              })}
            </List>
          )}
        </>
      )}
      <TabbarSpacer />
    </Page>
  );
}

/** The tab's navbar: a large title named like its tab, the way back to the Hub. */
function PagesNavbar({ refresh }: { refresh: React.ReactNode }) {
  const { t } = useI18n();
  const standalone = useStandalone();
  return (
    <Navbar
      large
      transparent
      centerTitle
      title={t.vetrinaCatalog.pages.title}
      titleClassName={`truncate ${standalone ? "max-w-[calc(100%-176px)]" : "max-w-[calc(100%-272px)]"}`}
      left={
        <>
          {!standalone && (
            <KLink href="/" component="a" className="gap-0.5 !px-2">
              <ChevronLeft className="h-5 w-5" />
              {t.vetrina.backToHub}
            </KLink>
          )}
          {refresh}
        </>
      }
    />
  );
}

/** The tab while WordPress answers: the same navbar, then a spinner. */
export function PagesHomeSkeleton() {
  const { t } = useI18n();
  return (
    <Page>
      <PagesNavbar
        refresh={
          <KLink iconOnly aria-label={t.vetrina.refresh}>
            <Preloader className="!h-5 !w-5" />
          </KLink>
        }
      />
      <div className="grid place-items-center pt-16">
        <Preloader className="!h-8 !w-8" />
      </div>
      <TabbarSpacer />
    </Page>
  );
}
