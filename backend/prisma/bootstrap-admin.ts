import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/crypto/hashing';
import { checkPassword } from '../src/auth/password.policy';

/**
 * Creates the first SUPER_ADMIN.
 *
 * Every other account in this system arrives by invitation, and an invitation
 * needs an authenticated inviter — so the very first account has to come from
 * outside the application. This is that door, and it is deliberately not part
 * of the automatic seed: it runs once, by hand, on the server.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... npm run bootstrap:admin
 *
 * It refuses to run if a SUPER_ADMIN already exists, so it cannot be used to
 * quietly add a second one later.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.user.count({
      where: { role: Role.SUPER_ADMIN, deletedAt: null },
    });

    if (existing > 0) {
      console.error('A SUPER_ADMIN already exists; refusing to create another.');
      process.exitCode = 1;
      return;
    }

    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    if (!email || !password) {
      console.error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.');
      process.exitCode = 1;
      return;
    }

    const check = checkPassword(password, [email]);
    if (!check.valid) {
      console.error(`Password rejected: ${check.reasons.join('; ')}`);
      process.exitCode = 1;
      return;
    }

    const user = await prisma.user.create({
      data: {
        role: Role.SUPER_ADMIN,
        email,
        passwordHash: await hashPassword(password),
        status: UserStatus.ACTIVE,
      },
    });

    console.log(`Created SUPER_ADMIN ${user.id} (${email}).`);
    console.log('Two-factor enrolment is required at first login before any token is issued.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
