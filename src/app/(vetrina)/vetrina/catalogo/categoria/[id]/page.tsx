import { readTermScreen } from "@/server/vetrina/catalog";
import { attempt } from "@/server/vetrina/service";
import { listQuery, paramReader, parseTermId, readListState } from "@/components/vetrina/catalog/term/list-model";
import { TermScreen } from "@/components/vetrina/catalog/term/TermScreen";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * A category's screen (/vetrina/catalogo/categoria/12): its panel and its products, read
 * from the store index at once, as the address left them (?q=, ?filter=,
 * ?within=, ?sort=).
 */
export default async function CategoryPage({ params, searchParams }: Params) {
  const id = parseTermId((await params).id);
  const served = readListState(paramReader(await searchParams));
  // An id that is not one reads like a category gone from the shop: the screen says so, with a way back.
  const result =
    id == null
      ? ({ ok: false, code: "not_found", error: "" } as const)
      : await attempt(() => readTermScreen("category", id, listQuery(served)));
  const detail = result.ok ? { ok: true as const, data: result.data.detail } : result;
  const page = result.ok ? { ok: true as const, data: result.data.page } : result;
  return <TermScreen taxonomy="category" detail={detail} page={page} served={served} />;
}
