import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { MarkdownNode } from '@milkdown/kit/transformer';
import { $node, $remark } from '@milkdown/kit/utils';
import emojis, { getTwemojiUrl, type Emoji } from '../../../src/constant/emoji';
export const EMOJI_NODE_ID = 'voex_emoji';
const normalize = (char: string) => char.replace(/\ufe0f/g, '');
const emojiByChar = new Map(emojis.map((emoji) => [normalize(emoji.char), emoji]));
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

// 按完整 grapheme 匹配，避免把 ZWJ 或肤色序列拆成多个表情。
function transformEmojiText(node: MarkdownNode): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      transformEmojiText(child);
      return [child];
    }
    const result: MarkdownNode[] = [];
    let text = '';
    for (const { segment } of segmenter.segment(child.value)) {
      if (!emojiByChar.has(normalize(segment))) {
        text += segment;
        continue;
      }
      if (text) result.push({ type: 'text', value: text });
      text = '';
      result.push({ type: EMOJI_NODE_ID, value: segment });
    }
    if (text) result.push({ type: 'text', value: text });
    return result;
  });
}

export function getEmoji(node: ProseMirrorNode): Emoji | undefined {
  const char = node.attrs.char as string;
  const emoji = emojiByChar.get(normalize(char));
  return emoji ? { ...emoji, char } : undefined;
}

export function createEmojiSchema() {
  const remarkEmoji = $remark('voex-remark-emoji', () => () => (tree) => {
    transformEmojiText(tree as MarkdownNode);
  });
  const emojiNode = $node(EMOJI_NODE_ID, () => ({
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { char: { default: '', validate: 'string' } },
    leafText: (node) => node.attrs.char as string,
    parseDOM: [
      {
        tag: 'span[data-emoji]',
        getAttrs: (dom) => {
          const char = dom.getAttribute('data-emoji') ?? '';
          return emojiByChar.has(normalize(char)) ? { char } : false;
        },
      },
    ],
    toDOM: (node) => {
      const emoji = getEmoji(node);
      const char = node.attrs.char as string;
      return [
        'span',
        { class: 'milkdown-emoji', 'data-emoji': char },
        emoji
          ? [
              'img',
              {
                class: 'milkdown-emoji__image',
                src: getTwemojiUrl(emoji),
                alt: char,
                title: emoji.name,
              },
            ]
          : char,
      ];
    },
    parseMarkdown: {
      match: (node) => node.type === EMOJI_NODE_ID,
      runner: (state, node, type) => state.addNode(type, { char: node.value as string }),
    },
    toMarkdown: {
      match: (node) => node.type.name === EMOJI_NODE_ID,
      runner: (state, node) => state.addNode('text', undefined, node.attrs.char as string),
    },
  }));
  return { remarkEmoji, emojiNode };
}
