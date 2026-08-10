import { db } from './index'

export interface ExpansionRow {
  id_expansion: number
  tcgdex_set_id: string | null
  name: string
  /** Nombre oficial en inglés. Solo lo tienen los sets japoneses. */
  name_en: string | null
  serie: string | null
  release_date: string | null
  logo: string | null
  symbol: string | null
  lang: string | null
  singles: number
  sealed: number
  top_trend: number | null
}

export interface ProductRow {
  id_product: number
  name: string
  category_name: string | null
  is_sealed: number
  image: string | null
  trend: number | null
  avg: number | null
  low: number | null
  avg7: number | null
  avg30: number | null
}

export function getStats() {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM products WHERE is_sealed = 0) AS singles,
         (SELECT COUNT(*) FROM products WHERE is_sealed = 1) AS sealed,
         (SELECT COUNT(*) FROM expansions)                   AS expansions,
         (SELECT COUNT(*) FROM price_history)                AS history,
         (SELECT source_created_at FROM ingest_runs WHERE status='ok'
           ORDER BY id DESC LIMIT 1)                         AS updated_at`,
    )
    .get() as {
    singles: number
    sealed: number
    expansions: number
    history: number
    updated_at: string | null
  }
  return row
}

/**
 * Sets que se muestran en la web, los más nuevos primero.
 *
 * Solo los identificados contra TCGdex, que por construcción son occidentales
 * o japoneses (los coreanos son los mismos que los japoneses y comparten
 * producto en Cardmarket). Las expansiones que Cardmarket tiene pero no
 * podemos identificar —chinas, promos sueltas, agrupaciones raras— quedan
 * fuera de la web pública y solo aparecen en el panel.
 */
/**
 * Región por la que se puede filtrar la portada.
 *
 * Corea no es una opción aparte a propósito: los sets coreanos son los mismos
 * que los japoneses y en Cardmarket comparten producto, así que van juntos.
 */
export type Region = 'todo' | 'occidente' | 'japon'

export function listExpansions(region: Region = 'todo'): ExpansionRow[] {
  const filtro =
    region === 'occidente' ? `AND e.lang = 'en'` : region === 'japon' ? `AND e.lang = 'ja'` : ''

  return db
    .prepare(
      `SELECT e.*,
              COUNT(*) FILTER (WHERE p.is_sealed = 0) AS singles,
              COUNT(*) FILTER (WHERE p.is_sealed = 1) AS sealed,
              MAX(CASE WHEN p.is_sealed = 1 THEN pr.trend END) AS top_trend
         FROM expansions e
         JOIN products  p  ON p.id_expansion = e.id_expansion
         LEFT JOIN prices pr ON pr.id_product = p.id_product
        WHERE e.tcgdex_set_id IS NOT NULL ${filtro}
        GROUP BY e.id_expansion
       HAVING singles + sealed > 0
        ORDER BY e.release_date IS NULL, e.release_date DESC, e.id_expansion DESC`,
    )
    .all() as ExpansionRow[]
}

/** Cuántos sets hay en cada región, para poder etiquetar los filtros. */
export function contarPorRegion() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS todo,
              COUNT(*) FILTER (WHERE lang = 'en') AS occidente,
              COUNT(*) FILTER (WHERE lang = 'ja') AS japon
         FROM expansions
        WHERE tcgdex_set_id IS NOT NULL`,
    )
    .get() as { todo: number; occidente: number; japon: number }
  return row
}

export function getExpansion(id: number): ExpansionRow | undefined {
  return db
    .prepare(
      `SELECT e.*,
              COUNT(*) FILTER (WHERE p.is_sealed = 0) AS singles,
              COUNT(*) FILTER (WHERE p.is_sealed = 1) AS sealed,
              MAX(CASE WHEN p.is_sealed = 1 THEN pr.trend END) AS top_trend
         FROM expansions e
         LEFT JOIN products p  ON p.id_expansion = e.id_expansion
         LEFT JOIN prices   pr ON pr.id_product  = p.id_product
        WHERE e.id_expansion = ?
        GROUP BY e.id_expansion`,
    )
    .get(id) as ExpansionRow | undefined
}

export function getProducts(idExpansion: number, sealed: boolean): ProductRow[] {
  return db
    .prepare(
      `SELECT p.id_product, p.name, p.category_name, p.is_sealed, p.image,
              pr.trend, pr.avg, pr.low, pr.avg7, pr.avg30
         FROM products p
         LEFT JOIN prices pr ON pr.id_product = p.id_product
        WHERE p.id_expansion = ? AND p.is_sealed = ?
        ORDER BY pr.trend DESC NULLS LAST, p.name`,
    )
    .all(idExpansion, sealed ? 1 : 0) as ProductRow[]
}

export function searchProducts(q: string, limit = 60) {
  return db
    .prepare(
      `SELECT p.id_product, p.name, p.category_name, p.is_sealed, p.image,
              pr.trend, pr.avg, pr.low, pr.avg7, pr.avg30,
              e.id_expansion, e.name AS expansion_name, e.tcgdex_set_id
         FROM products p
         LEFT JOIN prices     pr ON pr.id_product   = p.id_product
         LEFT JOIN expansions e  ON e.id_expansion  = p.id_expansion
        WHERE p.name LIKE ?
        ORDER BY p.is_sealed DESC, pr.trend DESC NULLS LAST
        LIMIT ?`,
    )
    .all(`%${q}%`, limit) as (ProductRow & {
    id_expansion: number
    expansion_name: string
    tcgdex_set_id: string | null
  })[]
}

