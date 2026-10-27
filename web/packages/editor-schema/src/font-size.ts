import { $mark } from '@milkdown/kit/utils';

export const FONT_SIZE_PRESETS = [12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96] as const;

export function normalizeFontSize(value: unknown): number | null {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^\d+(?:\.[05])?$/.test(value.trim()))
  )
    return null;
  const size = Number(value);
  return Number.isFinite(size) && size >= 8 && size <= 96 && Number.isInteger(size * 2)
    ? size
    : null;
}

function readSizeAttributes(attributes: Record<string, string>): number | null {
  if (Object.keys(attributes).some((name) => !['data-voex-font-size', 'style'].includes(name)))
    return null;
  const explicit = attributes['data-voex-font-size'];
  const style = attributes.style;
  if (style === undefined) return explicit === undefined ? null : normalizeFontSize(explicit);
  const match = style.trim().match(/^font-size\s*:\s*(\d+(?:\.\d+)?)px\s*;?$/i);
  if (!match) return null;
  const size = normalizeFontSize(match[1]);
  return explicit === undefined || normalizeFontSize(explicit) === size ? size : null;
}

export function createFontSizeSchema() {
  const activeSizes = new WeakMap<object, number[]>();
  const fontSize = $mark('fontSize', () => ({
    attrs: {
      size: {
        validate: (value: unknown) => {
          if (typeof value !== 'number' || normalizeFontSize(value) !== value)
            throw new RangeError('字号必须为 8–96 px，且以 0.5 px 递增');
        },
      },
    },
    parseDOM: [
      {
        tag: 'span[data-voex-font-size], span[style]',
        getAttrs: (dom) => {
          const size = readSizeAttributes(
            Object.fromEntries(
              [...dom.attributes].map((attribute) => [attribute.name, attribute.value])
            )
          );
          return size === null ? false : { size };
        },
      },
    ],
    toDOM: (mark) => {
      const size = normalizeFontSize(mark.attrs.size);
      return [
        'span',
        size === null ? {} : { 'data-voex-font-size': String(size), style: `font-size: ${size}px` },
        0,
      ];
    },
    parseMarkdown: {
      match: (node) => node.type === 'fontSize',
      runner: (state, node, type) => {
        const size = normalizeFontSize(node.size);
        if (size === null) {
          state.next(node.children ?? []);
          return;
        }
        // Nested spans override their parent size only for their own content.
        const sizes = activeSizes.get(state) ?? [];
        sizes.push(size);
        activeSizes.set(state, sizes);
        state.openMark(type, { size });
        try {
          state.next(node.children ?? []);
        } finally {
          state.closeMark(type);
          sizes.pop();
          const parentSize = sizes.at(-1);
          if (parentSize !== undefined) state.openMark(type, { size: parentSize });
          else activeSizes.delete(state);
        }
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === 'fontSize',
      runner: (state, mark) => {
        state.withMark(mark, 'fontSize', undefined, { size: mark.attrs.size });
      },
    },
  }));

  return { fontSize };
}
