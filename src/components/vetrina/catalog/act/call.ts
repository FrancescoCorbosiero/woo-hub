import type { VetrinaResult } from "@/server/vetrina/service";

/**
 * A server action called from a sheet or the tracker: a request that never
 * reached the server (offline, a deploy) answers like any refusal, in the
 * owner's words, instead of throwing into the screen.
 */
export async function call<T>(fn: () => Promise<VetrinaResult<T>>, networkError: string): Promise<VetrinaResult<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, code: "failed", error: networkError };
  }
}
