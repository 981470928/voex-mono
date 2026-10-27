import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const svgDirectory = fileURLToPath(new URL('../src/assets/svg/', import.meta.url));

async function findIcons(directory = svgDirectory) {
  const icons = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      icons.push(...(await findIcons(filePath)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.svg') {
      icons.push(filePath);
    }
  }

  return icons.sort();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
}

async function renderPage() {
  const files = await findIcons();
  const groups = await Promise.all(
    files.map(async (filePath) => {
      const name = relative(svgDirectory, filePath).split(sep).join('/');
      const content = await readFile(filePath, 'utf8');
      const symbols = [...content.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol\s*>/gi)];
      if (!symbols.length) return [{ name, content }];

      // Sprite source files contain definitions, each symbol needs its own SVG viewport.
      return symbols.map((symbol, index) => {
        const id = symbol[1].match(/\bid\s*=\s*(["'])(.*?)\1/i)?.[2] || String(index + 1);
        const attributes = symbol[1].replace(/\sxmlns\s*=\s*(["']).*?\1/gi, '');
        return {
          name: name + '#' + id,
          content: `<svg xmlns="http://www.w3.org/2000/svg"${attributes}>${symbol[2]}</svg>`,
        };
      });
    })
  );
  const icons = groups.flat();
  const cards = icons.map((icon) => {
    const name = escapeHtml(icon.name);
    // Each SVG is an isolated image, so its styles and IDs cannot affect other icons.
    const source = Buffer.from(icon.content).toString('base64');
    return `<li class="icon-preview__card" data-name="${name}">
        <div class="icon-preview__image-wrap">
          <img class="icon-preview__image" src="data:image/svg+xml;base64,${source}"
            alt="" width="32" height="32" decoding="async">
        </div>
        <code class="icon-preview__name">${name}</code>
      </li>`;
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SVG 图标预览 · Voex</title>
  <style>
    /* Standalone preview: use the project's light palette without a build step. */
    :root {
      color-scheme: light;
      --preview-background: #f5f5f5;
      --preview-surface: #ffffff;
      --preview-text: #1a1a1a;
      --preview-muted: #666666;
      --preview-border: #dcdcdc;
      --preview-accent: #0066cc;
      --preview-icon-size: 32px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', Arial, sans-serif;
      color: var(--preview-text);
      background: var(--preview-background);
      scrollbar-color: var(--preview-muted) var(--preview-background);
      scrollbar-gutter: stable;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    [hidden] { display: none !important; }
    button, input { font: inherit; }
    button, input[type="range"] { cursor: pointer; }
    :focus-visible { outline: 2px solid var(--preview-accent); outline-offset: 3px; }
    .icon-preview { max-width: 1480px; margin: 0 auto; padding: 36px; }
    .icon-preview__title { margin: 0 0 8px; font-size: 22px; font-weight: 600; }
    .icon-preview__description { margin: 0; color: var(--preview-muted); font-size: 14px; line-height: 1.8; }
    .icon-preview__toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 24px; margin: 28px 0 16px; }
    .icon-preview__search { flex: 1 1 280px; }
    .icon-preview__label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
    .icon-preview__search-control { display: flex; gap: 8px; }
    .icon-preview__input {
      min-width: 0; width: 100%; height: 44px; padding: 0 12px;
      border: 1px solid var(--preview-border); border-radius: 6px;
      background: var(--preview-surface); color: var(--preview-text);
    }
    .icon-preview__input::placeholder { color: var(--preview-muted); }
    .icon-preview__clear {
      flex: 0 0 60px; height: 44px; border: 1px solid var(--preview-border);
      border-radius: 6px; color: var(--preview-text); background: var(--preview-surface);
    }
    .icon-preview__clear:hover:not(:disabled) { border-color: var(--preview-accent); color: var(--preview-accent); }
    .icon-preview__clear:active:not(:disabled) { background: var(--preview-background); }
    .icon-preview__clear:disabled { opacity: 0.5; cursor: default; }
    .icon-preview__size { flex: 0 1 220px; }
    .icon-preview__range { width: 100%; height: 44px; margin: 0; accent-color: var(--preview-accent); }
    .icon-preview__count { color: var(--preview-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .icon-preview__grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px; padding: 0; margin: 16px 0; list-style: none;
    }
    .icon-preview__card {
      min-width: 0; padding: 16px 12px; border: 1px solid var(--preview-border);
      border-radius: 8px; background: var(--preview-surface); text-align: center;
    }
    .icon-preview__image-wrap { height: 88px; display: grid; place-items: center; }
    .icon-preview__image { width: var(--preview-icon-size); height: var(--preview-icon-size); object-fit: contain; }
    .icon-preview__name { display: block; margin-top: 12px; font: 12px/1.6 Consolas, monospace; overflow-wrap: anywhere; }
    .icon-preview__empty { padding: 64px 16px; color: var(--preview-muted); text-align: center; }
    @media (max-width: 600px) {
      .icon-preview { padding: 24px 16px; }
      .icon-preview__toolbar { gap: 16px; }
      .icon-preview__size { flex-basis: 100%; }
      .icon-preview__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (forced-colors: active) { :root { scrollbar-color: auto; } }
  </style>
</head>
<body>
  <main class="icon-preview">
    <h1 class="icon-preview__title">SVG 图标预览</h1>
    <p class="icon-preview__description"><code>src/assets/svg/</code> · 图标变更后刷新页面即可更新。</p>
    <div class="icon-preview__toolbar">
      <div class="icon-preview__search">
        <label class="icon-preview__label" for="search">搜索图标</label>
        <div class="icon-preview__search-control">
          <input class="icon-preview__input" id="search" type="search" placeholder="输入文件名或子目录，例如 chat"
            autocomplete="off" spellcheck="false" aria-controls="icons">
          <button class="icon-preview__clear" id="clear" type="button" aria-label="清空搜索" disabled>清空</button>
        </div>
      </div>
      <div class="icon-preview__size">
        <label class="icon-preview__label" for="size">预览尺寸 <output id="size-value" for="size">32 px</output></label>
        <input class="icon-preview__range" id="size" type="range" min="16" max="80" step="4" value="32">
      </div>
    </div>
    <p class="icon-preview__count" id="count" role="status">共 ${icons.length} 个图标</p>
    <ul class="icon-preview__grid" id="icons">${cards.join('\n')}</ul>
    <p class="icon-preview__empty" id="empty" ${icons.length ? 'hidden' : ''}>目录中没有 SVG 图标，添加后刷新页面。</p>
  </main>
  <script>
    const search = document.getElementById('search');
    const clear = document.getElementById('clear');
    const cards = Array.from(document.querySelectorAll('[data-name]'));
    const count = document.getElementById('count');
    const empty = document.getElementById('empty');
    const size = document.getElementById('size');

    function filterIcons() {
      const query = search.value.trim().toLowerCase();
      let visible = 0;
      for (const card of cards) {
        card.hidden = !card.dataset.name.toLowerCase().includes(query);
        if (!card.hidden) visible += 1;
      }
      count.textContent = '显示 ' + visible + ' / ' + cards.length + ' 个图标';
      empty.hidden = visible > 0;
      empty.textContent = cards.length
        ? '没有匹配的图标，请修改关键词或清空搜索。'
        : '目录中没有 SVG 图标，添加后刷新页面。';
      clear.disabled = search.value.length === 0;
      const url = new URL(location.href);
      if (search.value) url.searchParams.set('q', search.value);
      else url.searchParams.delete('q');
      history.replaceState(null, '', url);
    }

    search.value = new URLSearchParams(location.search).get('q') || '';
    search.addEventListener('input', (event) => {
      if (!event.isComposing) filterIcons();
    });
    search.addEventListener('compositionend', filterIcons);
    clear.addEventListener('click', () => {
      search.value = '';
      filterIcons();
      search.focus();
    });
    size.addEventListener('input', () => {
      document.documentElement.style.setProperty('--preview-icon-size', size.value + 'px');
      document.getElementById('size-value').textContent = size.value + ' px';
    });
    for (const card of cards) {
      const image = card.querySelector('img');
      const showError = () => { image.parentElement.textContent = 'SVG 无法显示'; };
      image.addEventListener('error', showError);
      if (image.complete && !image.naturalWidth) showError();
    }
    filterIcons();
  </script>
</body>
</html>`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '4174' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      '用法: pnpm preview:svg [--port 4174]\n刷新页面会重新扫描 src/assets/svg/（包含子目录）。'
    );
    return;
  }

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port 必须是 1 到 65535 之间的整数');
  }
  // Fail before listening if the source directory cannot be read.
  const icons = await findIcons();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = request.url?.split('?')[0];
    if (pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    if (pathname !== '/' && pathname !== '/index.html') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('页面不存在');
      return;
    }

    try {
      const html = await renderPage();
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : html);
    } catch (error) {
      console.error('生成 SVG 预览失败:', error.message);
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('生成预览失败，请检查终端中的文件读取错误，修复后刷新页面。');
    }
  });
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `端口 ${port} 已占用，请使用 pnpm preview:svg --port ${port === 65535 ? 4174 : port + 1}`
        : error.message
    );
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(
      `SVG 预览: http://127.0.0.1:${port}\n已检索 ${icons.length} 个 SVG 文件，按 Ctrl+C 停止。`
    );
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
