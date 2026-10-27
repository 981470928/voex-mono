import type { Mermaid, MermaidConfig } from 'mermaid';

let loading: Promise<Mermaid> | undefined;
let renderQueue: Promise<void> = Promise.resolve();
let renderId = 0;
const MAX_SOURCE_LENGTH = 50000;

function loadMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid')
    .then((module) => module.default)
    .catch(() => {
      loading = undefined;
      throw new Error('流程图渲染器加载失败，请重试');
    });
  return loading;
}

function readConfig(): MermaidConfig {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const themeVariables: Record<string, string | boolean> = {
    darkMode: root.dataset.theme === 'dark',
    fontFamily: styles.fontFamily,
  };
  const tokens: Record<string, string> = {
    background: '--color-bg-panel',
    primaryColor: '--color-accent-tint',
    primaryBorderColor: '--color-accent',
    primaryTextColor: '--color-text-primary',
    secondaryColor: '--color-bg-secondary',
    secondaryTextColor: '--color-text-primary',
    tertiaryColor: '--color-bg-tertiary',
    tertiaryTextColor: '--color-text-primary',
    lineColor: '--color-text-secondary',
    textColor: '--color-text-primary',
    edgeLabelBackground: '--color-bg-panel',
    clusterBkg: '--color-bg-secondary',
    clusterBorder: '--color-border-tertiary',
    titleColor: '--color-text-primary',
  };
  for (const [key, token] of Object.entries(tokens)) {
    const value = styles.getPropertyValue(token).trim();
    if (value) themeVariables[key] = value;
  }
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    theme: 'base',
    themeVariables,
    fontFamily: styles.fontFamily,
    layout: 'dagre',
    look: 'classic',
    maxTextSize: MAX_SOURCE_LENGTH,
    maxEdges: 500,
    flowchart: { useMaxWidth: true },
    // 源码中的 frontmatter / init 指令不能放宽安全设置或注入外部样式。
    secure: [
      'secure',
      'securityLevel',
      'startOnLoad',
      'maxTextSize',
      'maxEdges',
      'suppressErrorRendering',
      'htmlLabels',
      'dompurifyConfig',
      'theme',
      'themeVariables',
      'themeCSS',
      'fontFamily',
    ],
  };
}

function checkSource(code: string) {
  if (!code.trim()) throw new Error('流程图为空，请输入 Mermaid 源码');
  if (code.length > MAX_SOURCE_LENGTH) throw new Error('流程图源码过长，请拆分为多个图块');
  // Mermaid 的 image 节点会在生成 SVG 前加载图片；本地渲染不请求源码中的资源。
  const decoded = code.replace(/\\(?:([\da-f]{1,6})\s?|([^\r\n]))/gi, (_match, hex, char) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : char
  );
  const hasResource = Array.from(decoded.matchAll(/\burl\s*\(([^)]*)\)/gi)).some(
    (match) =>
      !match[1]
        ?.trim()
        .replace(/^["']|["']$/g, '')
        .startsWith('#')
  );
  if (/(?:["']?\bimg["']?\s*:|@import\b)/i.test(decoded) || hasResource)
    throw new Error('流程图暂不支持图片节点或外部样式资源，请使用文字节点');
}

function renderError(cause: unknown): Error {
  const detail =
    cause instanceof Error
      ? cause.message
      : cause && typeof cause === 'object' && 'message' in cause
        ? String(cause.message)
        : '';
  return new Error(
    `流程图渲染失败，请检查 Mermaid 语法${detail ? `\n${detail.slice(0, 500)}` : ''}`
  );
}

export function renderMermaid(code: string): Promise<SVGSVGElement> {
  const task = renderQueue.then(async () => {
    checkSource(code);
    const mermaid = await loadMermaid();
    mermaid.initialize(readConfig());
    const container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    // 保留可测量的布局，避免 display:none 使文字或图形尺寸变为零。
    container.style.cssText =
      'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:1200px';
    document.body.append(container);
    try {
      const { svg: markup } = await mermaid.render(`voex-mermaid-${++renderId}`, code, container);
      const template = document.createElement('template');
      template.innerHTML = markup;
      const svg = template.content.querySelector('svg');
      if (!svg) throw new Error('未生成有效的 SVG');
      // 不绑定 Mermaid 的点击回调；输出也不保留可导航链接和外部资源。
      svg
        .querySelectorAll('script, foreignObject, image, iframe, object, embed')
        .forEach((node) => {
          node.remove();
        });
      for (const element of [svg, ...svg.querySelectorAll('*')]) {
        for (const attribute of Array.from(element.attributes)) {
          if (
            /^on/i.test(attribute.name) ||
            (/(?:^|:)href$/i.test(attribute.name) && !attribute.value.startsWith('#')) ||
            (element.localName === 'a' && ['href', 'xlink:href', 'target'].includes(attribute.name))
          )
            element.removeAttribute(attribute.name);
        }
      }
      svg.setAttribute('role', 'img');
      if (!svg.hasAttribute('aria-labelledby')) svg.setAttribute('aria-label', '流程图');
      svg.setAttribute('focusable', 'false');
      return svg;
    } catch (cause) {
      throw renderError(cause);
    } finally {
      container.remove();
    }
  });
  // initialize 和 render 共用 Mermaid 配置，预览与正文必须在同一个队列执行。
  renderQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}
