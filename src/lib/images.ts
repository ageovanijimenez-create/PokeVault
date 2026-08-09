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
