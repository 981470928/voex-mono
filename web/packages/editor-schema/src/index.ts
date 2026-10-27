import { Ctx, Container, Clock, type MilkdownPlugin } from '@milkdown/kit/ctx';
import {
  init,
  nodesCtx,
  marksCtx,
  schemaCtx,
  remarkCtx,
  remarkPluginsCtx,
  schemaTimerCtx,
} from '@milkdown/kit/core';
import type { Editor } from '@milkdown/kit/core';
import { Schema, type Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  schema as commonmarkSchema,
  remarkAddOrderInListPlugin,
  remarkInlineLinkPlugin,
  remarkLineBreak,
  remarkHtmlTransformer,
  remarkMarker,
  remarkPreserveEmptyLinePlugin,
} from '@milkdown/kit/preset/commonmark';
import { schema as gfmSchema, remarkGFMPlugin } from '@milkdown/kit/preset/gfm';
import { ParserState, SerializerState, type RemarkParser } from '@milkdown/kit/transformer';
import { createAttachmentSchema } from './attachment';
import { createEmojiSchema } from './emoji';
import { createLatexSchema } from './latex';
import { createMermaidSchema } from './mermaid';
import { createTextColorSchema } from './text-color';
import { createFontSizeSchema } from './font-size';
import { createRichTextSchema } from './rich-text';
import { createCardSchema } from './cards';
import { createImageSchema } from './images';
import { tableWidthsRemark, configureTables } from './tables';
import { configureParagraph } from './paragraph';
export { configureParagraph } from './paragraph';
import { CARD_LIST, validCardList } from '../../../src/views/edit/milkdown/card-list-model';

export const SCHEMA_VERSION = 'voex-editor-1';
export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
export interface MarkdownCodec {
  schema: Schema;
  parse: (markdown: string) => ProseNode;
  serialize: (node: ProseNode) => string;
  validate: (node: ProseNode) => void;
}

/** Builds the same schema and Remark pipeline as the browser, without an EditorView or DOM.
 * Only schema plugins run; their readiness waits are already satisfied by this explicit order.
 * UI factories and browser-global timers are never constructed.
 */
export async function createMarkdownCodec(): Promise<MarkdownCodec> {
  const ctx = new Ctx(new Container(), new Clock());
  Object.defineProperties(ctx, {
    wait: { value: () => Promise.resolve() },
    waitTimers: { value: () => Promise.resolve() },
    done: { value: () => undefined },
  });
  const initialize = init({} as Editor)(ctx);
  ctx.inject(nodesCtx, []).inject(marksCtx, []).inject(schemaTimerCtx, []).inject(schemaCtx);
  const attachment = createAttachmentSchema();
  const emoji = createEmojiSchema();
  const latex = createLatexSchema();
  const mermaid = createMermaidSchema();
  const richText = createRichTextSchema();
  const colors = createTextColorSchema();
  const fontSizes = createFontSizeSchema();
  const cards = createCardSchema();
  const images = createImageSchema();
  const plugins: MilkdownPlugin[] = [
    ...commonmarkSchema,
    ...gfmSchema,
    ...remarkAddOrderInListPlugin,
    ...remarkInlineLinkPlugin,
    ...remarkLineBreak,
    ...remarkHtmlTransformer,
    ...remarkMarker,
    ...remarkPreserveEmptyLinePlugin,
    ...remarkGFMPlugin,
    images.remarkImages,
    attachment.remarkAttachmentPlugin,
    attachment.attachmentNode,
    ...emoji.remarkEmoji,
    emoji.emojiNode,
    ...latex.remarkLatex,
    latex.latexNode,
    ...mermaid.remarkMermaid,
    mermaid.mermaidNode,
    ...colors.marks,
    fontSizes.fontSize,
    ...tableWidthsRemark,
    ...cards.remarkCards,
    cards.cardText,
    cards.cardItem,
    cards.cardList,
    ...richText.plugins,
  ];
  const runners = plugins.map((plugin) => plugin(ctx));
  let serializing: ProseNode | null = null;
  configureParagraph(ctx, () => serializing);
  richText.configure(ctx);
  images.configure(ctx);
  configureTables(ctx);
  await initialize();
  for (const run of runners) await run();
  const nodes = Object.fromEntries(ctx.get(nodesCtx));
  const marks = Object.fromEntries(ctx.get(marksCtx));
  const schema = new Schema({ nodes, marks });
  ctx.set(schemaCtx, schema);
  const remark = ctx
    .get(remarkPluginsCtx)
    .reduce(
      (processor, plugin) =>
        processor.use(plugin.plugin, plugin.options) as unknown as RemarkParser,
      ctx.get(remarkCtx)
    );
  ctx.set(remarkCtx, remark);
  const parser = ParserState.create(schema, remark);
  const serializer = (node: ProseNode) => SerializerState.create(schema, remark)(node);
  const validate = (node: ProseNode) => {
    node.check();
    let count = 0;
    node.descendants((child) => {
      if (++count > 100000) throw new Error('文档节点数量超过限制');
      if (child.type.name === CARD_LIST && !validCardList(child))
        throw new Error('卡片列表结构无效');
    });
  };
  const parse = (markdown: string) => {
    if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN_BYTES)
      throw new Error('文档正文超过 2 MiB 限制');
    const node = parser(markdown);
    if (!node) throw new Error('文档格式无法解析');
    validate(node);
    return node;
  };
  const serialize = (node: ProseNode) => {
    validate(node);
    let markdown: string;
    serializing = node;
    try {
      markdown = serializer(node);
    } finally {
      serializing = null;
    }
    if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN_BYTES)
      throw new Error('文档正文超过 2 MiB 限制');
    return markdown;
  };
  return { schema, parse, serialize, validate };
}
