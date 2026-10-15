import { redirect } from "next/navigation";
import { demoMode } from "@/server/collections/store";
import { readPage } from "@/server/vetrina/catalog";
import { attempt } from "@/server/vetrina/service";
import {
  CATALOG_HOME,
  listQuery,
  paramReader,
  parseQuickView,
  readListState,
} from "@/components/vetrina/catalog/term/list-model";
import { QuickViewScreen } from "@/components/vetrina/catalog/term/QuickViewScreen";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ view: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** A quick view across the catalog (/vetrina/catalogo/vista/soldout): sold out, on sale, hidden… */
export default async function QuickViewPage({ params, searchParams }: Params) {
  const view = parseQuickView((await params).view);
  // A view that does not exist (an old or mistyped link): the catalog's home, where every view is.
  if (!view) redirect(CATALOG_HOME);

  // A view already is a status: only its search, brand and order are read.
  const served = { ...readListState(paramReader(await searchParams)), status: "all" as const };
  const page = await attempt(() => readPage({ view, ...listQuery(served) }));
  return <QuickViewScreen view={view} page={page} served={served} demo={demoMode()} />;
}
