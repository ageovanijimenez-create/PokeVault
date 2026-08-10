/**
 * Ficheros públicos de Cardmarket.
 *
 * Cardmarket retiró estos datos de la API y los publica como ficheros sueltos en
 * un bucket S3: sin API key, sin login y —lo importante— sin el Cloudflare que
 * protege www.cardmarket.com. Por eso se pueden descargar desde Railway.
 *
 * Se regeneran una vez al día (madrugada, CET). El campo `createdAt` de cada
 * fichero es la marca que usamos para no reprocesar dos veces el mismo volcado.
 */

/** ID de juego en Cardmarket. 1 = Magic, 3 = Yu-Gi-Oh!, 6 = Pokémon. */
export const GAME_POKEMON = 6

const BASE = 'https://downloads.s3.cardmarket.com/productCatalog'

export const urls = (game: number = GAME_POKEMON) => ({
  singles: `${BASE}/productList/products_singles_${game}.json`,
  sealed: `${BASE}/productList/products_nonsingles_${game}.json`,
  prices: `${BASE}/priceGuide/price_guide_${game}.json`,
})

export interface CmProduct {
  idProduct: number
  name: string
  idCategory: number
  categoryName: string
  idExpansion: number
  idMetacard: number
  dateAdded: string
}

export interface CmPrice {
  idProduct: number
  idCategory: number
  avg: number | null
  low: number | null
  trend: number | null
  /** Medias de venta a 1/7/30 días. Ojo: los sellados SIEMPRE las traen a null. */
  avg1: number | null
  avg7: number | null
  avg30: number | null
  'avg-holo': number | null
  'low-holo': number | null
  'trend-holo': number | null
  'avg1-holo': number | null
  'avg7-holo': number | null
  'avg30-holo': number | null
}

interface FileEnvelope {
  version: number
  createdAt: string
}
type ProductFile = FileEnvelope & { products: CmProduct[] }
type PriceFile = FileEnvelope & { priceGuides: CmPrice[] }

/**
 * Comprueba si hay volcado nuevo sin bajarse los 15 MB.
 *
 * El bucket devuelve `ETag` y `Last-Modified`, así que una petición HEAD basta
 * para saber si el fichero ha cambiado. Esto es lo que permite que el
 * planificador dentro del servicio web mire cada hora sin gastar ancho de
 * banda: 400 bytes en vez de 15 MB.
 */
export async function peekPrices(game?: number): Promise<{ etag: string | null; lastModified: string | null }> {
  try {
    const res = await fetch(urls(game).prices, { method: 'HEAD' })
    if (!res.ok) return { etag: null, lastModified: null }
    return {
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    }
  } catch {
    return { etag: null, lastModified: null }
  }
}

async function getJson<T>(url: string, attempt = 1): Promise<T> {
  try {
    const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } catch (err) {
    if (attempt >= 3) throw new Error(`No se pudo descargar ${url}: ${(err as Error).message}`)
    await new Promise((r) => setTimeout(r, attempt * 2000))
    return getJson<T>(url, attempt + 1)
  }
}

export async function fetchProducts(game?: number) {
  const u = urls(game)
  const [singles, sealed] = await Promise.all([
    getJson<ProductFile>(u.singles),
    getJson<ProductFile>(u.sealed),
  ])
  return {
    createdAt: singles.createdAt,
    singles: singles.products,
    sealed: sealed.products,
  }
}

export async function fetchPrices(game?: number) {
  const file = await getJson<PriceFile>(urls(game).prices)
  return { createdAt: file.createdAt, prices: file.priceGuides }
}

/**
 * Enlace directo a la ficha del producto en Cardmarket.
 *
 * Cardmarket mantiene una redirección oficial por id de producto:
 *
 *   https://www.cardmarket.com/es/Pokemon/Products?idProduct=895789
 *
 * Es la misma que usa Scryfall en sus enlaces, y evita tener que construir el
 * slug de la ficha —que lleva el nombre inglés de la expansión y no viene en
 * los ficheros públicos—. El `idProduct` sí lo tenemos: es literalmente la
 * clave primaria de nuestra tabla de productos.
 *
 * `referrer` es cortesía: le dice a Cardmarket de dónde le llega el tráfico.
 */
export const productUrl = (idProduct: number, locale = 'es') =>
  `https://www.cardmarket.com/${locale}/Pokemon/Products?idProduct=${idProduct}&referrer=pokevault`
