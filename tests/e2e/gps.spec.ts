import { expect, test } from "@playwright/test";
import { createReportUI, waitForServiceWorker } from "./helpers.js";

test.describe("GPS en la interfaz", () => {
  test("GPS no disponible (permiso negado): aviso claro y guardado sin ubicación", async ({ page, context }) => {
    await context.clearPermissions();
    await context.setOffline(false);
    await page.goto("/senso/app/nuevo");
    await page.getByRole("button", { name: "ENTENDIDO, CONTINUAR" }).click();
    await page.getByTestId("category-water").click();
    await page.getByRole("button", { name: "No disponible", exact: true }).click();
    const panel = page.getByTestId("location-panel");
    await expect(panel).toHaveAttribute("data-phase", "error", { timeout: 30_000 });
    await expect(panel).toContainText("No fue posible obtener la ubicación.");
    await page.getByTestId("save-without-location").click();
    await expect(page.getByTestId("report-saved")).toBeVisible();
    await page.goto("/senso/app/reportes");
    await expect(page.getByTestId("report-card").first()).toContainText("📍 Sin ubicación");
  });

  test("GPS con baja precisión: se marca como aproximada y se puede guardar", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 19.43, longitude: -99.13, accuracy: 900 });
    await page.goto("/senso/app/nuevo");
    await page.getByRole("button", { name: "ENTENDIDO, CONTINUAR" }).click();
    await page.getByTestId("category-phone").click();
    await page.getByRole("button", { name: "Intermitente", exact: true }).click();
    // La búsqueda dura hasta el tiempo límite intentando mejorar la precisión
    await expect(page.getByTestId("location-panel")).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
    await expect(page.getByTestId("location-panel")).toContainText("Ubicación aproximada");
    await expect(page.getByTestId("location-panel")).toContainText("±900 m");
    await page.getByTestId("save-report").click();
    await expect(page.getByTestId("report-saved")).toBeVisible();
  });

  test("GPS recuperado después: reintentar tras el error obtiene la ubicación", async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto("/senso/app/nuevo");
    await page.getByRole("button", { name: "ENTENDIDO, CONTINUAR" }).click();
    await page.getByTestId("category-gas").click();
    await expect(page.getByTestId("location-panel")).toHaveAttribute("data-phase", "error", { timeout: 30_000 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 20.67, longitude: -103.35, accuracy: 10 });
    await page.getByTestId("location-retry").click();
    await expect(page.getByTestId("location-panel")).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("location-panel")).toContainText("Ubicación registrada");
    await page.getByRole("button", { name: "No disponible", exact: true }).click();
    await page.getByTestId("save-report").click();
    await expect(page.getByTestId("report-saved")).toBeVisible();
  });

  test("GPS disponible sin internet", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 23.06, longitude: -109.69, accuracy: 8 });
    await page.goto("/senso/app");
    await waitForServiceWorker(page); // la app debe haberse abierto una vez con internet
    await context.setOffline(true);
    const folio = await createReportUI(page, "electricity", "No disponible");
    expect(folio).toContain("SENSO-");
    await context.setOffline(false);
  });
});
