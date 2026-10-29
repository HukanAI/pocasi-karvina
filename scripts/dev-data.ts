// Připraví data pro lokální vývoj do public/dev-data (spustí všechny datové skripty)
// Spuštění: npm run data:dev

import { execFileSync } from 'node:child_process'

const env = { ...process.env, DATA_DIR: 'public/dev-data' }
for (const script of ['update-station.ts', 'update-climate.ts', 'fetch-warnings.ts']) {
  console.log(`\n▶ ${script}`)
  execFileSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit', env })
}
