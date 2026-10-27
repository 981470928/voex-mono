import { $mark } from '@milkdown/kit/utils';
export type TextColorKind = 'textColor' | 'highlight';

const colors = {
  textColor: { attribute: 'data-voex-text-color', style: 'color' },
  highlight: { attribute: 'data-voex-highlight', style: 'background-color' },
} as const;
const kinds: TextColorKind[] = ['textColor', 'highlight'];

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.trim())) return null;
  const hex = value.trim().slice(1).toUpperCase();
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}`;
}

export function createTextColorSchema() {
  const marks = kinds.map((kind) => {
    const { attribute, style } = colors[kind];
    return $mark(kind, () => ({
      attrs: { color: { validate: 'string' } },
      parseDOM: [
        {
          tag: `span[${attribute}]`,
          getAttrs: (dom) => {
            const color = normalizeHexColor(dom.getAttribute(attribute));
            return color ? { color } : false;
          },
        },
      ],
      toDOM: (mark) => {
        const color = normalizeHexColor(mark.attrs.color);
        return ['span', color ? { [attribute]: color, style: `${style}: ${color}` } : {}, 0];
      },
      parseMarkdown: {
        match: (node) => node.type === kind,
        runner: (state, node, type) => {
          const color = normalizeHexColor(node.color);
          if (color) state.openMark(type, { color });
          state.next(node.children ?? []);
          if (color) state.closeMark(type);
        },
      },
      toMarkdown: {
        match: (mark) => mark.type.name === kind,
        runner: (state, mark) => {
          state.withMark(mark, kind, undefined, { color: mark.attrs.color });
        },
      },
    }));
  });

  return { marks };
}
