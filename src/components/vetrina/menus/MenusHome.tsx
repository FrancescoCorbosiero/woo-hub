"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, List, ListItem, Navbar, Page, Preloader, Link as KLink } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { MenuSummary, ThemePlace } from "@/lib/menus/types";
import type { VetrinaResult } from "@/server/vetrina/service";
import { ActivityLink } from "../catalog/act/ActivityLink";
import { FILL } from "../catalog/act/parts";
import { Plus } from "../catalog/act/icons";
import { NextLinkTag } from "../catalog/home/ui";
import { TabbarSpacer } from "../catalog/TabbarSpacer";
import { ErrorState } from "../ErrorState";
import { ChevronLeft, Refresh } from "../icons";
import { useStandalone } from "../sheet-mount";
import { NewMenuSheet, type NewMenuRequest } from "./MenuNameSheet";
import { PlaceDialog, PlacePicker, type PlaceChange } from "./PlaceDialog";

/** The tab's read: the site's menus, and the theme's places with the menu each shows. */
export interface MenusHomeData {
  menus: MenuSummary[];
  places: ThemePlace[];
}

/**
 * "Menu": the site's navigation menus (WordPress's Aspetto › Menu), read
 * live on every visit — each with where the theme shows it and how many
 * items it holds; a tap opens it. "Nuovo menu" makes one (empty, or a copy
 * to rework before showing it), and the theme's places say which menu each
 * shows — a tap chooses another, or none.
 */
export function MenusHome({ result }: { result: VetrinaResult<MenusHomeData> }) {
  const { t, locale } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const router = useRouter();
  const list = new Intl.ListFormat(locale === "en" ? "en-GB" : "it-IT", { style: "long", type: "conjunction" });
  const [creating, setCreating] = React.useState<NewMenuRequest | null>(null);
  const [picking, setPicking] = React.useState<ThemePlace | null>(null);
  const [change, setChange] = React.useState<PlaceChange | null>(null);
  const menus = result.ok ? result.data.menus : [];

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
      ) : (
        <>
          <p className="px-5 pb-1 pt-1 text-[15px] leading-snug opacity-60">{menus.length === 0 ? m.empty : m.intro}</p>
          <div className="px-4 pt-2">
            <Button large rounded colors={FILL} onClick={() => setCreating({ menus, copyOf: null })} className="w-full gap-1.5">
              <Plus className="h-5 w-5" />
              {m.home.newMenu}
            </Button>
          </div>
          {menus.length > 0 && (
            <List strong inset dividers aria-label={m.title}>
              {menus.map((menu) => (
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
          )}
          <h2 className="px-5 pb-0.5 pt-2 text-[13px] font-semibold uppercase tracking-wide opacity-50">{m.home.places}</h2>
          {result.data.places.length === 0 ? (
            <p className="px-5 pt-1 text-[15px] leading-snug opacity-60">{m.home.noPlaces}</p>
          ) : (
            <>
              <p className="px-5 pt-0.5 text-[13px] leading-snug opacity-60">{m.home.placesIntro}</p>
              <List strong inset dividers aria-label={m.home.places}>
                {result.data.places.map((place) => (
                  <ListItem
                    key={place.slug}
                    link
                    linkComponent="button"
                    linkProps={{ type: "button", onClick: () => setPicking(place) }}
                    contentClassName="w-full text-start"
                    title={place.name}
                    after={<span className={place.menu ? undefined : "opacity-50"}>{place.menu?.name ?? m.home.none}</span>}
                  />
                ))}
              </List>
            </>
          )}
        </>
      )}
      <TabbarSpacer />

      <NewMenuSheet request={creating} onClose={() => setCreating(null)} />
      <PlacePicker
        place={picking}
        menus={menus}
        onPick={(next) => {
          setPicking(null);
          setChange(next);
        }}
        onClose={() => setPicking(null)}
      />
      <PlaceDialog change={change} onClose={() => setChange(null)} />
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
