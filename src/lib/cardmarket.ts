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
 * Enlace a la ficha del producto en Cardmarket.
 *
 * La URL directa de una ficha es
 * `/Products/Singles/{Expansion-Slug}/{Producto-Slug}` y **no se puede
 * construir**: el slug usa el nombre inglés de la expansión, que los ficheros
 * públicos no traen (solo dan `idExpansion`). Tampoco existe una ruta por id.
 *
 * La búsqueda por el nombre exacto del producto sí funciona siempre, porque el
 * nombre que guardamos es literalmente el suyo. Cae en la ficha o a un clic.
 */
export const productUrl = (name: string, locale = 'es') =>
  `https://www.cardmarket.com/${locale}/Pokemon/Products/Search?searchString=${encodeURIComponent(name)}`
