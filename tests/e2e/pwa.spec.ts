import { expect, test } from "@playwright/test";
import { waitForServiceWorker } from "./helpers.js";

test.describe("PWA", () => {
  test("manifest instalable bajo /senso", async ({ request }) => {
    const res = await request.get("/senso/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m).toMatchObject({ short_name: "SENSO", display: "standalone", scope: "/senso/", start_url: "/senso/app" });
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    for (const icon of m.icons) expect((await request.get(`/senso/${icon.src}`)).ok()).toBe(true);
  });

  test("la app abre sin internet en todas sus pantallas (service worker)", async ({ page, context }) => {
    await page.goto("/senso/");
    await expect(page.getByRole("heading", { name: /Reporta\./ })).toBeVisible();
    await waitForServiceWorker(page);
    await context.setOffline(true);
    for (const [url, text] of [
      ["/senso/app", "Reporta desde donde estés"],
      ["/senso/app/nuevo", "Antes de reportar"],
      ["/senso/app/reportes", "Mis reportes"],
      ["/senso/app/como-funciona", "¿Cómo funciona?"],
      ["/senso/", "Aún sin conexión."],
    ]) {
      await page.goto(url);
      await expect(page.getByText(text).first()).toBeVisible();
    }
    await context.setOffline(false);
  });

  test("SEO: landing indexable, admin no indexable", async ({ page, request }) => {
    await page.goto("/senso/");
    await expect(page).toHaveTitle(/SENSO/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.leysillapro.com/senso/");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /SENSO/);
    expect((await request.get("/senso/robots.txt")).ok()).toBe(true);
    expect(await (await request.get("/senso/robots.txt")).text()).toContain("Disallow: /senso/admin");
    expect(await (await request.get("/senso/sitemap.xml")).text()).toContain("https://www.leysillapro.com/senso/");
    const admin = await request.get("/senso/admin");
    expect(admin.headers()["x-robots-tag"]).toContain("noindex");
  });

  test("IndexedDB contiene los stores esperados", async ({ page }) => {
    await page.goto("/senso/app");
    const stores = await page.evaluate(
      () =>
        new Promise<string[]>((resolve, reject) => {
          const req = indexedDB.open("senso");
          req.onsuccess = () => resolve(Array.from(req.result.objectStoreNames));
          req.onerror = () => reject(req.error);
        }),
    );
    expect(stores.sort()).toEqual(["meta", "outbox", "reports", "updates"]);
  });
});
