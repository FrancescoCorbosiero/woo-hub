import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { ShopHome } from "@/components/vetrina/shop/ShopHome";
import { attempt } from "@/server/vetrina/service";
import { readShopOverview } from "@/server/vetrina/shop";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.shop.title} — Store Hub` };
}

/** "Negozio": the store kept in step with the supplier, and what waits for the owner. */
export default async function ShopPage() {
  const result = await attempt(() => readShopOverview());
  return <ShopHome result={result} />;
}
