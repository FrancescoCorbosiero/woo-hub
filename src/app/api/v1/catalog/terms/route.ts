import type { NextRequest } from "next/server";
import { z } from "zod";
import { listTags, listTerms } from "@/server/api/catalog-order";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/catalog/terms?taxonomy=category|brand|tag — every category
 * (or brand, or tag): id, name, slug, parent, path, products. What the
 * taxonomy actions (termRename, termMove, termMerge, termDelete) take. See
 * docs/api.md.
 */
export function GET(req: NextRequest) {
  return serve(req, "read", async () => {
    const taxonomy = z.enum(["category", "brand", "tag"]).default("category").parse(req.nextUrl.searchParams.get("taxonomy") ?? undefined);
    return taxonomy === "tag" ? listTags() : listTerms(taxonomy);
  });
}
