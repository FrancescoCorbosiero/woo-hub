import { expect, test } from "@playwright/test";

/**
 * Every screen opens without a client error: an exception, a failed
 * hydration, a render loop ("Too many re-renders"), a hook used wrongly.
 * Screens that need a real shop say so in words; that is not an error.
 */
const PAGES = [
  "/vetrina",
  "/vetrina/catalogo",
  "/vetrina/catalogo/categoria/101",
  "/vetrina/catalogo/brand/205",
  "/vetrina/catalogo/vista/onsale",
  "/vetrina/sezione/category.featured-sneakers-originali-streetwear.0",
  "/collections",
  "/taxonomies",
  "/pricing",
  "/preview",
  "/publish",
  "/sync",
  "/feeds",
  "/orders",
  "/duplicates",
  "/import",
];

for (const path of PAGES) {
  test(`${path} opens cleanly`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    const res = await page.goto(path, { waitUntil: "networkidle" });
    expect(res?.status(), `${path} answered`).toBeLessThan(500);
    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors, `${path} logged errors`).toEqual([]);
  });
}
