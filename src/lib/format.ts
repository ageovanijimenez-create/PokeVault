const EUR = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
})
const NUM = new Intl.NumberFormat('es-ES')

export const eur = (v: number | null | undefined) => (v == null ? '—' : EUR.format(v))
export const num = (v: number | null | undefined) => (v == null ? '—' : NUM.format(v))

/**
 * Nombre a mostrar de un set. Los japoneses se enseñan con su nombre oficial
 * en inglés (el que usa la gente: "Inferno X", no "インフェルノX") y el
 * original queda debajo como referencia.
 */
export const setName = (e: { name: string; name_en: string | null }) =>
  e.name_en ? { main: e.name_en, alt: e.name } : { main: e.name, alt: null }

export const fecha = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Fecha compacta para columnas de tabla: "jul 2026". */
export const fechaCorta = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }).replace('.', '')
}
