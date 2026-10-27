import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { ROOT } from './common.mjs';

const outDir = process.env.VOEX_BUILD_WEB_ROOT;
if (!outDir) throw new Error('VOEX_BUILD_WEB_ROOT is required');
const resolved = path.resolve(outDir);
const root = path.resolve(ROOT);
if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('构建输出必须位于仓库目录内。');
const web = path.join(ROOT, 'web');
const require = createRequire(path.join(web, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
await build({
  root: web,
  configFile: path.join(web, 'vite.config.ts'),
  base: '/app/',
  logLevel: 'warn',
  build: { outDir: resolved, emptyOutDir: true, reportCompressedSize: false },
});
