import "server-only";
import { headers } from "next/headers";
import type { Actor } from "@/lib/actors";
import { signedInUser } from "@/lib/auth";

/**
 * The person signed in on the screens, as the actor of what they do there
 * (src/lib/actors.ts): Authelia's Remote-User, which src/proxy.ts lets reach
 * the app only on requests Authelia vouched for. Null without a sign-in
 * (local development) or outside a request. Not a server action itself: a
 * helper for those in this folder.
 */
export async function signedInActor(): Promise<Actor | null> {
  try {
    const user = signedInUser(await headers());
    return user ? { kind: "user", name: user.username } : null;
  } catch {
    return null;
  }
}
