import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { PricesScreen } from "@/components/vetrina/shop/PricesScreen";
import { loadStoreEdits } from "@/server/sync/store-edits";
import { attempt } from "@/server/vetrina/service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.shop.prices.title} — Store Hub` };
}

/** "Prezzi cambiati su WordPress": what the sync kept, for the owner to decide. */
export default async function PricesPage() {
  const result = await attempt(() => loadStoreEdits());
  return <PricesScreen result={result} />;
}
