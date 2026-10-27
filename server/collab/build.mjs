import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const schemaSource = process.env.VOEX_COLLAB_SCHEMA_SOURCE || fileURLToPath(new URL('../../web/packages/editor-schema/src/index.ts', import.meta.url));
if (!fs.existsSync(schemaSource)) throw new Error('Shared editor schema source not found');
const frontRoot = path.resolve(path.dirname(schemaSource), '../../..');
const resolvePM = createRequire(require.resolve('y-prosemirror'));
await build({
  entryPoints: { server: 'src/server.ts', 'editor-schema': schemaSource },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  sourcemap: false,
  legalComments: 'eof',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [{
    name: 'shared-editor-schema',
    setup(builder) {
      builder.onResolve({ filter: /^@voex\/editor-schema$/ }, () => ({ path: schemaSource }));
      builder.onResolve({ filter: /^@voex\/editor-schema\// }, ({ path: id }) => ({
        path: path.join(path.dirname(schemaSource), id.slice('@voex/editor-schema/'.length) + '.ts'),
      }));
      builder.onResolve({ filter: /^@\// }, ({ path: id }) => ({ path: path.join(frontRoot, 'src', id.slice(2)) }));
      builder.onResolve({ filter: /^(prosemirror-(?:model|state|view|transform)|yjs)(\/.*)?$/ }, ({ path: id }) => ({
        path: id === 'yjs' ? require.resolve(id) : resolvePM.resolve(id),
      }));
    },
  }],
});
