import { schemaCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { MarkdownNode } from '@milkdown/kit/transformer';
import { $node, $remark } from '@milkdown/kit/utils';
import { withRichInlineSerialization } from './rich-text';
import {
  CARD_LIST,
  CARD_ITEM,
  CARD_TEXT,
  CARD_LANGUAGE,
  DEFAULT_CARD_IMAGE_SIZE,
  DEFAULT_CARD_IMAGE_HEIGHT,
  cardImageSize,
  cardImageHeight,
  cardImageFit,
  cardPadding,
  parseCardList,
  safeCardImage,
  serializeCardList,
} from '../../../src/views/edit/milkdown/card-list-model';
export function createCardSchema() {
  const remarkCards = $remark('voex-remark-card-list', (ctx) => () => (tree) => {
    const transform = (node: MarkdownNode) => {
      if (node.type === 'code' && node.lang === CARD_LANGUAGE && typeof node.value === 'string') {
        // 无效数据仍作为代码展示，不能悄悄丢掉用户的正文。
        if (parseCardList(node.value, ctx.get(schemaCtx))) node.type = CARD_LIST;
        return;
      }
      node.children?.forEach(transform);
    };
    transform(tree as MarkdownNode);
  });
  const cardText = $node(CARD_TEXT, () =>
    withRichInlineSerialization({
      content: 'text*',
      marks: 'strong emphasis strike_through inlineCode link textColor highlight fontSize',
      defining: true,
      parseDOM: [{ tag: `p[data-type="${CARD_TEXT}"]` }],
      toDOM: () => [
        'p',
        { 'data-type': CARD_TEXT, class: 'milkdown-card__text', 'data-placeholder': '输入文字…' },
        0,
      ],
      parseMarkdown: { match: () => false, runner: () => undefined },
      toMarkdown: {
        match: (node) => node.type.name === CARD_TEXT,
        runner: (state, node) => state.openNode('paragraph').next(node.content).closeNode(),
      },
    })
  );
  const cardItem = $node(CARD_ITEM, () => ({
    content: `${CARD_TEXT}+`,
    isolating: true,
    defining: true,
    selectable: false,
    attrs: { src: { default: '', validate: 'string' }, alt: { default: '', validate: 'string' } },
    parseDOM: [
      {
        tag: `div[data-type="${CARD_ITEM}"]`,
        contentElement: '.milkdown-card__body',
        getAttrs: (dom) => ({ src: safeCardImage(dom.dataset.src), alt: dom.dataset.alt ?? '' }),
      },
    ],
    toDOM: (node) => [
      'div',
      { 'data-type': CARD_ITEM, 'data-src': node.attrs.src, 'data-alt': node.attrs.alt },
      ['div', { class: 'milkdown-card__body' }, 0],
    ],
    parseMarkdown: { match: () => false, runner: () => undefined },
    toMarkdown: {
      match: (node) => node.type.name === CARD_ITEM,
      runner: (state, node) => state.next(node.content),
    },
  }));
  const cardList = $node(CARD_LIST, () => ({
    group: 'block',
    content: `${CARD_ITEM}+`,
    isolating: true,
    defining: true,
    selectable: true,
    draggable: true,
    attrs: {
      layout: { default: 'vertical', validate: 'string' },
      imageSize: { default: DEFAULT_CARD_IMAGE_SIZE, validate: 'number' },
      imageHeight: { default: DEFAULT_CARD_IMAGE_HEIGHT, validate: 'number' },
      imageFit: { default: 'cover', validate: 'string' },
      padding: { default: 0, validate: 'number' },
    },
    parseDOM: [
      {
        tag: `section[data-type="${CARD_LIST}"]`,
        contentElement: '.milkdown-cards__items',
        getAttrs: (dom) => ({
          layout: dom.dataset.layout === 'horizontal' ? 'horizontal' : 'vertical',
          imageSize: cardImageSize(dom.dataset.imageSize ?? DEFAULT_CARD_IMAGE_SIZE),
          imageHeight: cardImageHeight(dom.dataset.imageHeight),
          imageFit: cardImageFit(dom.dataset.imageFit),
          padding: cardPadding(dom.dataset.padding),
        }),
      },
    ],
    toDOM: (node) => [
      'section',
      {
        'data-type': CARD_LIST,
        'data-layout': node.attrs.layout,
        'data-image-size': node.attrs.imageSize,
        'data-image-height': node.attrs.imageHeight,
        'data-image-fit': node.attrs.imageFit,
        'data-padding': node.attrs.padding,
      },
      ['div', { class: 'milkdown-cards__items' }, 0],
    ],
    parseMarkdown: {
      match: (node) => node.type === CARD_LIST,
      runner: (state, node, type) => {
        const parsed = parseCardList(String(node.value), state.schema);
        if (parsed) {
          const children: ProseNode[] = [];
          parsed.forEach((item) => children.push(item));
          state.addNode(type, parsed.attrs, children);
        }
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === CARD_LIST,
      runner: (state, node) =>
        state.addNode('code', undefined, serializeCardList(node), { lang: CARD_LANGUAGE }),
    },
  }));

  return { remarkCards, cardText, cardItem, cardList };
}
