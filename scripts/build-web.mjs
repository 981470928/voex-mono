import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { ROOT, LOCAL } from './common.mjs';

const outDir = process.env.VOEX_BUILD_WEB_ROOT;
if (!outDir || !path.resolve(outDir).startsWith(path.join(LOCAL, 'releases') + path.sep))
  throw new Error('构建输出必须位于 .voex/releases/ 内。');
const web = path.join(ROOT, 'web');
const require = createRequire(path.join(web, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
await build({ root: web, configFile: path.join(web, 'vite.config.ts'), base: '/app/', build: { outDir, emptyOutDir: true, reportCompressedSize: false } });
