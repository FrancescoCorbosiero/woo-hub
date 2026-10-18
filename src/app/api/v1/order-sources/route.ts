import { NextResponse, type NextRequest } from "next/server";
import { upload } from "@/server/api/order-sources";
import { serve } from "@/server/api/v1";
import { listSources } from "@/server/vetrina/order-sources/service";

export const dynamic = "force-dynamic";

/** GET /api/v1/order-sources — every order source, with how many of its products the shop has. See docs/order-sources.md. */
export function GET(req: NextRequest) {
  return serve(req, () => listSources());
}

/**
 * POST /api/v1/order-sources — upload a ranking: the agreed format as JSON
 * (its "name" names it), { name, origin, content } with any text the Vetrina
 * reads, or the text itself (text/plain, text/csv) with ?name=. A source of
 * that name is replaced (200), else made (201). See docs/order-sources.md.
 */
export async function POST(req: NextRequest) {
  let created = false;
  const res = await serve(req, async () => {
    const out = await upload(req);
    created = out.created;
    return out;
  });
  return res.ok && created ? NextResponse.json(await res.json(), { status: 201 }) : res;
}
