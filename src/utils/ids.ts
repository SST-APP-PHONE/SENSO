/** UUID v4. crypto.randomUUID requiere contexto seguro; se incluye respaldo con getRandomValues. */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Sin 0/O/1/I/L para que se pueda dictar por teléfono sin confusión.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Folio provisional generado sin conexión: SENSO-2026-P-7K3QXM.
 * El folio oficial consecutivo (SENSO-2026-000001) lo asigna el servidor al sincronizar.
 */
export function localFolio(date = new Date()): string {
  const r = crypto.getRandomValues(new Uint8Array(6));
  const code = Array.from(r, (x) => ALPHABET[x % ALPHABET.length]).join("");
  return `SENSO-${date.getFullYear()}-P-${code}`;
}
