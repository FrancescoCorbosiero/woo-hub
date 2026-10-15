import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n/dictionary";
import { plainError } from "./errors";

describe("a rule's failure in the owner's words", () => {
  const it_ = getDictionary("it").vetrinaCatalog.rules;
  const words = { ...it_.errors, network: it_.network };

  it("says what went wrong by its code, never the server's text", () => {
    // What the demo answered: the database's own failure, raw.
    const said = plainError("failed", words);
    expect(said).toBe("Non riuscito, per un problema del server: riprova tra poco.");
    expect(said).not.toMatch(/query|insert|smart_collections/i);
    expect(plainError("not_found", words)).toBe("Questa categoria automatica non c'è più.");
    expect(plainError("store", words)).toBe(it_.errors.store);
    expect(plainError("invalid", words)).toBe(it_.errors.invalid);
    expect(plainError("not_configured", words)).toBe(it_.errors.notConfigured);
    expect(plainError("network", words)).toBe(it_.network);
    expect(plainError("something new", words)).toBe(it_.errors.failed);
  });

  it("has every message in English too", () => {
    const en = getDictionary("en").vetrinaCatalog.rules;
    for (const key of Object.keys(it_.errors) as (keyof typeof it_.errors)[]) {
      expect(en.errors[key]).toBeTruthy();
      expect(en.errors[key]).not.toBe(it_.errors[key]);
    }
  });
});
