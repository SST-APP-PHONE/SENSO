import { expect, test } from "@playwright/test";

/**
 * Mensajes del centro de monitoreo según la respuesta real del servidor.
 * Reproduce el caso de producción: ADMIN_SECRET ausente → la API responde 503 en /admin/*.
 */
const NOT_CONFIGURED = { status: 503, contentType: "application/json", body: JSON.stringify({ error: "Centro de monitoreo no configurado (ADMIN_SECRET)" }) };

test("503 del servidor: se muestra su mensaje real, no un falso «No se pudo contactar al servidor»", async ({ page }) => {
  await page.route("**/senso/api/admin/**", (r) => r.fulfill(NOT_CONFIGURED));
  await page.goto("/senso/admin");
  await expect(page.getByText("Centro de monitoreo no configurado (ADMIN_SECRET)")).toBeVisible();
  await expect(page.getByText("No se pudo contactar al servidor.")).toHaveCount(0);
});

test("fallo de red real: sí se muestra «No se pudo contactar al servidor»", async ({ page }) => {
  await page.route("**/senso/api/admin/me", (r) => r.abort("connectionrefused"));
  await page.goto("/senso/admin");
  await expect(page.getByText("No se pudo contactar al servidor.")).toBeVisible();
});

test("sin sesión (401): pantalla de acceso sin avisos de error", async ({ page }) => {
  await page.goto("/senso/admin");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("No se pudo contactar al servidor.")).toHaveCount(0);
});
