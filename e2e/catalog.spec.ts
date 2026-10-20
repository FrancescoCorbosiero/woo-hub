import { expect, test, type Page } from "@playwright/test";
import { actionSheet, sheet } from "./helpers";

/**
 * A category's screen in the catalog: its positions in the shop changed in
 * one labelled place, and a list's order on screen that changes nothing.
 */

const TRENDING = "/vetrina/catalogo/categoria/101";

/**
 * The products listed, top to bottom: name and price. Read from the page's
 * text, not as drawn: rows off screen are not drawn (content-visibility).
 */
async function listed(page: Page): Promise<{ name: string; price: number }[]> {
  return page
    .getByRole("list")
    .last()
    .getByRole("listitem")
    .evaluateAll((rows) =>
      rows.map((row) => {
        const name = row.querySelector(".line-clamp-2")?.textContent?.trim() ?? "";
        const rest = (row.textContent ?? "").replace(name, " ");
        const price = rest.match(/(\d{1,3}(?:\.\d{3})*,\d{2}) €/)?.[1] ?? "";
        return { name, price: Number(price.replace(/\./g, "").replace(",", ".")) };
      }),
    );
}

/** Undoes the newest action from the activity log (on the homepage tab). */
async function undoLastAction(page: Page) {
  await page.goto("/vetrina");
  await page.getByRole("link", { name: "Attività" }).filter({ visible: true }).first().click();
  const log = sheet(page, "Attività");
  await log.getByRole("button", { name: "Annulla" }).first().click();
  await expect(log.getByText("Annullata").first()).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto(TRENDING);
  await expect(page.getByText("Posizioni nel negozio")).toBeVisible();
  await expect.poll(async () => (await listed(page))[0]?.name ?? "").not.toBe("");
});

test("the shop's positions are changed in one labelled place", async ({ page }) => {
  await expect(page.getByText("Come la pagina «Prodotti in tendenza» del negozio mette in fila i suoi prodotti.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Disponi a mano/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Disponi come una classifica/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Porta in cima alcuni prodotti/ })).toBeVisible();
});

test("listing by price is a view: the shop's positions are as they were", async ({ page }) => {
  const shop = (await listed(page)).map((p) => p.name);

  await page.getByRole("button", { name: "Elenco per: Posizione nel negozio. Cambia" }).click();
  await expect(actionSheet(page).getByText("Elenca i prodotti per")).toBeVisible();
  await actionSheet(page).getByRole("button", { name: "Prezzo crescente" }).click();
  await expect(page.getByRole("button", { name: "Elenco per: Prezzo crescente. Cambia" })).toBeVisible();
  await expect
    .poll(async () => {
      const prices = (await listed(page)).map((p) => p.price);
      return prices.length > 2 && prices.every((p, i) => i === 0 || prices[i - 1] <= p);
    })
    .toBe(true);

  await page.getByRole("button", { name: "Elenco per: Prezzo crescente. Cambia" }).click();
  await actionSheet(page).getByRole("button", { name: "Posizione nel negozio" }).click();
  await expect.poll(async () => (await listed(page)).map((p) => p.name)).toEqual(shop);
});

test("Posiziona puts a product first in the shop; Annulla puts it back", async ({ page }) => {
  const before = (await listed(page)).map((p) => p.name);
  const target = before[3];

  await page.getByRole("button", { name: /^Porta in cima alcuni prodotti/ }).click();
  await page.getByRole("list").last().getByRole("listitem").filter({ hasText: target }).click();
  await page.getByRole("button", { name: "Posiziona", exact: true }).click();
  const place = sheet(page, "Posiziona in «Prodotti in tendenza»");
  await place.getByRole("button", { name: "Sposta 1 prodotto" }).click();

  await expect.poll(async () => (await listed(page))[0]?.name, { timeout: 30_000 }).toBe(target);

  await undoLastAction(page);
  await page.goto(TRENDING);
  await expect.poll(async () => (await listed(page)).map((p) => p.name)).toEqual(before);
});
