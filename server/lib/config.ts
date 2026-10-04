/** Configuración del servidor. Solo backend: nada de aquí se expone al frontend. */
export interface ServerConfig {
  adminSecret: string;
  timezone: string;
  isProduction: boolean;
  corsOrigins: string[];
  /** Desactiva los límites de peticiones (solo pruebas automatizadas). */
  disableRateLimit: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProduction = env.NODE_ENV === "production";
  const adminSecret = env.ADMIN_SECRET ?? "";
  if (adminSecret.length < 32) {
    if (isProduction) throw new Error("ADMIN_SECRET debe tener al menos 32 caracteres en producción");
  }
  return {
    adminSecret: adminSecret.length >= 32 ? adminSecret : "dev-only-insecure-secret-change-me-0123456789",
    timezone: env.APP_TIMEZONE || "America/Mexico_City",
    isProduction,
    corsOrigins: (env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    disableRateLimit: env.SENSO_DISABLE_RATE_LIMIT === "1" && !isProduction,
  };
}
