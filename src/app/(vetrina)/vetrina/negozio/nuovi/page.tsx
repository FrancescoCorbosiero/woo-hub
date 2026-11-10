import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { PublishScreen } from "@/components/vetrina/shop/PublishScreen";
import { getPublishState } from "@/server/actions/publish";
import { attempt } from "@/server/vetrina/service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.shop.publish.title} — Store Hub` };
}

/** "Nuovi prodotti": the catalog's products the store does not have yet, to publish from the phone. */
export default async function NewProductsPage() {
  const result = await attempt(() => getPublishState({}));
  return <PublishScreen result={result} />;
}
