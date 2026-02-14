import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, existsSync } from 'fs'
import { build } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'build-extension-scripts',
      async writeBundle() {
        // Copy manifest.json to dist
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json')
        )
        
        // Copy offscreen.html from public to dist
        const offscreenSrc = resolve(__dirname, 'public/offscreen.html')
        if (existsSync(offscreenSrc)) {
          copyFileSync(offscreenSrc, resolve(__dirname, 'dist/offscreen.html'))
        }
        
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
        
        // Build offscreen script separately as IIFE
        await build({
          configFile: false,
          build: {
            emptyOutDir: false,
            outDir: resolve(__dirname, 'dist'),
            lib: {
              entry: resolve(__dirname, 'src/offscreen/offscreen.ts'),
              name: 'CatfishOffscreen',
              formats: ['iife'],
              fileName: () => 'offscreen.js',
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
