import bcrypt from 'bcryptjs';
import { normalizeAdminRole } from '../auth/roles';
import { prisma } from '../db/prisma';

const usage = () => {
  console.log('Usage: npm run admin:create -w @gta-service/server -- <username> <password> [ADMIN|VIEWER]');
};

const run = async () => {
  const username = process.argv[2]?.trim();
  const password = process.argv[3] ?? '';
  const role = normalizeAdminRole(process.argv[4] ?? 'ADMIN');

  if (!username || !password) {
    usage();
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must have at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.adminUser.upsert({
    where: {
      username
    },
    update: {
      passwordHash,
      role,
      isActive: true
    },
    create: {
      username,
      passwordHash,
      role,
      isActive: true
    }
  });

  console.log(`Admin user ready: ${user.username} (id=${user.id}, role=${user.role})`);
};

run()
  .catch((error) => {
    console.error('Failed to create admin user', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
