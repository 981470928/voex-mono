// Milkdown 工具栏接收 HTML 字符串，图标来自项目已注册的 SVG sprite。
export function editorIcon(name: string, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;
}
