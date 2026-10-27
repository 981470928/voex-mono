import type { Node as ProseNode, Schema, ResolvedPos } from '@milkdown/kit/prose/model';
import type { Selection } from '@milkdown/kit/prose/state';
import { normalizeHexColor } from './text-color';
import { normalizeFontSize } from '@voex/editor-schema/font-size';

export const CARD_LIST = 'voex_card_list';
export const CARD_ITEM = 'voex_card_item';
export const CARD_TEXT = 'voex_card_text';
export const CARD_LANGUAGE = 'voex-cards';
export const MIN_CARD_IMAGE_SIZE = 80;
export const MAX_CARD_IMAGE_SIZE = 320;
export const DEFAULT_CARD_IMAGE_SIZE = 160;
export const MIN_CARD_IMAGE_HEIGHT = 40;
export const MAX_CARD_IMAGE_HEIGHT = 640;
export const MAX_CARD_PADDING = 160;
export type CardImageFit = 'contain' | 'cover';

export const DEFAULT_CARD_IMAGE_HEIGHT = 100;

export function cardImageHeight(value: unknown): number {
  const height = Number(value);
  return Number.isFinite(height)
    ? Math.max(MIN_CARD_IMAGE_HEIGHT, Math.min(MAX_CARD_IMAGE_HEIGHT, Math.round(height)))
    : DEFAULT_CARD_IMAGE_HEIGHT;
}

export function cardPadding(value: unknown): number {
  const padding = Number(value);
  return Number.isFinite(padding)
    ? Math.max(0, Math.min(MAX_CARD_PADDING, Math.round(padding)))
    : 0;
}

export function cardImageFit(value: unknown): CardImageFit {
  return value === 'contain' ? 'contain' : 'cover';
}
export type CardLayout = 'horizontal' | 'vertical';

export function cardImageSize(value: unknown): number {
  const size = Number(value);
  return Number.isFinite(size)
    ? Math.max(MIN_CARD_IMAGE_SIZE, Math.min(MAX_CARD_IMAGE_SIZE, Math.round(size)))
    : DEFAULT_CARD_IMAGE_SIZE;
}

export function cardAncestor(position: ResolvedPos, type = CARD_LIST) {
  for (let depth = position.depth; depth > 0; depth--) {
    if (position.node(depth).type.name === type)
      return { node: position.node(depth), pos: position.before(depth), depth };
  }
  return null;
}

export function inCardText(selection: Selection): boolean {
  return Boolean(cardAncestor(selection.$from) || cardAncestor(selection.$to));
}

function hasControlOrSpace(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127);
}

export function safeCardImage(value: unknown): string {
  if (typeof value !== 'string' || hasControlOrSpace(value)) return '';
  if (/^\/api\/download\/[^/?#]+\/[^/?#]+$/.test(value)) return value;
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol) ? value : '';
  } catch {
    return '';
  }
}

export function emptyCard(schema: Schema): ProseNode {
  return schema.nodes[CARD_ITEM]!.create(null, schema.nodes[CARD_TEXT]!.create());
}

export function validCardList(node: ProseNode): boolean {
  if (node.type.name !== CARD_LIST || !['horizontal', 'vertical'].includes(node.attrs.layout))
    return false;
  if (node.attrs.imageSize !== cardImageSize(node.attrs.imageSize)) return false;
  if (node.attrs.imageHeight !== cardImageHeight(node.attrs.imageHeight)) return false;
  if (node.attrs.imageFit !== cardImageFit(node.attrs.imageFit)) return false;
  if (node.attrs.padding !== cardPadding(node.attrs.padding)) return false;
  if (!node.childCount) return false;
  let valid = true;
  node.forEach((item) => {
    if (item.type.name !== CARD_ITEM || !item.childCount) valid = false;
    if (typeof item.attrs.src !== 'string' || (item.attrs.src && !safeCardImage(item.attrs.src)))
      valid = false;
    if (typeof item.attrs.alt !== 'string') valid = false;
    item.forEach((paragraph) => {
      if (paragraph.type.name !== CARD_TEXT) valid = false;
      paragraph.forEach((text) => {
        if (!text.isText) valid = false;
        for (const mark of text.marks) {
          const name = mark.type.name;
          if (['strong', 'emphasis', 'strike_through', 'inlineCode'].includes(name)) continue;
          if (name === 'fontSize') {
            if (typeof mark.attrs.size !== 'number' || normalizeFontSize(mark.attrs.size) === null)
              valid = false;
            continue;
          }
          if (name === 'textColor' || name === 'highlight') {
            if (!normalizeHexColor(mark.attrs.color)) valid = false;
            continue;
          }
          if (name === 'link') {
            const href = String(mark.attrs.href ?? '').trim();
            try {
              if (
                !['http:', 'https:', 'mailto:', 'tel:'].includes(
                  new URL(href, 'https://voex.local/').protocol
                )
              )
                valid = false;
            } catch {
              valid = false;
            }
            continue;
          }
          valid = false;
        }
      });
    });
  });
  return valid;
}

export function parseCardList(value: string, schema: Schema): ProseNode | null {
  try {
    const data = JSON.parse(value) as { version?: number; node?: unknown };
    if (data.version !== 1 || !data.node) return null;
    const node = schema.nodeFromJSON(data.node);
    node.check();
    return validCardList(node) ? node : null;
  } catch {
    return null;
  }
}

export function serializeCardList(node: ProseNode): string {
  return JSON.stringify({ version: 1, node: node.toJSON() });
}
