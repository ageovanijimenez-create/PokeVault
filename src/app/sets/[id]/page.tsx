import { notFound } from 'next/navigation'
import { getExpansion, getProducts } from '@/db/queries'
import { ProductTable } from '@/components/ProductTable'
import { fecha, num, setName } from '@/lib/format'
import { setMark } from '@/lib/images'

export const dynamic = 'force-dynamic'

export default async function SetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ver?: string }>
}) {
  const { id } = await params
  const { ver } = await searchParams

  const expansion = getExpansion(Number(id))
  if (!expansion) notFound()

  const viendoSellados = ver !== 'cartas'
  const rows = getProducts(expansion.id_expansion, viendoSellados)
  const nombre = setName(expansion)

  return (
    <>
      <div style={{ paddingTop: 22 }}>
        <a className="back" href="/">
          ← Todos los sets
        </a>
      </div>

      <div className="set-head">
        {(() => {
          const marca = setMark(expansion)
          return marca ? <img className={`set-logo ${marca.tipo}`} src={marca.src} alt="" /> : null
        })()}
        <div>
          <h1>{nombre.main}</h1>
          <div className="sub">
            {[
              nombre.alt,
              expansion.serie,
              fecha(expansion.release_date),
              `${num(expansion.singles)} cartas`,
              `${num(expansion.sealed)} sellados`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>

      <div className="tabs">
        <a className={`tab ${viendoSellados ? 'on' : ''}`} href={`/sets/${id}`}>
          Sellados ({num(expansion.sealed)})
        </a>
        <a className={`tab ${viendoSellados ? '' : 'on'}`} href={`/sets/${id}?ver=cartas`}>
          Cartas ({num(expansion.singles)})
        </a>
      </div>

      {viendoSellados && (
        <div className="note">
          Cardmarket no publica medias de venta para producto sellado: solo <b>trend</b>, media y
          mínimo. La evolución en el tiempo la construye PokeVault guardando una foto diaria.
        </div>
      )}

      <ProductTable
        rows={rows}
        showSalesAverages={!viendoSellados}
        emptyLabel={
          viendoSellados
            ? 'Este set no tiene producto sellado en Cardmarket.'
            : 'Este set no tiene cartas sueltas en Cardmarket.'
        }
      />
    </>
  )
}
