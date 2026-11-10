import type { NextRequest } from "next/server";
import { importFrom, ImportBody, sourceIdOf } from "@/server/api/order-sources";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";
// Up to 25 products made on the live store, their sizes and photos.
export const maxDuration = 300;

/**
 * POST /api/v1/order-sources/{id}/import — the source's missing products
 * made on the store, through Publish:
 *   { "skus": ["DD1391-100", …] }        those (at most 25)
 *   { "missing": true, "after": 0 }      its missing items' own SKUs, 25 at a time (`next` goes on)
 * with "dryRun": true for what Publish would make. A SKU the Hub's catalog
 * lacks is confirmed on KicksDB first; one it does not confirm is never
 * published. Needs admin (read for a dry run): products are made at once.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: unknown = await req.json().catch(() => ({}));
  const dryRun = typeof body === "object" && body != null && (body as { dryRun?: unknown }).dryRun === true;
  return serve(req, dryRun ? "read" : "admin", async () => importFrom(sourceIdOf(id), ImportBody.parse(body ?? {})));
}
