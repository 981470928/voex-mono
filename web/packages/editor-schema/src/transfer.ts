import type { Mark, Node as ProseNode } from '@milkdown/kit/prose/model';
import { sanitizeLinkHref } from '@milkdown/kit/preset/commonmark';
import { createMarkdownCodec, MAX_MARKDOWN_BYTES, type MarkdownCodec } from './index';
import { parseAlignment, parseWidth, safeImageSource } from './images';
import { readLatexAttrs } from './latex';
import { normalizeHexColor } from './text-color';
import { normalizeFontSize } from './font-size';
import { normalizeFontFamily } from './font-catalog';
import { portableImportRemark } from './transfer-import';

export interface TransferWarning {
  code: string;
  message: string;
  name?: string;
  source?: string;
}
export interface TransferAsset {
  hash: string;
  path: string;
  name?: string;
  mime?: string;
  missing?: boolean;
}
export interface TransferReference {
  kind: 'image' | 'attachment' | 'card' | 'link';
  hash: string;
  source: string;
  document_key?: string;
  name: string;
  mime?: string;
}
type JsonObject = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;
const STYLE_MARKS = new Set(['textColor', 'highlight', 'fontSize', 'fontFamily']);
export const ARCHIVE_DOCUMENT_KEY = '__voex_archive__';

export function attachmentReference(value: unknown): { hash: string; document_key: string } | null {
  if (typeof value !== 'string') return null;
  const match = /^\/api\/download\/([^/?#]+)\/([^/?#]+)$/.exec(value);
  if (!match) return null;
  try {
    const hash = decodeURIComponent(match[2]!);
    const document_key = decodeURIComponent(match[1]!);
    return HASH.test(hash) && /^[A-Za-z0-9_-]{1,128}$/.test(document_key)
      ? { hash, document_key }
      : null;
  } catch {
    return null;
  }
}

function object(value: unknown, message: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as JsonObject;
}
function knownKeys(value: JsonObject, allowed: readonly string[], message: string): void {
  for (const name of Object.keys(value))
    if (!allowed.includes(name)) throw new Error(message + '：' + name);
}
function assertAttrs(value: unknown, allowed: readonly string[]): void {
  if (value === undefined) return;
  knownKeys(object(value, '节点属性必须是对象'), allowed, '文档包含未知属性');
}
function finiteValues(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('节点属性嵌套过深');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('节点属性包含无效数值');
  if (Array.isArray(value)) value.forEach((item) => finiteValues(item, depth + 1));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('节点属性字段无效');
      finiteValues(item, depth + 1);
    }
  }
}

/** Validate before nodeFromJSON: ProseMirror intentionally ignores unknown attributes. / 在调用 nodeFromJSON 前校验：ProseMirror 会有意忽略未知属性。 */
export function readTransferDocument(value: unknown, codec: MarkdownCodec): ProseNode {
  let count = 0;
  function visit(input: unknown, depth: number): void {
    if (++count > 100000 || depth > 128) throw new Error('文档节点数量或嵌套深度超过限制');
    const node = object(input, '文档节点必须是对象');
    knownKeys(node, ['type', 'attrs', 'content', 'marks', 'text'], '文档包含未知节点字段');
    if (typeof node.type !== 'string' || !codec.schema.nodes[node.type])
      throw new Error('文档包含未知节点类型');
    const type = codec.schema.nodes[node.type]!;
    assertAttrs(node.attrs, Object.keys(type.spec.attrs ?? {}));
    finiteValues(node.attrs);
    if (node.text !== undefined && (node.type !== 'text' || typeof node.text !== 'string'))
      throw new Error('文字节点格式无效');
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks) || node.marks.length > 32) throw new Error('文字格式列表无效');
      const markNames = new Set<string>();
      for (const inputMark of node.marks) {
        const mark = object(inputMark, '文字格式必须是对象');
        knownKeys(mark, ['type', 'attrs'], '文字格式包含未知字段');
        if (
          typeof mark.type !== 'string' ||
          !codec.schema.marks[mark.type] ||
          markNames.has(mark.type)
        )
          throw new Error('文档包含未知或重复文字格式');
        markNames.add(mark.type);
        assertAttrs(mark.attrs, Object.keys(codec.schema.marks[mark.type]!.spec.attrs ?? {}));
        finiteValues(mark.attrs);
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || node.type === 'text')
        throw new Error('文档子节点格式无效');
      node.content.forEach((child) => visit(child, depth + 1));
    }
  }
  visit(value, 0);
  if ((value as JsonObject).type !== 'doc') throw new Error('正文根节点必须为 doc');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16 * 1024 * 1024)
    throw new Error('文档结构超过 16 MiB 限制');
  const node = codec.schema.nodeFromJSON(value);
  codec.validate(node);
  validateValues(node);
  return node;
}

