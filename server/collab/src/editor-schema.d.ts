declare module "@voex/editor-schema" {
  export const SCHEMA_VERSION: string;
  export function createMarkdownCodec(): Promise<{
    schema: Parameters<
      typeof import("y-prosemirror").yXmlFragmentToProseMirrorRootNode
    >[1];
    parse(
      markdown: string,
    ): Parameters<typeof import("y-prosemirror").prosemirrorToYXmlFragment>[0];
    validate(
      node: Parameters<
        typeof import("y-prosemirror").prosemirrorToYXmlFragment
      >[0],
    ): void;
    serialize(
      node: Parameters<
        typeof import("y-prosemirror").prosemirrorToYXmlFragment
      >[0],
    ): string;
  }>;
}

declare module "@voex/editor-schema/transfer" {
  type Node = Parameters<
    typeof import("y-prosemirror").prosemirrorToYXmlFragment
  >[0];
  type Codec = Awaited<
    ReturnType<typeof import("@voex/editor-schema").createMarkdownCodec>
  >;
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
    kind: "image" | "attachment" | "card" | "link";
    hash: string;
    source: string;
    document_key?: string;
    name: string;
    mime?: string;
  }
  export const ARCHIVE_DOCUMENT_KEY: string;
  export function collectTransferReferences(node: Node): TransferReference[];
  export function readTransferDocument(value: unknown, codec: Codec): Node;
  export function remapNativeDocument(node: Node, documentKey: string): Node;
  export function createTransferCodec(): Promise<{
    importMarkdown(markdown: string, warnings: TransferWarning[]): Node;
  }>;
  export function exportPortableMarkdown(
    node: Node,
    codec: Codec,
    assets: TransferAsset[],
    preserveStyles: boolean,
    warnings: TransferWarning[],
  ): string;
}
