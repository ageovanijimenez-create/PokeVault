/**
 * Imágenes de las cartas, desde consola.
 *
 *   npm run backfill-images            # 10 sets (los más recientes primero)
 *   npm run backfill-images -- 40      # 40 sets
 *   npm run backfill-images -- all     # todos, de una tirada
 *
 * La lógica vive en `src/lib/backfill-images.ts` porque también se lanza desde
 * el panel y desde el mantenimiento automático.
 */
import { runBackfillImages } from '../lib/backfill-images'

const arg = process.argv[2] ?? '10'
const limit = arg === 'all' ? Number.MAX_SAFE_INTEGER : Number(arg)
if (!Number.isFinite(limit) || limit <= 0) {
  console.error('\n  Uso: npm run backfill-images -- <número de sets | all>\n')
  process.exit(1)
}

console.log('\n▶ Imágenes de cartas\n')

await runBackfillImages((msg) => console.log(`  ${msg}`), limit)
console.log('')
