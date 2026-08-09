/**
 * Nombre oficial en inglés de los sets japoneses, desde consola.
 *
 *   npm run names-en
 *
 * La lógica vive en `src/lib/names-en.ts` porque también se lanza desde el
 * panel y desde el mantenimiento automático.
 */
import { runNamesEn } from '../lib/names-en'

console.log('\n▶ Nombres oficiales en inglés para sets japoneses\n')

await runNamesEn((msg) => console.log(`  ${msg}`))
console.log('')
