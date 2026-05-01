import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import fs from 'node:fs'
import path from 'node:path'

function loadMkcert() {
  const cert = path.resolve('certs/local.pem')
  const key  = path.resolve('certs/local-key.pem')
  if (fs.existsSync(cert) && fs.existsSync(key)) {
    return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) }
  }
  return null
}

// mode=https: HTTPS + LAN 公開（iPad/Bluefy 向け）
//   certs/ に mkcert 証明書があればそれを使用、なければ basicSsl の自己署名にフォールバック
// mode=development (デフォルト): HTTP localhost のみ → Chrome での SW 登録が通る
export default defineConfig(({ mode }) => {
  const isLan = mode === 'https'
  const mkcert = isLan ? loadMkcert() : null

  return {
    plugins: (isLan && !mkcert) ? [basicSsl()] : [],
    server: {
      host: isLan,
      https: mkcert ?? undefined,
    },
    preview: {
      host: true,
    },
    test: {
      environment: 'node',
    },
  }
})
