/**
 * Actualización diaria, desde consola.
 *
 *   npm run ingest
 *
 * La lógica vive en `src/lib/ingest.ts` porque también la llama el
 * planificador que corre dentro del servicio web en Railway. Esto es solo el
 * envoltorio de consola.
 */
import { runIngest } from '../lib/ingest'

console.log('\n▶ Ingesta de Cardmarket (Pokémon)\n')

const result = await runIngest((msg) => console.log(`  ${msg}`))

if (result.status === 'error') {
  console.error(`\n  ✗ Falló la ingesta: ${result.error}\n`)
  process.exit(1)
}

if (result.status === 'skipped') {
  console.log('')
  process.exit(0)
}

console.log(`\n✓ Listo en ${result.seconds}s\n`)
