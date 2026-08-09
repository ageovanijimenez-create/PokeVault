/**
 * Nombre oficial en inglés para los sets japoneses.
 *
 * TCGdex da los sets japoneses solo en japonés (インフェルノX) y la gente los
 * conoce por su nombre inglés (Inferno X). Ese nombre existe, es el que usa
 * TCGplayer en su categoría "Pokemon Japan", y se cruza por abreviatura:
 *
 *   set de TCGdex 'M2' → grupo 'M2' de TCGCSV → "M2: Inferno X"
 *
 * OJO: el cruce por abreviatura SOLO vale para sets japoneses. Las dos
 * numeraciones colisionan —'dp1' existe en ambos mundos y son sets distintos—
 * así que aplicarlo a los occidentales metería nombres falsos.
 */
import { db } from '../db/index'
import { listSets } from './tcgdex'
import { CATEGORY_POKEMON_JP, listGroups } from './tcgcsv'

export interface NamesEnResult {
  japanese: number
  named: number
  missing: string[]
}

export async function runNamesEn(log: (msg: string) => void = () => {}): Promise<NamesEnResult> {
  const [western, groups] = await Promise.all([listSets('en'), listGroups(CATEGORY_POKEMON_JP)])
  if (!western?.length || !groups?.length) throw new Error('No se pudo consultar TCGdex o TCGCSV.')

  // Un set es japonés si no aparece en el catálogo occidental de TCGdex.
  const westernIds = new Set(western.map((s) => s.id.toUpperCase()))
  const byAbbr = new Map<string, string>()
  for (const g of groups) {
    if (g.abbreviation) byAbbr.set(g.abbreviation.toUpperCase(), g.name)
  }

  const rows = db
    .prepare(
      `SELECT id_expansion, tcgdex_set_id, name, lang FROM expansions WHERE tcgdex_set_id IS NOT NULL`,
    )
    .all() as { id_expansion: number; tcgdex_set_id: string; name: string; lang: string | null }[]

  const setLang = db.prepare(`UPDATE expansions SET lang=? WHERE id_expansion=?`)
  const setNameEn = db.prepare(`UPDATE expansions SET name_en=? WHERE id_expansion=?`)

  let japanese = 0
  let named = 0
  const missing: string[] = []

  // `lang` lo decide map-sets (es el catálogo de TCGdex del que salió el set, y
  // del que salen sus imágenes). Aquí NO lo pisamos: solo lo rellenamos si
  // viene vacío, para filas antiguas de antes de que existiera la columna.
  db.transaction(() => {
    for (const r of rows) {
      const isWestern = westernIds.has(r.tcgdex_set_id.toUpperCase())
      if (!r.lang) setLang.run(isWestern ? 'en' : 'ja', r.id_expansion)

      if (isWestern || (r.lang && r.lang !== 'ja')) continue

      japanese++
      const official = byAbbr.get(r.tcgdex_set_id.toUpperCase())
      if (official) {
        setNameEn.run(official, r.id_expansion)
        named++
      } else {
        missing.push(r.tcgdex_set_id)
      }
    }
  })()

  log(`${named}/${japanese} sets japoneses con nombre oficial en inglés`)
  if (missing.length) log(`sin nombre inglés: ${missing.join(', ')}`)
  return { japanese, named, missing }
}
