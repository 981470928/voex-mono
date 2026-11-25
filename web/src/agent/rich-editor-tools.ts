import type { Node as ProseNode, Schema } from '@milkdown/kit/prose/model';
import { Transform } from '@milkdown/kit/prose/transform';
import type { MarkdownCodec } from '@voex/editor-schema';
import { normalizeHexColor } from '@voex/editor-schema/text-color';
import { normalizeFontSize } from '@voex/editor-schema/font-size';
import { FONT_FAMILIES, normalizeFontFamily } from '@voex/editor-schema/font-catalog';
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
  file_key: string(
    'Defaults to the current file. Alternatively use a draft ID created in this turn.'
  ),
};
const layoutProperty: ToolProperty = {
  type: 'string',
  enum: ['horizontal', 'vertical'],
  description:
    'Horizontal wraps after four cards per row with space between them. Vertical places the image to the left of the text. Either layout accepts any number of cards.',
};
const imageHeightProperty = integer(
  'Image height for the entire card list, 40–640 px. Defaults to 100 on insertion.',
  MIN_CARD_IMAGE_HEIGHT,
  MAX_CARD_IMAGE_HEIGHT
);
const imageSizeProperty = integer(
  'Image width for the entire card list, 80–320 px. Defaults to 160 on insertion.',
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
    throw new Error(`Unknown ${label} index. Call read_editor_components for current indices.`);
  return item;
}

