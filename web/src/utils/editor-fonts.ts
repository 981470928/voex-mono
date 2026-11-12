import {
  FONT_FAMILIES,
  FONT_FALLBACK_IDS,
  normalizeFontFamily,
} from '@voex/editor-schema/font-catalog';

const stylesheets = new Map<string, Promise<void>>();
const base = `${import.meta.env.BASE_URL}fonts/`;

export function fontAssetUrl(id: string, file: 'font.css' | 'preview.svg'): string {
  const font = FONT_FAMILIES.find((entry) => entry.id === id);
  if (!font) throw new RangeError('不支持的字体');
  return `${base}${font.id}/${font.version}/${file}`;
}

function loadStylesheet(id: string): Promise<void> {
  const existing = stylesheets.get(id);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontAssetUrl(id, 'font.css');
    link.dataset.voexFont = id;
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      link.onload = link.onerror = null;
      if (error) {
        link.remove();
        reject(error);
      } else resolve();
    };
    const timer = window.setTimeout(() => finish(new Error('字体加载超时，请重试')), 20000);
    link.onload = () => finish();
    link.onerror = () => finish(new Error('字体加载失败，请检查网络后重试'));
    document.head.append(link);
  });
  stylesheets.set(id, promise);
  void promise.catch(() => {
    if (stylesheets.get(id) === promise) stylesheets.delete(id);
  });
  return promise;
}

/** Only install a selected/document-used family and its CJK fallbacks. No preload/import. / 仅安装选中的或文档使用的字体及其 CJK 回退字体，不进行预加载或导入。 */
export async function ensureFontStyles(id: string): Promise<void> {
  if (!normalizeFontFamily(id)) throw new RangeError('不支持的字体');
  await Promise.all([...new Set([id, ...FONT_FALLBACK_IDS])].map(loadStylesheet));
}

/** Load the selected complete font; rendering requests other weights/fallbacks only when used. / 加载选中的完整字体；渲染时仅在实际使用其他字重或回退字体时才发起请求。 */
export async function loadSelectedFont(id: string, text: string): Promise<void> {
  await ensureFontStyles(id);
  const font = FONT_FAMILIES.find((entry) => entry.id === id)!;
  let timer: number | undefined;
  try {
    await Promise.race([
      document.fonts.load(`400 16px "Voex ${font.family}"`, text || ' '),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('字体下载超时，请重试')), 60000);
      }),
    ]);
  } catch (cause) {
    // A failed FontFace keeps its error state. Reinstall its stylesheet on the next try.
    // 失败的 FontFace 会保留错误状态；下次重试时重新安装其样式表。
    document.querySelectorAll<HTMLLinkElement>('link[data-voex-font]').forEach((link) => {
      if (link.dataset.voexFont === id) link.remove();
    });
    stylesheets.delete(id);
    throw cause;
  } finally {
    window.clearTimeout(timer);
  }
}
