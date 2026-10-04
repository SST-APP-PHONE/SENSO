/** Configuración del servidor. Solo backend: nada de aquí se expone al frontend. */
export interface ServerConfig {
  adminSecret: string;
  /** false en producción sin ADMIN_SECRET válido: el centro de monitoreo responde 503 (la API pública sigue funcionando). */
  adminConfigured: boolean;
  timezone: string;
  isProduction: boolean;
  corsOrigins: string[];
  /** Desactiva los límites de peticiones (solo pruebas automatizadas). */
  disableRateLimit: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProduction = env.NODE_ENV === "production";
  const adminSecret = env.ADMIN_SECRET ?? "";
  const validSecret = adminSecret.length >= 32;
  return {
    // Sin secreto válido en producción NO se usa el de desarrollo: el admin queda deshabilitado.
    adminSecret: validSecret ? adminSecret : isProduction ? "" : "dev-only-insecure-secret-change-me-0123456789",
    adminConfigured: validSecret || !isProduction,
    timezone: env.APP_TIMEZONE || "America/Mexico_City",
    isProduction,
    corsOrigins: (env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    disableRateLimit: env.SENSO_DISABLE_RATE_LIMIT === "1" && !isProduction,
  };
}
