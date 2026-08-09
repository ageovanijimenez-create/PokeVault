import { searchProducts } from '@/db/queries'
import { productUrl } from '@/lib/cardmarket'
import { cardThumb } from '@/lib/images'
import { eur, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

const LIMIT = 60

export default async function Buscar({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  const term = (q ?? '').trim()
  const rows = term.length >= 2 ? searchProducts(term, LIMIT) : []

  return (
    <>
      <div style={{ paddingTop: 22 }}>
        <a className="back" href="/">
          ← Todos los sets
        </a>
      </div>

      <div className="page-head" style={{ paddingTop: 18 }}>
        <h1>{term ? term : 'Buscar'}</h1>
        <div className="meta-line">
          {term.length < 2 ? (
            <span>Escribe al menos dos caracteres.</span>
          ) : rows.length ? (
            <span>
              <b>{num(rows.length)}</b> resultados
              {rows.length === LIMIT && ' (recortado)'}
            </span>
          ) : (
            <span>Sin resultados.</span>
          )}
        </div>
      </div>

      {term.length >= 2 && rows.length === 0 && (
        <div className="empty" style={{ marginTop: 24 }}>
          <strong>Nada coincide con «{term}»</strong>
          Prueba con el nombre en inglés: el catálogo usa los nombres de Cardmarket.
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 20 }}>
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th style={{ textAlign: 'left' }}>Set</th>
                <th>Trend</th>
                <th>Media</th>
                <th>Mínimo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id_product}>
                  <td>
                    <div className="prod">
                      {p.image ? (
                        <img className="thumb" src={cardThumb(p.image)} alt="" loading="lazy" />
                      ) : (
                        <span className="thumb ph" />
                      )}
                      <span>
                        {p.name}
                        <span className="cat">{p.category_name}</span>
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    {/* Las expansiones que no hemos podido identificar no
                        enseñan su id crudo: no le dice nada a nadie. */}
                    {p.tcgdex_set_id ? (
                      <a href={`/sets/${p.id_expansion}`} className="back">
                        {p.expansion_name}
                      </a>
                    ) : (
                      <span className="nil">Sin catalogar</span>
                    )}
                  </td>
                  <td className="trend">{eur(p.trend)}</td>
                  <td>{eur(p.avg)}</td>
                  <td>{eur(p.low)}</td>
                  <td>
                    <a
                      className="cm"
                      href={productUrl(p.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Cardmarket ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