// ProseMirror text positions use UTF-16; Emoji atoms consume one position regardless of char length.
// ProseMirror 文本位置使用 UTF-16；Emoji 原子节点无论字符长度多少都只占一个位置。
// Separate runs at non-text components, so a match cannot jump across an image or attachment.
// 在非文本组件处分隔文本片段，避免匹配跨越图片或附件。
function textRanges(doc: ProseNode, search: string): TextRange[] {
  if (!search) throw new Error('The target text cannot be empty.');
  const matches: TextRange[] = [];
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  doc.descendants((block, position) => {
    if (!block.isTextblock) return;
    if (block.type.spec.code) return false;
    let text = '';
    let boundaries: (number | null)[] = [];
    const flush = () => {
      // A grapheme may span multiple text nodes/marks; do not split a visible character.
      // 一个字素可能跨越多个文本节点或 mark；不要拆分可见字符。
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
    throw new Error(
      'Text not found. Read the draft and supply visible text within one paragraph outside code blocks.'
    );
  if (occurrence === 0) return matches;
  if (occurrence !== undefined) {
    const match = matches[occurrence - 1];
    if (!match) throw new Error(`Found ${matches.length} matches. The occurrence is out of range.`);
    return [match];
  }
  if (matches.length !== 1)
    throw new Error(
      `Found ${matches.length} matches. Specify the occurrence, or use 0 only if the user explicitly requested all matches.`
    );
  return matches;
}

function colorValue(value: unknown): string | null {
  if (typeof value !== 'string') throw new Error('Supply a HEX color or none to clear it.');
  if (value.trim().toLowerCase() === 'none') return null;
  const color = normalizeHexColor(value);
  if (!color) throw new Error('Use #RGB, #RRGGBB or none.');
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
    input.image_index === undefined ? null : numbered(images, input.image_index, 'body image').node;
  const src = original ? safeCardImage(original.attrs.src) : '';
  if (original && !src)
    throw new Error('Import this image as an attachment before reusing it in a card.');
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
    'Use the components_version returned by read_editor_components for this draft. Refresh after content edits.'
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
        'Component indices are unavailable or stale. Call read_editor_components and use the new components_version.'
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
    // 修改草稿前先校验持久化表示，不写入实时编辑器，也不调用 API 写入。
    const restored = current.codec.parse(markdown);
    if (!restored.eq(next))
      throw new Error(
        'The rich text could not be serialized without loss. The draft was left intact.'
      );
    return draft.write(markdown, current.fileKey);
  }
  const tools: AgentTool[] = [
    {
      name: 'read_editor_components',
      description:
        'List body images and card lists with their content, layout and one-based indices in the latest draft. Refresh after content changes. The images collection excludes card images, whose size is shared by the entire list.',
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
        'Insert a horizontal or vertical card list of any length. Items contain plain text, with bold titles and multiline bodies. To reuse an existing body image, supply its image_index and current components_version. Omit the index for an empty image slot. Insert after the top-level block containing after_text, or append by default.',
      parameters: schema(
        {
          ...fileKeyProperty,
          layout: layoutProperty,
          image_size: imageSizeProperty,
          image_height: imageHeightProperty,
          components_version: componentsVersionProperty,
          after_text: string(
            'Optional unique visible text in one paragraph. Insert after its containing top-level block.'
          ),
          items: {
            type: 'array',
            minItems: 1,
            description: 'Cards to insert. More than four are supported.',
            items: schema(
              {
                title: string('Optional plain-text title rendered in bold.'),
                text: string(
                  'Plain text with optional line breaks. An empty string leaves the text area empty.'
                ),
                image_index: integer(
                  'Optional body image index from read_editor_components. Only images marked reusable_in_card qualify, including supported HTTP(S) and attachment URLs. Omit for an empty slot.',
                  1
                ),
                image_alt: string('Optional image description. Defaults to the original alt text.'),
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
        'Change layout or image dimensions for an entire card list using its current list_index. Preserve all cards, images and formatting. Horizontal lists wrap after four items. Card images share their size and alignment.',
      parameters: schema(
        {
          ...fileKeyProperty,
          list_index: integer('One-based card list index.', 1),
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
          throw new Error('Supply at least one of layout, image_size or image_height.');
        const current = await load(input, context);
        requireCurrentComponents(input, current);
        const { node, pos } = numbered(
          components(current.doc).cardLists,
          Number(input.list_index),
          'card list'
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
        'Apply or clear font family, font size, foreground or background color on visible text within one paragraph, including headings, lists, tables and cards. Preserve other marks such as links and bold. Code is excluded, and font family and size affect only text nodes. Provide a unique match or specify occurrence.',
      parameters: schema(
        {
          ...fileKeyProperty,
          text: string(
            'Visible text within one paragraph. It may cross bold or link marks, but cannot cross images or other components.'
          ),
          occurrence: integer(
            'Optional one-based match index. Omit for a unique match. Use 0 only when the user explicitly requests all occurrences.',
            0
          ),
          font_family: {
            type: 'string',
            enum: [...FONT_FAMILIES.map((font) => font.id), 'none'],
            description: `Registered font IDs and display names: ${FONT_FAMILIES.map((font) => `${font.id} (${font.label})`).join(', ')}. Use none to restore the default family while preserving other formatting. Only registered IDs are accepted.`,
          },
          font_size: {
            type: 'number',
            minimum: 0,
            maximum: 96,
            description:
              'Optional size in pixels from 8 to 96 in steps of 0.5. Use 0 to restore the default size while preserving other formatting.',
          },
          text_color: string('Optional HEX text color, e.g. #F00 or #FF0000. Use none to clear.'),
          background_color: string(
            'Optional HEX background color, e.g. #FFF59D. Use none to clear.'
          ),
        },
        ['text']
      ),
      execute: async (input, context) => {
        const styles: {
          kind: string;
          attrs: { color: string } | { size: number } | { family: string } | null;
        }[] = [];
        for (const [parameter, kind] of [
          ['text_color', 'textColor'],
          ['background_color', 'highlight'],
        ] as const) {
          if (input[parameter] === undefined) continue;
          const color = colorValue(input[parameter]);
          styles.push({ kind, attrs: color === null ? null : { color } });
        }
        if (input.font_family !== undefined) {
          const family =
            input.font_family === 'none' ? null : normalizeFontFamily(input.font_family);
          if (input.font_family !== 'none' && family === null)
            throw new Error('Supply a registered font_family ID or none to restore the default.');
          styles.push({ kind: 'fontFamily', attrs: family === null ? null : { family } });
        }
        if (input.font_size !== undefined) {
          const size = input.font_size === 0 ? null : normalizeFontSize(input.font_size);
          if (input.font_size !== 0 && size === null)
            throw new Error(
              'Font size must be 8–96 px in steps of 0.5, or 0 to restore the default.'
            );
          styles.push({ kind: 'fontSize', attrs: size === null ? null : { size } });
        }
        if (!styles.length)
          throw new Error(
            'Supply at least one of font_family, font_size, text_color or background_color.'
          );
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
                ((kind === 'fontSize' || kind === 'fontFamily') && !node.isText) ||
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
          throw new Error(
            'The range contains no styleable text. Code and standalone components cannot be styled.'
          );
        return { ...save(current, tr.doc), matched: ranges.length };
      },
    },
    {
      name: 'set_image_layout',
      description:
        'Change body image width or alignment while preserving the URL, alt text, title and other formatting. Read component indices first. Use 0 only for an explicit request to change all body images. Use update_card_list_layout for card images.',
      parameters: schema(
        {
          ...fileKeyProperty,
          image_index: integer('One-based body image index, or 0 for all body images.', 0),
          components_version: componentsVersionProperty,
          width: integer(
            `Optional integer width of ${MIN_WIDTH}–${MAX_WIDTH} px. Use 0 for the original size. Height stays proportional.`,
            0,
            MAX_WIDTH
          ),
          alignment: {
            type: 'string',
            enum: ['left', 'center', 'right', 'inline'],
            description: 'Optional alignment. Use inline to clear block alignment.',
          },
        },
        ['image_index', 'components_version']
      ),
      execute: async (input, context) => {
        if (input.width === undefined && input.alignment === undefined)
          throw new Error('Supply width or alignment.');
        const width =
          input.width === undefined || input.width === 0 ? null : parseWidth(input.width);
        if (input.width !== undefined && input.width !== 0 && width === null)
          throw new Error(
            `Width must be an integer from ${MIN_WIDTH} to ${MAX_WIDTH}, or 0 for the original size.`
          );
        const current = await load(input, context);
        requireCurrentComponents(input, current);
        const { images } = components(current.doc);
        if (!images.length)
          throw new Error(
            'The draft has no body images. Use update_card_list_layout for card images.'
          );
        const targets =
          input.image_index === 0
            ? images
            : [numbered(images, Number(input.image_index), 'body image')];
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
