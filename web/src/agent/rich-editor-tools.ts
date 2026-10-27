import type { Node as ProseNode, Schema } from '@milkdown/kit/prose/model';
import { Transform } from '@milkdown/kit/prose/transform';
import type { MarkdownCodec } from '@voex/editor-schema';
import { normalizeHexColor } from '@voex/editor-schema/text-color';
import { normalizeFontSize } from '@voex/editor-schema/font-size';
import { MAX_WIDTH, MIN_WIDTH, parseWidth } from '@voex/editor-schema/images';
import {
  CARD_ITEM,
  CARD_LIST,
  CARD_TEXT,
  DEFAULT_CARD_IMAGE_SIZE,
  DEFAULT_CARD_IMAGE_HEIGHT,
  MIN_CARD_IMAGE_HEIGHT,
  MAX_CARD_IMAGE_HEIGHT,
  MIN_CARD_IMAGE_SIZE,
  MAX_CARD_IMAGE_SIZE,
  safeCardImage,
} from '@/views/edit/milkdown/card-list-model';
import type { AgentDraft } from './draft';
import type { AgentToolRegistry } from './registry';
import type { AgentContext, AgentTool, ToolProperty, ToolSchema } from './types';

let codecTask: Promise<MarkdownCodec> | undefined;
function getCodec(): Promise<MarkdownCodec> {
  codecTask ??= import('@voex/editor-schema')
    .then(({ createMarkdownCodec }) => createMarkdownCodec())
    .catch((cause: unknown) => {
      codecTask = undefined;
      throw cause;
    });
  return codecTask;
}

interface LocatedNode {
  node: ProseNode;
  pos: number;
}
interface TextRange {
  from: number;
  to: number;
}
interface CardInput {
  title?: string;
  text: string;
  image_index?: number;
  image_alt?: string;
}
interface DraftDocument {
  codec: MarkdownCodec;
  doc: ProseNode;
  fileKey: string;
  content: string;
  context: AgentContext;
}
const string = (description: string): ToolProperty => ({ type: 'string', description });
const integer = (description: string, minimum: number, maximum?: number): ToolProperty => ({
  type: 'integer',
  description,
  minimum,
  ...(maximum !== undefined && { maximum }),
});
const schema = (properties: ToolSchema['properties'], required: string[]): ToolSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const fileKeyProperty = {
  file_key: string('省略表示当前文件；仅可指定当前文件 ID 或本轮新建文件的 draft ID。'),
};
const layoutProperty: ToolProperty = {
  type: 'string',
  enum: ['horizontal', 'vertical'],
  description:
    'horizontal：横向，每行最多 4 项、超出换行、space-between；vertical：纵向左图右文。总项数不限。',
};
const imageHeightProperty = integer(
  '整组卡片统一的图片高度（像素），40–640；插入时省略为100。',
  MIN_CARD_IMAGE_HEIGHT,
  MAX_CARD_IMAGE_HEIGHT
);
const imageSizeProperty = integer(
  '整组卡片统一的图片宽度（像素），80–320；插入时省略为 160。',
  MIN_CARD_IMAGE_SIZE,
  MAX_CARD_IMAGE_SIZE
);

function components(doc: ProseNode) {
  const images: LocatedNode[] = [];
  const cardLists: LocatedNode[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === CARD_LIST) {
      cardLists.push({ node, pos });
      return false;
    }
    if (node.type.name === 'image') images.push({ node, pos });
  });
  return { images, cardLists };
}

function numbered<T>(items: T[], index: number, label: string): T {
  const item = items[index - 1];
  if (!Number.isSafeInteger(index) || index < 1 || !item)
    throw new Error(`${label}编号不存在，请重新调用 read_editor_components 获取当前编号`);
  return item;
}

