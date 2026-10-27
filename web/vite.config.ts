import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons';
// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  return {
    base: command === 'build' && mode === 'test' ? '/test/' : '/app/',
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
      port: 3500,
      proxy: {
        '/api/collab/ws': {
          target:
            process.env.VITE_COLLAB_PROXY_TARGET ||
            loadEnv(mode, process.cwd(), 'VITE_').VITE_COLLAB_PROXY_TARGET ||
            'ws://127.0.0.1:8091',
          ws: true,
          changeOrigin: true,
        },
        '/api': {
          target:
            process.env.VITE_API_PROXY_TARGET ||
            loadEnv(mode, process.cwd(), 'VITE_').VITE_API_PROXY_TARGET ||
            'http://127.0.0.1:8090',
          changeOrigin: true,
        },
      },
    },
  };
});
