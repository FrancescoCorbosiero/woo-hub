import { NextResponse, type NextRequest } from "next/server";
import { runPublish } from "@/server/actions/publish";
import { crossOrigin } from "@/server/http/same-origin";

export const dynamic = "force-dynamic";
// A batch creates up to 25 products on the live store, images included.
export const maxDuration = 300;

/**
 * One publish batch, for the Vetrina's "Nuovi prodotti" — the Hub's
 * /api/publish, under the Vetrina's own path: on the Vetrina's address only
 * /vetrina is served (src/proxy.ts), and its sign-in is the owner's.
 */
export async function POST(req: NextRequest) {
  // Same-origin only: being signed in must not let another site's page create products through this browser.
  if (crossOrigin(req)) return NextResponse.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  return NextResponse.json(await runPublish(input), { headers: { "Cache-Control": "no-store" } });
}