// ProseMirror text positions use UTF-16; Emoji atoms consume one position regardless of char length.
// Separate runs at non-text components, so a match cannot jump across an image or attachment.
function textRanges(doc: ProseNode, search: string): TextRange[] {
  if (!search) throw new Error('目标文字不能为空');
  const matches: TextRange[] = [];
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  doc.descendants((block, position) => {
    if (!block.isTextblock) return;
    if (block.type.spec.code) return false;
    let text = '';
    let boundaries: (number | null)[] = [];
    const flush = () => {
      // A grapheme may span multiple text nodes/marks; do not split a visible character.
      for (const { index, segment } of graphemes.segment(text))
        for (let offset = index + 1; offset < index + segment.length; offset++)
          boundaries[offset] = null;
      let offset = 0;
      while (offset <= text.length - search.length) {
        const index = text.indexOf(search, offset);
        if (index < 0) break;
        const from = boundaries[index];
        const to = boundaries[index + search.length];
        if (from !== undefined && from !== null && to !== undefined && to !== null)
          matches.push({ from, to });
        offset = index + 1;
      }
      text = '';
      boundaries = [];
    };
    block.forEach((node, offset) => {
      const start = position + 1 + offset;
      const value = node.isText
        ? node.text!
        : node.type.name === 'voex_emoji'
          ? String(node.attrs.char ?? '')
          : node.type.name === 'hardbreak'
            ? node.attrs.isInline
              ? ' '
              : '\n'
            : null;
      if (value === null || !value) {
        flush();
        return;
      }
      const length = text.length;
      text += value;
      boundaries[length] = start;
      for (let index = 1; index < value.length; index++)
        boundaries[length + index] = node.isText ? start + index : null;
      boundaries[text.length] = start + node.nodeSize;
    });
    flush();
    return false;
  });
  return matches;
}

function selectedTextRanges(doc: ProseNode, search: string, occurrence?: number): TextRange[] {
  const matches = textRanges(doc, search);
  if (!matches.length)
    throw new Error('未找到目标文字；请读取草稿并提供同一段内的可见文字，代码块不参与文字定位');
  if (occurrence === 0) return matches;
  if (occurrence !== undefined) {
    const match = matches[occurrence - 1];
    if (!match) throw new Error(`目标文字共匹配 ${matches.length} 处，occurrence 超出范围`);
    return [match];
  }
  if (matches.length !== 1)
    throw new Error(
      `目标文字匹配 ${matches.length} 处，请用 occurrence 指定第几处；仅明确要求全部时使用 0`
    );
  return matches;
}

function colorValue(value: unknown): string | null {
  if (typeof value !== 'string') throw new Error('颜色必须是 HEX 字符串，或用 none 清除');
  if (value.trim().toLowerCase() === 'none') return null;
  const color = normalizeHexColor(value);
  if (!color) throw new Error('颜色仅支持 #RGB、#RRGGBB，或用 none 清除');
  return color;
}

function createCard(schema: Schema, input: CardInput, images: LocatedNode[]): ProseNode {
  const paragraphs: ProseNode[] = [];
  const textType = schema.nodes[CARD_TEXT]!;
  if (input.title?.trim())
    paragraphs.push(
      textType.create(null, schema.text(input.title, [schema.marks.strong!.create()]))
    );
  if (input.text || !paragraphs.length)
    for (const line of input.text.split(/\r\n|\r|\n/))
      paragraphs.push(textType.create(null, line ? schema.text(line) : undefined));
  const original =
    input.image_index === undefined ? null : numbered(images, input.image_index, '正文图片').node;
  const src = original ? safeCardImage(original.attrs.src) : '';
  if (original && !src) throw new Error('该图片地址不能保存到卡片，请先将图片导入文档附件');
  return schema.nodes[CARD_ITEM]!.create(
    {
      src,
      alt: input.image_alt ?? original?.attrs.alt ?? input.title ?? '',
    },
    paragraphs
  );
}

