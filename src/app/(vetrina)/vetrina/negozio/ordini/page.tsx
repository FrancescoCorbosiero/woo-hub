import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { OrdersScreen } from "@/components/vetrina/shop/OrdersScreen";
import { getOrdersState } from "@/server/actions/orders";
import { attempt } from "@/server/vetrina/service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.shop.orders.title} — Store Hub` };
}

/** "Ordini": the store's orders to fulfil, on the phone. */
export default async function OrdersPage() {
  const result = await attempt(() => getOrdersState());
  return <OrdersScreen result={result} />;
}
