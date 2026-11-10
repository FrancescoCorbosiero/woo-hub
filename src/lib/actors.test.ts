import { describe, expect, it } from "vitest";
import { actorId, actorOf, findPrincipal, isPerson, may, parsePrincipals, SCOPES, type Actor } from "./actors";

const T1 = "a".repeat(24);
const T2 = "b".repeat(32);
const T3 = "c".repeat(64);

const parsed = (list: string | undefined, legacy?: string) => {
  const p = parsePrincipals(list, legacy);
  if (!p.ok) throw new Error(p.error);
  return p.principals;
};
const refusal = (list: string, legacy?: string) => {
  const p = parsePrincipals(list, legacy);
  if (p.ok) throw new Error("expected a refusal");
  return p.error;
};

describe("the API's callers, from the env", () => {
  it("are none when nothing is set", () => {
    expect(parsed(undefined)).toEqual([]);
    expect(parsed("  ,  ")).toEqual([]);
  });

  it("keep the single token from before as «legacy», with every scope", () => {
    expect(parsed(undefined, T1)).toEqual([{ name: "legacy", token: T1, scopes: [...SCOPES] }]);
  });

  it("read name:token:scopes entries apart by commas or spaces, scopes in their own order, once", () => {
    expect(parsed(`assistant:${T1}:read+propose, phone:${T2}:undo+read+confirm+read\nscript:${T3}:admin`)).toEqual([
      { name: "assistant", token: T1, scopes: ["read", "propose"] },
      { name: "phone", token: T2, scopes: ["read", "confirm", "undo"] },
      { name: "script", token: T3, scopes: ["admin"] },
    ]);
    expect(parsed(`owner:${T2}:read`, T1).map((p) => p.name)).toEqual(["legacy", "owner"]);
  });

  it("refuse the whole list for one wrong entry, saying which and why — never with its token", () => {
    const cases: [string, RegExp][] = [
      [`assistant:${T1}`, /entry 1 is not name:token:scopes/],
      [`assistant:${T1}:read:extra`, /entry 1 is not name:token:scopes/],
      [`ok:${T2}:read,-bad:${T1}:read`, /entry 2: "-bad" is not a name/],
      [`assistant:short:read`, /entry 1 \(assistant\): the token is shorter than 24 characters/],
      [`assistant:${T1}:`, /scopes are read, propose, confirm, undo, admin/],
      [`assistant:${T1}:read+write`, /— not write/],
      [`assistant:${T1}:read,Assistant:${T2}:read`, /entry 2: the name "Assistant" is taken/],
      [`assistant:${T1}:read,phone:${T1}:confirm`, /entry 2 \(phone\) has the same token as assistant/],
    ];
    for (const [list, why] of cases) {
      const error = refusal(list);
      expect(error).toMatch(why);
      expect(error).not.toContain(T1);
      expect(error).not.toContain(T2);
    }
    expect(refusal(`legacy:${T2}:read`, T1)).toMatch(/the name "legacy" is taken \(HUB_API_TOKEN's\)/);
    expect(refusal(`phone:${T1}:confirm`, T1)).toMatch(/same token as legacy/);
  });

  it("find a caller by its whole token only", () => {
    const callers = parsed(`assistant:${T1}:read,phone:${T2}:confirm`);
    expect(findPrincipal(callers, T2)?.name).toBe("phone");
    expect(findPrincipal(callers, T1)?.name).toBe("assistant");
    expect(findPrincipal(callers, T1.slice(1))).toBeNull();
    expect(findPrincipal(callers, `${T1}a`)).toBeNull();
    expect(findPrincipal(callers, "")).toBeNull();
  });
});

describe("who acts", () => {
  const owner: Actor = { kind: "user", name: "francesco" };
  const assistant: Actor = { kind: "token", name: "assistant", scopes: ["read", "propose"] };
  const phone: Actor = { kind: "token", name: "phone", scopes: ["read", "confirm"] };

  it("is filed as user:<name> or token:<name>", () => {
    expect(actorId(owner)).toBe("user:francesco");
    expect(actorId(assistant)).toBe("token:assistant");
    expect(actorOf(null)).toBeNull();
    expect(actorOf(phone)).toBe("token:phone");
  });

  it("may do what its scopes say over the API, and what the screens offer when signed in", () => {
    expect(may(assistant, "propose")).toBe(true);
    expect(may(assistant, "admin")).toBe(false);
    expect(may(owner, "admin")).toBe(true);
  });

  it("is a person when signed in, or holding the confirm scope — never a program's token", () => {
    expect(isPerson(owner)).toBe(true);
    expect(isPerson(phone)).toBe(true);
    expect(isPerson(assistant)).toBe(false);
    expect(isPerson(null)).toBe(false);
    expect(isPerson(undefined)).toBe(false);
  });
});
