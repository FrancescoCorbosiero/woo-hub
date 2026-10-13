import { notFound } from "next/navigation";
import { demoMode } from "@/server/collections/store";
import { readPage } from "@/server/vetrina/catalog";
import { attempt } from "@/server/vetrina/service";
import { parseQuickView } from "@/components/vetrina/catalog/term/list-model";
import { QuickViewScreen } from "@/components/vetrina/catalog/term/QuickViewScreen";

export const dynamic = "force-dynamic";

/** A quick view across the catalog (/vetrina/catalogo/vista/soldout): sold out, on sale, hidden… */
export default async function QuickViewPage({ params }: { params: Promise<{ view: string }> }) {
  const view = parseQuickView((await params).view);
  if (!view) notFound();

  const page = await attempt(() => readPage({ view, sort: "shop" }));
  return <QuickViewScreen view={view} page={page} demo={demoMode()} />;
}
