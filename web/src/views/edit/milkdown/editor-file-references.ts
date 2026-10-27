import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export interface FileReference {
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
  href: string;
}

export function isFileReference(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return false;
  const path = value.trim();
  return (
    /^(?:[a-z]:[\\/]|file:\/\/|\\\\)/i.test(path) ||
    /^(?:\/(?!\/)|\.{1,2}\/|~\/).+(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/.test(path)
  );
}

function scanText(text: string, offset: number): FileReference[] {
  const references: FileReference[] = [];
  const opening = /\[([^\]\r\n[]+)\]\\?\(/g;
  for (let match = opening.exec(text); match; match = opening.exec(text)) {
    if (match.index > 0 && /[!\\]/.test(text[match.index - 1]!)) continue;
    const pathStart = opening.lastIndex;
    let depth = 1;
    let end = pathStart;
    for (; end < text.length; end++) {
      const char = text[end];
      if (char === '\n' || char === '\r') break;
      if (char === '\\' && /[()]/.test(text[end + 1] ?? '')) {
        end++;
        continue;
      }
      if (char === '(') depth++;
      if (char === ')' && --depth === 0) break;
    }
    if (depth !== 0) continue;
    const href = text
      .slice(pathStart, end)
      .trim()
      .replace(/^<(.+)>$/, '$1')
      .replace(/\\([()])/g, '$1');
    if (!isFileReference(href)) continue;
    const from = offset + match.index;
    references.push({
      from,
      to: offset + end + 1,
      labelFrom: from + 1,
      labelTo: from + 1 + match[1]!.length,
      href,
    });
    opening.lastIndex = end + 1;
  }
  return references;
}

function blockReferences(block: ProseNode, start: number): FileReference[] {
  const result: FileReference[] = [];
  let text = '';
  let offset = start;
  const flush = () => {
    if (text) result.push(...scanText(text, offset));
    text = '';
  };
  block.forEach((node, position) => {
    if (
      !node.isText ||
      node.marks.some(
        (mark) => mark.type.spec.code || ['inlineCode', 'code', 'link'].includes(mark.type.name)
      )
    ) {
      flush();
      return;
    }
    if (!text) offset = start + position;
    text += node.text;
  });
  flush();
  return result;
}

export function fileReferenceAt(doc: ProseNode, pos: number): FileReference | undefined {
  const resolved = doc.resolve(pos);
  if (!resolved.parent.isTextblock || resolved.parent.type.spec.code) return;
  return blockReferences(resolved.parent, resolved.start()).find(
    (reference) => pos >= reference.from && pos < reference.to
  );
}

function decorations(doc: ProseNode): DecorationSet {
  const result: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return;
    for (const reference of blockReferences(node, position + 1)) {
      // Presentation only: keep the original Markdown and collaboration state intact.
      const hidden = { style: 'display: none', 'aria-hidden': 'true' };
      result.push(
        Decoration.inline(reference.from, reference.labelFrom, hidden),
        Decoration.inline(reference.labelFrom, reference.labelTo, {
          nodeName: 'a',
          'data-voex-file-reference': reference.href,
          role: 'link',
          'aria-disabled': 'true',
          tabindex: '0',
          title: reference.href,
        }),
        Decoration.inline(reference.labelTo, reference.to, hidden)
      );
    }
    return false;
  });
  return DecorationSet.create(doc, result);
}

export function createFileReferencePlugin() {
  const key = new PluginKey<DecorationSet>('voex-file-references');
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (transaction, previous) =>
            transaction.docChanged ? decorations(transaction.doc) : previous,
        },
        props: { decorations: (state) => key.getState(state) },
      })
  );
}
