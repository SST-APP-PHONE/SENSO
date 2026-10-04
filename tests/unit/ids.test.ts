import { describe, expect, it } from "vitest";
import { localFolio, uuid } from "../../src/utils/ids";
import { createReportPayloadSchema } from "../../shared/schemas";

describe("Identificadores", () => {
  it("uuid v4 válido y único", () => {
    const ids = new Set(Array.from({ length: 1000 }, uuid));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("folio provisional legible", () => {
    expect(localFolio(new Date("2026-10-04T12:00:00"))).toMatch(/^SENSO-2026-P-[2-9A-HJ-NP-Z]{6}$/);
  });
  it("el payload que genera el cliente cumple el contrato del servidor", async () => {
    const { createReport, listOutbox } = await import("../../src/storage/reports");
    await createReport({ category: "fire", status: "UNAVAILABLE", severity: "HIGH", comment: "Humo", location: null, event: { id: 3, name: "x" }, online: false });
    const [item] = await listOutbox();
    expect(createReportPayloadSchema.safeParse(item.payload).success).toBe(true);
  });
});