function validateValues(root: ProseNode): void {
  root.descendants((node) => {
    const attrs = node.attrs;
    switch (node.type.name) {
      case 'heading':
        if (!Number.isInteger(attrs.level) || attrs.level < 1 || attrs.level > 6)
          throw new Error('标题级别无效');
        break;
      case 'ordered_list':
        if (!Number.isSafeInteger(attrs.order) || attrs.order < 0)
          throw new Error('有序列表起始编号无效');
        break;
      case 'image':
        if (!safeImageSource(attrs.src)) throw new Error('图片地址无效');
        if (attrs.width !== null && parseWidth(attrs.width) === null)
          throw new Error('图片宽度无效');
        if (attrs.alignment !== null && parseAlignment(attrs.alignment) === null)
          throw new Error('图片对齐无效');
        break;
      case 'attachment':
        if (!HASH.test(attrs.hash) || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(attrs.mime))
          throw new Error('附件标识或类型无效');
        if (![null, 'attachment', 'media'].includes(attrs.display))
          throw new Error('附件显示模式无效');
        if (attrs.width !== null && parseWidth(attrs.width) === null)
          throw new Error('附件宽度无效');
        if (attrs.alignment !== null && parseAlignment(attrs.alignment) === null)
          throw new Error('附件对齐无效');
        break;
      case 'voex_latex':
        if (!readLatexAttrs(attrs)) throw new Error('公式格式无效');
        break;
      case 'table_cell':
      case 'table_header':
        if (
          !Number.isSafeInteger(attrs.colspan) ||
          attrs.colspan < 1 ||
          attrs.colspan > 1000 ||
          !Number.isSafeInteger(attrs.rowspan) ||
          attrs.rowspan < 1 ||
          attrs.rowspan > 1000 ||
          !['left', 'center', 'right'].includes(attrs.alignment)
        )
          throw new Error('表格单元格属性无效');
        if (
          attrs.colwidth !== null &&
          (!Array.isArray(attrs.colwidth) ||
            attrs.colwidth.length !== attrs.colspan ||
            attrs.colwidth.some(
              (width: unknown) =>
                typeof width !== 'number' || !Number.isInteger(width) || width < 0 || width > 10000
            ))
        )
          throw new Error('表格列宽无效');
        break;
    }
    for (const mark of node.marks) {
      switch (mark.type.name) {
        case 'textColor':
        case 'highlight':
          if (!normalizeHexColor(mark.attrs.color)) throw new Error('文字颜色无效');
          break;
        case 'fontSize':
          if (normalizeFontSize(mark.attrs.size) === null) throw new Error('文字字号无效');
          break;
        case 'fontFamily':
          if (!normalizeFontFamily(mark.attrs.family)) throw new Error('字体无效');
          break;
        case 'link':
          if (mark.attrs.href && !sanitizeLinkHref(mark.attrs.href))
            throw new Error('链接地址不安全');
          break;
      }
    }
  });
}

export function collectTransferReferences(root: ProseNode): TransferReference[] {
  const result: TransferReference[] = [];
  const seen = new Set<string>();
  const add = (item: TransferReference) => {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  };
  root.descendants((node) => {
    if (node.type.name === 'attachment')
      add({
        kind: 'attachment',
        hash: node.attrs.hash,
        source: node.attrs.hash,
        name: node.attrs.name || node.attrs.hash,
        mime: node.attrs.mime,
      });
    if (node.type.name === 'image' || node.type.name === 'voex_card_item') {
      const ref = attachmentReference(node.attrs.src);
      if (ref)
        add({
          ...ref,
          kind: node.type.name === 'image' ? 'image' : 'card',
          source: node.attrs.src,
          name: node.attrs.alt || ref.hash,
        });
    }
    for (const mark of node.marks)
      if (mark.type.name === 'link') {
        const ref = attachmentReference(mark.attrs.href);
        if (ref)
          add({
            ...ref,
            kind: 'link',
            source: mark.attrs.href,
            name: node.textContent || ref.hash,
          });
      }
  });
  return result;
}

