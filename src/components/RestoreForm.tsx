'use client'

import { useRef, useState } from 'react'

type Estado =
  | { fase: 'reposo' }
  | { fase: 'subiendo'; pct: number }
  | { fase: 'ok'; productos: number; precios: number }
  | { fase: 'error'; mensaje: string }

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function RestoreForm({ pendiente }: { pendiente: { bytes: number } | null }) {
  const input = useRef<HTMLInputElement>(null)
  const [fichero, setFichero] = useState<File | null>(null)
  const [estado, setEstado] = useState<Estado>({ fase: 'reposo' })

  const subiendo = estado.fase === 'subiendo'

  function subir() {
    if (!fichero) return

    const datos = new FormData()
    datos.append('db', fichero)

    // XHR y no fetch: fetch no informa del progreso de subida, y con 26 MB
    // por una conexión doméstica hace falta ver que avanza.
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/restore')

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setEstado({ fase: 'subiendo', pct: Math.round((100 * e.loaded) / e.total) })
      }
    }

    xhr.onload = () => {
      try {
        const r = JSON.parse(xhr.responseText)
        if (xhr.status === 200 && r.ok) {
          setEstado({ fase: 'ok', productos: r.productos, precios: r.precios })
        } else {
          setEstado({ fase: 'error', mensaje: r.error ?? `Error ${xhr.status}` })
        }
      } catch {
        setEstado({ fase: 'error', mensaje: `Respuesta inesperada (${xhr.status})` })
      }
    }

    xhr.onerror = () =>
      setEstado({ fase: 'error', mensaje: 'Se cortó la conexión durante la subida' })

    setEstado({ fase: 'subiendo', pct: 0 })
    xhr.send(datos)
  }

  return (
    <div className="restore">
      {pendiente && estado.fase !== 'ok' && (
        <p className="restore-pend">
          Hay una base de {mb(pendiente.bytes)} esperando. <b>Reinicia el servicio</b> para que se
          coloque en su sitio.
        </p>
      )}

      <div className="restore-row">
        <input
          ref={input}
          type="file"
          accept=".sqlite,.gz,.db,application/gzip,application/octet-stream"
          disabled={subiendo}
          onChange={(e) => {
            setFichero(e.target.files?.[0] ?? null)
            setEstado({ fase: 'reposo' })
          }}
        />
        <button type="button" onClick={subir} disabled={!fichero || subiendo}>
          {subiendo ? 'Subiendo…' : 'Subir base'}
        </button>
      </div>

      {fichero && estado.fase === 'reposo' && (
        <p className="restore-note">
          {fichero.name} · {mb(fichero.size)}
        </p>
      )}

      {subiendo && (
        <div className="cover-track" style={{ marginTop: 10 }}>
          <span className="bar">
            <span className="bar-fill" style={{ width: `${estado.pct}%` }} />
          </span>
          <span className="bar-pct">{estado.pct}%</span>
        </div>
      )}

      {estado.fase === 'ok' && (
        <p className="restore-ok">
          Recibida y validada: {estado.productos.toLocaleString('es')} productos y{' '}
          {estado.precios.toLocaleString('es')} precios. <b>Ahora reinicia el servicio</b> — la base
          se cambia al arrancar, no en caliente.
        </p>
      )}

      {estado.fase === 'error' && <p className="restore-err">{estado.mensaje}</p>}
    </div>
  )
}
