import { expect, test as setup } from "@playwright/test";

/**
 * A fresh database holds no catalog: opening the Vetrina's catalog starts the
 * first full read of the demo shop, as it does for an owner on day one. Every
 * test after this one finds the products there.
 */
setup("the demo shop's catalog is read", async ({ page }) => {
  setup.setTimeout(120_000);
  await page.goto("/vetrina/catalogo");
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Prodotti in tendenza", { exact: true }).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });
});
