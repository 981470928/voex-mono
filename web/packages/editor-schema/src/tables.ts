import type { Ctx } from '@milkdown/kit/ctx';
import { remarkPluginsCtx } from '@milkdown/kit/core';
import { tableCellSchema, tableHeaderSchema } from '@milkdown/kit/preset/gfm';
import type { MarkdownNode } from '@milkdown/kit/transformer';
import { $remark } from '@milkdown/kit/utils';
import {
  normalizeColwidth,
  restoreTableWidths,
} from '../../../src/views/edit/milkdown/table-widths';
export const tableWidthsRemark = $remark('voex-remark-table-widths', () => () => (tree) => {
  restoreTableWidths(tree as MarkdownNode);
});

// Legacy width comments must be consumed before commonmark turns HTML into paragraphs.
const ordinaryTableRemark = tableWidthsRemark.plugin;
tableWidthsRemark.plugin = tableWidthsRemark[1] = (ctx) => {
  const run = ordinaryTableRemark(ctx);
  return async () => {
    const dispose = await run();
    ctx.update(remarkPluginsCtx, (plugins) => {
      // Find our registered transformer by the options slice's stable reference.
      const options = ctx.get(tableWidthsRemark.options.key);
      const own = plugins.find((plugin) => plugin.options === options);
      return own ? [own, ...plugins.filter((plugin) => plugin !== own)] : plugins;
    });
    return () => {
      if (typeof dispose === 'function') return dispose();
    };
  };
};

function getCellAttrs(node: MarkdownNode) {
  const colspan = Math.max(1, Number(node.colspan) || 1);
  return {
    alignment: typeof node.align === 'string' ? node.align : 'left',
    colwidth: normalizeColwidth(node.colwidth, colspan),
  };
}

export function extendCellSchema(
  schema: typeof tableCellSchema | typeof tableHeaderSchema,
  ctx: Ctx
) {
  ctx.update(schema.key, (previous) => (schemaCtx) => {
    const base = previous(schemaCtx);
    return {
      ...base,
      parseMarkdown: {
        match: base.parseMarkdown.match,
        runner: (state, node, type) => {
          state
            .openNode(type, getCellAttrs(node))
            .openNode(state.schema.nodes.paragraph!)
            .next(node.children ?? [])
            .closeNode()
            .closeNode();
        },
      },
    };
  });
}

export function configureTables(ctx: Ctx) {
  extendCellSchema(tableCellSchema, ctx);
  extendCellSchema(tableHeaderSchema, ctx);
}
