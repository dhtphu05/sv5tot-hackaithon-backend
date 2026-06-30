import { Role } from '@prisma/client';
import { env } from '../src/config/env';
import { logger } from '../src/config/logger';
import { prisma } from '../src/infrastructure/database/prisma';
import { PasswordService } from '../src/modules/auth/password.service';

const passwordService = new PasswordService();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? 'admin@dut.udn.vn';
  const password = process.env.ADMIN_PASSWORD ?? env.SEED_DEFAULT_PASSWORD;
  const passwordHash = await passwordService.hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    update: {
      role: Role.admin,
      isActive: true,
    },
    create: {
      email,
      fullName: 'Quản trị hệ thống',
      passwordHash,
      role: Role.admin,
      isActive: true,
    },
  });

  logger.info({ email }, 'Admin user is ready');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    logger.error({ error }, 'Create admin failed');
    await prisma.$disconnect();
    process.exit(1);
  });
