/**
 * Pone nombre a las expansiones.
 *
 *   npm run map-sets
 *
 * Los ficheros de Cardmarket traen `idExpansion` pero NO el nombre del set.
 * TCGdex sí tiene nombres y además expone en cada carta el
 * `cardmarket.idProduct`. Así que el puente es:
 *
 *   set de TCGdex → una carta suya → idProduct → products.id_expansion
 *
 * Con eso queda identificada la expansión entera, sellados incluidos.
 *
 * ALCANCE: solo occidente y Japón (ver `LANGS`). El coreano no hace falta —
 * son los mismos sets que los japoneses y Cardmarket les da el mismo producto,
 * el idioma es solo un atributo del anuncio—. El chino se queda fuera porque
 * TCGdex no enlaza sus cartas con Cardmarket: no hay puente posible.
 *
 * CUIDADO con los IDs: **colisionan entre catálogos**. `SV10` es "Destined
 * Rivals" en inglés y "The Glory of Team Rocket" en japonés, y son sets
 * distintos. Por eso recorremos cada catálogo por separado y la clave es el
 * par (idioma, id), nunca el id suelto.
 *
 * Solo procesa sets sin mapear, así que a partir de la segunda vez tarda nada.
 */
import { db } from '../db/index'
import { LANGS, findCardmarketAnchor, getSet, listSets } from '../lib/tcgdex'

console.log('\n▶ Mapeando sets de TCGdex contra expansiones de Cardmarket\n')

const products = db.prepare(`SELECT COUNT(*) AS n FROM products`).get() as { n: number }
if (!products.n) {
  console.error('  ✗ No hay productos en la base. Lanza primero `npm run ingest`.\n')
  process.exit(1)
}

const catalogs = await Promise.all(
  LANGS.map(async (lang) => ({ lang, sets: (await listSets(lang)) ?? [] })),
)
const candidates = catalogs.flatMap((c) => c.sets.map((s) => ({ lang: c.lang, id: s.id })))
if (!candidates.length) {
  console.error('  ✗ TCGdex no respondió.\n')
  process.exit(1)
}

// Nombres en castellano, para mostrarlos cuando existan. Una sola petición.
const spanish = new Map(((await listSets('es')) ?? []).map((s) => [s.id, s.name]))

const already = db
  .prepare(`SELECT id_expansion, tcgdex_set_id, lang FROM expansions WHERE tcgdex_set_id IS NOT NULL`)
  .all() as { id_expansion: number; tcgdex_set_id: string; lang: string | null }[]

const done = new Set(already.map((r) => `${r.lang ?? 'en'}:${r.tcgdex_set_id}`))
const taken = new Set(already.map((r) => r.id_expansion))

const pending = candidates.filter((c) => !done.has(`${c.lang}:${c.id}`))
console.log(
  `  ${candidates.length} sets en ${LANGS.join('/')} · ${done.size} ya mapeados · ${pending.length} por mapear\n`,
)

const expansionOf = db.prepare(`SELECT id_expansion FROM products WHERE id_product = ?`)
const update = db.prepare(`
  UPDATE expansions SET tcgdex_set_id=?, name=?, serie=?, release_date=?, logo=?, symbol=?, card_count=?, lang=?
  WHERE id_expansion = ?
`)

let ok = 0
let miss = 0
let dupe = 0

for (const cand of pending) {
  const set = await getSet(cand.id, cand.lang)
  if (!set?.cards?.length) {
    miss++
    continue
  }

  const anchor = await findCardmarketAnchor(set, cand.lang)
  const row = anchor ? (expansionOf.get(anchor) as { id_expansion: number } | undefined) : undefined

  if (!row) {
    miss++
    continue
  }

  // Otro set ya reclamó esta expansión (pasa con th/id, que son calcos del
  // japonés). El primero que llega se la queda.
  if (taken.has(row.id_expansion)) {
    dupe++
    continue
  }

  update.run(
    set.id,
    spanish.get(set.id) ?? set.name,
    set.serie?.name ?? null,
    set.releaseDate ?? null,
    set.logo ?? null,
    set.symbol ?? null,
    set.cardCount?.official ?? null,
    cand.lang,
    row.id_expansion,
  )
  taken.add(row.id_expansion)
  ok++
  console.log(
    `  ✓ ${cand.lang.padEnd(3)} ${set.id.padEnd(10)} → exp ${String(row.id_expansion).padEnd(6)} ${set.name}`,
  )
}

// Las expansiones que TCGdex no cubre se quedan con un nombre provisional
// para que no salgan en blanco en la web.
db.prepare(`UPDATE expansions SET name = 'Expansión #' || id_expansion WHERE name IS NULL`).run()

const cov = db
  .prepare(
    `SELECT COUNT(*) FILTER (WHERE e.tcgdex_set_id IS NOT NULL) AS mapped, COUNT(*) AS total
       FROM products p JOIN expansions e ON e.id_expansion = p.id_expansion`,
  )
  .get() as { mapped: number; total: number }

console.log(`\n✓ ${ok} mapeados · ${miss} sin correspondencia · ${dupe} ya ocupadas por otro set`)
console.log(`  ${((100 * cov.mapped) / cov.total).toFixed(0)}% de los productos viven en un set con nombre\n`)
