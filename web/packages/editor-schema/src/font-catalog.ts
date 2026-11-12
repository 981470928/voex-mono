import catalog from './font-catalog.json';

export const FONT_FAMILIES = catalog;
export const FONT_GROUPS = ['中文', 'English', '日本語', '한국어'] as const;
export const FONT_FALLBACK_IDS = ['noto-sans-sc', 'noto-sans-jp', 'noto-sans-kr'] as const;

export function normalizeFontFamily(value: unknown): string | null {
  return typeof value === 'string' && FONT_FAMILIES.some((font) => font.id === value)
    ? value
    : null;
}

export function fontFamilyStyle(value: string): string {
  const font = FONT_FAMILIES.find((font) => font.id === value);
  if (!font) throw new RangeError('不支持的字体');
  const families = [
    `Voex ${font.family}`,
    ...FONT_FALLBACK_IDS.filter((id) => id !== value).map(
      (id) => `Voex ${FONT_FAMILIES.find((entry) => entry.id === id)!.family}`
    ),
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Microsoft YaHei',
    'Yu Gothic',
    'Malgun Gothic',
  ];
  return `${families.map((family) => `'${family}'`).join(', ')}, sans-serif`;
}
