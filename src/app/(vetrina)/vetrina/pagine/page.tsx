import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { PagesHome } from "@/components/vetrina/pages/PagesHome";
import { attempt } from "@/server/vetrina/service";
import { pagesOverview } from "@/server/wordpress/pages/service";
import { getPageSource } from "@/server/wordpress/pages/source";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.pages.title} — Store Hub` };
}

/** "Pagine": the site's published pages, read live from WordPress on every visit, the Vetrina's own marked. */
export default async function PagesPage() {
  const result = await attempt(async () => pagesOverview(await getPageSource()));
  return <PagesHome result={result} />;
}
