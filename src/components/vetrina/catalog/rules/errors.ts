/**
 * The automatic categories' failures as the owner reads them in the Vetrina.
 * Their server actions answer with the server's own text (an English
 * message, a failed SQL query): the Hub's desktop page shows it, but on the
 * phone only the code counts, said in the owner's words. The detail is in
 * the server's log.
 */

export interface PlainErrorWords {
  failed: string;
  network: string;
  notConfigured: string;
  store: string;
  invalid: string;
  notFound: string;
}

/** A request that never reached the server (offline, a deploy), answered like a refusal. */
export const NETWORK_CODE = "network";

export function plainError(code: string, words: PlainErrorWords): string {
  switch (code) {
    case NETWORK_CODE:
      return words.network;
    case "not_configured":
      return words.notConfigured;
    case "store":
      return words.store;
    case "invalid":
      return words.invalid;
    case "not_found":
      return words.notFound;
    default:
      return words.failed;
  }
}
