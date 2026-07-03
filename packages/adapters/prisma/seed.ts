// Seed T-020 — tenant uji + user pemilik. Dijalankan via `prisma db seed`.
// Tidak menulis nilai rahasia; data ini hanya fixture pengujian.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'warung-demo' },
    update: {},
    create: {
      brandId: 'digimaestro',
      name: 'Warung Demo',
      slug: 'warung-demo',
      status: 'TRIALING',
      waNumbers: [],
      users: {
        create: {
          role: 'OWNER',
          name: 'Bu Demo',
          phone: '+6280000000000',
          email: 'owner@warung-demo.test',
        },
      },
    },
  });

  const users = await prisma.user.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, role: true },
  });

  console.log(`Seeded tenant ${tenant.slug} (${tenant.id}) with ${users.length} user(s):`);
  for (const u of users) {
    console.log(`  - ${u.role} ${u.name} (${u.id})`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
