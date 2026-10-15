"use client";

import { Link as KLink, List, ListItem, Navbar, Page, Preloader, Searchbar } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { ChevronLeft } from "../../icons";
import { useStandalone } from "../../sheet-mount";
import { Clock, Plus } from "../act/icons";
import { TabbarSpacer } from "../TabbarSpacer";

/**
 * The catalog home while the server reads it: the same navbar and search bar
 * in the same places, then the shape of the lists, so nothing moves when the
 * real screen arrives. The search field waits for the real one.
 */
export function CatalogHomeSkeleton() {
  const { t } = useI18n();
  const h = t.vetrinaCatalog.home;
  const standalone = useStandalone();
  const bar = "rounded-full bg-black/[0.08] dark:bg-white/[0.12]";

  return (
    <Page>
      <Navbar
        large
        transparent
        centerTitle
        title={h.title}
        titleClassName={`truncate ${standalone ? "max-w-[calc(100%-224px)]" : "max-w-[calc(100%-272px)]"}`}
        // The same buttons in the same places; they wait for the real screen.
        left={
          <>
            {!standalone && (
              <KLink href="/" component="a" className="gap-0.5 !px-2">
                <ChevronLeft className="h-5 w-5" />
                {t.vetrina.backToHub}
              </KLink>
            )}
            <KLink iconOnly aria-label={t.vetrina.refresh}>
              <Preloader className="!h-5 !w-5" />
            </KLink>
          </>
        }
        right={
          <span aria-hidden className="flex h-full items-center opacity-40">
            <KLink iconOnly component="span">
              <Clock className="h-[22px] w-[22px]" />
            </KLink>
            <KLink iconOnly component="span">
              <Plus className="h-6 w-6" />
            </KLink>
          </span>
        }
        subnavbar={
          <Searchbar
            value=""
            placeholder={h.search}
            onChange={() => undefined}
            clearButton={false}
            inputStyle={{ pointerEvents: "none", outline: "none" }}
            aria-hidden
          />
        }
      />

      <div aria-hidden className="animate-pulse">
        <div className="px-4 pt-2">
          <div className={`h-12 ${bar}`} />
        </div>
        <div className="-mb-2 mt-3 flex h-11 items-center gap-2 overflow-hidden px-4">
          {[96, 112, 104].map((width) => (
            <div key={width} className={`h-[34px] shrink-0 ${bar}`} style={{ width }} />
          ))}
        </div>
        <div className={`mx-4 mt-8 h-4 w-32 ${bar}`} />
        {/* Rows like the first group's: a tile, the name, its sections, the count. */}
        <List strong inset className="!mt-3">
          {[55, 38, 62, 45, 70].map((width, i) => (
            <ListItem
              key={i}
              media={<span className="block h-[30px] w-[30px] rounded-[8px] bg-black/[0.08] dark:bg-white/[0.12]" />}
              title={<span className={`block h-3.5 ${bar}`} style={{ width: `${width}%` }} />}
              text={<span className={`mt-2 block h-3 w-24 ${bar}`} />}
              after={<span className={`block h-3.5 w-8 ${bar}`} />}
            />
          ))}
        </List>
      </div>

      <TabbarSpacer />
    </Page>
  );
}
