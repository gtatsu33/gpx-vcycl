import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [],
  preview: {
    host: true,
  },
  test: {
    environment: 'node',
  },
})