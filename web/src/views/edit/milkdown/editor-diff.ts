import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { diffComponent, diffComponentConfig } from '@milkdown/kit/component/diff';
import {
  clearDiffReviewCmd,
  diff,
  diffPluginKey,
  getPendingChanges,
  startDiffReviewCmd,
} from '@milkdown/kit/plugin/diff';
import { ATTACHMENT_NODE_ID } from '@voex/editor-schema/attachment';
import { LATEX_NODE_ID } from '@voex/editor-schema/latex';
import { MERMAID_NODE_ID } from '@voex/editor-schema/mermaid';
import { CARD_LIST } from './card-list-model';

/** Official diff rendering inside an isolated, read-only editor; no apply commands are exposed. */
export function createEditorDiffPreview() {
  return {
    plugins: [...diff, ...diffComponent],
    configure(ctx: Ctx) {
      ctx.update(diffComponentConfig.key, (config) => ({
        ...config,
        acceptLabel: '接受',
        rejectLabel: '拒绝',
        customBlockTypes: [
          'table',
          'code_block',
          CARD_LIST,
          ATTACHMENT_NODE_ID,
          LATEX_NODE_ID,
          MERMAID_NODE_ID,
        ],
      }));
    },
    start(ctx: Ctx, markdown: string): number {
      const commands = ctx.get(commandsCtx);
      if (!commands.call(startDiffReviewCmd.key, markdown)) throw new Error('文档差异无法解析');
      const state = diffPluginKey.getState(ctx.get(editorViewCtx).state);
      const count = state ? getPendingChanges(state).length : 0;
      if (!count) commands.call(clearDiffReviewCmd.key);
      return count;
    },
  };
}
