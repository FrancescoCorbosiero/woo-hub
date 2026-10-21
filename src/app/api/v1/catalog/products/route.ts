import type { NextRequest } from "next/server";
import { ProductsQuery, readProducts } from "@/server/api/reads";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/catalog/products?q=dunk&taxonomy=brand&termId=7&onSale=true&offset=0&limit=40
 * — the products a catalog query matches, a page at a time: the same query
 * an action's `target: { "kind": "query" }` takes. See docs/api.md.
 */
export function GET(req: NextRequest) {
  return serve(req, async () => readProducts(ProductsQuery.parse(Object.fromEntries(req.nextUrl.searchParams))));
}
