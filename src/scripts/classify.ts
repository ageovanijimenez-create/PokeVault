/**
 * Clasificar expansiones, desde consola.
 *
 *   npm run classify
 *
 * La lógica vive en `src/lib/classify.ts` porque también se lanza desde el
 * panel y desde el mantenimiento automático.
 */
import { runClassify } from '../lib/classify'

console.log('\n▶ Clasificando expansiones de Cardmarket\n')

const { counts } = runClassify(() => {})

const etiquetas: Record<string, string> = {
  main: 'expansiones de verdad (con sobre propio)',
  promo: 'promos, mazos y colecciones',
  energy: 'sets de energías',
  'sealed-only': 'solo sellado (monedas, lotes, tins)',
  minor: 'menos de 20 cartas',
}
for (const [kind, texto] of Object.entries(etiquetas)) {
  console.log(`  ${String(counts[kind as keyof typeof counts] ?? 0).padStart(4)}  ${kind.padEnd(12)} ${texto}`)
}
console.log('')
