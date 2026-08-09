/**
 * Actualización diaria.
 *
 *   npm run ingest
 *
 * Qué hace, en orden:
 *   1. Descarga el price guide y mira su `createdAt`. Si ya procesamos ese
 *      volcado exacto, se sale. Esto hace el script idempotente: lo puedes
 *      lanzar 20 veces al día sin ensuciar nada.
 *   2. Descarga catálogo de singles y sellados, y los mete en `products`.
 *   3. Compara los precios nuevos con los que ya teníamos y escribe en
 *      `price_history` SOLO los que han cambiado.
 *   4. Sobrescribe `prices` con la foto de hoy.
 *
 * El paso 3 es el que importa: Cardmarket te da la foto de hoy, nunca el
 * pasado. El histórico solo existe si lo guardas tú, empezando ya.
 */
import { db } from '../db/index'
import { fetchPrices, fetchProducts, type CmProduct } from '../lib/cardmarket'

const t0 = Date.now()
const log = (msg: string) => console.log(`  ${msg}`)

const run = db
  .prepare(`INSERT INTO ingest_runs (started_at, status) VALUES (?, 'running')`)
  .run(new Date().toISOString())
const runId = run.lastInsertRowid as number

const fail = (err: unknown) => {
  db.prepare(`UPDATE ingest_runs SET finished_at=?, status='error', error=? WHERE id=?`).run(
    new Date().toISOString(),
    (err as Error).message,
    runId,
  )
  console.error('\n  ✗ Falló la ingesta:', (err as Error).message)
  process.exit(1)
}

try {
  console.log('\n▶ Ingesta de Cardmarket (Pokémon)\n')

  // ─── 1. ¿Hay volcado nuevo? ────────────────────────────────────────────────
  log('Descargando price guide...')
  const { createdAt, prices } = await fetchPrices()
  log(`Volcado del ${createdAt} · ${prices.length.toLocaleString('es')} precios`)

  const last = db
    .prepare(`SELECT source_created_at FROM ingest_runs WHERE status='ok' ORDER BY id DESC LIMIT 1`)
    .get() as { source_created_at: string } | undefined

  if (last?.source_created_at === createdAt) {
    log('Ya teníamos este volcado. Nada que hacer.')
    db.prepare(`UPDATE ingest_runs SET finished_at=?, status='skipped', source_created_at=? WHERE id=?`)
      .run(new Date().toISOString(), createdAt, runId)
    process.exit(0)
  }

  // El día del histórico lo marca el fichero, no el reloj de la máquina.
  const day = createdAt.slice(0, 10)

  // ─── 2. Catálogo ───────────────────────────────────────────────────────────
  log('Descargando catálogo...')
  const { singles, sealed } = await fetchProducts()
  log(`${singles.length.toLocaleString('es')} cartas · ${sealed.length.toLocaleString('es')} sellados`)

  const upsertProduct = db.prepare(`
    INSERT INTO products (id_product, name, id_category, category_name, id_expansion, is_sealed, date_added)
    VALUES (@idProduct, @name, @idCategory, @categoryName, @idExpansion, @isSealed, @dateAdded)
    ON CONFLICT(id_product) DO UPDATE SET
      name=excluded.name, id_category=excluded.id_category,
      category_name=excluded.category_name, id_expansion=excluded.id_expansion,
      is_sealed=excluded.is_sealed
  `)
  const ensureExpansion = db.prepare(`INSERT OR IGNORE INTO expansions (id_expansion) VALUES (?)`)

  const writeProducts = db.transaction((rows: CmProduct[], isSealed: number) => {
    for (const p of rows) {
      ensureExpansion.run(p.idExpansion)
      upsertProduct.run({
        idProduct: p.idProduct,
        name: p.name,
        idCategory: p.idCategory,
        categoryName: p.categoryName,
        idExpansion: p.idExpansion,
        isSealed,
        dateAdded: p.dateAdded,
      })
    }
  })
  writeProducts(singles, 0)
  writeProducts(sealed, 1)
  log(`Catálogo guardado (${(singles.length + sealed.length).toLocaleString('es')} productos)`)

  // ─── 3. Histórico: solo lo que ha cambiado ─────────────────────────────────
  const previous = new Map<number, { trend: number | null; avg: number | null; low: number | null }>()
  for (const row of db.prepare(`SELECT id_product, trend, avg, low FROM prices`).iterate() as Iterable<{
    id_product: number
    trend: number | null
    avg: number | null
    low: number | null
  }>) {
    previous.set(row.id_product, { trend: row.trend, avg: row.avg, low: row.low })
  }

  const insertHistory = db.prepare(`
    INSERT INTO price_history (id_product, day, trend, avg, low, avg7, avg30)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id_product, day) DO UPDATE SET
      trend=excluded.trend, avg=excluded.avg, low=excluded.low,
      avg7=excluded.avg7, avg30=excluded.avg30
  `)
  const upsertPrice = db.prepare(`
    INSERT INTO prices (id_product, avg, low, trend, avg1, avg7, avg30,
                        avg_holo, low_holo, trend_holo, avg1_holo, avg7_holo, avg30_holo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id_product) DO UPDATE SET
      avg=excluded.avg, low=excluded.low, trend=excluded.trend,
      avg1=excluded.avg1, avg7=excluded.avg7, avg30=excluded.avg30,
      avg_holo=excluded.avg_holo, low_holo=excluded.low_holo, trend_holo=excluded.trend_holo,
      avg1_holo=excluded.avg1_holo, avg7_holo=excluded.avg7_holo, avg30_holo=excluded.avg30_holo,
      updated_at=excluded.updated_at
  `)

  let changed = 0
  const writePrices = db.transaction(() => {
    for (const p of prices) {
      const prev = previous.get(p.idProduct)
      if (!prev || prev.trend !== p.trend || prev.avg !== p.avg || prev.low !== p.low) {
        insertHistory.run(p.idProduct, day, p.trend, p.avg, p.low, p.avg7, p.avg30)
        changed++
      }
      upsertPrice.run(
        p.idProduct, p.avg, p.low, p.trend, p.avg1, p.avg7, p.avg30,
        p['avg-holo'], p['low-holo'], p['trend-holo'],
        p['avg1-holo'], p['avg7-holo'], p['avg30-holo'],
        createdAt,
      )
    }
  })
  writePrices()

  const pct = ((changed / prices.length) * 100).toFixed(1)
  log(`Precios guardados · ${changed.toLocaleString('es')} cambios anotados en el histórico (${pct}%)`)

  db.prepare(`
    UPDATE ingest_runs SET finished_at=?, status='ok', source_created_at=?,
      products_upserted=?, prices_upserted=?, history_rows=? WHERE id=?
  `).run(
    new Date().toISOString(), createdAt,
    singles.length + sealed.length, prices.length, changed, runId,
  )

  console.log(`\n✓ Listo en ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
} catch (err) {
  fail(err)
}
