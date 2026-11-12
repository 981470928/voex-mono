import { Messages, httpStatus, invalidFormatMessage, logFailure, mustBeMessage } from "./errors.js";
import * as Y from "yjs";
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "y-prosemirror";
import { SCHEMA_VERSION } from "@voex/editor-schema";
import {
  ARCHIVE_DOCUMENT_KEY,
  collectTransferReferences,
  createTransferCodec,
  exportPortableMarkdown,
  readTransferDocument,
  remapNativeDocument,
  type TransferAsset,
  type TransferWarning,
} from "@voex/editor-schema/transfer";
import type { DocumentCodec } from "./documents.js";
import { MAX_STATE } from "./config.js";
import { decode, key, ServiceError } from "./protocol.js";

export async function createTransferService(documents: DocumentCodec) {
  const { codec, snapshot } = documents;
  const portable = await createTransferCodec();
  return function transfer(input: unknown): object {
    try {
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new ServiceError(invalidFormatMessage("转换请求"), httpStatus.HTTP_STATUS_BAD_REQUEST);
      const body = input as Record<string, unknown>;
      if (!["decode", "export", "import"].includes(String(body.action)))
        throw new ServiceError(Messages.ConversionActionInvalid, httpStatus.HTTP_STATUS_BAD_REQUEST);
      if (
        body.schema_version !== undefined &&
        body.schema_version !== SCHEMA_VERSION
      )
        throw new ServiceError(Messages.DocumentSchemaMismatch, httpStatus.HTTP_STATUS_CONFLICT);
      if (
        (body.document !== undefined || body.state_base64) &&
        body.schema_version !== SCHEMA_VERSION
      )
        throw new ServiceError(Messages.DocumentSchemaRequired, httpStatus.HTTP_STATUS_BAD_REQUEST);
      const sources = [
        body.document !== undefined,
        !!body.state_base64,
        body.markdown !== undefined,
      ].filter(Boolean).length;
      if (sources !== 1) throw new ServiceError(Messages.DocumentSourceExclusive, httpStatus.HTTP_STATUS_BAD_REQUEST);
      const warnings: TransferWarning[] = [];
      let node;
      if (body.document !== undefined)
        node = readTransferDocument(body.document, codec);
      else if (body.state_base64) {
        if (typeof body.state_base64 !== "string")
          throw new ServiceError(invalidFormatMessage("协作快照"), httpStatus.HTTP_STATUS_BAD_REQUEST);
        const state = decode(body.state_base64, MAX_STATE);
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, state);
          for (const name of doc.share.keys())
            if (name !== "prosemirror")
              throw new ServiceError(Messages.CollaborationSnapshotFieldsInvalid, httpStatus.HTTP_STATUS_BAD_REQUEST);
          const stored = yXmlFragmentToProseMirrorRootNode(
            doc.getXmlFragment("prosemirror"),
            codec.schema,
          );
          node = readTransferDocument(stored.toJSON(), codec);
        } finally {
          doc.destroy();
        }
      } else {
        if (typeof body.markdown !== "string")
          throw new ServiceError(invalidFormatMessage("Markdown 正文"), httpStatus.HTTP_STATUS_BAD_REQUEST);
        node =
          body.action === "import"
            ? portable.importMarkdown(body.markdown, warnings)
            : codec.parse(body.markdown);
      }
      if (body.action === "decode")
        return {
          document: node.toJSON(),
          schema_version: SCHEMA_VERSION,
          references: collectTransferReferences(node),
          warnings,
        };
      if (body.action === "export") {
        if (body.format === "voex")
          return {
            document: remapNativeDocument(node, ARCHIVE_DOCUMENT_KEY).toJSON(),
            schema_version: SCHEMA_VERSION,
            warnings,
          };
        if (body.format !== "markdown")
          throw new ServiceError(invalidFormatMessage("导出"), httpStatus.HTTP_STATUS_BAD_REQUEST);
        if (
          body.preserve_styles !== undefined &&
          typeof body.preserve_styles !== "boolean"
        )
          throw new ServiceError(mustBeMessage("样式选项", Messages.BooleanType), httpStatus.HTTP_STATUS_BAD_REQUEST);
        if (!Array.isArray(body.assets) || body.assets.length > 100000)
          throw new ServiceError(invalidFormatMessage("附件映射"), httpStatus.HTTP_STATUS_BAD_REQUEST);
        for (const asset of body.assets) {
          if (
            !asset ||
            typeof asset !== "object" ||
            typeof asset.hash !== "string" ||
            typeof asset.path !== "string"
          )
            throw new ServiceError(invalidFormatMessage("附件映射"), httpStatus.HTTP_STATUS_BAD_REQUEST);
        }
        return {
          markdown: exportPortableMarkdown(
            node,
            codec,
            body.assets as TransferAsset[],
            body.preserve_styles === true,
            warnings,
          ),
          schema_version: SCHEMA_VERSION,
          warnings,
        };
      }
      if (typeof body.file_key !== "string")
        throw new ServiceError(Messages.ImportTargetRequired, httpStatus.HTTP_STATUS_BAD_REQUEST);
      node = remapNativeDocument(node, key(body.file_key));
      const available = new Set<string>();
      if (body.assets !== undefined && !Array.isArray(body.assets))
        throw new ServiceError(invalidFormatMessage("附件映射"), httpStatus.HTTP_STATUS_BAD_REQUEST);
      for (const asset of (body.assets ?? []) as TransferAsset[])
        if (asset && !asset.missing) available.add(asset.hash);
      for (const reference of collectTransferReferences(node)) {
        if (
          !available.has(reference.hash) &&
          !warnings.some(
            (warning) =>
              warning.code === "missing_attachment" &&
              warning.source === reference.hash,
          )
        )
          warnings.push({
            code: "missing_attachment",
            message: "附件文件缺失，正文引用已保留",
            name: reference.name,
            source: reference.hash,
          });
      }
      const doc = new Y.Doc();
      try {
        prosemirrorToYXmlFragment(node, doc.getXmlFragment("prosemirror"));
        const result = snapshot(doc);
        return {
          state_base64: result.state,
          markdown: result.markdown,
          schema_version: SCHEMA_VERSION,
          warnings,
        };
      } finally {
        doc.destroy();
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      logFailure('convert document', error);
      throw new ServiceError(Messages.ConversionDocumentInvalid, httpStatus.HTTP_STATUS_BAD_REQUEST);
    }
  };
}
export type TransferService = Awaited<ReturnType<typeof createTransferService>>;
