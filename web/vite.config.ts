import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons';
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: env.VITE_BASE_PATH || '/app/',
    plugins: [
      vue(),
      vueDevTools(),
      createSvgIconsPlugin({
        iconDirs: [fileURLToPath(new URL('./src/assets/svg', import.meta.url))],
        symbolId: 'icon-[dir]-[name]',
        svgoOptions: {
          plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }],
        },
      }),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: Number(env.VITE_DEV_PORT || 3500),
      proxy: {
        '/api/collab/ws': {
          target: env.VITE_COLLAB_PROXY_TARGET || 'ws://127.0.0.1:8091',
          ws: true,
          // 保留浏览器原始 Host，协同服务据此与 Origin 比对同源。
          changeOrigin: false,
        },
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8090',
          changeOrigin: true,
        },
      },
    },
  };
});
