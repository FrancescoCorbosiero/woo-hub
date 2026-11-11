import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { AddProductsScreen } from "@/components/vetrina/shop/add/AddProductsScreen";
import { kicksdbConfigured } from "@/server/adapters/kicksdb";
import { wooSiteUrl } from "@/server/woo/client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.shop.add.title} — Store Hub` };
}

/** "Aggiungi prodotti": the one way in for new products, by code — or by hand. */
export default function AddProductsPage() {
  const site = wooSiteUrl().replace(/\/wp-json.*$/, "").replace(/\/+$/, "");
  return <AddProductsScreen wpAdmin={`${site}/wp-admin`} kicksdb={kicksdbConfigured()} />;
}
