"use client";

import { useRouter } from "next/navigation";
import { List, ListItem, Navbar, Page, Preloader, Link as KLink } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { MenuSummary } from "@/lib/menus/types";
import type { VetrinaResult } from "@/server/vetrina/service";
import { ActivityLink } from "../catalog/act/ActivityLink";
import { NextLinkTag } from "../catalog/home/ui";
import { TabbarSpacer } from "../catalog/TabbarSpacer";
import { ErrorState } from "../ErrorState";
import { ChevronLeft, Refresh } from "../icons";
import { useStandalone } from "../sheet-mount";

/**
 * "Menu": the site's navigation menus (WordPress's Aspetto › Menu), read
 * live on every visit — each with where the theme shows it and how many
 * items it holds; a tap opens it.
 */
export function MenusHome({ result }: { result: VetrinaResult<MenuSummary[]> }) {
  const { t, locale } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const router = useRouter();
  const list = new Intl.ListFormat(locale === "en" ? "en-GB" : "it-IT", { style: "long", type: "conjunction" });

  return (
    <Page>
      <MenusNavbar
        refresh={
          <KLink iconOnly onClick={() => router.refresh()} aria-label={t.vetrina.refresh}>
            <Refresh className="h-5 w-5" />
          </KLink>
        }
      />
      {!result.ok ? (
        <ErrorState code={result.code} error={result.error} words={m.errors} />
      ) : result.data.length === 0 ? (
        <p className="px-5 pt-2 text-[15px] leading-snug opacity-70">{m.empty}</p>
      ) : (
        <>
          <p className="px-5 pb-1 pt-1 text-[15px] leading-snug opacity-60">{m.intro}</p>
          <List strong inset dividers aria-label={m.title}>
            {result.data.map((menu) => (
              <ListItem
                key={menu.id}
                link
                linkComponent={NextLinkTag}
                linkProps={{ href: `/vetrina/menu/${menu.id}` }}
                title={menu.name}
                subtitle={menu.locations.length > 0 ? m.shownIn(list.format(menu.locations.map((l) => l.name))) : m.shownNowhere}
                after={<span className="tabular-nums">{m.items(menu.count)}</span>}
              />
            ))}
          </List>
        </>
      )}
      <TabbarSpacer />
    </Page>
  );
}

/** The tab's navbar: a large title named like its tab, the way back to the Hub, the log. */
function MenusNavbar({ refresh }: { refresh: React.ReactNode }) {
  const { t } = useI18n();
  const standalone = useStandalone();
  return (
    <Navbar
      large
      transparent
      centerTitle
      title={t.vetrinaCatalog.menus.title}
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
      right={<ActivityLink />}
    />
  );
}

/** The tab while WordPress answers: the same navbar, then a spinner. */
export function MenusHomeSkeleton() {
  const { t } = useI18n();
  return (
    <Page>
      <MenusNavbar
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
