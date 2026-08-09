/**
 * TCGCSV: espejo diario y gratuito del catálogo de TCGplayer.
 *
 * Lo usamos para una cosa concreta: los sets japoneses tienen nombre oficial en
 * inglés ahí ("S12a: VSTAR Universe"), que es como los conoce la gente. TCGdex
 * solo los da en japonés y Cardmarket no da nombre de expansión ninguno.
 */

const BASE = 'https://tcgcsv.com/tcgplayer'

/** Nos identificamos: es lo que pide TCGCSV y es de buena educación. */
const USER_AGENT = process.env.USER_AGENT ?? 'PokeVault/0.1 (+https://github.com/ageovanijimenez-create/PokeVault)'

/** Categorías de TCGplayer. 3 = Pokémon (occidental), 85 = Pokémon Japan. */
export const CATEGORY_POKEMON = 3
export const CATEGORY_POKEMON_JP = 85

export interface TcgcsvGroup {
  groupId: number
  name: string
  abbreviation: string | null
  publishedOn: string | null
  categoryId: number
}

export interface TcgcsvProduct {
  productId: number
  name: string
  cleanName: string
  imageUrl: string
  groupId: number
  url: string
  extendedData?: { name: string; value: string }[]
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    // TCGCSV rechaza el User-Agent por defecto de Node y pide que te
    // identifiques. Es su norma y es razonable: la respetamos.
    const res = await fetch(`${BASE}${path}`, { headers: { 'user-agent': USER_AGENT } })
    if (!res.ok) return null
    const body = (await res.json()) as { results?: T }
    return body.results ?? null
  } catch {
    return null
  }
}

export const listGroups = (categoryId: number) => getJson<TcgcsvGroup[]>(`/${categoryId}/groups`)

export const listProducts = (categoryId: number, groupId: number) =>
  getJson<TcgcsvProduct[]>(`/${categoryId}/${groupId}/products`)
