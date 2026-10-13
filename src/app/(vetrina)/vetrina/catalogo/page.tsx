import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { readOverview } from "@/server/vetrina/catalog";
import { attempt } from "@/server/vetrina/service";
import { CatalogHome } from "@/components/vetrina/catalog/home/CatalogHome";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.home.title} — Store Hub` };
}

/** "Catalogo": every category and brand with its counts, read from the store index on every visit. */
export default async function CatalogPage() {
  const result = await attempt(() => readOverview());
  return <CatalogHome result={result} />;
}