// ─── Panel de administración ────────────────────────────────────────────────

export function getAdminOverview() {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM expansions)                                        AS expansions,
         (SELECT COUNT(*) FROM expansions WHERE tcgdex_set_id IS NOT NULL)        AS mapped,
         (SELECT COUNT(*) FROM expansions WHERE name_en IS NOT NULL)              AS with_english,
         (SELECT COUNT(*) FROM expansions WHERE lang = 'ja')                      AS japanese,
         (SELECT COUNT(*) FROM products)                                          AS products,
         (SELECT COUNT(*) FROM products WHERE is_sealed = 0)                      AS singles,
         (SELECT COUNT(*) FROM products WHERE is_sealed = 1)                      AS sealed,
         (SELECT COUNT(*) FROM products WHERE image IS NOT NULL)                  AS with_image,
         (SELECT COUNT(*) FROM products WHERE tcgdex_card_id IS NOT NULL)         AS with_card_id,
         (SELECT COUNT(*) FROM image_backfill)                                    AS backfilled,
         (SELECT COUNT(*) FROM price_history)                                     AS history,
         (SELECT COUNT(DISTINCT day) FROM price_history)                          AS history_days,
         (SELECT COUNT(*) FROM products p JOIN expansions e USING (id_expansion)
           WHERE e.tcgdex_set_id IS NOT NULL)                                     AS products_in_named,
         -- Reparto por clase. Ver scripts/classify.ts: Cardmarket mete sets de
         -- verdad y agrupaciones en el mismo saco, y aquí los separamos.
         (SELECT COUNT(*) FROM expansions WHERE kind='main')                      AS main,
         (SELECT COUNT(*) FROM expansions WHERE kind='main'
            AND tcgdex_set_id IS NOT NULL)                                        AS main_mapped,
         (SELECT COUNT(*) FROM expansions WHERE kind='promo')                     AS promo,
         (SELECT COUNT(*) FROM expansions WHERE kind='promo'
            AND tcgdex_set_id IS NOT NULL)                                        AS promo_mapped,
         (SELECT COUNT(*) FROM expansions WHERE kind='energy')                    AS energy,
         (SELECT COUNT(*) FROM expansions WHERE kind='sealed-only')               AS sealed_only,
         (SELECT COUNT(*) FROM expansions WHERE kind='minor')                     AS minor`,
    )
    .get() as Record<string, number>
}

/**
 * Lo que queda por meter de verdad: solo expansiones clasificadas como `main`
 * (las que tienen sobre propio). Sin ese filtro la lista se llenaba de
 * energías, monedas y agrupaciones que nunca van a ser un set.
 */
export function listUnmapped(limit = 40) {
  return db
    .prepare(
      `SELECT e.id_expansion,
              COUNT(*)                              AS products,
              SUM(p.is_sealed)                      AS sealed,
              MAX(pr.trend)                         AS top_trend,
              (SELECT name FROM products
                WHERE id_expansion = e.id_expansion
                ORDER BY is_sealed DESC LIMIT 1)    AS sample
         FROM expansions e
         JOIN products p   ON p.id_expansion = e.id_expansion
         LEFT JOIN prices pr ON pr.id_product = p.id_product
        WHERE e.tcgdex_set_id IS NULL AND e.kind = 'main'
        GROUP BY e.id_expansion
        ORDER BY products DESC
        LIMIT ?`,
    )
    .all(limit) as {
    id_expansion: number
    products: number
    sealed: number
    top_trend: number | null
    sample: string
  }[]
}

/** Sets mapeados a los que aún les faltan las imágenes. */
export function listBackfillPending(limit = 40) {
  return db
    .prepare(
      `SELECT e.tcgdex_set_id, e.name, e.name_en, e.lang, e.release_date, COUNT(p.id_product) AS products
         FROM expansions e
         LEFT JOIN products p ON p.id_expansion = e.id_expansion AND p.is_sealed = 0
        WHERE e.tcgdex_set_id IS NOT NULL
          AND e.tcgdex_set_id NOT IN (SELECT tcgdex_set_id FROM image_backfill)
        GROUP BY e.id_expansion
        ORDER BY e.release_date IS NULL, e.release_date DESC
        LIMIT ?`,
    )
    .all(limit) as {
    tcgdex_set_id: string
    name: string
    name_en: string | null
    lang: string | null
    release_date: string | null
    products: number
  }[]
}

export function listRuns(limit = 12) {
  return db
    .prepare(`SELECT * FROM ingest_runs ORDER BY id DESC LIMIT ?`)
    .all(limit) as {
    id: number
    started_at: string
    finished_at: string | null
    source_created_at: string | null
    products_upserted: number | null
    prices_upserted: number | null
    history_rows: number | null
    status: string
    error: string | null
  }[]
}

/** Serie histórica de un producto. Las filas solo existen cuando el precio cambió. */
export function getHistory(idProduct: number) {
  return db
    .prepare(
      `SELECT day, trend, avg, low FROM price_history
        WHERE id_product = ? ORDER BY day`,
    )
    .all(idProduct) as { day: string; trend: number | null; avg: number | null; low: number | null }[]
}
