import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { HandmadeScreen } from "@/components/vetrina/shop/add/HandmadeScreen";
import { getHandmadeSetup } from "@/server/actions/vetrina-add";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.shop.handmade.title} — Store Hub` };
}

/** A product made by hand: the code the owner looked up ("?sku="), with whatever is known of it — or none. */
export default async function HandmadePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const sku = typeof query.sku === "string" ? query.sku : null;
  const result = await getHandmadeSetup(sku);
  // Keyed by the code: another code opens a fresh form, not the last one's.
  return <HandmadeScreen key={sku ?? ""} result={result} fromCodes={query.da === "codici"} code={sku} />;
}
