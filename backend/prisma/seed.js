const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user (Guillaume)
  const adminHash = await bcrypt.hash('admin1234', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'guillaume@lbdp.fr' },
    update: { password_hash: adminHash },
    create: {
      email: 'guillaume@lbdp.fr',
      password_hash: adminHash,
      name: 'Guillaume Darinot',
      role: 'admin',
      card_id: 'CARTE-001',
    },
  });
  console.log('Admin created:', admin.name);

  // Create team users
  const userHash = await bcrypt.hash('user1234', 10);

  const users = [
    { email: 'loic@lbdp.fr', name: 'Loïc', card_id: 'CARTE-002' },
    { email: 'alban@lbdp.fr', name: 'Alban', card_id: 'CARTE-003' },
    { email: 'etienne@lbdp.fr', name: 'Étienne Darinot', card_id: 'CARTE-004' },
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { password_hash: userHash },
      create: {
        email: u.email,
        password_hash: userHash,
        name: u.name,
        role: 'user',
        card_id: u.card_id,
      },
    });
    console.log('User created:', user.name);
  }

  // Create sample expenses only if none exist yet
  const existingCount = await prisma.expense.count({ where: { user_id: admin.id } });
  if (existingCount === 0) {
    const sampleExpenses = [
      { user_id: admin.id, date_ticket: new Date('2026-02-15'), amount: 67.40, type: 'carburant', merchant: 'Total Energies', description: 'Plein gasoil', card_id: 'CARTE-001', has_receipt: true, upload_status: 'uploaded' },
      { user_id: admin.id, date_ticket: new Date('2026-02-18'), amount: 24.50, type: 'repas', merchant: 'Le Bistrot du Marché', description: 'Déjeuner client', card_id: 'CARTE-001', has_receipt: true, upload_status: 'uploaded' },
      { user_id: admin.id, date_ticket: new Date('2026-02-20'), amount: 8.70, type: 'peage', merchant: 'APRR', description: 'A47 Saint-Étienne', card_id: 'CARTE-001', has_receipt: true, upload_status: 'pending' },
    ];

    for (const exp of sampleExpenses) {
      await prisma.expense.create({ data: exp });
    }
    console.log('Sample expenses created');
  } else {
    console.log('Sample expenses already exist, skipping');
  }

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
