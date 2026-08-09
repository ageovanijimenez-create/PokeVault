'use client'

import { useCallback, useEffect, useState } from 'react'
import { JOB_LABELS, type JobName, type JobRow } from '@/lib/jobs-shared'

/** Orden en que se ofrecen: primero lo que se usa, luego las piezas sueltas. */
const BOTONES: JobName[] = [
  'mantenimiento',
  'ingest',
  'map-sets',
  'names-en',
  'classify',
  'backfill-images',
]

const hace = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'hace un momento'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return `hace ${Math.round(s / 86400)} d`
}

export function JobsPanel({ inicial }: { inicial: JobRow[] }) {
  const [tareas, setTareas] = useState<JobRow[]>(inicial)
  const [enCurso, setEnCurso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refrescar = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/jobs', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setTareas(d.tareas)
      setEnCurso(d.enCurso)
    } catch {
      /* si falla una consulta de estado, ya lo cogerá la siguiente */
    }
  }, [])

  // Mientras algo corre miramos a menudo; en reposo, de vez en cuando.
  useEffect(() => {
    void refrescar()
    const id = setInterval(refrescar, enCurso ? 2000 : 20000)
    return () => clearInterval(id)
  }, [refrescar, enCurso])

  async function lanzar(name: JobName) {
    setError(null)
    setEnCurso(name) // respuesta inmediata, aunque el servidor tarde en confirmar
    try {
      const r = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json()
      if (!r.ok) {
        setError(d.error ?? `Error ${r.status}`)
        setEnCurso(null)
      }
      void refrescar()
    } catch {
      setError('No se pudo contactar con el servidor')
      setEnCurso(null)
    }
  }

  return (
    <div className="jobs">
      <div className="jobs-buttons">
        {BOTONES.map((n) => (
          <button
            key={n}
            type="button"
            className={n === 'mantenimiento' ? 'primary' : ''}
            disabled={!!enCurso}
            onClick={() => lanzar(n)}
          >
            {enCurso === n ? 'En marcha…' : JOB_LABELS[n]}
          </button>
        ))}
      </div>

      {error && <p className="jobs-err">{error}</p>}

      {tareas.length === 0 ? (
        <p className="hint" style={{ marginTop: 14 }}>
          Todavía no se ha lanzado ninguna tarea.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Tarea</th>
                <th style={{ textAlign: 'left' }}>Estado</th>
                <th style={{ textAlign: 'left' }}>Detalle</th>
                <th>Cuándo</th>
              </tr>
            </thead>
            <tbody>
              {tareas.map((t) => (
                <tr key={t.id}>
                  <td>
                    {JOB_LABELS[t.name as JobName] ?? t.name}
                    {t.trigger === 'auto' && <span className="cat">automática</span>}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <span className={`pill ${t.status}`}>{t.status}</span>
                  </td>
                  <td style={{ textAlign: 'left' }} className="jobs-detail">
                    {t.error ?? t.detail ?? '—'}
                  </td>
                  <td>{hace(t.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
