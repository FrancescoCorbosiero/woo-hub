/**
 * A product's photos on their way from the phone to WordPress: shrunk first
 * — a phone's 12-megapixel shot is 4 MB, the shop shows 2000 pixels at most
 * — then sent one at a time through the Vetrina's own route
 * (src/app/(vetrina)/vetrina/negozio/aggiungi/foto).
 */

export const PHOTO_ROUTE = "/vetrina/negozio/aggiungi/foto";
/** The long side the shop gets: sharp on any product page, light on any connection. */
const LONG_SIDE = 2000;
const QUALITY = 0.86;

/**
 * The photo at LONG_SIDE pixels at most, as a JPEG — turned the right way up
 * (the browser reads the camera's orientation). A format the browser cannot
 * draw (HEIC on most phones but iPhones) goes as it is: WordPress decides.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || file.type === "image/gif") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    // Small already, and a JPEG: sent as taken.
    if (scale === 1 && file.type === "image/jpeg" && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // A transparent PNG on white, as a shop's page shows it.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    return blob ?? file;
  } finally {
    bitmap.close();
  }
}

export type UploadAnswer = { ok: true; id: number; url: string } | { ok: false; error: string };

/** Upload one photo; `title` is the product's name, for the library and for whoever cannot see the picture. */
export async function uploadPhoto(file: File, title: string): Promise<UploadAnswer> {
  const body = new FormData();
  const shrunk = await shrinkPhoto(file);
  body.append("photo", shrunk, shrunk === file ? file.name : "foto.jpg");
  body.append("title", title);
  let res: Response;
  try {
    res = await fetch(PHOTO_ROUTE, { method: "POST", body });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!res.headers.get("content-type")?.includes("application/json")) return { ok: false, error: `HTTP ${res.status}` };
  const answer = (await res.json()) as { ok: true; data: { id: number; url: string } } | { ok: false; error: string };
  return answer.ok ? { ok: true, id: answer.data.id, url: answer.data.url } : { ok: false, error: answer.error };
}
