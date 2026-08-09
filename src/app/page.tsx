import { getStats, listExpansions } from '@/db/queries'
import { eur, fechaCorta, num, setName } from '@/lib/format'
import { setLogo } from '@/lib/images'

export const dynamic = 'force-dynamic'

export default function Home() {
  const stats = getStats()
  // Ya vienen filtrados a occidente + Japón: ver listExpansions().
  const sets = listExpansions()

  return (
    <>
      <div className="page-head">
        <h1>Precios de Pokémon TCG en Europa</h1>
        <p className="lede">
          Cartas y producto sellado, set a set, con el precio de mercado de Cardmarket en euros.
        </p>
        <div className="meta-line">
          <span>
            <b>{num(sets.length)}</b> sets
          </span>
          <span className="sep">/</span>
          <span>
            <b>{num(stats.singles)}</b> cartas
          </span>
          <span className="sep">/</span>
          <span>
            <b>{num(stats.sealed)}</b> sellados
          </span>
          <span className="sep">/</span>
          <span>
            actualizado <b>{stats.updated_at ? fechaCorta(stats.updated_at) : '—'}</b>
          </span>
        </div>
      </div>

      {sets.length === 0 ? (
        <div className="empty" style={{ marginTop: 24 }}>
          <strong>Todavía no hay catálogo</strong>
          Lanza <code>npm run ingest</code> y después <code>npm run map-sets</code>.
        </div>
      ) : (
        <div className="index" style={{ marginTop: 20 }}>
          <div className="index-head">
            <span />
            <span>Set</span>
            <span className="col-serie">Serie</span>
            <span className="col-date num">Salida</span>
            <span className="col-singles num">Cartas</span>
            <span className="col-sealed num">Sellados</span>
            <span className="num">Más caro</span>
          </div>

          {sets.map((e) => {
            const n = setName(e)
            return (
              <a className="set-row" key={e.id_expansion} href={`/sets/${e.id_expansion}`}>
                <span className="set-mark">
                  {e.logo ? (
                    <img src={setLogo(e.logo)} alt="" loading="lazy" />
                  ) : (
                    <span className="void" />
                  )}
                </span>
                <span className="set-name">
                  {n.main}
                  {n.alt && <span className="native">{n.alt}</span>}
                </span>
                <span className="col-serie">{e.serie ?? '—'}</span>
                <span className="col-date num">{fechaCorta(e.release_date) ?? '—'}</span>
                <span className="col-singles num">{num(e.singles)}</span>
                <span className="col-sealed num">{num(e.sealed)}</span>
                <span className="num strong">{e.top_trend ? eur(e.top_trend) : '—'}</span>
              </a>
            )
          })}
        </div>
      )}
    </>
  )
}
