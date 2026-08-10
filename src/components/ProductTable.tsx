import type { ProductRow } from '@/db/queries'
import { productUrl } from '@/lib/cardmarket'
import { cardThumb } from '@/lib/images'
import { eur } from '@/lib/format'

const Cell = ({ v, className }: { v: number | null; className?: string }) =>
  v == null ? <td className="nil">—</td> : <td className={className}>{eur(v)}</td>

export function ProductTable({
  rows,
  showSalesAverages,
  emptyLabel,
}: {
  rows: ProductRow[]
  /** Los sellados nunca traen avg7/avg30 en el price guide: ocultamos las columnas. */
  showSalesAverages: boolean
  emptyLabel: string
}) {
  if (!rows.length)
    return (
      <div className="empty">
        <strong>Nada que mostrar</strong>
        {emptyLabel}
      </div>
    )

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Trend</th>
            <th>Media</th>
            <th>Mínimo</th>
            {showSalesAverages && (
              <>
                <th>Vendido 7d</th>
                <th>Vendido 30d</th>
              </>
            )}
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
                    {p.category_name && <span className="cat">{p.category_name}</span>}
                  </span>
                </div>
              </td>
              <Cell v={p.trend} className="trend" />
              <Cell v={p.avg} />
              <Cell v={p.low} />
              {showSalesAverages && (
                <>
                  <Cell v={p.avg7} />
                  <Cell v={p.avg30} />
                </>
              )}
              <td>
                <a
                  className="cm"
                  href={productUrl(p.id_product)}
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
  )
}
