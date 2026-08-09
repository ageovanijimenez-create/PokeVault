/**
 * Imágenes de las cartas.
 *
 * Los ficheros de Cardmarket no traen imágenes, y TCGdex solo da el
 * `cardmarket.idProduct` en la respuesta de CADA carta —no hay endpoint
 * masivo, y por GraphQL el campo `pricing` no está expuesto—. Así que hay que
 * pedir carta a carta, una vez por set.
 *
 * Probé si los idProduct eran secuenciales dentro del set para deducirlos de
 * golpe: empiezan bien pero se desvían a partir de la carta ~45, así que no
 * sirve. Mejor lento y correcto que rápido y con las fotos cambiadas.
 *
 * Es resumible: cada set terminado queda anotado en `image_backfill` y no se
 * vuelve a tocar. Para un set nuevo son ~200 peticiones, medio minuto.
 */
import { db } from '../db/index'
import { getCard, getSet } from './tcgdex'

export interface BackfillResult {
  sets: number
  images: number
  pending: number
}

/** Peticiones en paralelo. Suficiente para ir rápido sin castigar a TCGdex. */
const CONCURRENCY = 4

export async function runBackfillImages(
  log: (msg: string) => void = () => {},
  limit = 10,
): Promise<BackfillResult> {
  const pending = db
    .prepare(
      `SELECT e.id_expansion, e.tcgdex_set_id, e.lang, e.name
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
  }[]

  const setImage = db.prepare(`UPDATE products SET image=?, tcgdex_card_id=? WHERE id_product=?`)
  const markDone = db.prepare(
    `INSERT OR REPLACE INTO image_backfill (tcgdex_set_id, done_at, matched, total) VALUES (?, ?, ?, ?)`,
  )

  let sets = 0
  let images = 0

  for (const exp of pending) {
    const set = await getSet(exp.tcgdex_set_id, exp.lang ?? 'en')
    if (!set?.cards?.length) {
      markDone.run(exp.tcgdex_set_id, new Date().toISOString(), 0, 0)
      sets++
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
    db.transaction(() => {
      for (const f of found) setImage.run(f.image, f.cardId, f.idProduct)
      markDone.run(exp.tcgdex_set_id, new Date().toISOString(), withImage, set.cards.length)
    })()

    sets++
    images += withImage
    log(`${exp.tcgdex_set_id}: ${withImage}/${set.cards.length} imágenes · ${exp.name}`)
  }

  const left = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM expansions
          WHERE tcgdex_set_id IS NOT NULL
            AND tcgdex_set_id NOT IN (SELECT tcgdex_set_id FROM image_backfill)`,
      )
      .get() as { n: number }
  ).n

  log(`${sets} sets procesados · ${images.toLocaleString('es')} imágenes · quedan ${left}`)
  return { sets, images, pending: left }
}
