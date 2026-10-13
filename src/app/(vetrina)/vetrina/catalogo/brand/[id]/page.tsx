import { notFound } from "next/navigation";
import { readPage, readTerm } from "@/server/vetrina/catalog";
import { attempt } from "@/server/vetrina/service";
import { parseTermId } from "@/components/vetrina/catalog/term/list-model";
import { TermScreen } from "@/components/vetrina/catalog/term/TermScreen";

export const dynamic = "force-dynamic";

/** A brand's screen (/vetrina/catalogo/brand/7): its panel and its products, read from the store index. */
export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseTermId((await params).id);
  if (id == null) notFound();

  const [detail, page] = await Promise.all([
    attempt(() => readTerm("brand", id)),
    attempt(() => readPage({ taxonomy: "brand", termId: id, sort: "shop" })),
  ]);
  return <TermScreen taxonomy="brand" detail={detail} page={page} />;
}
