import { Messages, httpStatus, sizeLimitMessage } from "./errors.js";
/** 共享编辑器 schema 的边界：Yjs 状态校验与 Markdown 投影必须使用同一份 schema。 */
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createMarkdownCodec } from '@voex/editor-schema';
import { MAX_STATE } from './config.js';
import { base64, ServiceError } from './protocol.js';

export async function createDocumentCodec() {
  const codec = await createMarkdownCodec();
  /** 拒绝未知共享字段和超大文档，同时生成将与二进制一起提交的 Markdown。 */
  function snapshot(doc: Y.Doc) {
    for (const name of doc.share.keys())
      if (name !== 'prosemirror') throw new ServiceError(Messages.InvalidRequest, httpStatus.HTTP_STATUS_BAD_REQUEST);
    const node = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('prosemirror'), codec.schema);
    const state = Y.encodeStateAsUpdate(doc);
    if (state.byteLength > MAX_STATE) throw new ServiceError(sizeLimitMessage("协同文档"), httpStatus.HTTP_STATUS_PAYLOAD_TOO_LARGE);
    return { state: base64(state), markdown: codec.serialize(node) };
  }
  return { codec, snapshot };
}
export type DocumentCodec = Awaited<ReturnType<typeof createDocumentCodec>>;