function mapTree(
  root: ProseNode,
  map: (node: ProseNode, children: ProseNode[]) => ProseNode[]
): ProseNode {
  const visit = (node: ProseNode): ProseNode[] => {
    const children: ProseNode[] = [];
    node.forEach((child) => children.push(...visit(child)));
    return map(node, children);
  };
  const result = visit(root);
  if (result.length !== 1 || result[0]!.type.name !== 'doc') throw new Error('正文转换结果无效');
  return result[0]!;
}

export function remapNativeDocument(root: ProseNode, documentKey: string): ProseNode {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(documentKey)) throw new Error('目标文档标识无效');
  const source = (value: string) => {
    const ref = attachmentReference(value);
    return ref ? '/api/download/' + encodeURIComponent(documentKey) + '/' + ref.hash : value;
  };
  return mapTree(root, (node, children) => {
    const attrs = { ...node.attrs };
    if (node.type.name === 'image' || node.type.name === 'voex_card_item')
      attrs.src = source(attrs.src);
    const marks = node.marks.map((mark) =>
      mark.type.name === 'link'
        ? mark.type.create({ ...mark.attrs, href: source(mark.attrs.href) })
        : mark
    );
    return [node.isText ? node.mark(marks) : node.type.create(attrs, children, marks)];
  });
}

function warningOnce(warnings: TransferWarning[], warning: TransferWarning): void {
  if (
    !warnings.some(
      (item) =>
        item.code === warning.code && item.source === warning.source && item.name === warning.name
    )
  )
    warnings.push(warning);
}
function unresolvedLocal(source: string): boolean {
  return (
    !!source &&
    !source.startsWith('#') &&
    !/^(?:https?:|mailto:|tel:|ftp:|data:|blob:|\/\/)/i.test(source)
  );
}

export async function createTransferCodec() {
  const external = await createMarkdownCodec([...portableImportRemark]);
  function importMarkdown(markdown: string, warnings: TransferWarning[]): ProseNode {
    if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN_BYTES)
      throw new Error('文档正文超过 2 MiB 限制');
    const parsed = external.parse(markdown.replace(/^\uFEFF/, ''));
    const normalized = mapTree(parsed, (node, children) => {
      let marks = node.marks.filter((mark) => mark.type.name !== 'fontFamily');
      marks = marks.filter((mark) => {
        if (mark.type.name !== 'link') return true;
        const href = String(mark.attrs.href);
        if (unresolvedLocal(href))
          warningOnce(warnings, {
            code: 'local_resource',
            message: '本地引用未随 Markdown 导入',
            source: href,
            name: node.textContent || href,
          });
        if (!href || sanitizeLinkHref(href)) return true;
        warningOnce(warnings, {
          code: 'unsafe_link',
          message: '不支持的链接已保留为文字',
          source: href,
        });
        return false;
      });
      if (node.type.name === 'image') {
        const src = String(node.attrs.src);
        if (unresolvedLocal(src))
          warningOnce(warnings, {
            code: 'local_resource',
            message: '本地图片未随 Markdown 导入',
            source: src,
            name: node.attrs.alt || src,
          });
        if (!safeImageSource(src)) {
          warningOnce(warnings, {
            code: 'unsupported_image',
            message: '不支持的图片地址已保留为文字',
            source: src,
          });
          return [external.schema.text('![' + String(node.attrs.alt) + '](' + src + ')', marks)];
        }
      }
      if (node.type.name === 'html')
        warningOnce(warnings, { code: 'raw_html', message: '未识别的 HTML 已保留为源码' });
      return [node.isText ? node.mark(marks) : node.type.create(node.attrs, children, marks)];
    });
    external.validate(normalized);
    validateValues(normalized);
    return normalized;
  }
  return { importMarkdown };
}

