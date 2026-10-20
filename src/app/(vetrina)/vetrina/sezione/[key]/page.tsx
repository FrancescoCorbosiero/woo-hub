import { notFound } from "next/navigation";
import { blockConfig, hubConfig } from "@/config";
import { paramToRailKey } from "@/lib/vetrina/order";
import { attempt, readRail } from "@/server/vetrina/service";
import { RailEditor } from "@/components/vetrina/RailEditor";

export const dynamic = "force-dynamic";

/**
 * One rail in the editor, opened by its stable key (/vetrina/sezione/category.saldi-sneakers-outlet.0);
 * with ?aggiungi=1 (the homepage's "Aggiungi prodotti") the catalog's picker opens at once.
 */
export default async function RailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ key: param }, query] = await Promise.all([params, searchParams]);
  const key = paramToRailKey(param);
  if (!key) notFound();

  const result = await attempt(() => readRail(key));
  const edit = blockConfig("golden-hive/shortcode-wrapper").edit;
  return (
    <RailEditor
      railKey={key}
      initial={result}
      options={{
        fallbacks: hubConfig.vetrina.fallbacks,
        edit,
        maxPins: hubConfig.vetrina.maxPins,
        maxLimit: hubConfig.vetrina.maxLimit,
        pageSize: hubConfig.vetrina.pageSize,
      }}
      openPicker={query.aggiungi === "1"}
    />
  );
}
