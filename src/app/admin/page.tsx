import { notFound } from 'next/navigation'
import { adminEnabled, isAdmin } from '@/lib/admin'
import { getAdminOverview, listBackfillPending, listRuns, listUnmapped } from '@/db/queries'
import { eur, fechaCorta, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

function Coverage({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total ? Math.round((100 * done) / total) : 0
  return (
    <div className="cover-row">
      <span>{label}</span>
      <span className="cover-track">
        <span className="bar">
          <span className="bar-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="bar-pct">{pct}%</span>
      </span>
      <b>
        {num(done)} / {num(total)}
      </b>
    </div>
  )
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!adminEnabled()) notFound()

  if (!(await isAdmin())) {
    const { error } = await searchParams
    return (
      <div className="login">
        <h1>Panel privado</h1>
        <p className="hint-sm">Acceso restringido.</p>
        <form method="post" action="/api/admin/login">
          <label htmlFor="token" className="sr-only">
            Token de acceso
          </label>
          <input id="token" type="password" name="token" placeholder="Token" autoFocus />
          <button type="submit">Entrar</button>
        </form>
        {error && <p className="err">Token incorrecto.</p>}
      </div>
    )
  }

  const o = getAdminOverview()
  const unmapped = listUnmapped(30)
  const pending = listBackfillPending(30)
  const runs = listRuns(8)

  return (
    <>
      <div className="page-head">
        <h1>Panel</h1>
        <p className="lede">Estado del catálogo y lo que falta por meter.</p>
        <div className="meta-line">
          <span>
            <b>{num(o.history)}</b> puntos de histórico
          </span>
          <span className="sep">/</span>
          <span>
            <b>{num(o.history_days)}</b> días registrados
          </span>
          <span className="sep">/</span>
          <span>
            <b>{num(o.products)}</b> productos
          </span>
        </div>
      </div>

      <h2 className="section">Cobertura</h2>
      <div className="cover">
        <Coverage label="Expansiones identificadas" done={o.mapped} total={o.expansions} />
        <Coverage
          label="Expansiones reales identificadas"
          done={o.main_mapped}
          total={o.main}
        />
        <Coverage label="Productos en un set con nombre" done={o.products_in_named} total={o.products} />
        <Coverage label="Cartas con imagen" done={o.with_image} total={o.singles} />
        <Coverage label="Sets con imágenes descargadas" done={o.backfilled} total={o.mapped} />
        <Coverage label="Sets japoneses con nombre inglés" done={o.with_english} total={o.japanese} />
      </div>

      <h2 className="section">Qué son las {num(o.expansions)} expansiones de Cardmarket</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Clase</th>
              <th style={{ textAlign: 'left' }}>Qué es</th>
              <th>Cuántas</th>
              <th>Identificadas</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['main', 'Expansiones de verdad — se venden en sobres', o.main, o.main_mapped],
              ['promo', 'Promos, mazos y colecciones', o.promo, o.promo_mapped],
              ['energy', 'Sets de energías', o.energy, 0],
              ['sealed-only', 'Solo sellado: monedas, lotes, tins', o.sealed_only, 0],
              ['minor', 'Menos de 20 cartas', o.minor, 0],
            ].map(([kind, desc, n, mapped]) => (
              <tr key={String(kind)}>
                <td>{kind}</td>
                <td style={{ textAlign: 'left' }}>{desc}</td>
                <td>{num(Number(n))}</td>
                <td>{mapped ? num(Number(mapped)) : <span className="nil">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Cardmarket no distingue set de agrupación. La clase se deduce del catálogo: una expansión de
        verdad tiene sobre o display propio. <code>npm run classify</code>
      </p>

      <h2 className="section">Últimas ingestas</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Volcado</th>
              <th style={{ textAlign: 'left' }}>Estado</th>
              <th>Productos</th>
              <th>Precios</th>
              <th>Cambios</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.source_created_at?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                <td style={{ textAlign: 'left' }}>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                </td>
                <td>{r.products_upserted ? num(r.products_upserted) : <span className="nil">—</span>}</td>
                <td>{r.prices_upserted ? num(r.prices_upserted) : <span className="nil">—</span>}</td>
                <td>{r.history_rows ? num(r.history_rows) : <span className="nil">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section">Pendiente de imágenes</h2>
      {pending.length === 0 ? (
        <div className="empty">
          <strong>Nada pendiente</strong>
          Todos los sets identificados tienen sus imágenes descargadas.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Set</th>
                <th style={{ textAlign: 'left' }}>Idioma</th>
                <th>Salida</th>
                <th>Cartas</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.tcgdex_set_id}>
                  <td>
                    {p.name_en ?? p.name}
                    <span className="cat">{p.tcgdex_set_id}</span>
                  </td>
                  <td style={{ textAlign: 'left' }}>{p.lang ?? '—'}</td>
                  <td>{fechaCorta(p.release_date) ?? '—'}</td>
                  <td>{num(p.products)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">
        <code>npm run backfill-images -- all</code>
      </p>

      <h2 className="section">Expansiones reales sin identificar ({num(o.main - o.main_mapped)})</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        Tienen sobre propio, así que son sets de verdad, pero TCGdex no las enlaza con Cardmarket.
        Buena parte son chinas —sin puente posible— y el resto, japonesas que TCGdex no cubre.
        Ordenadas por volumen.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Ejemplo de producto</th>
              <th>ID</th>
              <th>Productos</th>
              <th>Sellados</th>
              <th>Más caro</th>
            </tr>
          </thead>
          <tbody>
            {unmapped.map((u) => (
              <tr key={u.id_expansion}>
                <td>
                  <a href={`/sets/${u.id_expansion}`}>{u.sample}</a>
                </td>
                <td>{u.id_expansion}</td>
                <td>{num(u.products)}</td>
                <td>{num(u.sealed)}</td>
                <td>{u.top_trend ? eur(u.top_trend) : <span className="nil">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
