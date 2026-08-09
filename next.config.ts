import type { NextConfig } from 'next'

const config: NextConfig = {
  // better-sqlite3 es un binario nativo: Next no debe intentar empaquetarlo.
  serverExternalPackages: ['better-sqlite3'],
}

export default config
