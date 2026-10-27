declare module '@voex/editor-schema' {
  export const SCHEMA_VERSION: string;
  export function createMarkdownCodec(): Promise<{
    schema: Parameters<typeof import('y-prosemirror').yXmlFragmentToProseMirrorRootNode>[1];
    parse(markdown: string): Parameters<typeof import('y-prosemirror').prosemirrorToYXmlFragment>[0];
    serialize(node: Parameters<typeof import('y-prosemirror').prosemirrorToYXmlFragment>[0]): string;
  }>;
}
