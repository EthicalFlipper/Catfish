import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'fs'
import { build } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'build-content-scripts',
      async writeBundle() {
        // Copy manifest.json to dist
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json')
        )
        
        // Build content script separately as IIFE
        await build({
          configFile: false,
          build: {
            emptyOutDir: false,
            outDir: resolve(__dirname, 'dist/content'),
            lib: {
              entry: resolve(__dirname, 'src/content/tinder.ts'),
              name: 'CatfishTinder',
              formats: ['iife'],
              fileName: () => 'tinder.js',
            },
            rollupOptions: {
              output: {
                extend: true,
              },
            },
          },
        })
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js'
          }
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
