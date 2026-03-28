import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

function readEmail() {
  const arg = process.argv.find((item) => item.startsWith('--email='));
  const value = arg ? arg.slice('--email='.length) : process.env.SUPERADMIN_EMAIL;
  return value?.trim().toLowerCase() || '';
}

async function main() {
  const email = readEmail();

  if (!email) {
    throw new Error('Укажите email через --email=user@example.com или SUPERADMIN_EMAIL');
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (!existing) {
    throw new Error(`Пользователь ${email} не найден`);
  }

  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: UserRole.superadmin,
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  console.log('Superadmin updated:', updated);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
