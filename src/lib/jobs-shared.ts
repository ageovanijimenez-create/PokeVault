/**
 * Nombres y etiquetas de las tareas, sin ninguna dependencia del servidor.
 *
 * Va aparte de `jobs.ts` a propósito: el panel es un componente de cliente, y
 * si importara de `jobs.ts` se traería `better-sqlite3` —un binario nativo— al
 * bundle del navegador.
 */

export const JOB_NAMES = [
  'ingest',
  'map-sets',
  'refresh-sets',
  'names-en',
  'classify',
  'backfill-images',
  'mantenimiento',
] as const

export type JobName = (typeof JOB_NAMES)[number]

export const JOB_LABELS: Record<JobName, string> = {
  ingest: 'Actualizar precios',
  'map-sets': 'Identificar expansiones',
  'refresh-sets': 'Refrescar logos y datos de set',
  'names-en': 'Nombres japoneses en inglés',
  classify: 'Clasificar expansiones',
  'backfill-images': 'Descargar imágenes',
  mantenimiento: 'Mantenimiento completo',
}

export interface JobRow {
  id: number
  name: string
  started_at: string
  finished_at: string | null
  status: string
  detail: string | null
  error: string | null
  trigger: string | null
}
