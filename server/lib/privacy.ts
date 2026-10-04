import { isIP } from "node:net";

/** Trunca la IP (IPv4 → /24, IPv6 → /48). SENSO nunca guarda la IP completa. */
export function ipPrefix(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, "");
  const v = isIP(clean);
  if (v === 4) return clean.split(".").slice(0, 3).join(".") + ".0/24";
  if (v === 6) {
    const groups = clean.split(":");
    return groups.slice(0, 3).join(":") + "::/48";
  }
  return null;
}
