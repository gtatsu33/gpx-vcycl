import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { cloudflare } from '@cloudflare/vite-plugin'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // vitest（VITEST env var）実行時は Cloudflare プラグインを外す
  // （workerd向けの変換がテスト実行と噛み合わないため）
  plugins: process.env.VITEST ? [] : [cloudflare()],
  preview: {
    host: true,
  },
  test: {
    environment: 'node',
  },
})