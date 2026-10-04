import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [390, 430, 768, 1024, 1366];
const PAGES = ["/senso/", "/senso/app", "/senso/app/nuevo", "/senso/app/reportes", "/senso/app/como-funciona", "/senso/privacidad", "/senso/admin"];

async function assertLayout(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, `scroll horizontal en ${url}`).toBeLessThanOrEqual(clientWidth);
  // Botones/enlaces principales con área táctil ≥ 44 px
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main button, main a"))
      .filter((el) => el.offsetParent !== null && !el.closest("p, dd, li.text-sm, footer, .leaflet-container"))
      .map((el) => ({ text: el.textContent?.trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((b) => b.h < 40),
  );
  expect(small, `controles pequeños en ${url}`).toEqual([]);
  // Texto base legible (≥ 14 px)
  const fontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(14);
}

test.describe("Interfaz responsiva", () => {
  for (const width of WIDTHS) {
    test(`sin scroll horizontal y controles accesibles a ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop-chromium", "anchos explícitos solo en desktop");
      await page.setViewportSize({ width, height: 900 });
      for (const url of PAGES) await assertLayout(page, url);
      // Barra de conexión visible en la app
      await page.goto("/senso/app");
      await expect(page.getByTestId("connection-status")).toBeVisible();
    });
  }

  test("dispositivo emulado (Android / iPhone): barra offline visible y sin scroll horizontal", async ({ page, context }, info) => {
    test.skip(info.project.name === "desktop-chromium", "solo dispositivos móviles");
    for (const url of PAGES) await assertLayout(page, url);
    await page.goto("/senso/app");
    await context.setOffline(true);
    await expect(page.getByTestId("offline-hint")).toBeVisible();
    const box = await page.getByTestId("connection-status").boundingBox();
    expect(box?.y).toBe(0);
    await page.getByRole("link", { name: /NUEVO REPORTE/ }).click();
    await expect(page.getByTestId("connection-status")).toBeVisible();
    await context.setOffline(false);
  });
});
