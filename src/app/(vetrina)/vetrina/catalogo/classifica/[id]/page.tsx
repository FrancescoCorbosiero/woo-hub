import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { CompareScreen } from "@/components/vetrina/catalog/sources/CompareScreen";
import { demoMode } from "@/server/collections/store";
import { compareSource } from "@/server/vetrina/order-sources/compare";
import { attempt } from "@/server/vetrina/service";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.sources.compare.subtitle} — Store Hub` };
}

/** A ranking against the shop (/vetrina/catalogo/classifica/…): read on every visit, the store index as it is now. */
export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // An id that is not one reads like a ranking that is gone: the screen says so, with a way back.
  const result = UUID.test(id) ? await attempt(() => compareSource(id)) : ({ ok: false, code: "not_found", error: "" } as const);
  return <CompareScreen id={id} result={result} demo={demoMode()} />;
}