export function registerRichEditorTools(registry: AgentToolRegistry, draft: AgentDraft) {
  let sequence = 0;
  const snapshots = new Map<string, { content: string; version: string }>();
  const componentsVersionProperty = string(
    'read_editor_components 返回的 components_version；必须与当前草稿一致，内容修改后重新读取。'
  );
  function componentVersion(current: DraftDocument): string {
    const existing = snapshots.get(current.fileKey);
    if (existing?.content === current.content) return existing.version;
    const version = String(++sequence);
    snapshots.set(current.fileKey, { content: current.content, version });
    return version;
  }
  function requireCurrentComponents(input: Record<string, unknown>, current: DraftDocument) {
    const snapshot = snapshots.get(current.fileKey);
    if (
      !snapshot ||
      input.components_version !== snapshot.version ||
      snapshot.content !== current.content
    )
      throw new Error(
        '组件编号未读取或已经过期，请重新调用 read_editor_components 并使用新的 components_version'
      );
  }
  async function load(
    input: Record<string, unknown>,
    context: AgentContext
  ): Promise<DraftDocument> {
    const codec = await getCodec();
    context.signal.throwIfAborted();
    const fileKey = typeof input.file_key === 'string' ? input.file_key : draft.source.file_key;
    const content = draft.read(fileKey);
    return { codec, doc: codec.parse(content), fileKey, content, context };
  }
  function save(current: DraftDocument, next: ProseNode) {
    current.context.signal.throwIfAborted();
    if (next.eq(current.doc)) return { status: 'unchanged', file_key: current.fileKey };
    const markdown = current.codec.serialize(next);
    // Validate the persisted representation before touching the draft. No live editor or API writes.
    const restored = current.codec.parse(markdown);
    if (!restored.eq(next)) throw new Error('富文本保存后无法完整恢复，已取消本次草稿修改');
    return draft.write(markdown, current.fileKey);
  }
  const tools: AgentTool[] = [
    {
      name: 'read_editor_components',
      description:
        '读取最新草稿中的正文图片和卡片列表编号、内容与布局。编号从 1 开始，只对本次草稿有效；插入/删除/替换内容后重新读取。images 不包含卡片内图片；卡片内图片尺寸由整组控制。',
      parameters: schema(fileKeyProperty, []),
      execute: async (input, context) => {
        const current = await load(input, context);
        const { images, cardLists } = components(current.doc);
        return {
          file_key: current.fileKey,
          components_version: componentVersion(current),
          images: images.map(({ node }, index) => ({
            image_index: index + 1,
            reusable_in_card: Boolean(safeCardImage(node.attrs.src)),
            alt: node.attrs.alt,
            title: node.attrs.title,
            width: node.attrs.width,
            alignment: node.attrs.alignment ?? 'inline',
          })),
          card_lists: cardLists.map(({ node }, index) => {
            const items: {
              item_index: number;
              text: string;
              has_image: boolean;
              image_alt: string;
            }[] = [];
            node.forEach((item, _offset, itemIndex) =>
              items.push({
                item_index: itemIndex + 1,
                text: item.textBetween(0, item.content.size, '\n'),
                has_image: Boolean(item.attrs.src),
                image_alt: item.attrs.alt,
              })
            );
            return {
              list_index: index + 1,
              layout: node.attrs.layout,
              image_size: node.attrs.imageSize,
              image_height: node.attrs.imageHeight,
              items,
            };
          }),
        };
      },
    },
    {
      name: 'insert_card_list',
      description:
        '在草稿插入横向或纵向卡片列表，总项数不限。每项仅含纯文字，title 自动加粗，text 支持换行。可通过 image_index 和最新 components_version 复用当前草稿的正文图片（保留原图），省略则留空图片位；本工具不生成或上传图片。after_text 为唯一可见文字片段，在其所在顶层块之后插入；省略则追加末尾。',
      parameters: schema(
        {
          ...fileKeyProperty,
          layout: layoutProperty,
          image_size: imageSizeProperty,
          image_height: imageHeightProperty,
          components_version: componentsVersionProperty,
          after_text: string(
            '可选；当前草稿同一段内的唯一可见文字。在其所在顶层块之后插入，不插入卡片文字内部。'
          ),
          items: {
            type: 'array',
            minItems: 1,
            description: '卡片数组，允许超过 4 项。',
            items: schema(
              {
                title: string('可选的纯文字标题，自动加粗。'),
                text: string('纯文字正文，可换行；空字符串表示空文字区，不解析为其他组件。'),
                image_index: integer(
                  '可选；read_editor_components 返回的当前草稿正文图片编号。省略保留空图片位。',
                  1
                ),
                image_alt: string('可选的图片说明；省略时保留原图片说明。'),
              },
              ['text']
            ),
          },
        },
        ['layout', 'items']
      ),
      execute: async (input, context) => {
        const current = await load(input, context);
        if ((input.items as CardInput[]).some((item) => item.image_index !== undefined))
          requireCurrentComponents(input, current);
        const { images } = components(current.doc);
        const items = (input.items as CardInput[]).map((item) =>
          createCard(current.codec.schema, item, images)
        );
        const card = current.codec.schema.nodes[CARD_LIST]!.create(
          {
            layout: input.layout,
            imageSize: input.image_size ?? DEFAULT_CARD_IMAGE_SIZE,
            imageHeight: input.image_height ?? DEFAULT_CARD_IMAGE_HEIGHT,
          },
          items
        );
        let position = current.doc.content.size;
        if (input.after_text !== undefined) {
          const [range] = selectedTextRanges(current.doc, String(input.after_text));
          position = current.doc.resolve(range!.from).after(1);
        }
        return save(current, new Transform(current.doc).insert(position, card).doc);
      },
    },
    {
      name: 'update_card_list_layout',
      description:
        '按最新组件清单中的 list_index 修改卡片横/纵布局或整组图片宽高。保留所有卡片、图片与文字格式。横向每行最多 4 项并自动换行；超过 4 项仍可切换横向。卡片图片不能单独改尺寸或对齐。只改待审阅草稿。',
      parameters: schema(
        {
          ...fileKeyProperty,
          list_index: integer('卡片列表编号，从 1 开始。', 1),
          components_version: componentsVersionProperty,
          layout: layoutProperty,
          image_size: imageSizeProperty,
          image_height: imageHeightProperty,
        },
        ['list_index', 'components_version']
      ),
      execute: async (input, context) => {
        if (
          input.layout === undefined &&
          input.image_size === undefined &&
          input.image_height === undefined
        )
          throw new Error('请至少提供 layout、image_size 或 image_height');
        const current = await load(input, context);
        requireCurrentComponents(input, current);
        const { node, pos } = numbered(
          components(current.doc).cardLists,
          Number(input.list_index),
          '卡片列表'
        );
        return save(
          current,
          new Transform(current.doc).setNodeMarkup(
            pos,
            undefined,
            {
              ...node.attrs,
              ...(input.layout !== undefined && { layout: input.layout }),
              ...(input.image_size !== undefined && { imageSize: input.image_size }),
              ...(input.image_height !== undefined && { imageHeight: input.image_height }),
            },
            node.marks
          ).doc
        );
      },
    },
    {
      name: 'set_text_style',
      description:
        '对草稿中的可见文字设置/清除字号、文字颜色和背景色，支持普通正文、标题、列表、表格与卡片文字，保留粗体/链接等其他格式。text 为同一段内的可见文字，不含 Markdown 标记。代码块和行内代码不应用这些样式；字号只修改文字节点。默认要求唯一匹配；occurrence 指定第几处，0 表示全部，仅在用户要求全部时使用。字号 font_size 支持 8–96px、0.5px 步长，0 清除局部字号。颜色支持 #RGB/#RRGGBB，none 清除对应颜色。',
      parameters: schema(
        {
          ...fileKeyProperty,
          text: string(
            '要设置样式的可见文字，不能为空；可跨同一段内的加粗/链接片段，不能跨图片等组件。'
          ),
          occurrence: integer('可选；从 1 开始指定匹配项，0 表示全部；省略时必须唯一。', 0),
          font_size: {
            type: 'number',
            minimum: 0,
            maximum: 96,
            description:
              '可选；字号以 px 为单位，8–96、步长 0.5，例如 24 或 18.5；0 仅清除局部字号并恢复默认，保留颜色等其他格式。',
          },
          text_color: string('可选；文字 HEX 颜色，例如 #F00、#FF0000；none 清除文字颜色。'),
          background_color: string('可选；背景 HEX 颜色，例如 #FFF59D；none 清除背景色。'),
        },
        ['text']
      ),
      execute: async (input, context) => {
        const styles: { kind: string; attrs: { color: string } | { size: number } | null }[] = [];
        for (const [parameter, kind] of [
          ['text_color', 'textColor'],
          ['background_color', 'highlight'],
        ] as const) {
          if (input[parameter] === undefined) continue;
          const color = colorValue(input[parameter]);
          styles.push({ kind, attrs: color === null ? null : { color } });
        }
        if (input.font_size !== undefined) {
          const size = input.font_size === 0 ? null : normalizeFontSize(input.font_size);
          if (input.font_size !== 0 && size === null)
            throw new Error('字号须为 8–96px，步长为 0.5px；0 表示恢复默认字号');
          styles.push({ kind: 'fontSize', attrs: size === null ? null : { size } });
        }
        if (!styles.length) throw new Error('请至少提供 font_size、text_color 或 background_color');
        const current = await load(input, context);
        const ranges = selectedTextRanges(
          current.doc,
          String(input.text),
          input.occurrence as number | undefined
        );
        const tr = new Transform(current.doc);
        let applicable = false;
        for (const range of ranges)
          for (const { kind, attrs } of styles) {
            const type = current.codec.schema.marks[kind]!;
            current.doc.nodesBetween(range.from, range.to, (node, pos, parent) => {
              if (
                !node.isInline ||
                (kind === 'fontSize' && !node.isText) ||
                !parent?.type.allowsMarkType(type) ||
                parent.type.spec.code ||
                node.marks.some((mark) => mark.type.spec.code)
              )
                return;
              if (node.isText) applicable = true;
              const from = Math.max(range.from, pos),
                to = Math.min(range.to, pos + node.nodeSize);
              if (attrs) tr.addMark(from, to, type.create(attrs));
              else tr.removeMark(from, to, type);
            });
          }
        if (!applicable)
          throw new Error('目标范围没有可设置文字样式的文字，代码和独立组件不支持此操作');
        return { ...save(current, tr.doc), matched: ranges.length };
      },
    },
    {
      name: 'set_image_layout',
      description:
        '修改草稿中已有正文图片的宽度和左/中/右对齐，保留地址、说明、标题和其他格式；不生成、上传或替换图片。先读取组件清单，image_index 从 1 开始，0 表示全部正文图片（仅用户明确要求全部时使用）。卡片内图片请用 update_card_list_layout 统一调整。width=0 恢复原始尺寸，alignment=inline 清除独占一行的对齐。',
      parameters: schema(
        {
          ...fileKeyProperty,
          image_index: integer('正文图片编号，0 表示全部正文图片。', 0),
          components_version: componentsVersionProperty,
          width: integer(
            `可选；宽度 ${MIN_WIDTH}–${MAX_WIDTH} 整数像素；0 清除设置、恢复原始尺寸，高度始终等比例。`,
            0,
            MAX_WIDTH
          ),
          alignment: {
            type: 'string',
            enum: ['left', 'center', 'right', 'inline'],
            description: '可选；left 左对齐、center 居中、right 右对齐、inline 清除对齐。',
          },
        },
        ['image_index', 'components_version']
      ),
      execute: async (input, context) => {
        if (input.width === undefined && input.alignment === undefined)
          throw new Error('请至少提供 width 或 alignment');
        const width =
          input.width === undefined || input.width === 0 ? null : parseWidth(input.width);
        if (input.width !== undefined && input.width !== 0 && width === null)
          throw new Error(`图片宽度须为 ${MIN_WIDTH}–${MAX_WIDTH} 的整数，或用 0 恢复原始尺寸`);
        const current = await load(input, context);
        requireCurrentComponents(input, current);
        const { images } = components(current.doc);
        if (!images.length)
          throw new Error('草稿中没有正文图片；卡片内图片使用 update_card_list_layout');
        const targets =
          input.image_index === 0
            ? images
            : [numbered(images, Number(input.image_index), '正文图片')];
        const tr = new Transform(current.doc);
        for (const { node, pos } of targets)
          tr.setNodeMarkup(
            pos,
            undefined,
            {
              ...node.attrs,
              ...(input.width !== undefined && { width }),
              ...(input.alignment !== undefined && {
                alignment: input.alignment === 'inline' ? null : input.alignment,
              }),
            },
            node.marks
          );
        return { ...save(current, tr.doc), images: targets.length };
      },
    },
  ];
  tools.forEach((tool) => registry.register(tool));
}
