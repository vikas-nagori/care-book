import { seedDatabase } from './seed.ts'

await seedDatabase()
console.log('Local E2E baseline is ready.')
