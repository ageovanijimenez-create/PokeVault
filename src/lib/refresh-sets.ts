/**
 * Refresca los metadatos de los sets ya identificados.
 *
 * `map-sets` solo toca lo que no está mapeado, así que un set que se
 * identificó con datos malos se queda con ellos para siempre. Pasó de verdad:
 * las primeras pasadas pedían los sets en castellano primero, y en castellano
 * los sets antiguos (Sol y Luna, XY, Base) no tienen logo. Se quedaron sin
 * imagen aunque en el catálogo inglés sí la tienen.
 *
 * Esto vuelve a pedir cada set en su idioma (`lang`) y actualiza logo, symbol,
 * serie, fecha y número de cartas. Es barato: una petición por set, sin sondear
 * cartas. El nombre en castellano se conserva cuando existe.
 */
import { db } from '../db/index'
import { getSet, listSets } from './tcgdex'

/**
 * Idiomas en los que buscar un asset, por orden de preferencia.
 *
 * TCGdex DECLARA la URL del logo en todos los idiomas, pero el fichero solo
 * existe en algunos: el logo de `me05` da 404 en `en`, `fr` y `de`, y 200 en
 * `es` e `it`. Así que la URL que devuelve la API no se puede usar a ciegas,
 * hay que comprobar que responde.
 */
const LOCALES_ASSET = ['es', 'en', 'ja', 'it', 'fr', 'de']

const existe = async (url: string) => {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok
  } catch {
    return false
  }
}

/**
 * Devuelve la URL del asset en el primer idioma donde exista de verdad, o null
 * si no está en ninguno. Casi siempre acierta a la primera.
 */
async function assetQueExiste(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  const m = url.match(/^(https:\/\/assets\.tcgdex\.net)\/([^/]+)\/(.+)$/)
  if (!m) return url // formato inesperado: lo dejamos como venga

  const [, base, declarado, resto] = m
  for (const lang of [declarado, ...LOCALES_ASSET.filter((l) => l !== declarado)]) {
    const candidato = `${base}/${lang}/${resto}`
    if (await existe(`${candidato}.webp`)) return candidato
  }
  return null
}

export interface RefreshResult {
  revisados: number
  actualizados: number
  logosNuevos: number
}

export async function runRefreshSets(
  log: (msg: string) => void = () => {},
  /**
   * En la cadena automática solo miramos los que no tienen logo: son los únicos
   * que pueden mejorar, y así son 70 peticiones en vez de 200 cada día.
   */
  { soloSinLogo = false } = {},
): Promise<RefreshResult> {
  const sets = db
    .prepare(
      `SELECT id_expansion, tcgdex_set_id, lang, logo, symbol
         FROM expansions
        WHERE tcgdex_set_id IS NOT NULL ${soloSinLogo ? 'AND logo IS NULL' : ''}
        ORDER BY release_date IS NULL, release_date DESC`,
    )
    .all() as {
    id_expansion: number
    tcgdex_set_id: string
    lang: string | null
    logo: string | null
    symbol: string | null
  }[]

  if (!sets.length) {
    log('No hay sets identificados todavía.')
    return { revisados: 0, actualizados: 0, logosNuevos: 0 }
  }

  const spanish = new Map(((await listSets('es')) ?? []).map((s) => [s.id, s.name]))

  // logo y symbol van SIN coalesce a propósito: si se comprueba que la imagen
  // no existe en ningún idioma hay que poder borrarla, o se queda para siempre
  // una URL rota guardada. El resto sí se conserva si viene vacío.
  const update = db.prepare(`
    UPDATE expansions
       SET name = COALESCE(?, name),
           serie = COALESCE(?, serie),
           release_date = COALESCE(?, release_date),
           logo = ?,
           symbol = ?,
           card_count = COALESCE(?, card_count)
     WHERE id_expansion = ?
  `)

  let actualizados = 0
  let logosNuevos = 0

  for (const row of sets) {
    const set = await getSet(row.tcgdex_set_id, row.lang ?? 'en')
    if (!set) continue

    // Comprobar los assets antes de guardarlos: si no, se guardan URLs que
    // luego salen como imagen rota en la web.
    const [logo, symbol] = await Promise.all([
      assetQueExiste(set.logo),
      assetQueExiste(set.symbol),
    ])

    // Si TCGdex no declara imagen, conservamos la que ya tuviéramos: puede
    // venir de otra pasada y ser buena. Solo la pisamos cuando la declara,
    // porque entonces sí sabemos si sirve o no.
    const logoFinal = set.logo ? logo : row.logo
    const symbolFinal = set.symbol ? symbol : row.symbol

    if (!row.logo && logoFinal) logosNuevos++

    update.run(
      spanish.get(set.id) ?? set.name ?? null,
      set.serie?.name ?? null,
      set.releaseDate ?? null,
      logoFinal,
      symbolFinal,
      set.cardCount?.official ?? null,
      row.id_expansion,
    )
    actualizados++
  }

  log(`${actualizados}/${sets.length} sets revisados · ${logosNuevos} logos recuperados`)
  return { revisados: sets.length, actualizados, logosNuevos }
}
