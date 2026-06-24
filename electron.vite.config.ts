import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        __API_SYNC_ENABLED__: JSON.stringify(env.API_SYNC_ENABLED ?? 'false'),
        __API_SYNC_URL__: JSON.stringify(env.API_SYNC_URL ?? ''),
        __API_SYNC_TOKEN__: JSON.stringify(env.API_SYNC_TOKEN ?? '')
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          output: {
            format: 'cjs',
            entryFileNames: 'index.cjs'
          }
        }
      }
    },
    renderer: {
      base: './',
      plugins: [react()],
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('shared')
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (
                id.includes('node_modules/react-dom') ||
                id.includes('node_modules/react/') ||
                id.includes('node_modules/scheduler')
              ) {
                return 'react-vendor'
              }
              if (id.includes('node_modules/react-router')) return 'router'
              if (id.includes('node_modules/zustand')) return 'zustand'
            }
          }
        }
      }
    }
  }
})
