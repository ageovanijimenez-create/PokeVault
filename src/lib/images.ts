/**
 * URLs de imagen de TCGdex.
 *
 * TCGdex devuelve las rutas SIN extensión (`.../me05/001`) y hay que elegir
 * calidad y formato al pedirla. Para cartas: `/low.webp` o `/high.webp`.
 * Para logos de set: `.webp` directamente.
 *
 * Las cartas japonesas no tienen imagen en TCGdex, así que ahí el campo viene
 * a null y se pinta un hueco.
 */

export const cardThumb = (image: string) => `${image}/low.webp`
export const cardFull = (image: string) => `${image}/high.webp`
export const setLogo = (logo: string) => `${logo}.webp`

/**
 * Marca del set para el índice: el logo si lo hay, y si no el símbolo.
 *
 * Bastantes sets antiguos no tienen logo en TCGdex pero sí símbolo (el iconito
 * de la expansión). Es peor marca que el logo, pero mucho mejor que un hueco.
 */
export function setMark(e: { logo: string | null; symbol: string | null }) {
  if (e.logo) return { src: `${e.logo}.webp`, tipo: 'logo' as const }
  if (e.symbol) return { src: `${e.symbol}.webp`, tipo: 'symbol' as const }
  return null
}
