import { defineConfig } from 'vite'

export default defineConfig({
  preview: {
    host: true,
  },
  test: {
    environment: 'node',
  },
})