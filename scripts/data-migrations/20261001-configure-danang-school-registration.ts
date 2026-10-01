import 'dotenv/config';
import { Prisma, PrismaClient, WorkspaceType } from '@prisma/client';
import { danangSchoolWorkspaces } from '../../prisma/seeds/danang-workspaces';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const knownTestWorkspaceCodes = new Set([
  'APPROVED-EVIDENCE-TEST',
  'E2E-NON-AI',
  'PILOT-5TOT',
]);

function isMockOrTestWorkspace(code: string, name: string): boolean {
  return knownTestWorkspaceCodes.has(code) ||
    /^AB-[AB]-/i.test(code) ||
    /(?:^|[-_])(test|mock|e2e|fixture|demo|qa)(?:[-_]|$)/i.test(code) ||
    /(?:^|\s)(test|mock|e2e|fixture|demo|qa)(?:\s|$)/i.test(name);
}

function assertTargetDatabase(): string {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('DATABASE_URL is required.');

  const url = new URL(rawUrl);
  if (!url.hostname.endsWith('.supabase.com') && !url.hostname.endsWith('.supabase.co')) {
    throw new Error(`Refusing to run against non-Supabase host: ${url.hostname}`);
  }

  const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;
  const actualProjectRef = decodeURIComponent(url.username).split('.')[1];
  if (!expectedProjectRef || actualProjectRef !== expectedProjectRef) {
    throw new Error('DATABASE_URL does not match EXPECTED_SUPABASE_PROJECT_REF. No data was changed.');
  }

  if (apply && process.env.APPLY_DANANG_SCHOOL_CATALOG !== 'ENABLE_20261001_DANANG_SCHOOL_CATALOG') {
    throw new Error('Set APPLY_DANANG_SCHOOL_CATALOG=ENABLE_20261001_DANANG_SCHOOL_CATALOG to apply.');
  }

  return expectedProjectRef;
}

async function migrate(tx: Prisma.TransactionClient, write: boolean) {
  const [city, udn] = await Promise.all([
    tx.workspace.findUnique({ where: { code: 'DANANG_CITY' }, select: { id: true, type: true } }),
    tx.workspace.findUnique({
      where: { code: 'UDN' },
      select: { id: true, type: true, parentWorkspaceId: true },
    }),
  ]);

  if (
    !city || city.type !== WorkspaceType.CITY ||
    !udn || udn.type !== WorkspaceType.UNIVERSITY_SYSTEM || udn.parentWorkspaceId !== city.id
  ) {
    throw new Error('Expected DANANG_CITY → UDN hierarchy is missing or invalid. No data was changed.');
  }

  const codes = danangSchoolWorkspaces.map(({ code }) => code);
  const names = danangSchoolWorkspaces.map(({ name }) => name);
  const [existingByCode, existingByName, allSchools] = await Promise.all([
    tx.workspace.findMany({
      where: { code: { in: codes } },
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
        type: true,
        parentWorkspaceId: true,
        isActive: true,
        registrationEnabled: true,
      },
    }),
    tx.workspace.findMany({
      where: { name: { in: names }, code: { notIn: codes } },
      select: { code: true, name: true },
    }),
    tx.workspace.findMany({
      where: { type: WorkspaceType.SCHOOL },
      select: { id: true, code: true, name: true, isActive: true, registrationEnabled: true },
    }),
  ]);

  if (existingByName.length > 0) {
    throw new Error(
      `Requested school names already belong to another workspace code: ${existingByName.map(({ code }) => code).join(', ')}. No data was changed.`,
    );
  }

  const existingByCodeMap = new Map(existingByCode.map((workspace) => [workspace.code, workspace]));
  for (const workspace of existingByCode) {
    if (workspace.type !== WorkspaceType.SCHOOL) {
      throw new Error(`Workspace code ${workspace.code} is not a SCHOOL. No data was changed.`);
    }
  }

  const mockWorkspaces = allSchools.filter(({ code, name }) => isMockOrTestWorkspace(code, name));
  const unexpectedPublicSchools = allSchools.filter(
    (workspace) =>
      workspace.isActive &&
      workspace.registrationEnabled &&
      !codes.includes(workspace.code as (typeof codes)[number]) &&
      !isMockOrTestWorkspace(workspace.code, workspace.name),
  );
  if (unexpectedPublicSchools.length > 0) {
    throw new Error(
      `Unexpected active signup workspaces need review before applying: ${unexpectedPublicSchools.map(({ code }) => code).join(', ')}. No data was changed.`,
    );
  }

  const create = danangSchoolWorkspaces
    .filter(({ code }) => !existingByCodeMap.has(code))
    .map(({ code, name }) => ({ code, name }));
  const update = danangSchoolWorkspaces
    .filter((school) => {
      const existing = existingByCodeMap.get(school.code);
      return existing && (
        existing.name !== school.name ||
        existing.shortName !== school.shortName ||
        existing.parentWorkspaceId !== (school.parentCode === 'UDN' ? udn.id : null) ||
        !existing.isActive ||
        !existing.registrationEnabled
      );
    })
    .map(({ code, name, parentCode }) => ({ code, name, parentCode }));
  const closeRegistrationFor = mockWorkspaces
    .filter(({ registrationEnabled }) => registrationEnabled)
    .map(({ code }) => code);
  const updateCodes = new Set(update.map(({ code }) => code));

  if (!write) {
    return {
      create,
      update,
      closeRegistrationFor,
      signupChoiceCountAfter: danangSchoolWorkspaces.length,
    };
  }

  for (const school of danangSchoolWorkspaces) {
    const data = {
      type: WorkspaceType.SCHOOL,
      name: school.name,
      shortName: school.shortName,
      parentWorkspaceId: school.parentCode === 'UDN' ? udn.id : null,
      isActive: true,
      registrationEnabled: true,
    };
    const existing = existingByCodeMap.get(school.code);
    if (existing) {
      if (updateCodes.has(school.code)) {
        await tx.workspace.update({ where: { id: existing.id }, data });
      }
    } else {
      await tx.workspace.create({ data: { code: school.code, ...data } });
    }
  }

  if (mockWorkspaces.length > 0) {
    await tx.workspace.updateMany({
      where: { id: { in: mockWorkspaces.map(({ id }) => id) } },
      data: { registrationEnabled: false },
    });
  }

  const signupChoices = await tx.workspace.findMany({
    where: { type: WorkspaceType.SCHOOL, isActive: true, registrationEnabled: true },
    select: { code: true },
    orderBy: { code: 'asc' },
  });
  const actualCodes = signupChoices.map(({ code }) => code);
  const expectedCodes = [...codes].sort();
  if (JSON.stringify(actualCodes) !== JSON.stringify(expectedCodes)) {
    throw new Error('Signup list does not exactly match the 13 requested schools; transaction rolled back.');
  }

  return {
    createdCount: create.length,
    updatedCount: update.length,
    closedMockRegistrationCount: closeRegistrationFor.length,
    signupChoices: actualCodes,
  };
}

async function main(): Promise<void> {
  const projectRef = assertTargetDatabase();
  const result = await prisma.$transaction((tx) => migrate(tx, apply), { timeout: 30_000 });
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', projectRef, result }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Data migration failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
