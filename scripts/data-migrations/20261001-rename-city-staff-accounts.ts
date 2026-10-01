import 'dotenv/config';
import { Criterion, PrismaClient, Role, WorkspaceType } from '@prisma/client';
import { PasswordService } from '../../src/modules/auth/password.service';

const expectedProjectRef = 'gvoccbqxackcacwhnoiz';
const expectedConfirmation = 'RENAME_CITY_STAFF_CREDENTIALS_20261001';
const expectedCityCode = 'DANANG_CITY';

const cityStaffAccounts = [
  { from: 'manager@danang.city', to: 'sv5tot_quanly@gmail.com', role: Role.city_manager, specializations: [] },
  { from: 'committee@danang.city', to: 'sv5tot_hoidong@gmail.com', role: Role.city_committee, specializations: [] },
  { from: 'officer.academic@dut.udn.vn', to: 'sv5tot_hoctap@gmail.com', role: Role.city_officer, specializations: [Criterion.academic] },
  { from: 'officer.ethics@dut.udn.vn', to: 'sv5tot_daoduc@gmail.com', role: Role.city_officer, specializations: [Criterion.ethics] },
  { from: 'officer.physical@dut.udn.vn', to: 'sv5tot_theluc@gmail.com', role: Role.city_officer, specializations: [Criterion.physical] },
  { from: 'officer.volunteer@dut.udn.vn', to: 'sv5tot_tinhnguyen@gmail.com', role: Role.city_officer, specializations: [Criterion.volunteer] },
  { from: 'officer.integration@dut.udn.vn', to: 'sv5tot_hoinhap@gmail.com', role: Role.city_officer, specializations: [Criterion.integration] },
  {
    from: 'officer@danang.city',
    to: 'sv5tot_canbo@gmail.com',
    role: Role.city_officer,
    specializations: [Criterion.academic, Criterion.ethics, Criterion.volunteer],
  },
] as const;

if (process.env.APPLY_CITY_STAFF_CREDENTIAL_RENAME !== expectedConfirmation) {
  throw new Error(`Set APPLY_CITY_STAFF_CREDENTIAL_RENAME=${expectedConfirmation} to apply this account update.`);
}
const newPassword = process.env.CITY_STAFF_ACCOUNT_PASSWORD;
if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
  throw new Error('CITY_STAFF_ACCOUNT_PASSWORD must be 8 to 128 characters.');
}
const validatedPassword = newPassword;

const rawDatabaseUrl = process.env.DATABASE_URL;
if (!rawDatabaseUrl) throw new Error('DATABASE_URL is required.');
const databaseUrl = new URL(rawDatabaseUrl);
if (!`${databaseUrl.hostname} ${decodeURIComponent(databaseUrl.username)}`.includes(expectedProjectRef)) {
  throw new Error('Refusing to update accounts outside the audited Supabase project.');
}

const prisma = new PrismaClient();
const passwordService = new PasswordService();

async function main() {
  const passwordHash = await passwordService.hashPassword(validatedPassword);
  const updated = await prisma.$transaction(async (tx) => {
    const city = await tx.workspace.findUnique({
      where: { code: expectedCityCode },
      select: { id: true, type: true, isActive: true },
    });
    if (!city?.isActive || city.type !== WorkspaceType.CITY) {
      throw new Error('Expected active DANANG_CITY workspace was not found.');
    }

    const accountEmails = cityStaffAccounts.flatMap(({ from, to }) => [from, to]);
    const users = await tx.user.findMany({
      where: { email: { in: accountEmails } },
      select: {
        id: true,
        email: true,
        role: true,
        workspaceId: true,
        isActive: true,
        officerSpecializations: { where: { isActive: true }, select: { criterion: true } },
      },
    });
    const usersByEmail = new Map(users.map((user) => [user.email, user]));
    const targetsInUse = cityStaffAccounts.filter(({ to }) => usersByEmail.has(to));
    if (targetsInUse.length) {
      throw new Error(`Target account emails already exist (${targetsInUse.length}); no changes were made.`);
    }

    const sourceUsers = cityStaffAccounts.map((account) => {
      const user = usersByEmail.get(account.from);
      if (
        !user ||
        !user.isActive ||
        user.role !== account.role ||
        user.workspaceId !== city.id ||
        !sameCriteria(
          user.officerSpecializations.map(({ criterion }) => criterion),
          account.specializations,
        )
      ) {
        throw new Error(`Account roster changed for ${account.from}; no changes were made.`);
      }
      return { account, user };
    });

    const result = [];
    for (const { account, user } of sourceUsers) {
      await tx.user.update({
        where: { id: user.id },
        data: { email: account.to, passwordHash },
      });
      const revoked = await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: city.id,
          action: 'CITY_STAFF_CREDENTIALS_RENAMED',
          targetType: 'user',
          targetId: user.id,
          beforeJson: { email: user.email, role: user.role },
          afterJson: {
            email: account.to,
            role: user.role,
            passwordReset: true,
            refreshSessionsRevoked: revoked.count,
          },
          note: 'Applied guarded City staff account credential migration.',
        },
      });
      result.push({ email: account.to, role: user.role, revokedRefreshTokens: revoked.count });
    }
    return result;
  }, { timeout: 60_000 });

  console.info(JSON.stringify({ updatedCount: updated.length, accounts: updated }, null, 2));
}

function sameCriteria(actual: Criterion[], expected: readonly Criterion[]): boolean {
  return actual.slice().sort().join(',') === expected.slice().sort().join(',');
}

main()
  .catch(() => {
    console.error('City staff account update failed and was rolled back. Database details were suppressed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
