/**
 * Refrescar logos y datos de los sets ya identificados, desde consola.
 *
 *   npm run refresh-sets              # todos
 *   npm run refresh-sets -- sin-logo  # solo los que no tienen logo
 *
 * La lógica vive en `src/lib/refresh-sets.ts` porque también se lanza desde el
 * panel y desde el mantenimiento automático.
 */
import { runRefreshSets } from '../lib/refresh-sets'

const soloSinLogo = process.argv[2] === 'sin-logo'

console.log('\n▶ Refrescando datos de sets' + (soloSinLogo ? ' (solo los que no tienen logo)' : '') + '\n')

await runRefreshSets((msg) => console.log(`  ${msg}`), { soloSinLogo })
console.log('')
