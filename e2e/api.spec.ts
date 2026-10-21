import { expect, test } from "@playwright/test";
import { api, open, sheet } from "./helpers";

/**
 * The programmatic API (/api/v1) on the demo shop: an action asked from
 * outside the Vetrina is the same action, filed in the same log, undone the
 * same way — and the log says where it came from.
 */

/** "Prodotti in tendenza" in the demo shop. */
const TRENDING = 101;

interface Listed {
  position: number;
  id: number;
  name: string;
}
interface Operation {
  id: string;
  label: string;
  status: string;
  via: string;
}

const order = async (request: Parameters<typeof api>[0]) =>
  (await api<{ products: Listed[] }>(request, "GET", `/catalog/order?id=${TRENDING}&limit=200`)).products.map((p) => p.id);

const status = async (request: Parameters<typeof api>[0], id: string) => (await api<Operation>(request, "GET", `/operations/${id}`)).status;

test("the actions are described for a script or an assistant", async ({ request }) => {
  const { actions } = await api<{ actions: { kind: string; scope: string; input: { properties: { kind: { const: string } } } }[] }>(
    request,
    "GET",
    "/actions",
  );
  expect(actions.map((a) => a.kind)).toEqual(expect.arrayContaining(["sale", "pin", "sectionSwitch", "sectionEdit"]));
  for (const action of actions) expect(action.input.properties.kind.const).toBe(action.kind);
  expect(actions.find((a) => a.kind === "sectionMove")?.scope).toBe("homepage");
});

test("an action from the API is filed as the API's; its undo puts the shop back", async ({ page, request }) => {
  const before = await order(request);
  expect(before.length).toBeGreaterThan(2);
  const last = before[before.length - 1];

  const { operation } = await api<{ operation: Operation }>(request, "POST", "/catalog/order", {
    body: { id: TRENDING, ids: [last], position: "top" },
  });
  expect(operation.via).toBe("api");
  await expect.poll(() => status(request, operation.id)).toBe("done");
  expect((await order(request))[0]).toBe(last);

  // The log on the phone shows it among the others, saying how it came.
  await open(page, "/vetrina");
  await page.getByRole("link", { name: "Attività" }).filter({ visible: true }).first().click();
  const row = sheet(page, "Attività").getByRole("listitem").filter({ hasText: operation.label }).first();
  await expect(row).toContainText("via API");

  await api(request, "POST", `/operations/${operation.id}/undo`);
  await expect.poll(() => status(request, operation.id)).toBe("undone");
  expect(await order(request)).toEqual(before);
});
