import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { defaultLocale, type Locale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionary";

/**
 * What the catalog's actions say to the owner — a preview's reasons and
 * warnings, before → after, the refusals, an action's label — in the
 * language he reads the Vetrina in. The words themselves live with the
 * screens' own, in src/i18n/dictionaries/catalog/ops.{it,en}.ts.
 *
 * The language is the request's: the server actions run their work inside
 * inLanguage(), and everything built deep down reads it from there through
 * words() — a background run started by a request too, so an error it
 * records reads in the language of whoever started it. Outside any request
 * (a test, the scheduler): Italian, the source of truth.
 */

export type Words = Dictionary["vetrinaCatalog"]["ops"];

// One store across bundles: the server actions and the instrumentation each get their own copy of this module.
const g = globalThis as { __vetrinaOpsLanguage?: AsyncLocalStorage<Locale> };
const language = (g.__vetrinaOpsLanguage ??= new AsyncLocalStorage<Locale>());

/** Run `fn` with the owner's words in this language. */
export function inLanguage<T>(locale: Locale, fn: () => T): T {
  return language.run(locale, fn);
}

/** The language of the request at hand. */
export function currentLanguage(): Locale {
  return language.getStore() ?? defaultLocale;
}

/** The words of the request's language. */
export function words(locale: Locale = currentLanguage()): Words {
  return getDictionary(locale).vetrinaCatalog.ops;
}
