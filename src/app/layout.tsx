import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PokeVault — precios Pokémon TCG en Europa',
  description:
    'Catálogo completo de cartas y productos sellados de Pokémon TCG con precios europeos en euros, set a set.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="top">
          <div className="wrap inner">
            <a href="/" className="brand">
              Poke<span>Vault</span>
            </a>
            <form className="search" action="/buscar" role="search">
              <label htmlFor="q" className="sr-only">
                Buscar carta o producto
              </label>
              <input
                id="q"
                name="q"
                type="search"
                placeholder="Buscar carta o producto…"
                autoComplete="off"
              />
            </form>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <div className="wrap">
          <footer className="bottom">
            Precios de Cardmarket · catálogo e imágenes de TCGdex.
            <br />
            Proyecto independiente, sin relación con Nintendo, The Pokémon Company ni Cardmarket.
          </footer>
        </div>
      </body>
    </html>
  )
}