export function exportPortableMarkdown(
  root: ProseNode,
  codec: MarkdownCodec,
  assets: TransferAsset[],
  preserveStyles: boolean,
  warnings: TransferWarning[]
): string {
  const schema = codec.schema;
  const byHash = new Map(assets.map((asset) => [asset.hash, asset]));
  for (const asset of assets) {
    if (
      !HASH.test(asset.hash) ||
      !asset.path.startsWith('assets/') ||
      asset.path.includes('\\') ||
      Array.from(asset.path).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ) ||
      asset.path.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('附件导出路径无效');
  }
  function location(hash: string): string {
    const asset = byHash.get(hash);
    if (!asset || asset.missing)
      warningOnce(warnings, {
        code: 'missing_attachment',
        message: '附件文件缺失，正文引用已保留',
        name: asset?.name || hash,
        source: hash,
      });
    return (asset?.path || 'assets/missing-' + hash).split('/').map(encodeURIComponent).join('/');
  }
  const source = (value: string) => {
    const ref = attachmentReference(value);
    if (ref) return location(ref.hash);
    if (unresolvedLocal(value))
      warningOnce(warnings, {
        code: 'local_resource',
        message: '本地或相对引用未随导出包提供，原引用已保留',
        source: value,
        name: value,
      });
    if (/^blob:/i.test(value))
      warningOnce(warnings, {
        code: 'temporary_resource',
        message: '临时图片地址无法随文档迁移，原引用已保留',
        source: value,
      });
    return value;
  };
  function marks(node: ProseNode): Mark[] {
    return node.marks
      .filter((mark) => !STYLE_MARKS.has(mark.type.name))
      .map((mark) =>
        mark.type.name === 'link'
          ? mark.type.create({ ...mark.attrs, href: source(mark.attrs.href) })
          : mark
      );
  }
  const paragraph = (nodes: ProseNode[]) => schema.nodes.paragraph!.create(null, nodes);
  function image(src: string, alt: string, title: string | null = ''): ProseNode {
    return schema.nodes.image!.create({
      src,
      alt,
      title: title ?? '',
      width: null,
      alignment: null,
    });
  }
  const converted = mapTree(root, (node, children) => {
    if (node.type.name === 'voex_card_list') {
      warningOnce(warnings, { code: 'card_layout', message: '卡片已展开为图片和文字，布局未保留' });
      return children;
    }
    if (node.type.name === 'voex_card_item') {
      return [
        ...(node.attrs.src ? [paragraph([image(source(node.attrs.src), node.attrs.alt)])] : []),
        ...children,
      ];
    }
    if (node.type.name === 'voex_card_text') return [paragraph(children)];
    if (node.type.name === 'attachment') {
      const href = location(node.attrs.hash);
      return [
        paragraph(
          node.attrs.mime.toLowerCase().startsWith('image/')
            ? [image(href, node.attrs.name)]
            : [
                schema.text(node.attrs.name || '附件', [
                  schema.marks.link!.create({ href, title: null }),
                ]),
              ]
        ),
      ];
    }
    if (node.type.name === 'voex_latex') {
      warningOnce(warnings, {
        code: 'formula_style',
        message: '公式已保留 LaTeX 源码，显示样式未保留',
      });
      return [paragraph([schema.nodes.html!.create({ value: '$$\n' + node.attrs.code + '\n$$' })])];
    }
    if (node.type.name === 'image') {
      return [image(source(node.attrs.src), node.attrs.alt, node.attrs.title).mark(marks(node))];
    }
    if (node.type.name === 'html') {
      warningOnce(warnings, { code: 'raw_html', message: '原始 HTML 已作为源码文字导出' });
      return node.attrs.value ? [schema.text(String(node.attrs.value), marks(node))] : [];
    }
    if (node.type.name === 'table') {
      let complex = false;
      node.descendants((cell) => {
        if (
          ['table_cell', 'table_header'].includes(cell.type.name) &&
          (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1)
        )
          complex = true;
      });
      if (complex) {
        warningOnce(warnings, {
          code: 'merged_table',
          message: '合并单元格表格已按行展开，保留单元格内容',
        });
        const rows: ProseNode[] = [];
        for (const row of children)
          row.forEach((cell) => cell.forEach((entry) => rows.push(entry)));
        return rows.length ? rows : [paragraph([])];
      }
    }
    const cleanMarks = marks(node);
    const next = node.isText
      ? node.mark(cleanMarks)
      : node.type.create(node.attrs, children, cleanMarks);
    if (!preserveStyles || !node.isText) return [next];
    const css: string[] = [];
    for (const mark of node.marks) {
      if (mark.type.name === 'textColor') css.push('color: ' + normalizeHexColor(mark.attrs.color));
      if (mark.type.name === 'highlight')
        css.push('background-color: ' + normalizeHexColor(mark.attrs.color));
      if (mark.type.name === 'fontSize')
        css.push('font-size: ' + normalizeFontSize(mark.attrs.size) + 'px');
    }
    return css.length
      ? [
          schema.nodes.html!.create({ value: '<span style="' + css.join('; ') + '">' }),
          next,
          schema.nodes.html!.create({ value: '</span>' }),
        ]
      : [next];
  });
  return codec.serialize(converted);
}
