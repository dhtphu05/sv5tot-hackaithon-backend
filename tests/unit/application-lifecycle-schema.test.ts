import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260928120000_application_lifecycle_overlays_and_final_history/migration.sql',
);

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `expected Prisma model ${name}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('application lifecycle schema migration', () => {
  it('keeps all lifecycle overlays nullable and relates lifecycle actors safely', () => {
    const application = modelBlock('Application');
    const user = modelBlock('User');

    for (const field of ['cancelledAt', 'cancelledById', 'cancelReason', 'archivedAt', 'archivedById', 'archiveReason']) {
      expect(application).toMatch(new RegExp(`^\\s*${field}\\s+[^\\n]*\\?`, 'm'));
    }
    expect(application).toMatch(/cancelledBy\s+User\?.*onDelete: SetNull/);
    expect(application).toMatch(/archivedBy\s+User\?.*onDelete: SetNull/);
    expect(user).toMatch(/cancelledApplications\s+Application\[\]/);
    expect(user).toMatch(/archivedApplications\s+Application\[\]/);
  });

  it('stores only immutable final decision and supersede metadata with required indexes', () => {
    const history = modelBlock('ApplicationFinalDecisionHistory');

    for (const field of [
      'applicationId',
      'finalStatus',
      'finalLevel',
      'finalNote',
      'finalizedAt',
      'finalizedById',
      'supersededAt',
      'supersededById',
      'supersedeReason',
      'createdAt',
    ]) {
      expect(history).toMatch(new RegExp(`^\\s*${field}\\s+`, 'm'));
    }
    expect(history).toMatch(/application\s+Application.*onDelete: Restrict/);
    expect(history).toMatch(/finalizedBy\s+User\?.*onDelete: SetNull/);
    expect(history).toMatch(/supersededBy\s+User\?.*onDelete: SetNull/);
    expect(history).toMatch(/@@index\(\[applicationId, supersededAt\]\)/);
    expect(history).toMatch(/@@index\(\[supersededById\]\)/);
  });

  it('uses an additive SQL migration without enum or existing-row rewrites', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('ALTER TABLE "Application"');
    expect(migration).toContain('CREATE TABLE "ApplicationFinalDecisionHistory"');
    expect(migration).toMatch(/CREATE INDEX .*Application.*cancelledAt.*archivedAt/s);
    expect(migration).not.toMatch(/^\s*(DROP\s+(TABLE|COLUMN|TYPE)|UPDATE\s+"|ALTER\s+TYPE)\b/im);
  });
});
