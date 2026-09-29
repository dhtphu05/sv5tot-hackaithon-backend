import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(process.cwd(), "prisma/migrations");

describe("migration bootstrap history", () => {
  it("creates the pre-existing schema before the first migration that alters CollectiveStatus", () => {
    const baseline = readFileSync(
      resolve(migrationsDir, "20260629000100_initial_schema_baseline/migration.sql"),
      "utf8",
    );
    const firstCollectiveMigration = readFileSync(
      resolve(migrationsDir, "20260630000100_phase9_collective/migration.sql"),
      "utf8",
    );

    expect(baseline).toContain('CREATE TYPE "CollectiveStatus"');
    expect(firstCollectiveMigration).toContain('ALTER TYPE "CollectiveStatus"');
  });

  it("uses an additive, idempotent reconciliation migration", () => {
    const reconciliation = readFileSync(
      resolve(migrationsDir, "20260929100000_reconcile_migration_history_gaps/migration.sql"),
      "utf8",
    );

    expect(reconciliation).toContain("ADD VALUE IF NOT EXISTS 'supplement_requested'");
    expect(reconciliation).toContain('CREATE INDEX IF NOT EXISTS "Application_targetLevel_idx"');
    expect(reconciliation).toContain('CREATE INDEX IF NOT EXISTS "ReviewTask_applicationId_idx"');
    expect(reconciliation).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM)\b/i);
  });
});
