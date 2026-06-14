import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * TRP-02-R5: Regression guard — DedupCache e dedup.ts foram intencionalmente removidos
 * do pacote transport (D-02, D-16). Este teste garante que esses arquivos não sejam
 * reintroduzidos acidentalmente.
 *
 * Se este teste falhar, significa que dedup.ts ou dedup.test.ts foram re-adicionados
 * ao repo e devem ser removidos.
 */
describe("TRP-02-R5: DedupCache removal regression guard", () => {
  // Resolve from the transport package src root
  const webhookDir = resolve(import.meta.dir, "../../webhook");

  it("dedup.ts does not exist in packages/transport/src/webhook/ (D-02, D-16)", () => {
    const dedupPath = resolve(webhookDir, "dedup.ts");
    expect(existsSync(dedupPath)).toBe(false);
  });

  it("dedup.test.ts does not exist in packages/transport/src/webhook/ (D-16)", () => {
    const dedupTestPath = resolve(webhookDir, "dedup.test.ts");
    expect(existsSync(dedupTestPath)).toBe(false);
  });

  it("transport index.ts does not export DedupCache (D-02)", async () => {
    const transportExports = await import("../../index.js");
    expect("DedupCache" in transportExports).toBe(false);
  });
});
