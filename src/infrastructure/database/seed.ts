import { db } from './client';
import { seedCatalog } from './seed/seed-catalog';

async function main(): Promise<void> {
  try {
    await seedCatalog(db);
    console.log('Database seeded successfully.');
  } catch (error) {
    console.error('Failed to seed database:', error);
    process.exitCode = 1;
  }
}

void main();
