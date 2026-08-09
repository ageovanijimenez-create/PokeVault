/**
 * Imágenes de las cartas.
 *
 *   npm run backfill-images            # 10 sets (los más recientes primero)
 *   npm run backfill-images -- 40      # 40 sets
 *   npm run backfill-images -- all     # todos, de una tirada
 *
 * Por qué hace falta un backfill y no vale con la ingesta diaria: los ficheros
 * de Cardmarket no traen imágenes, y TCGdex solo da el `cardmarket.idProduct`
 * en la respuesta de CADA carta —no hay endpoint masivo, y por GraphQL el campo
 * `pricing` no está expuesto—. Así que hay que pedir carta a carta, una vez.
 *
 * Probé si los idProduct eran secuenciales dentro del set para deducirlos de
 * golpe: empiezan bien pero se desvían a partir de la carta ~45, así que no
 * sirve. Mejor lento y correcto que rápido y con las fotos cambiadas.
 *
 * Es resumible: cada set terminado queda anotado en `image_backfill` y no se
 * vuelve a tocar. Se puede cortar con Ctrl+C sin perder lo hecho.
 */
import { db } from '../db/index'
import { getCard, getSet } from '../lib/tcgdex'

const arg = process.argv[2] ?? '10'
const limit = arg === 'all' ? Number.MAX_SAFE_INTEGER : Number(arg)
if (!Number.isFinite(limit) || limit <= 0) {
  console.error('\n  Uso: npm run backfill-images -- <número de sets | all>\n')
  process.exit(1)
}

/** Peticiones en paralelo. Suficiente para ir rápido sin castigar a TCGdex. */
const CONCURRENCY = 4

const pending = db
  .prepare(
    `SELECT e.id_expansion, e.tcgdex_set_id, e.lang, e.name, e.release_date
       FROM expansions e
      WHERE e.tcgdex_set_id IS NOT NULL
        AND e.tcgdex_set_id NOT IN (SELECT tcgdex_set_id FROM image_backfill)
      ORDER BY e.release_date IS NULL, e.release_date DESC
      LIMIT ?`,
  )
  .all(limit) as {
  id_expansion: number
  tcgdex_set_id: string
  lang: string | null
  name: string
  release_date: string | null
}[]

const total = db
  .prepare(`SELECT COUNT(*) AS n FROM expansions WHERE tcgdex_set_id IS NOT NULL`)
  .get() as { n: number }
const done = db.prepare(`SELECT COUNT(*) AS n FROM image_backfill`).get() as { n: number }

console.log(`\n▶ Imágenes de cartas · ${done.n}/${total.n} sets ya hechos\n`)
if (!pending.length) {
  console.log('  Nada pendiente.\n')
  process.exit(0)
}

const setImage = db.prepare(`UPDATE products SET image=?, tcgdex_card_id=? WHERE id_product=?`)
const markDone = db.prepare(
  `INSERT OR REPLACE INTO image_backfill (tcgdex_set_id, done_at, matched, total) VALUES (?, ?, ?, ?)`,
)

for (const exp of pending) {
  const set = await getSet(exp.tcgdex_set_id, exp.lang ?? 'en')
  if (!set?.cards?.length) {
    markDone.run(exp.tcgdex_set_id, new Date().toISOString(), 0, 0)
    console.log(`  · ${exp.tcgdex_set_id.padEnd(10)} sin cartas en TCGdex`)
    continue
  }

  // Guardamos el id de carta aunque no haya imagen: TCGdex no tiene fotos de
  // las cartas japonesas, pero el mapeo carta↔producto sigue siendo útil.
  const found: { idProduct: number; image: string | null; cardId: string }[] = []

  for (let i = 0; i < set.cards.length; i += CONCURRENCY) {
    const batch = set.cards.slice(i, i + CONCURRENCY)
    const cards = await Promise.all(batch.map((c) => getCard(c.id, exp.lang ?? 'en')))
    cards.forEach((card, j) => {
      const idProduct = card?.pricing?.cardmarket?.idProduct
      if (idProduct) found.push({ idProduct, image: batch[j].image ?? null, cardId: batch[j].id })
    })
  }

  const withImage = found.filter((f) => f.image).length
  const write = db.transaction(() => {
    for (const f of found) setImage.run(f.image, f.cardId, f.idProduct)
    markDone.run(exp.tcgdex_set_id, new Date().toISOString(), withImage, set.cards.length)
  })
  write()

  const pct = ((withImage / set.cards.length) * 100).toFixed(0)
  const note = found.length && !withImage ? '  (mapeadas, pero TCGdex no tiene sus imágenes)' : ''
  console.log(
    `  ✓ ${exp.tcgdex_set_id.padEnd(10)} ${String(withImage).padStart(4)}/${String(set.cards.length).padEnd(4)} (${pct}%)  ${exp.name}${note}`,
  )
}

const cov = db
  .prepare(`SELECT COUNT(*) AS n FROM products WHERE image IS NOT NULL AND is_sealed = 0`)
  .get() as { n: number }
const singles = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE is_sealed = 0`).get() as {
  n: number
}
console.log(
  `\n✓ ${cov.n.toLocaleString('es')}/${singles.n.toLocaleString('es')} cartas con imagen (${((100 * cov.n) / singles.n).toFixed(0)}%)\n`,
)
