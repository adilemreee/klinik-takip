import { PrismaClient, Role } from '@prisma/client';
import { PERMISSIONS, ROLE_PERMISSIONS } from './permissions';

const prisma = new PrismaClient();

/**
 * Seeds the permission catalogue and the default role matrix.
 *
 * Idempotent: safe to run on every deploy. Existing per-user overrides in
 * `user_permissions` are never touched — re-seeding must not silently restore
 * access the doctor deliberately revoked from someone.
 */
async function main(): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      create: permission,
      update: { description: permission.description, category: permission.category },
    });
  }

  for (const [role, codes] of Object.entries(ROLE_PERMISSIONS)) {
    for (const code of codes) {
      await prisma.rolePermission.upsert({
        where: { role_permissionCode: { role: role as Role, permissionCode: code } },
        create: { role: role as Role, permissionCode: code },
        update: {},
      });
    }

    // Drop grants that are no longer in the matrix, so removing a permission
    // from the catalogue actually removes it in a deployed environment.
    await prisma.rolePermission.deleteMany({
      where: { role: role as Role, permissionCode: { notIn: codes } },
    });
  }

  const permissionCount = await prisma.permission.count();
  const grantCount = await prisma.rolePermission.count();
  console.log(`Seeded ${permissionCount} permissions and ${grantCount} role grants`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
