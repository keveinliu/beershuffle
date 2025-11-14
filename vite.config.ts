import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.BACKEND_PORT || env.VITE_BACKEND_PORT || process.env.BACKEND_PORT || '3001'
  const target = `http://localhost:${backendPort}`
  return {
    build: {
      sourcemap: 'hidden',
    },
    server: {
      proxy: {
        '/api': { target, changeOrigin: true },
        '/data': { target, changeOrigin: true },
        '/images': { target, changeOrigin: true },
      },
    },
    plugins: [
      react({
        babel: {
          plugins: [
            'react-dev-locator',
          ],
        },
      }),
      traeBadgePlugin({
        variant: 'dark',
        position: 'bottom-right',
        prodOnly: true,
        clickable: true,
        clickUrl: 'https://www.trae.ai/solo?showJoin=1',
        autoTheme: true,
        autoThemeTarget: '#root'
    }), 
    tsconfigPaths()
    ],
  }
})
