/**
 * TCGdex: catálogo abierto de Pokémon TCG, multiidioma y sin API key.
 *
 * Aquí lo usamos para dos cosas:
 *   1. Nombres de set en castellano (Cardmarket solo da `idExpansion`, sin nombre).
 *   2. El puente de IDs: cada carta trae `pricing.cardmarket.idProduct`, que es
 *      lo que nos permite atar un set de TCGdex a una expansión de Cardmarket.
 */

const BASE = 'https://api.tcgdex.net/v2'

export interface TcgdexSetBrief {
  id: string
  name: string
  logo?: string
  symbol?: string
  cardCount?: { total?: number; official?: number }
}

export interface TcgdexSet extends TcgdexSetBrief {
  serie?: { id: string; name: string }
  releaseDate?: string
  cards: { id: string; localId: string; name: string; image?: string }[]
}

export interface TcgdexCard {
  id: string
  name: string
  pricing?: {
    cardmarket?: { idProduct?: number; trend?: number; avg7?: number }
    tcgplayer?: Record<string, { productId?: number }>
  }
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export const listSets = (lang = 'es') => getJson<TcgdexSetBrief[]>(`/${lang}/sets`)
export const getSet = (id: string, lang = 'es') => getJson<TcgdexSet>(`/${lang}/sets/${id}`)
export const getCard = (id: string, lang = 'es') => getJson<TcgdexCard>(`/${lang}/cards/${id}`)

/**
 * Catálogos de TCGdex que recorremos: occidente y Japón, y nada más.
 *
 *   - `ko` no hace falta: los sets coreanos son los mismos que los japoneses y
 *     en Cardmarket comparten producto (ko/SV4M y ja/SV4M dan el mismo
 *     idProduct). El idioma es un atributo del anuncio, no un set aparte.
 *   - `zh-tw` / `zh-cn` quedan fuera: TCGdex no enlaza las cartas chinas con
 *     Cardmarket, así que no hay puente posible aunque quisiéramos.
 *   - `th` / `id` son calcos del japonés y solo generan duplicados.
 *
 * `en` va primero: de ahí salen las imágenes de carta, y los nombres de
 * producto de Cardmarket son ingleses, así que concuerdan. El nombre del SET
 * en castellano se busca aparte.
 */
export const LANGS = ['en', 'ja'] as const

/**
 * Busca un set probando idiomas por orden y devuelve también en cuál lo
 * encontró: las cartas hay que pedirlas en ese mismo idioma o dan 404.
 */
export async function resolveSet(id: string): Promise<{ set: TcgdexSet; lang: string } | null> {
  for (const lang of LANGS) {
    const set = await getSet(id, lang)
    if (set?.cards?.length) return { set, lang }
  }
  return null
}

/**
 * Devuelve el `idProduct` de Cardmarket de alguna carta del set.
 *
 * Prueba varias cartas repartidas por el set porque no todas tienen precio
 * (promos, cartas muy nuevas, secretas sin ventas todavía).
 */
export async function findCardmarketAnchor(
  set: TcgdexSet,
  lang: string,
  tries = 5,
): Promise<number | null> {
  const cards = set.cards ?? []
  if (!cards.length) return null

  const step = Math.max(1, Math.floor(cards.length / tries))
  for (let i = 0; i < cards.length && i / step < tries; i += step) {
    const card = await getCard(cards[i].id, lang)
    const id = card?.pricing?.cardmarket?.idProduct
    if (id) return id
    await new Promise((r) => setTimeout(r, 120)) // TCGdex pide moderación, no hay rate limit duro
  }
  return null
}
