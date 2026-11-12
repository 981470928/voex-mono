import { $mark } from '@milkdown/kit/utils';
import { fontFamilyStyle, normalizeFontFamily } from './font-catalog';

export function createFontFamilySchema() {
  const activeFamilies = new WeakMap<object, string[]>();
  const fontFamily = $mark('fontFamily', () => ({
    attrs: {
      family: {
        validate: (value: unknown) => {
          if (!normalizeFontFamily(value)) throw new RangeError('不支持的字体');
        },
      },
    },
    parseDOM: [
      {
        tag: 'span[data-voex-font-family]',
        getAttrs: (dom) => {
          if (
            [...dom.attributes].some(
              ({ name }) => !['data-voex-font-family', 'style'].includes(name)
            )
          )
            return false;
          const family = normalizeFontFamily(dom.getAttribute('data-voex-font-family'));
          if (!family) return false;
          if (!dom.hasAttribute('style')) return { family };
          // Browser clipboard HTML normalizes quotes and adds a trailing semicolon.
          // 浏览器剪贴板 HTML 会规范化引号，并添加末尾分号。
          // Compare parsed font-family values while rejecting every other CSS property.
          // 比较解析后的 font-family 值，同时拒绝其他所有 CSS 属性。
          const expected = dom.ownerDocument.createElement('span');
          expected.style.fontFamily = fontFamilyStyle(family);
          return dom.style.length === 1 &&
            dom.style.item(0) === 'font-family' &&
            !dom.style.getPropertyPriority('font-family') &&
            dom.style.fontFamily === expected.style.fontFamily
            ? { family }
            : false;
        },
      },
    ],
    toDOM: (mark) => {
      const family = normalizeFontFamily(mark.attrs.family);
      return [
        'span',
        family
          ? { 'data-voex-font-family': family, style: `font-family: ${fontFamilyStyle(family)}` }
          : {},
        0,
      ];
    },
    parseMarkdown: {
      match: (node) => node.type === 'fontFamily',
      runner: (state, node, type) => {
        const family = normalizeFontFamily(node.family);
        if (!family) {
          state.next(node.children ?? []);
          return;
        }
        const families = activeFamilies.get(state) ?? [];
        families.push(family);
        activeFamilies.set(state, families);
        state.openMark(type, { family });
        try {
          state.next(node.children ?? []);
        } finally {
          state.closeMark(type);
          families.pop();
          const parent = families.at(-1);
          if (parent) state.openMark(type, { family: parent });
          else activeFamilies.delete(state);
        }
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === 'fontFamily',
      runner: (state, mark) => {
        state.withMark(mark, 'fontFamily', undefined, { family: mark.attrs.family });
      },
    },
  }));
  return { fontFamily };
}
