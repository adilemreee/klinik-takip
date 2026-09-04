import { NestFactory } from '@nestjs/core';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { generateSync } from 'otplib';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { hashPassword } from '../src/crypto/hashing';

/**
 * A staff account for the load test, with a second factor enrolled.
 *
 * Staff sign-in requires TOTP, so the account cannot be made with plain SQL —
 * the secret is encrypted at the application layer. This goes through the
 * application's own enrolment, which is also the point: the account the load
 * test uses is made the way a real one is.
 *
 * Local only. It refuses to run against anything but a local database.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';

  if (!url.includes('127.0.0.1') && !url.includes('localhost')) {
    throw new Error('Refusing to run against a non-local database');
  }

  const prisma = new PrismaClient();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const auth = app.get(AuthService);

  const email = 'load-staff@klinik.test';
  const password = 'KlinikTest2026!';

  await prisma.user.deleteMany({ where: { email } });

  const user = await prisma.user.create({
    data: {
      role: Role.COORDINATOR,
      email,
      passwordHash: await hashPassword(password),
      status: UserStatus.ACTIVE,
    },
  });

  // The front desk, which is the realistic case for this measurement: a
  // coordinator without it sees only their assigned patients, so a search
  // returns nothing and the load test measures an empty query.
  await prisma.staffProfile.create({
    data: {
      userId: user.id,
      firstName: 'Load',
      lastName: 'Test',
      canSeeAllPatients: true,
    },
  });

  const setup = await auth.beginTotpEnrolment(user.id);
  await auth.confirmTotpEnrolment(user.id, generateSync({ secret: setup.secret }));

  console.log(`email=${email}`);
  console.log(`password=${password}`);
  console.log(`secret=${setup.secret}`);
  console.log(`code=${generateSync({ secret: setup.secret })}`);

  await app.close();
  await prisma.$disconnect();
}

void main();
