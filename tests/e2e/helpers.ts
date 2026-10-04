import { chromium, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const GOOD_FIX = { latitude: 23.0605, longitude: -109.6977, accuracy: 12 };

/**
 * Contexto persistente (perfil en disco): cerrarlo y relanzarlo con el mismo
 * directorio simula cerrar y volver a abrir el navegador / la app instalada.
 */
export async function launchProfile(info: TestInfo, userDataDir: string, geo = GOOD_FIX): Promise<BrowserContext> {
  const use = info.project.use;
  return chromium.launchPersistentContext(userDataDir, {
    executablePath: (use.launchOptions as { executablePath?: string } | undefined)?.executablePath,
    baseURL: use.baseURL,
    viewport: use.viewport ?? { width: 390, height: 844 },
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    locale: "es-MX",
    timezoneId: "America/Mazatlan",
    geolocation: geo,
    permissions: ["geolocation"],
  });
}

export const newProfileDir = () => mkdtempSync(path.join(tmpdir(), "senso-e2e-"));

/** Espera a que el service worker controle la página (app disponible offline). */
export async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active && !!navigator.serviceWorker.controller;
  }, undefined, { timeout: 30_000 }).catch(async () => {
    // Primera carga: el SW toma control tras clientsClaim; recargar si aún no controla.
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 });
  });
}

export async function connection(page: Page) {
  return page.getByTestId("connection-status").getAttribute("data-mode");
}

/** Flujo completo de captura: categoría → estado → (GPS) → guardar. */
export async function createReportUI(page: Page, category = "electricity", status = "No disponible", opts: { expectLocation?: boolean } = {}) {
  await page.goto("/senso/app/nuevo");
  const consent = page.getByTestId("privacy-consent");
  if (await consent.isVisible().catch(() => false)) await page.getByRole("button", { name: "ENTENDIDO, CONTINUAR" }).click();
  await page.getByTestId(`category-${category}`).click();
  await page.getByRole("button", { name: status, exact: true }).click();
  if (opts.expectLocation !== false) await expect(page.getByTestId("location-panel")).toHaveAttribute("data-phase", "ready");
  await page.getByTestId("save-report").click();
  await expect(page.getByTestId("report-saved")).toBeVisible();
  return (await page.getByTestId("saved-folio").textContent())!.trim();
}
