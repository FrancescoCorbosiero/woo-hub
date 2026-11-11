import "server-only";
import { z } from "zod";
import { requestJson, type HttpError } from "@/server/adapters/http";
import { VetrinaError } from "@/server/vetrina/source";
import { restRoot, wordpressConfigured, wpAuthorization } from "./client";

/**
 * A product's photos, taken on the phone, into WordPress's media library
 * (wp/v2/media) — the one way a picture with no address of its own reaches
 * the shop: WooCommerce's keys cannot upload, so this signs in with the
 * Application Password the menus use (WP_APP_USER, WP_APP_PASSWORD; the user
 * needs upload_files). The product then takes the photo by its id: nothing
 * to download, nothing to wait for.
 */

/** The pictures taken, by type: what WordPress makes thumbnails of everywhere. */
export const PHOTO_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
/** The largest photo taken: the screen shrinks them well under it first. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const Uploaded = z.looseObject({ id: z.number().int().positive(), source_url: z.string().default("") });

/**
 * The photos this Hub uploaded and no product took yet, by id: the only ones
 * it may take back out of the library (the form's "Rimuovi"). Any other
 * picture of the site is the shop's, and never deleted from here. A day at
 * most; on globalThis, one list for every bundle.
 */
const LOOSE_MS = 24 * 60 * 60_000;
const g = globalThis as { __storeHubLoosePhotos?: Map<number, number> };
const loose = (g.__storeHubLoosePhotos ??= new Map<number, number>());

/** These photos belong to a product now: no longer removable from here. */
export function photosTaken(ids: readonly number[]): void {
  for (const id of ids) loose.delete(id);
}

export function photosUploadable(): boolean {
  return wordpressConfigured();
}

function refusal(e: unknown): VetrinaError {
  const err = e as HttpError;
  let message = err.message ?? String(e);
  try {
    const body = JSON.parse(err.body ?? "") as { message?: string };
    if (body.message) message = body.message;
  } catch {
    // not JSON: the transport's own words stay
  }
  if (err.status === 401) return new VetrinaError("unauthorized", `WordPress refused WP_APP_USER / WP_APP_PASSWORD: ${message}`, 401);
  if (err.status === 403) return new VetrinaError("unauthorized", `WP_APP_USER may not upload files (upload_files): ${message}`, 403);
  if (err.status === 413) return new VetrinaError("invalid", `The photo is too large for the site's server: ${message}`, 413);
  if (err.status === 400 || err.status === 415) return new VetrinaError("invalid", message, err.status);
  return new VetrinaError("failed", message, err.status);
}

/** A photo's file name for the library: the product's, readable, without anything a header would choke on. */
export function photoFileName(name: string, type: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "foto"}.${PHOTO_TYPES[type] ?? "jpg"}`;
}

/** Upload one photo; `title` names it in the library and describes it to whoever cannot see it. */
export async function uploadPhoto(photo: { bytes: Uint8Array; type: string; title: string }): Promise<{ id: number; url: string }> {
  if (!wordpressConfigured()) {
    throw new VetrinaError(
      "not_configured",
      "Photos need WP_APP_USER and WP_APP_PASSWORD: a WordPress user who may upload files, and an Application Password of theirs.",
    );
  }
  if (!PHOTO_TYPES[photo.type]) throw new VetrinaError("invalid", `Not a photo the shop takes: ${photo.type || "unknown type"}`, 415);
  if (photo.bytes.byteLength === 0 || photo.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new VetrinaError("invalid", "The photo is empty or too large.", 413);
  }
  const url = new URL(`${restRoot()}/wp/v2/media`);
  const title = photo.title.trim().slice(0, 200);
  if (title) {
    url.searchParams.set("title", title);
    url.searchParams.set("alt_text", title);
  }
  try {
    const answer = await requestJson(
      url.toString(),
      {
        method: "POST",
        headers: {
          Authorization: wpAuthorization(),
          Accept: "application/json",
          "Content-Type": photo.type,
          "Content-Disposition": `attachment; filename="${photoFileName(title, photo.type)}"`,
        },
        body: photo.bytes as unknown as BodyInit,
        cache: "no-store",
      },
      // Never retried: an upload that timed out may have landed, and a second would be a twin.
      { attempts: 1, backoffMs: 0, timeoutMs: 120_000 },
    );
    const parsed = Uploaded.safeParse(answer);
    if (!parsed.success) throw new VetrinaError("failed", "Unexpected answer from wp/v2/media.");
    loose.set(parsed.data.id, Date.now());
    return { id: parsed.data.id, url: parsed.data.source_url };
  } catch (e) {
    throw e instanceof VetrinaError ? e : refusal(e);
  }
}

/** Take a photo back out of the library: one this Hub uploaded for a product never made. Best-effort. */
export async function deletePhoto(id: number, now = Date.now()): Promise<boolean> {
  if (!wordpressConfigured() || !Number.isInteger(id) || id <= 0) return false;
  const at = loose.get(id);
  if (at == null || now - at > LOOSE_MS) return false;
  loose.delete(id);
  try {
    await requestJson(
      `${restRoot()}/wp/v2/media/${id}?force=true`,
      { method: "DELETE", headers: { Authorization: wpAuthorization(), Accept: "application/json" }, cache: "no-store" },
      { attempts: 1, backoffMs: 0, timeoutMs: 30_000 },
    );
    return true;
  } catch (e) {
    console.warn(`[photos] photo ${id} not removed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
