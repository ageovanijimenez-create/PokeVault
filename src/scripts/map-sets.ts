/**
 * Identificar expansiones, desde consola.
 *
 *   npm run map-sets            # solo lo pendiente
 *   npm run map-sets -- force   # reintenta también los que nunca casaron
 *
 * La lógica vive en `src/lib/map-sets.ts` porque también se lanza desde el
 * panel y desde el mantenimiento automático.
 */
import { runMapSets } from '../lib/map-sets'

console.log('\n▶ Mapeando sets de TCGdex contra expansiones de Cardmarket\n')

const force = process.argv[2] === 'force'
if (force) console.log('  (reintentando también los fallidos)\n')

await runMapSets((msg) => console.log(`  ${msg}`), { force })
console.log('')
