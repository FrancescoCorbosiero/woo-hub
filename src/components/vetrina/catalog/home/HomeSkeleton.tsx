"use client";

import { Link as KLink, List, Navbar, Page, Preloader, Searchbar } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { ChevronLeft } from "../../icons";
import { useStandalone } from "../../sheet-mount";
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
        left={
          standalone ? undefined : (
            <KLink href="/" component="a" className="gap-0.5">
              <ChevronLeft className="h-5 w-5" />
              {t.vetrina.backToHub}
            </KLink>
          )
        }
        right={
          <KLink aria-label={t.vetrina.refresh}>
            <Preloader className="!h-5 !w-5" />
          </KLink>
        }
        subnavbar={
          <Searchbar
            value=""
            placeholder={h.search}
            onChange={() => undefined}
            clearButton={false}
            inputStyle={{ pointerEvents: "none" }}
            aria-hidden
          />
        }
      />

      <div aria-hidden className="animate-pulse">
        <div className="px-4 pt-2">
          <div className={`h-11 ${bar}`} />
        </div>
        <div className="-mb-2 mt-3 flex h-11 items-center gap-2 overflow-hidden px-4">
          {[96, 112, 104].map((width) => (
            <div key={width} className={`h-[34px] shrink-0 ${bar}`} style={{ width }} />
          ))}
        </div>
        <div className={`mx-4 mt-8 h-4 w-32 ${bar}`} />
        <List strong inset className="!mt-3">
          {[55, 38, 62, 45, 70, 50, 40].map((width, i) => (
            <li key={i} className="flex h-[52px] items-center justify-between ps-4 pe-4">
              <span className={`h-3.5 ${bar}`} style={{ width: `${width}%` }} />
              <span className={`h-3.5 w-8 ${bar}`} />
            </li>
          ))}
        </List>
      </div>

      <TabbarSpacer />
    </Page>
  );
}
