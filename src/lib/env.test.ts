import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The env read at boot (env.ts): the API's callers and the process's role, refused there when wrong. */
const load = async () => (await import("./env")).env;

describe("the env at boot", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://hub@localhost:5432/hub");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads the API's callers and the process's role", async () => {
    vi.stubEnv("HUB_API_TOKEN", "t".repeat(32));
    vi.stubEnv("HUB_API_TOKENS", `assistant:${"a".repeat(32)}:read+propose`);
    vi.stubEnv("HUB_ROLE", "web");
    expect(await load()).toMatchObject({ HUB_API_TOKENS: `assistant:${"a".repeat(32)}:read+propose`, HUB_ROLE: "web" });
  });

  it("takes a blank HUB_API_TOKENS or HUB_ROLE as unset: the writer, no list", async () => {
    vi.stubEnv("HUB_API_TOKENS", " ");
    vi.stubEnv("HUB_ROLE", "");
    const env = await load();
    expect(env.HUB_API_TOKENS).toBeUndefined();
    expect(env.HUB_ROLE).toBeUndefined();
  });

  it("stops at boot on a wrong list, or one that takes HUB_API_TOKEN's name or token — never printing a token", async () => {
    vi.stubEnv("HUB_API_TOKENS", "assistant:short:read");
    await expect(load()).rejects.toThrow(/HUB_API_TOKENS: HUB_API_TOKENS entry 1 \(assistant\): the token is shorter/);

    vi.resetModules();
    vi.stubEnv("HUB_API_TOKEN", "t".repeat(32));
    vi.stubEnv("HUB_API_TOKENS", `phone:${"t".repeat(32)}:confirm`);
    const failure = load();
    await expect(failure).rejects.toThrow(/same token as legacy/);
    await expect(failure).rejects.not.toThrow(/t{32}/);
  });

  it("refuses a role it does not know", async () => {
    vi.stubEnv("HUB_ROLE", "reader");
    await expect(load()).rejects.toThrow(/HUB_ROLE/);
  });
});
