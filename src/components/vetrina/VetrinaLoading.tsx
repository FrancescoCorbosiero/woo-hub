"use client";

import { Navbar, NavbarBackLink, Page, Preloader } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { useBack } from "./use-back";

/**
 * The section editor while the site answers (the Vetrina always reads it
 * live): its navbar's way back already there, and no title of its own — the
 * section's name comes with it, and "Vetrina" named a tab that is now
 * "Homepage".
 */
export function VetrinaLoading() {
  const { t } = useI18n();
  const back = useBack("/vetrina");
  return (
    <Page>
      <Navbar left={<NavbarBackLink onClick={back} aria-label={t.vetrinaCatalog.term.back} />} />
      <div className="grid place-items-center pt-24">
        <Preloader className="!h-8 !w-8" />
      </div>
    </Page>
  );
}
