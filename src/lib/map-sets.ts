/**
 * Pone nombre a las expansiones de Cardmarket.
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
 * distintos. Por eso la clave es el par (idioma, id), nunca el id suelto.
 */
import { db } from '../db/index'
import { LANGS, findCardmarketAnchor, getSet, listSets } from './tcgdex'

export interface MapSetsResult {
  mapped: number
  missed: number
  dupes: number
  skipped: number
}

/**
 * Cuántos días esperamos antes de volver a sondear un set que no casó.
 *
 * Sin esto, cada ejecución automática reintentaba ~190 sets imposibles
 * (chinos, promos sin enlace) y eso son casi mil peticiones diarias a TCGdex
 * para llegar siempre al mismo sitio. Se reintentan de vez en cuando por si
 * TCGdex acaba añadiendo el enlace.
 */
const RETRY_AFTER_DAYS = 14

export async function runMapSets(
  log: (msg: string) => void = () => {},
  { force = false } = {},
): Promise<MapSetsResult> {
  const products = db.prepare(`SELECT COUNT(*) AS n FROM products`).get() as { n: number }
  if (!products.n) throw new Error('No hay productos. Hay que lanzar antes la ingesta.')

  const catalogs = await Promise.all(
    LANGS.map(async (lang) => ({ lang, sets: (await listSets(lang)) ?? [] })),
  )
  const candidates = catalogs.flatMap((c) => c.sets.map((s) => ({ lang: c.lang, id: s.id })))
  if (!candidates.length) throw new Error('TCGdex no respondió.')

  // Nombres en castellano, para mostrarlos cuando existan. Una sola petición.
  const spanish = new Map(((await listSets('es')) ?? []).map((s) => [s.id, s.name]))

  const already = db
    .prepare(`SELECT id_expansion, tcgdex_set_id, lang FROM expansions WHERE tcgdex_set_id IS NOT NULL`)
    .all() as { id_expansion: number; tcgdex_set_id: string; lang: string | null }[]

  const done = new Set(already.map((r) => `${r.lang ?? 'en'}:${r.tcgdex_set_id}`))
  const taken = new Set(already.map((r) => r.id_expansion))

  // Fallidos recientes: se saltan salvo que se fuerce.
  const cutoff = new Date(Date.now() - RETRY_AFTER_DAYS * 86400_000).toISOString()
  const recentlyTried = new Set(
    force
      ? []
      : (db
          .prepare(`SELECT tcgdex_set_id, lang FROM set_attempts WHERE last_try > ?`)
          .all(cutoff) as { tcgdex_set_id: string; lang: string }[]
        ).map((r) => `${r.lang}:${r.tcgdex_set_id}`),
  )

  const pending = candidates.filter(
    (c) => !done.has(`${c.lang}:${c.id}`) && !recentlyTried.has(`${c.lang}:${c.id}`),
  )
  const skipped = candidates.length - pending.length - done.size

  log(`${candidates.length} sets · ${done.size} ya mapeados · ${pending.length} por probar`)

  const expansionOf = db.prepare(`SELECT id_expansion FROM products WHERE id_product = ?`)
  const update = db.prepare(`
    UPDATE expansions SET tcgdex_set_id=?, name=?, serie=?, release_date=?, logo=?, symbol=?, card_count=?, lang=?
    WHERE id_expansion = ?
  `)
  const noteAttempt = db.prepare(`
    INSERT INTO set_attempts (tcgdex_set_id, lang, last_try, tries) VALUES (?, ?, ?, 1)
    ON CONFLICT(tcgdex_set_id, lang) DO UPDATE SET last_try = excluded.last_try, tries = tries + 1
  `)
  const clearAttempt = db.prepare(`DELETE FROM set_attempts WHERE tcgdex_set_id = ? AND lang = ?`)

  let mapped = 0
  let missed = 0
  let dupes = 0
  const now = new Date().toISOString()

  for (const cand of pending) {
    const set = await getSet(cand.id, cand.lang)
    if (!set?.cards?.length) {
      noteAttempt.run(cand.id, cand.lang, now)
      missed++
      continue
    }

    const anchor = await findCardmarketAnchor(set, cand.lang)
    const row = anchor ? (expansionOf.get(anchor) as { id_expansion: number } | undefined) : undefined

    if (!row) {
      noteAttempt.run(cand.id, cand.lang, now)
      missed++
      continue
    }

    // Otra entrada ya reclamó esta expansión. El primero que llega se la queda.
    if (taken.has(row.id_expansion)) {
      noteAttempt.run(cand.id, cand.lang, now)
      dupes++
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
    clearAttempt.run(cand.id, cand.lang)
    taken.add(row.id_expansion)
    mapped++
    log(`${cand.lang} ${set.id} → expansión ${row.id_expansion} · ${set.name}`)
  }

  // Las expansiones que TCGdex no cubre se quedan con un nombre provisional
  // para que no salgan en blanco en el panel.
  db.prepare(`UPDATE expansions SET name = 'Expansión #' || id_expansion WHERE name IS NULL`).run()

  log(`${mapped} mapeados · ${missed} sin correspondencia · ${dupes} ya ocupadas`)
  return { mapped, missed, dupes, skipped: Math.max(0, skipped) }
}
