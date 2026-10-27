import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { paragraphSchema } from '@milkdown/kit/preset/commonmark';
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model';

/** Same paragraph serialization in both runtimes; headless callers provide the real input root. */
export function configureParagraph(ctx: Ctx, getRoot?: () => ProseNode | null) {
  ctx.update(paragraphSchema.key, (previous) => (schemaCtx) => {
    const base = previous(schemaCtx);
    return {
      ...base,
      toMarkdown: {
        match: base.toMarkdown.match,
        runner: (state, node) => {
          const root = getRoot ? getRoot() : ctx.get(editorViewCtx).state?.doc;
          state.openNode('paragraph');
          if (
            !node.content.size &&
            node !== root?.lastChild &&
            ctx.isInjected('remark-preserve-empty-line')
          )
            state.addNode('html', undefined, '<br />');
          else if (node.lastChild?.type.name === 'hardbreak') {
            const content: ProseNode[] = [];
            node.forEach((child, _offset, index) => {
              if (index < node.childCount - 1) content.push(child);
            });
            state.next(Fragment.fromArray(content));
          } else state.next(node.content);
          state.closeNode();
        },
      },
    };
  });
}
