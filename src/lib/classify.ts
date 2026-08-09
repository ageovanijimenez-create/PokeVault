/**
 * Clasifica las "expansiones" de Cardmarket.
 *
 * Cardmarket tiene 776 idExpansion para Pokémon, pero eso NO son 776 sets.
 * En el mismo saco mete las expansiones de verdad y un montón de agrupaciones
 * que no lo son: sets de energías, promos, mazos, monedas sueltas, lotes.
 *
 * No existe ningún campo que diga "esto es un set". Así que lo deducimos de la
 * composición del propio catálogo, con una regla que se puede comprobar a
 * ojo: **una expansión de verdad se vende en sobres**.
 *
 *   energy      → más de la mitad de sus cartas son energías
 *   sealed-only → no tiene cartas, solo producto sellado (monedas, lotes, tins)
 *   main        → tiene sobre o display propio y 20+ cartas  ← las de verdad
 *   promo       → 20+ cartas pero sin sobre propio (promos, mazos, colecciones)
 *   minor       → menos de 20 cartas
 *
 * El orden importa: se comprueba de arriba abajo y se queda con la primera.
 */
import { db } from '../db/index'

export type Kind = 'energy' | 'sealed-only' | 'main' | 'promo' | 'minor'

export interface ClassifyResult {
  counts: Record<Kind, number>
  mainMapped: number
}

interface Row {
  id_expansion: number
  singles: number
  sealed: number
  energies: number
  packs: number
}

function classify(r: Row): Kind {
  if (r.singles > 0 && r.energies * 2 > r.singles) return 'energy'
  if (r.singles === 0) return 'sealed-only'
  if (r.packs > 0 && r.singles >= 20) return 'main'
  if (r.singles >= 20) return 'promo'
  return 'minor'
}

export function runClassify(log: (msg: string) => void = () => {}): ClassifyResult {
  const rows = db
    .prepare(
      `SELECT e.id_expansion,
              SUM(1 - p.is_sealed)                                                   AS singles,
              SUM(p.is_sealed)                                                       AS sealed,
              SUM(CASE WHEN p.is_sealed = 0 AND p.name LIKE '%Energy%'
                       THEN 1 ELSE 0 END)                                            AS energies,
              SUM(CASE WHEN p.category_name IN ('Pokémon Booster', 'Pokémon Display')
                       THEN 1 ELSE 0 END)                                            AS packs
         FROM expansions e
         JOIN products p ON p.id_expansion = e.id_expansion
        GROUP BY e.id_expansion`,
    )
    .all() as Row[]

  const update = db.prepare(`UPDATE expansions SET kind = ? WHERE id_expansion = ?`)
  const counts = { main: 0, promo: 0, energy: 0, 'sealed-only': 0, minor: 0 } as Record<Kind, number>

  db.transaction(() => {
    for (const r of rows) {
      const kind = classify(r)
      update.run(kind, r.id_expansion)
      counts[kind]++
    }
  })()

  const mainMapped = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM expansions WHERE kind='main' AND tcgdex_set_id IS NOT NULL`)
      .get() as { n: number }
  ).n

  log(`${counts.main} expansiones de verdad, ${mainMapped} identificadas`)
  return { counts, mainMapped }
}
