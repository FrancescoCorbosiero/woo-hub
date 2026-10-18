import type { NextRequest } from "next/server";
import { z } from "zod";
import { listTerms } from "@/server/api/catalog-order";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/catalog/terms?taxonomy=category|brand — every category (or
 * brand): id, name, slug, parent, path, products. See docs/api.md.
 */
export function GET(req: NextRequest) {
  return serve(req, async () => {
    const taxonomy = z.enum(["category", "brand"]).default("category").parse(req.nextUrl.searchParams.get("taxonomy") ?? undefined);
    return listTerms(taxonomy);
  });
}
