import { NextResponse, type NextRequest } from "next/server";
import { crossOrigin } from "@/server/http/same-origin";
import { attempt } from "@/server/vetrina/service";
import { MAX_PHOTO_BYTES, uploadPhoto } from "@/server/wordpress/media";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One photo of a product made by hand, from the phone to WordPress's media
 * library (src/server/wordpress/media.ts). A plain request, not a server
 * action: an action's body stops at 1 MB, a photo is more.
 */
export async function POST(req: NextRequest) {
  if (crossOrigin(req)) return NextResponse.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, code: "invalid", error: "not a form" }, { status: 400 });
  }
  const file = form.get("photo");
  const title = String(form.get("title") ?? "").slice(0, 200);
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, code: "invalid", error: "no photo" }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ ok: false, code: "invalid", error: "photo too large" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await attempt(() => uploadPhoto({ bytes, type: file.type, title }));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
