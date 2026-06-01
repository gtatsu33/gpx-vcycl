import { defineConfig } from 'vite'

// mode=https: HTTPS + LAN 公開（iPad/Bluefy 向け）
// mode=development (デフォルト): HTTP localhost のみ
export default defineConfig(async ({ mode }) => {
  const isLan = mode === 'https'

  let plugins = []
  let serverHttps = undefined
  let serverHost = false

  if (isLan) {
    // 動的importでNode.js APIをLANモード時のみ読み込む
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl')

    const cert = path.resolve('certs/local.pem')
    const key  = path.resolve('certs/local-key.pem')

    if (fs.existsSync(cert) && fs.existsSync(key)) {
      serverHttps = {
        cert: fs.readFileSync(cert),
        key:  fs.readFileSync(key),
      }
    } else {
      plugins = [basicSsl()]
    }
    serverHost = true
  }

  return {
    plugins,
    server: {
      host: serverHost,
      https: serverHttps,
    },
    preview: {
      host: true,
    },
    test: {
      environment: 'node',
    },
  }
})