<template>
  <section
    ref="editorRoot"
    class="milkdown-editor"
    :class="{
      'milkdown-editor--readonly': readonly,
      'milkdown-editor--diff-preview': !!diffPreview,
      'milkdown-editor--floating-navigation': floatingNavigation,
      'milkdown-editor--outline': showOutline,
      'milkdown-editor--minimap': minimapAvailable && supportsMinimap && showMinimap,
    }"
  >
    <div v-if="showOutline" class="milkdown-editor__outline-anchor">
      <EditorOutline
        :items="outlineItems"
        :active-key="activeOutlineKey"
        :navigating="outlineNavigating"
        @select="scrollToOutline"
      />
    </div>
    <div class="milkdown-editor__document">
      <div
        v-if="(!readonly || loading) && showToolbar"
        ref="toolbarRef"
        class="milkdown-editor__toolbar"
        role="group"
        aria-label="编辑工具"
      >
        <button
          v-for="action in toolbarActions"
          :key="action.id"
          type="button"
          class="milkdown-editor__action"
          :class="{ 'milkdown-editor__action--active': toolbarState[action.id]?.active }"
          :data-format="action.id"
          :title="action.label"
          :aria-label="action.label"
          :aria-pressed="action.active ? !!toolbarState[action.id]?.active : undefined"
          :aria-haspopup="action.opensDialog ? 'dialog' : undefined"
          :disabled="loading || !ready || toolbarState[action.id]?.enabled === false"
          @mousedown.prevent
          @click="runAction(action)"
        >
          <SvgIcon v-if="action.id === 'link'" name="editor-link" :size="16" />
          <template v-else>{{ action.text }}</template>
        </button>
        <div ref="toolbarColorHost" class="milkdown-editor__color-controls" />
        <button
          v-for="layout in ['horizontal', 'vertical'] as const"
          :key="layout"
          type="button"
          class="milkdown-editor__action"
          :disabled="loading || !ready || componentInsertionBlocked"
          :title="layout === 'horizontal' ? '插入横向卡片列表' : '插入纵向卡片列表'"
          :aria-label="layout === 'horizontal' ? '插入横向卡片列表' : '插入纵向卡片列表'"
          @mousedown.prevent
          @click="insertCardList(layout)"
        >
          <SvgIcon :name="layout === 'horizontal' ? 'grid' : 'list'" :size="16" />
        </button>
        <span v-if="allowAttachments" class="milkdown-editor__separator" aria-hidden="true" />
        <button
          type="button"
          class="milkdown-editor__action"
          :disabled="loading || !ready || componentInsertionBlocked"
          title="插入表情"
          aria-label="插入表情"
          aria-haspopup="dialog"
          @mousedown.prevent
          @click="openEmoji"
        >
          <SvgIcon name="face" :size="16" />
        </button>
        <button
          type="button"
          class="milkdown-editor__action"
          :disabled="loading || !ready"
          aria-haspopup="dialog"
          title="图库"
          aria-label="图库"
          @mousedown.prevent
          @click="openPexels"
        >
          <SvgIcon name="image" :size="16" />
        </button>
        <button
          type="button"
          class="milkdown-editor__action"
          :disabled="loading || !ready || componentInsertionBlocked"
          title="插入或编辑 LaTeX 公式"
          aria-label="插入或编辑 LaTeX 公式"
          aria-haspopup="dialog"
          @mousedown.prevent
          @click="openLatex()"
        >
          <SvgIcon name="editor-formula" :size="16" />
        </button>
        <button
          type="button"
          class="milkdown-editor__action"
          :disabled="loading || !ready || componentInsertionBlocked"
          title="插入或编辑流程图"
          aria-label="插入或编辑流程图"
          aria-haspopup="dialog"
          @mousedown.prevent
          @click="openMermaid()"
        >
          <SvgIcon name="diagram" :size="16" />
        </button>
        <button
          v-if="allowAttachments"
          type="button"
          class="milkdown-editor__action"
          :title="uploading ? '上传中…' : '添加附件'"
          :aria-label="uploading ? '上传中…' : '添加附件'"
          :disabled="loading || !ready || uploading || componentInsertionBlocked"
          :aria-busy="uploading"
          @mousedown.prevent
          @click="uploadAndInsertAttachments"
        >
          <SvgIcon
            :name="uploading ? 'loading' : 'attachment'"
            :size="16"
            :class="{ 'milkdown-editor__uploading': uploading }"
          />
        </button>
      </div>
      <Teleport v-for="host in colorMenuHosts" :key="host.source" :to="host.element">
        <select
          class="milkdown-editor__font-size"
          aria-label="字号（px）"
          title="字号（px）"
          data-format="fontSize"
          :value="toolbarFontSize ?? ''"
          :disabled="readonly || loading || !ready || toolbarState.fontSize?.enabled === false"
          @pointerdown="rememberFontSizeSelection(host.source)"
          @focus="rememberFontSizeSelection(host.source)"
          @change="applySelectedFontSize($event, host.source)"
          @blur="closeFontSizeSelection"
          @keydown.stop
        >
          <option v-if="toolbarFontSize === 'mixed'" value="mixed" disabled>混合</option>
          <option value="">默认</option>
          <option
            v-if="
              typeof toolbarFontSize === 'number' &&
              !FONT_SIZE_PRESETS.some((size) => size === toolbarFontSize)
            "
            :value="toolbarFontSize"
          >
            {{ toolbarFontSize }}px
          </option>
          <option v-for="size in FONT_SIZE_PRESETS" :key="size" :value="size">{{ size }}px</option>
        </select>
        <VoexTrigger
          v-for="item in colorControls"
          :key="item.kind"
          :popup-visible="
            colorSelection?.source === host.source && colorSelection.kind === item.kind
          "
          trigger="click"
          position="bottom-start"
          strategy="fixed"
          :popup-offset="6"
          :disabled="loading || !ready || toolbarState[item.kind]?.enabled === false"
          role="dialog"
          :aria-label="item.label"
          @update:popup-visible="setColorMenuVisible(item.kind, $event, host.source)"
          @show="focusColorMenu(item.kind, host.source)"
        >
          <button
            type="button"
            class="milkdown-editor__action milkdown-editor__color-button"
            :class="{
              'milkdown-editor__action--active':
                toolbarState[item.kind]?.active || colorSelection?.kind === item.kind,
            }"
            :data-format="item.kind"
            :title="item.label"
            :aria-label="item.label"
            aria-haspopup="dialog"
            :disabled="loading || !ready || toolbarState[item.kind]?.enabled === false"
            @mousedown.prevent
            @keydown.down.prevent="setColorMenuVisible(item.kind, true, host.source)"
          >
            <span class="milkdown-editor__color-icon" aria-hidden="true">
              <SvgIcon :name="item.icon" :size="16" />
              <span
                class="milkdown-editor__color-indicator"
                :style="{ backgroundColor: toolbarColors[item.kind] ?? item.defaultColor }"
              />
            </span>
            <SvgIcon name="chevron-right" :size="10" class="milkdown-editor__color-chevron" />
          </button>
          <template #content>
            <div
              :id="`${colorMenuId}-${host.source}-${item.kind}`"
              class="milkdown-editor__color-menu"
              @keydown.tab="handleColorMenuTab($event, item.kind, host.source)"
            >
              <ColorPicker
                :model-value="colorDraft"
                :label="item.label"
                @update:model-value="applyMenuColor"
                @change="applyMenuColor"
              />
              <div class="milkdown-editor__color-footer">
                <button
                  type="button"
                  class="milkdown-editor__color-clear"
                  :disabled="!colorSelection?.clearable"
                  @click="applyMenuColor(null)"
                >
                  <SvgIcon name="eraser" :size="16" />
                  清除{{ item.label }}
                </button>
              </div>
            </div>
          </template>
        </VoexTrigger>
      </Teleport>
      <Milkdown :inert="loading" :aria-hidden="loading" />
    </div>
    <div v-if="supportsMinimap && showMinimap" class="milkdown-editor__minimap-anchor">
      <DocumentMinimap
        :source-root="editorRoot"
        :min-source-width="floatingNavigation ? 800 : showOutline ? 1000 : 800"
        :active="ready && !loading"
        content-selector=".milkdown-editor__content"
        :placeholders="editorMinimapPlaceholders"
        :ignore-selectors="editorMinimapIgnoreSelectors"
        @availability="minimapAvailable = $event"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { createRichTextSchema } from '@voex/editor-schema/rich-text';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import ColorPicker from '@/components/ColorPicker.vue';
import EditorOutline from '@/views/edit/milkdown/EditorOutline.vue';
import { DocumentMinimap } from '@/plugins/document-minimap';
import { editorMinimapPlaceholders, editorMinimapIgnoreSelectors } from './editor-minimap';
import { useDialog } from '@/composables/useDialog';
import { VoexTrigger } from '@/plugins/trigger';
import type { Mark, NodeType } from '@milkdown/kit/prose/model';
import {
  Editor,
  EditorStatus,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
  parserCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  commonmark,
  insertHrInputRule,
  syncHeadingIdPlugin,
} from '@milkdown/kit/preset/commonmark';
import { columnResizingPlugin, gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { configureParagraph } from '@voex/editor-schema/paragraph';
import { collab, collabServiceCtx } from '@milkdown/plugin-collab';
import {
  undoCommand as collabUndo,
  redoCommand as collabRedo,
  ySyncPluginKey,
} from 'y-prosemirror';
import type { CollaborationBinding } from '@/composables/useDocumentCollaboration';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { cursor, dropIndicatorConfig } from '@milkdown/kit/plugin/cursor';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { indent, indentConfig } from '@milkdown/kit/plugin/indent';
import { upload } from '@milkdown/kit/plugin/upload';
import { trailing, trailingConfig } from '@milkdown/kit/plugin/trailing';
import { undo, redo } from '@milkdown/kit/prose/history';
import { Plugin, type Selection, type SelectionBookmark } from '@milkdown/kit/prose/state';
import { $prose, getMarkdown as serializeMarkdown } from '@milkdown/kit/utils';
import { Milkdown, useEditor } from '@milkdown/vue';
import '@milkdown/kit/prose/view/style/prosemirror.css';
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css';
import '@milkdown/kit/prose/tables/style/tables.css';
import type { FileInfo } from '@/service/api/document-api';
import { ModalType } from '@/stores/modal';
import { useNotificationStore } from '@/stores/notification';
import { useEditorStore } from '@/stores/editor';
import { isMobile } from '@/utils/platform';
import { errorMessage } from '@/utils/error';
import {
  createAttachmentExtension,
  type AttachmentExtension,
} from '@/views/edit/milkdown/attachment';
import { createCardListExtension } from './card-list';
import { inCardText, type CardLayout } from './card-list-model';
import './card-list.styl';
import { createEditorContent } from '@/views/edit/milkdown/editor-content';
import { createEditorPaste } from '@/views/edit/milkdown/editor-paste';
import { createEditorLinks } from '@/views/edit/milkdown/editor-links';
import { createEditorTables } from '@/views/edit/milkdown/editor-tables';
import { createEditorCodeBlock } from '@/views/edit/milkdown/editor-code-block';
import { createEditorDiffPreview } from './editor-diff';
import './editor-diff.styl';
import '@/views/edit/milkdown/editor-code-block.styl';
import {
  editorOutlineElement,
  readEditorOutline,
  type EditorOutlineItem,
} from '@/views/edit/milkdown/editor-outline';
import {
  createImageImport,
  createImportedImage,
  imageAttachmentHash,
} from '@/views/edit/milkdown/image-import';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createEmojiExtension } from '@/views/edit/milkdown/emoji';
import type { Emoji } from '@/constant/emoji';
import type { PexelsPhoto } from '@/service/api/pexels-api';
import { createLatexExtension, type LatexAttrs } from '@/views/edit/milkdown/latex';
import { createMermaidExtension } from '@/views/edit/milkdown/mermaid';
import { createTextColorExtension, type TextColorKind } from '@/views/edit/milkdown/text-color';
import { createFontSizeExtension, FONT_SIZE_PRESETS } from './font-size';
import {
  createEditorInteractions,
  createFormattingActions,
  type EditorAction,
} from '@/views/edit/milkdown/editor-interactions';

const props = withDefaults(
  defineProps<{
    defaultValue?: string;
    collaboration?: CollaborationBinding | null;
    attachments?: FileInfo[];
    uploadAttachments?: () => Promise<FileInfo[]>;
    importImages?: (files: File[]) => Promise<FileInfo[]>;
    loadImage?: (hash: string, signal: AbortSignal, documentKey?: string) => Promise<Blob>;
    documentKey?: string;
    allowAttachments?: boolean;
    onPreviewAttachment?: (file: FileInfo) => void;
    readonly?: boolean;
    loading?: boolean;
    showToolbar?: boolean;
    showOutline?: boolean;
    showMinimap?: boolean;
    floatingNavigation?: boolean;
    codeMirrorEnabled?: boolean;
    diffAfter?: string;
  }>(),
  {
    defaultValue: '',
    collaboration: null,
    attachments: () => [],
    uploadAttachments: undefined,
    importImages: undefined,
    loadImage: undefined,
    documentKey: '',
    allowAttachments: true,
    onPreviewAttachment: undefined,
    readonly: false,
    loading: false,
    showToolbar: true,
    showOutline: true,
    showMinimap: true,
    floatingNavigation: false,
    codeMirrorEnabled: true,
    diffAfter: undefined,
  }
);

const emit = defineEmits<{
  ready: [markdown: string];
  'load-error': [message: string];
  'diff-ready': [changes: number];
  change: [markdown: string];
}>();

// Diff previews always use their own non-collaborative, read-only instance.
const diffPreview =
  props.readonly && props.diffAfter !== undefined ? createEditorDiffPreview() : null;

const editorRef = shallowRef<Editor | null>(null);
const attachmentExtensionRef = shallowRef<AttachmentExtension | null>(null);
const ready = ref(false);
const uploading = ref(false);
const componentInsertionBlocked = ref(false);
const toolbarState = shallowRef<Record<string, { active: boolean; enabled: boolean }>>({});
const toolbarRef = ref<HTMLElement>();
const editorRoot = ref<HTMLElement | null>(null);
const minimapAvailable = ref(false);
const supportsMinimap = !isMobile;
const outlineItems = shallowRef<EditorOutlineItem[]>([]);
const activeOutlineKey = ref('');
const outlineNavigating = ref(false);
type ColorMenuSource = 'toolbar' | 'floating';
const toolbarColorHost = ref<HTMLElement>();
const floatingColorHost = shallowRef<HTMLElement | null>(null);
const colorMenuHosts = computed(() => {
  const hosts: { source: ColorMenuSource; element: HTMLElement }[] = [];
  if (toolbarColorHost.value) hosts.push({ source: 'toolbar', element: toolbarColorHost.value });
  if (floatingColorHost.value) hosts.push({ source: 'floating', element: floatingColorHost.value });
  return hosts;
});
const colorMenuId = `editor-color-${useId()}`;
const colorControls = [
  { kind: 'textColor', label: '文字颜色', icon: 'editor-text-color', defaultColor: '#FF0000' },
  { kind: 'highlight', label: '背景色', icon: 'editor-highlight', defaultColor: '#FFFF00' },
] as const;
const toolbarColors = shallowRef<Record<TextColorKind, string | null>>({
  textColor: null,
  highlight: null,
});
const toolbarFontSize = ref<number | 'mixed' | null>(null);
const fontSizeSelection = shallowRef<{
  source: ColorMenuSource;
  key: symbol;
  editor: Editor;
  version: number;
  marks: readonly Mark[] | null;
} | null>(null);
const colorDraft = ref('#FF0000');
const colorSelection = shallowRef<{
  kind: TextColorKind;
  source: ColorMenuSource;
  key: symbol;
  editor: Editor;
  version: number;
  marks: readonly Mark[] | null;
  clearable: boolean;
} | null>(null);
const notification = useNotificationStore();
const editorStore = useEditorStore();
const editorId = useId();
const pendingAttachments: FileInfo[] = [];
const bookmarks = new Map<symbol, SelectionBookmark>();
const emojiSelection = shallowRef<{ key: symbol; editor: Editor; version: number } | null>(null);
const pexelsSelection = shallowRef<{
  key: symbol;
  editor: Editor;
  version: number;
  appendToEnd: boolean;
  insertedAtEnd: boolean;
} | null>(null);
const latexSelection = shallowRef<{
  key: symbol;
  editor: Editor;
  version: number;
  initial?: LatexAttrs;
  editing: boolean;
} | null>(null);
const mermaidSelection = shallowRef<{
  key: symbol;
  editor: Editor;
  version: number;
  initial?: string;
  editing: boolean;
} | null>(null);
useDialog(ModalType.EMOJI_DIALOG, {
  visible: () => !!emojiSelection.value,
  props: () => ({ onSelect: insertEmoji }),
  onClose: closeEmoji,
  key: () => emojiSelection.value?.key,
});
useDialog(ModalType.PEXELS_DIALOG, {
  visible: () => !!pexelsSelection.value,
  props: () => ({ onInsert: insertPexelsPhoto }),
  onClose: closePexels,
  key: () => pexelsSelection.value?.key,
});
useDialog(ModalType.LATEX_DIALOG, {
  visible: () => !!latexSelection.value,
  props: () => ({
    initial: latexSelection.value?.initial,
    editing: latexSelection.value?.editing,
    onInsert: insertLatex,
  }),
  onClose: closeLatex,
  key: () => latexSelection.value?.key,
});
useDialog(ModalType.MERMAID_DIALOG, {
  visible: () => !!mermaidSelection.value,
  props: () => ({
    initial: mermaidSelection.value?.initial,
    editing: mermaidSelection.value?.editing,
    onInsert: insertMermaid,
  }),
  onClose: closeMermaid,
  key: () => mermaidSelection.value?.key,
});
let disposed = false;
let readonlyVersion = 0;
let publishedMarkdown = props.defaultValue;
let lastTransactionWasRemote = false;

function collaborationColor(user: { color?: unknown }) {
  return typeof user.color === 'string' && /^#[0-9a-f]{6}$/i.test(user.color)
    ? user.color
    : '#1e90ff';
}

function collaborationLabelColor(color: string) {
  const linearChannel = (offset: number) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linearChannel(1) + 0.7152 * linearChannel(3) + 0.0722 * linearChannel(5);
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

function collaborationCursor(user: { name?: unknown; color?: unknown }) {
  const cursor = document.createElement('span');
  cursor.className = 'ProseMirror-yjs-cursor';
  const color = collaborationColor(user);
  cursor.style.borderColor = color;
  cursor.setAttribute('aria-hidden', 'true');
  const label = document.createElement('div');
  label.style.backgroundColor = color;
  label.style.color = collaborationLabelColor(color);
  label.textContent = typeof user.name === 'string' ? user.name.slice(0, 80) : '协作者';
  cursor.append(document.createTextNode('\u2060'), label, document.createTextNode('\u2060'));
  return cursor;
}

const imageImport = createImageImport({
  readonly: () => props.readonly,
  attachments: () => props.attachments,
  documentKey: () => props.documentKey,
  importFiles: (files) => {
    if (!props.importImages) throw new Error('当前页面不支持图片导入');
    return props.importImages(files);
  },
  loadImage: (hash, signal, documentKey) => {
    if (!props.loadImage) throw new Error('当前页面无法读取图片附件');
    return props.loadImage(hash, signal, documentKey);
  },
});
const cards = createCardListExtension({
  readonly: () => props.readonly,
  imageImport,
  onError: (message) => notification.show(message, 'error'),
});
const paste = createEditorPaste({
  readonly: () => props.readonly,
  onError: (message) => notification.show(message, 'error'),
  importImages: imageImport.importImages,
  importSource: imageImport.importSource,
});
const content = createEditorContent({
  readonly: () => props.readonly,
  collaborative: () => !!props.collaboration,
  onError: (message) => notification.show(message, 'error'),
  imageImport: imageImport,
  onAttachment: (view, pos, node) => {
    const hash = imageAttachmentHash(node.attrs.src);
    const file = props.attachments.find((file) => file.hash === hash);
    const type = view.state.schema.nodes.attachment;
    if (!file || !type || props.readonly) return;
    view.dispatch(
      view.state.tr.replaceRangeWith(pos, pos + node.nodeSize, type.create(file)).scrollIntoView()
    );
    view.focus();
  },
});
const emojiExtension = createEmojiExtension();
const latexExtension = createLatexExtension({ readonly: () => props.readonly, onEdit: openLatex });
const mermaidExtension = createMermaidExtension({
  readonly: () => props.readonly,
  onEdit: openMermaid,
});
const richText = createRichTextSchema();
const textColors = createTextColorExtension();
const fontSizes = createFontSizeExtension();
const tables = createEditorTables({
  readonly: () => props.readonly,
  collaborative: () => !!props.collaboration,
  documentKey: () => props.documentKey,
});
const codeBlocks = createEditorCodeBlock({
  readonly: () => props.readonly,
  enabled: () => props.codeMirrorEnabled,
  collaborative: () => !!props.collaboration,
  history: (kind) =>
    editorRef.value?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      return (kind === 'undo' ? collabUndo : collabRedo)(view.state, view.dispatch);
    }) ?? false,
  notify: (message, tone) => notification.show(message, tone),
});
const links = createEditorLinks({
  readonly: () => props.readonly,
  notify: (message, tone) => notification.show(message, tone),
});
const interactions = createEditorInteractions({
  readonly: () => props.readonly,
  allowAttachments: () => props.allowAttachments,
  onAttachment: () => void uploadAndInsertAttachments(),
  onLink: editLink,
  onPexels: openPexels,
  onCardList: insertCardList,
  onColorToolbar: (element) => {
    floatingColorHost.value = element;
  },
  isColorMenuOpen: () =>
    colorSelection.value?.source === 'floating' || fontSizeSelection.value?.source === 'floating',
});
const toolbarActions: EditorAction[] = [
  ...[
    {
      id: 'undo',
      label: '撤销 (Ctrl / ⌘ Z)',
      text: '↶',
      command: (...args: Parameters<typeof undo>) =>
        (props.collaboration ? collabUndo : undo)(...args),
    },
    {
      id: 'redo',
      label: '重做 (Ctrl / ⌘ Shift Z)',
      text: '↷',
      command: (...args: Parameters<typeof redo>) =>
        (props.collaboration ? collabRedo : redo)(...args),
    },
  ].map(({ id, label, text, command }) => ({
    id,
    label,
    text,
    run: (ctx: Ctx) => {
      const view = ctx.get(editorViewCtx);
      command(view.state, view.dispatch);
    },
    enabled: (ctx: Ctx) => command(ctx.get(editorViewCtx).state),
  })),
  ...createFormattingActions(editLink),
];

function canEdit(editor = editorRef.value): editor is Editor {
  return !disposed && !props.readonly && editor?.status === EditorStatus.Created;
}

function canInsertComponent(editor: Editor): boolean {
  return editor.action((ctx) => !inCardText(ctx.get(editorViewCtx).state.selection));
}

function insertCardList(layout: CardLayout) {
  const editor = editorRef.value;
  if (!canEdit(editor) || !canInsertComponent(editor)) return;
  editor.action((ctx) => cards.insert(ctx, layout));
}

function publishMarkdown(markdown: string) {
  if (disposed || !ready.value || markdown === publishedMarkdown) return;
  publishedMarkdown = markdown;
  emit('change', markdown);
}

type OutlineScrollTarget = HTMLElement | Window;

const outlineMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let outlineScrollTarget: OutlineScrollTarget | null = null;
let outlineFrame = 0;
let cleanupOutlineNavigation: (() => void) | null = null;

function finishOutlineNavigation() {
  cleanupOutlineNavigation?.();
  cleanupOutlineNavigation = null;
  outlineNavigating.value = false;
}

function beginOutlineNavigation(target: OutlineScrollTarget) {
  finishOutlineNavigation();
  outlineNavigating.value = true;
  if (outlineFrame) {
    cancelAnimationFrame(outlineFrame);
    outlineFrame = 0;
  }

  let frame = 0;
  let previousTop = target instanceof HTMLElement ? target.scrollTop : window.scrollY;
  let stableSince = 0;
  let moved = false;

  const handleScrollEnd = (event: Event) => {
    if (!moved) return;
    if (event.target !== target && !(target === window && event.target === document)) return;
    finishOutlineNavigation();
  };

  const checkScroll = (now: number) => {
    const currentTop = target instanceof HTMLElement ? target.scrollTop : window.scrollY;
    if (currentTop !== previousTop) {
      moved = true;
      previousTop = currentTop;
      stableSince = now;
    } else if (!stableSince) {
      stableSince = now;
    } else if (now - stableSince >= 160) {
      // Covers older browsers, interrupted scrolling and jumps with no movement.
      finishOutlineNavigation();
      return;
    }
    frame = requestAnimationFrame(checkScroll);
  };

  target.addEventListener('scrollend', handleScrollEnd);
  cleanupOutlineNavigation = () => {
    cancelAnimationFrame(frame);
    target.removeEventListener('scrollend', handleScrollEnd);
  };
  frame = requestAnimationFrame(checkScroll);
}

function findOutlineScrollTarget(element: HTMLElement): OutlineScrollTarget {
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
    parent = parent.parentElement;
  }
  return window;
}

function updateActiveOutline() {
  if (outlineNavigating.value) return;
  const items = outlineItems.value;
  const editor = editorRef.value;
  if (!items.length || !editor || editor.status !== EditorStatus.Created) {
    activeOutlineKey.value = '';
    return;
  }

  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  const target = outlineScrollTarget;
  const targetTop = target instanceof HTMLElement ? target.getBoundingClientRect().top : 0;
  const activationTop = targetTop + 65;
  let active: EditorOutlineItem | undefined = items[0];

  for (const item of items) {
    const element = editorOutlineElement(view, item);
    if (!element?.isConnected) continue;
    if (element.getBoundingClientRect().top > activationTop) break;
    active = item;
  }

  const scrollTop = target instanceof HTMLElement ? target.scrollTop : window.scrollY;
  const viewportHeight = target instanceof HTMLElement ? target.clientHeight : window.innerHeight;
  const scrollHeight =
    target instanceof HTMLElement ? target.scrollHeight : document.documentElement.scrollHeight;
  if (scrollTop > 0 && scrollTop + viewportHeight >= scrollHeight - 1) {
    active = items[items.length - 1];
  }
  if (active) activeOutlineKey.value = active.key;
}

function scheduleOutlineUpdate() {
  if (outlineNavigating.value || outlineFrame) return;
  outlineFrame = requestAnimationFrame(() => {
    outlineFrame = 0;
    if (!disposed) updateActiveOutline();
  });
}

function bindOutlineScrollTarget() {
  const root = editorRoot.value;
  if (!root || disposed) return;
  const target = findOutlineScrollTarget(root);
  if (target === outlineScrollTarget) return;

  finishOutlineNavigation();
  outlineScrollTarget?.removeEventListener('scroll', scheduleOutlineUpdate);
  outlineScrollTarget = target;
  target.addEventListener('scroll', scheduleOutlineUpdate, { passive: true });
  scheduleOutlineUpdate();
}

function refreshOutline() {
  const editor = editorRef.value;
  if (!editor || editor.status !== EditorStatus.Created) {
    outlineItems.value = [];
    activeOutlineKey.value = '';
    return;
  }
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  outlineItems.value = readEditorOutline(view);
  bindOutlineScrollTarget();
  scheduleOutlineUpdate();
}

function scrollToOutline(item: EditorOutlineItem) {
  const editor = editorRef.value;
  if (disposed || outlineNavigating.value || !editor || editor.status !== EditorStatus.Created)
    return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const element = editorOutlineElement(view, item);
    if (!element?.isConnected) return;
    bindOutlineScrollTarget();
    if (!outlineScrollTarget) return;
    activeOutlineKey.value = item.key;
    beginOutlineNavigation(outlineScrollTarget);
    element.scrollIntoView({
      behavior: outlineMotionPreference.matches ? 'instant' : 'smooth',
      block: 'start',
    });
  });
}

watch(
  editorRoot,
  () => {
    bindOutlineScrollTarget();
  },
  { flush: 'post' }
);
window.addEventListener('resize', scheduleOutlineUpdate);

function syncSelection(ctx: Ctx, selection?: Selection, focused?: boolean) {
  if (disposed) return;
  const view = ctx.get(editorViewCtx);
  // 插件初始化可能先触发选区事件，Created 时再同步完整 EditorView。
  if (!view.state) return;
  // selectionUpdated runs before the view state is updated; use its selection argument.
  const current = selection ?? view.state.selection;
  let selectedText = '';
  if (!current.empty) {
    const content = current.content().content;
    selectedText = content.textBetween(0, content.size, '\n', (node) => {
      if (node.type.name === 'hardbreak') return node.attrs.isInline ? ' ' : '\n';
      return node.type.spec.leafText?.(node) ?? '';
    });
  }
  editorStore.setSelection({
    editorId,
    documentKey: props.documentKey,
    type: current.toJSON().type,
    anchor: current.anchor,
    head: current.head,
    from: current.from,
    to: current.to,
    empty: current.empty,
    selectedText,
    focused: focused ?? view.hasFocus(),
  });
}

function refreshToolbar(ctx: Ctx) {
  toolbarFontSize.value = fontSizes.selected(ctx);
  componentInsertionBlocked.value = inCardText(ctx.get(editorViewCtx).state.selection);
  toolbarColors.value = {
    textColor: textColors.selected(ctx, 'textColor'),
    highlight: textColors.selected(ctx, 'highlight'),
  };
  toolbarState.value = Object.fromEntries([
    ...toolbarActions.map((action) => [
      action.id,
      { active: action.active?.(ctx) ?? false, enabled: action.enabled?.(ctx) ?? true },
    ]),
    [
      'fontSize',
      { active: typeof toolbarFontSize.value === 'number', enabled: fontSizes.enabled(ctx) },
    ],
    ...colorControls.map(({ kind }) => [
      kind,
      { active: textColors.active(ctx, kind), enabled: textColors.enabled(ctx, kind) },
    ]),
  ]);
}

function runAction(action: EditorAction) {
  const editor = editorRef.value;
  if (!canEdit(editor)) return;
  editor.action((ctx) => {
    if (action.enabled?.(ctx) === false) return;
    action.run(ctx);
    if (!action.opensDialog) ctx.get(editorViewCtx).focus();
    refreshToolbar(ctx);
  });
}

// 弹窗与上传期间继续映射选区，返回后仍插入原来的位置。
const selectionPlugin = $prose(
  (ctx) =>
    new Plugin({
      state: {
        init: () => null,
        apply: (transaction) => {
          if (transaction.docChanged)
            lastTransactionWasRemote = !!transaction.getMeta(ySyncPluginKey);
          bookmarks.forEach((bookmark, key) =>
            bookmarks.set(key, bookmark.map(transaction.mapping))
          );
          return null;
        },
      },
      view: () => ({
        update: (view, previousState) => {
          refreshToolbar(ctx);
          // Selected text can change without changing the selection offsets.
          if (view.state.doc !== previousState.doc) {
            syncSelection(ctx);
            // Remote Yjs transactions need the same outline and snapshot refresh as local edits.
            queueMicrotask(() => {
              if (disposed || editorRef.value?.status !== EditorStatus.Created) return;
              publishMarkdown(editorRef.value.action(serializeMarkdown()));
              // Yjs updates undo/redo stacks after plugin views finish updating.
              editorRef.value.action(refreshToolbar);
              refreshOutline();
            });
          }
        },
      }),
    })
);

function rememberSelection(editor: Editor) {
  const key = Symbol('editor-selection');
  editor.action((ctx) => bookmarks.set(key, ctx.get(editorViewCtx).state.selection.getBookmark()));
  return key;
}

function restoreSelection(ctx: Ctx, key: symbol) {
  const bookmark = bookmarks.get(key);
  if (!bookmark) return;
  const view = ctx.get(editorViewCtx);
  view.dispatch(view.state.tr.setSelection(bookmark.resolve(view.state.doc)));
}

function openEmoji() {
  const editor = editorRef.value;
  if (!canEdit(editor) || !canInsertComponent(editor) || emojiSelection.value) return;
  interactions.hide();
  emojiSelection.value = { key: rememberSelection(editor), editor, version: readonlyVersion };
}

function closeEmoji() {
  const session = emojiSelection.value;
  if (!session) return;
  bookmarks.delete(session.key);
  emojiSelection.value = null;
  void nextTick(() => {
    if (canEdit(session.editor) && session.editor === editorRef.value)
      session.editor.action((ctx) => ctx.get(editorViewCtx).focus());
  });
}

function insertEmoji(emoji: Emoji) {
  const session = emojiSelection.value;
  if (
    !session ||
    !canEdit(session.editor) ||
    session.editor !== editorRef.value ||
    session.version !== readonlyVersion
  ) {
    closeEmoji();
    return;
  }
  try {
    session.editor.action((ctx) => {
      restoreSelection(ctx, session.key);
      if (inCardText(ctx.get(editorViewCtx).state.selection))
        throw new Error('卡片文字区域只支持文字');
      emojiExtension.insert(ctx, emoji);
    });
    closeEmoji();
  } catch (cause) {
    notification.show(errorMessage(cause, '表情插入失败，请将光标移到正文后重试'), 'error');
  }
}

function openLatex(position?: number) {
  const editor = editorRef.value;
  if (!canEdit(editor) || !canInsertComponent(editor) || latexSelection.value) return;
  interactions.hide();
  const initial = editor.action((ctx) => {
    if (position !== undefined) latexExtension.select(ctx, position);
    return latexExtension.selected(ctx);
  });
  latexSelection.value = {
    key: rememberSelection(editor),
    editor,
    version: readonlyVersion,
    initial: initial ?? undefined,
    editing: !!initial,
  };
}

function closeLatex() {
  const session = latexSelection.value;
  if (!session) return;
  bookmarks.delete(session.key);
  latexSelection.value = null;
  void nextTick(() => {
    if (canEdit(session.editor) && session.editor === editorRef.value)
      session.editor.action((ctx) => ctx.get(editorViewCtx).focus());
  });
}

function insertLatex(attrs: LatexAttrs) {
  const session = latexSelection.value;
  if (
    !session ||
    !canEdit(session.editor) ||
    session.editor !== editorRef.value ||
    session.version !== readonlyVersion
  )
    throw new Error('当前文档不可编辑，请关闭弹窗后重试');
  session.editor.action((ctx) => {
    restoreSelection(ctx, session.key);
    if (inCardText(ctx.get(editorViewCtx).state.selection))
      throw new Error('卡片文字区域只支持文字');
    latexExtension.insert(ctx, attrs, session.editing);
  });
  // 公式参数提交后立即更新保存快照，避免防抖期间仍显示旧的“修改已保存”。
  publishMarkdown(session.editor.action(serializeMarkdown()));
}

function openMermaid(position?: number) {
  const editor = editorRef.value;
  if (!canEdit(editor) || !canInsertComponent(editor) || mermaidSelection.value) return;
  interactions.hide();
  const initial = editor.action((ctx) => {
    if (position !== undefined) mermaidExtension.select(ctx, position);
    return mermaidExtension.selected(ctx);
  });
  mermaidSelection.value = {
    key: rememberSelection(editor),
    editor,
    version: readonlyVersion,
    initial: initial ?? undefined,
    editing: initial !== null,
  };
}

function closeMermaid() {
  const session = mermaidSelection.value;
  if (!session) return;
  bookmarks.delete(session.key);
  mermaidSelection.value = null;
  void nextTick(() => {
    if (canEdit(session.editor) && session.editor === editorRef.value)
      session.editor.action((ctx) => ctx.get(editorViewCtx).focus());
  });
}

function insertMermaid(code: string) {
  const session = mermaidSelection.value;
  if (
    !session ||
    !canEdit(session.editor) ||
    session.editor !== editorRef.value ||
    session.version !== readonlyVersion
  )
    throw new Error('当前文档不可编辑，请关闭弹窗后重试');
  session.editor.action((ctx) => {
    restoreSelection(ctx, session.key);
    if (inCardText(ctx.get(editorViewCtx).state.selection))
      throw new Error('卡片文字区域只支持文字');
    mermaidExtension.insert(ctx, code, session.editing);
  });
  publishMarkdown(session.editor.action(serializeMarkdown()));
}

function canInsertPexelsImage(selection: Selection, image: NodeType | undefined) {
  const { $from } = selection;
  return (
    selection instanceof TextSelection &&
    !inCardText(selection) &&
    !!image &&
    $from.parent.canReplaceWith($from.index(), $from.index(), image)
  );
}

function openPexels() {
  const editor = editorRef.value;
  if (!canEdit(editor) || pexelsSelection.value) return;
  const appendToEnd = editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const selection = view.dom.ownerDocument.getSelection();
    return (
      !selection?.rangeCount ||
      !view.dom.contains(selection.anchorNode) ||
      !view.dom.contains(selection.focusNode) ||
      !canInsertPexelsImage(view.state.selection, view.state.schema.nodes.image)
    );
  });
  interactions.hide();
  pexelsSelection.value = {
    key: rememberSelection(editor),
    editor,
    version: readonlyVersion,
    appendToEnd,
    insertedAtEnd: false,
  };
}

function closePexels() {
  const session = pexelsSelection.value;
  if (!session) return;
  bookmarks.delete(session.key);
  pexelsSelection.value = null;
  void nextTick(() => {
    if (!canEdit(session.editor) || session.editor !== editorRef.value) return;
    session.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
      if (!session.insertedAtEnd) return;
      const lastBlock = view.dom.lastElementChild;
      const selection = view.state.selection;
      const scrollToEnd = () => {
        if (
          canEdit(session.editor) &&
          session.editor === editorRef.value &&
          session.version === readonlyVersion &&
          lastBlock?.isConnected &&
          view.state.selection.eq(selection)
        )
          lastBlock.scrollIntoView({ block: 'end', behavior: 'instant' });
      };
      scrollToEnd();
      // Attachment images can finish loading after the gallery has closed.
      lastBlock?.querySelectorAll('img').forEach((image) => {
        if (!image.complete || !image.naturalWidth)
          image.addEventListener('load', scrollToEnd, { once: true });
      });
    });
  });
}

async function insertPexelsPhoto(photo: PexelsPhoto) {
  const session = pexelsSelection.value;
  if (
    !session ||
    !canEdit(session.editor) ||
    session.editor !== editorRef.value ||
    session.version !== readonlyVersion
  )
    throw new Error('当前文档不可编辑，请关闭图库后重试');
  const view = session.editor.action((ctx) => ctx.get(editorViewCtx));
  const image = view.state.schema.nodes.image;
  if (!image) throw new Error('当前文档不支持插入图片');
  const node = await imageImport.importSource(
    view,
    image.create({
      src: photo.src.large2x || photo.src.large || photo.src.original,
      alt: photo.alt || `${photo.photographer} 的照片`,
      title: `摄影：${photo.photographer} / Pexels`,
    })
  );
  if (
    pexelsSelection.value !== session ||
    !canEdit(session.editor) ||
    session.editor !== editorRef.value ||
    session.version !== readonlyVersion
  )
    throw new Error('图片导入已取消');
  session.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const tr = view.state.tr;
    const selection = session.appendToEnd ? undefined : bookmarks.get(session.key)?.resolve(tr.doc);
    if (selection && canInsertPexelsImage(selection, image)) {
      tr.setSelection(selection).replaceSelectionWith(node, false);
    } else {
      const end = tr.doc.content.size;
      const paragraph = view.state.schema.nodes.paragraph!;
      const position = tr.doc.lastChild?.type === paragraph ? end - 1 : end + 1;
      if (position < end) tr.insert(position, node);
      else tr.insert(end, paragraph.create(null, node));
      tr.setSelection(TextSelection.create(tr.doc, position + node.nodeSize));
      session.insertedAtEnd = true;
    }
    view.dispatch(tr.scrollIntoView());
  });
  publishMarkdown(session.editor.action(serializeMarkdown()));
}

async function uploadAndInsertAttachments() {
  const editor = editorRef.value;
  if (
    !canEdit(editor) ||
    !canInsertComponent(editor) ||
    uploading.value ||
    !props.allowAttachments ||
    !props.uploadAttachments
  )
    return;
  const key = rememberSelection(editor);
  const version = readonlyVersion;
  uploading.value = true;
  try {
    const files = await props.uploadAttachments();
    if (
      !canEdit(editor) ||
      editor !== editorRef.value ||
      version !== readonlyVersion ||
      !files.length
    )
      return;
    editor.action((ctx) => {
      restoreSelection(ctx, key);
      files.forEach((file) => insertImportedFile(ctx, file));
    });
  } catch (cause) {
    if (!disposed) notification.show(errorMessage(cause, '附件上传失败，请重试'), 'error');
  } finally {
    bookmarks.delete(key);
    uploading.value = false;
  }
}

function editLink() {
  const editor = editorRef.value;
  if (!canEdit(editor)) return;
  interactions.hide();
  editor.action((ctx) => links.edit(ctx));
}

function closeFontSizeSelection() {
  const session = fontSizeSelection.value;
  if (session) bookmarks.delete(session.key);
  fontSizeSelection.value = null;
}

function rememberFontSizeSelection(source: ColorMenuSource) {
  const editor = editorRef.value;
  if (!canEdit(editor) || !editor.action(fontSizes.enabled)) return;
  if (fontSizeSelection.value?.source === source) return;
  closeFontSizeSelection();
  closeColorMenu();
  fontSizeSelection.value = {
    source,
    key: rememberSelection(editor),
    editor,
    version: readonlyVersion,
    marks: editor.action((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      return state.storedMarks ?? state.selection.$from.marks();
    }),
  };
}

function applySelectedFontSize(event: Event, source: ColorMenuSource) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === 'mixed') return;
  if (!fontSizeSelection.value) rememberFontSizeSelection(source);
  const session = fontSizeSelection.value;
  if (
    !session ||
    !canEdit(session.editor) ||
    session.editor !== editorRef.value ||
    session.version !== readonlyVersion
  ) {
    closeFontSizeSelection();
    return;
  }
  try {
    session.editor.action((ctx) => {
      restoreSelection(ctx, session.key);
      const view = ctx.get(editorViewCtx);
      if (view.state.selection.empty) view.dispatch(view.state.tr.setStoredMarks(session.marks));
      fontSizes.apply(ctx, value === '' ? null : value);
      view.focus();
      refreshToolbar(ctx);
    });
    publishMarkdown(session.editor.action(serializeMarkdown()));
  } catch (cause) {
    notification.show(errorMessage(cause, '字号设置失败，请重新选择文字后重试'), 'error');
  } finally {
    closeFontSizeSelection();
  }
}

function closeColorMenu() {
  const session = colorSelection.value;
  if (!session) return;
  bookmarks.delete(session.key);
  colorSelection.value = null;
  if (session.source === 'floating')
    void nextTick(() => {
      if (!disposed) interactions.refresh();
    });
}

function setColorMenuVisible(kind: TextColorKind, visible: boolean, source: ColorMenuSource) {
  if (!visible) {
    if (colorSelection.value?.kind === kind && colorSelection.value.source === source)
      closeColorMenu();
    return;
  }
  const editor = editorRef.value;
  if (!canEdit(editor) || !editor.action((ctx) => textColors.enabled(ctx, kind))) return;
  if (colorSelection.value?.kind === kind && colorSelection.value.source === source) return;
  closeColorMenu();
  const initial = editor.action((ctx) => ({
    color: textColors.selected(ctx, kind),
    marks: ctx.get(editorViewCtx).state.storedMarks,
    clearable: textColors.active(ctx, kind),
  }));
  colorDraft.value =
    initial.color ?? colorControls.find((item) => item.kind === kind)!.defaultColor;
  if (source === 'toolbar') interactions.hide();
  colorSelection.value = {
    kind,
    source,
    key: rememberSelection(editor),
    editor,
    version: readonlyVersion,
    marks: initial.marks,
    clearable: initial.clearable,
  };
}

function colorMenuElement(kind: TextColorKind, source: ColorMenuSource) {
  return colorMenuHosts.value
    .find((host) => host.source === source)
    ?.element.ownerDocument.getElementById(`${colorMenuId}-${source}-${kind}`);
}

function focusColorMenu(kind: TextColorKind, source: ColorMenuSource) {
  if (colorSelection.value?.kind === kind && colorSelection.value.source === source)
    colorMenuElement(kind, source)
      ?.querySelector<HTMLInputElement>('input')
      ?.focus({ preventScroll: true });
}

function handleColorMenuTab(event: KeyboardEvent, kind: TextColorKind, source: ColorMenuSource) {
  const controls = colorMenuElement(kind, source)?.querySelectorAll<HTMLElement>(
    'input:not(:disabled), button:not(:disabled)'
  );
  if (!controls?.length) return;
  const boundary = event.shiftKey ? controls[0] : controls[controls.length - 1];
  if (event.target !== boundary) return;
  event.preventDefault();
  const toolbar = colorMenuHosts.value.find((host) => host.source === source)?.element
    .parentElement;
  const buttons = [
    ...(toolbar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
  ];
  const index = buttons.findIndex((button) => button.dataset.format === kind);
  const target = event.shiftKey ? buttons[index] : buttons[index + 1];
  closeColorMenu();
  if (target) target.focus({ preventScroll: true });
  else editorRef.value?.action((ctx) => ctx.get(editorViewCtx).focus());
}

function applyMenuColor(color: string | null) {
  const session = colorSelection.value;
  if (!session) return;
  if (
    !canEdit(session.editor) ||
    session.editor !== editorRef.value ||
    session.version !== readonlyVersion
  ) {
    closeColorMenu();
    return;
  }
  try {
    session.editor.action((ctx) => {
      restoreSelection(ctx, session.key);
      const view = ctx.get(editorViewCtx);
      if (view.state.selection.empty && session.marks)
        view.dispatch(view.state.tr.setStoredMarks(session.marks));
      textColors.apply(ctx, session.kind, color);
      colorSelection.value = {
        ...session,
        marks: view.state.storedMarks,
        clearable: textColors.active(ctx, session.kind),
      };
      if (color) colorDraft.value = color;
      refreshToolbar(ctx);
    });
    publishMarkdown(session.editor.action(serializeMarkdown()));
  } catch (cause) {
    notification.show(errorMessage(cause, '颜色设置失败，请重新选择文字后重试'), 'error');
  }
}

const { loading: initializing } = useEditor((root) => {
  const extension = createAttachmentExtension(
    (hash) => props.attachments.some((file) => file.hash === hash),
    (file) => {
      const attachment = props.attachments.find((item) => item.hash === file.hash);
      if (attachment) props.onPreviewAttachment?.(attachment);
    },
    {
      readonly: () => props.readonly,
      loadFile: (hash, signal) => {
        if (!props.loadImage) throw new Error('当前页面无法读取视频或音频附件');
        return props.loadImage(hash, signal);
      },
    },
    {
      readonly: () => props.readonly,
      onImage: (view, pos, hash) => {
        const file = props.attachments.find((file) => file.hash === hash);
        const current = view.state.doc.nodeAt(pos);
        const paragraph = view.state.schema.nodes.paragraph;
        if (!file || !current || !paragraph || props.readonly) return;
        const image = createImportedImage(view, file, props.documentKey);
        const tr = view.state.tr.replaceWith(
          pos,
          pos + current.nodeSize,
          paragraph.create(null, image)
        );
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
        view.dispatch(tr.scrollIntoView());
        view.focus();
      },
    }
  );
  attachmentExtensionRef.value = extension;

  // preset 定义文档结构；交互和视觉由当前组件控制。
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, props.collaboration ? '' : props.defaultValue);
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        editable: () => !props.readonly,
        attributes: () => ({
          class: 'milkdown-editor__content',
          'aria-label': '文档正文',
          'aria-multiline': 'true',
          'aria-readonly': String(props.readonly),
        }),
        handleDOMEvents: {
          keydown: (view, event) => {
            if (event.key !== 'Tab') return false;
            const { $from } = view.state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              if (['code_block', 'list_item', 'table'].includes($from.node(depth).type.name))
                return false;
            }
            // 普通正文保留 Tab 导航，避免键盘焦点困在编辑器内。
            return true;
          },
        },
      }));
      ctx.set(indentConfig.key, { type: 'space' as const, size: 2 });
      ctx.update(dropIndicatorConfig.key, (config) => ({
        ...config,
        color: 'var(--editor-accent)',
      }));
      configureParagraph(ctx);
      content.configure(ctx);
      richText.configure(ctx);
      interactions.configure(ctx);
      links.configure(ctx);
      tables.configure(ctx);
      codeBlocks.configure(ctx);
      diffPreview?.configure(ctx);
      ctx.update(trailingConfig.key, (config) => ({
        ...config,
        shouldAppend: (lastNode, state) =>
          !props.readonly &&
          (!props.collaboration || !lastTransactionWasRemote) &&
          config.shouldAppend(lastNode, state),
      }));
      ctx
        .get(listenerCtx)
        .markdownUpdated((_ctx, markdown, previous) => {
          if (markdown !== previous) publishMarkdown(markdown);
          refreshOutline();
        })
        .selectionUpdated((ctx, selection) => syncSelection(ctx, selection))
        .focus((ctx) => syncSelection(ctx, undefined, true))
        .blur((ctx) => syncSelection(ctx, undefined, false))
        .destroy(() => editorStore.clearSelection(editorId));
    })
    .use(richText.serializer)
    .use(cards.guardPlugins)
    .use(paste.plugins)
    .use(content.plugins)
    .use(
      commonmark.filter(
        (plugin) =>
          plugin !== insertHrInputRule && (!props.collaboration || plugin !== syncHeadingIdPlugin)
      )
    )
    .use(cards.plugins)
    .use(columnResizingPlugin)
    .use(gfm)
    .use(props.collaboration ? collab : history)
    .use(upload)
    .use(clipboard)
    .use(cursor)
    .use(listener)
    .use(indent)
    .use(extension.plugins)
    .use(emojiExtension.plugins)
    .use(latexExtension.plugins)
    .use(mermaidExtension.plugins)
    .use(textColors.plugins)
    .use(fontSizes.plugins)
    .use(interactions.plugins)
    .use(links.plugins)
    .use(tables.plugins)
    .use(codeBlocks.plugins)
    .use(diffPreview?.plugins ?? [])
    .use(selectionPlugin)
    .use(trailing)
    .use(richText.plugins);

  editorRef.value = editor;
  editor.onStatusChange((status) => {
    if (status === EditorStatus.Created && !disposed) {
      if (props.collaboration) {
        editor.action((ctx) => {
          const service = ctx.get(collabServiceCtx).bindDoc(props.collaboration!.document);
          const awareness = props.collaboration!.provider.awareness;
          if (awareness) service.setAwareness(awareness);
          service.setOptions({
            yCursorOpts: {
              cursorBuilder: collaborationCursor,
              selectionBuilder: (user: { color?: unknown }) => ({
                class: 'ProseMirror-yjs-selection',
                style: `background-color: ${collaborationColor(user)}40`,
              }),
            },
          });
          service.connect();
        });
      }
      editor.action(refreshToolbar);
      editor.action((ctx) => syncSelection(ctx));
      publishedMarkdown = editor.action(serializeMarkdown());
      if (diffPreview) {
        try {
          emit(
            'diff-ready',
            editor.action((ctx) => diffPreview.start(ctx, props.diffAfter ?? ''))
          );
        } catch (cause) {
          emit('load-error', errorMessage(cause, '文档差异计算失败，请重试'));
          return;
        }
      }
      refreshOutline();
      ready.value = true;
      emit('ready', publishedMarkdown);
      pendingAttachments.splice(0).forEach((file) => insertAttachment(file));
    }
  });
  return editor;
});

watch(
  initializing,
  (isInitializing, wasInitializing) => {
    if (wasInitializing && !isInitializing && !ready.value && !disposed)
      emit('load-error', '编辑器初始化失败，请重新加载文档。');
  },
  { flush: 'post' }
);

watch(
  () => props.readonly,
  () => {
    readonlyVersion++;
    links.hide();
    tables.readonlyChanged();
    codeBlocks.readonlyChanged();
    paste.readonlyChanged();
    imageImport.readonlyChanged();
    content.readonlyChanged();
    cards.readonlyChanged();
    attachmentExtensionRef.value?.refreshAvailability();
    latexExtension.readonlyChanged();
    mermaidExtension.readonlyChanged();
    interactions.hide();
    closeEmoji();
    closePexels();
    closeLatex();
    closeMermaid();
    closeColorMenu();
    closeFontSizeSelection();
    if (props.readonly) pendingAttachments.length = 0;
    if (editorRef.value?.status === EditorStatus.Created) {
      editorRef.value.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.setProps({ editable: () => !props.readonly });
        view.dispatch(view.state.tr);
      });
    }
  },
  { flush: 'sync' }
);

watch(
  () => props.diffAfter,
  (markdown) => {
    const editor = editorRef.value;
    if (!diffPreview || !ready.value || disposed || editor?.status !== EditorStatus.Created) return;
    try {
      emit(
        'diff-ready',
        editor.action((ctx) => diffPreview.start(ctx, markdown ?? ''))
      );
    } catch (cause) {
      emit('load-error', errorMessage(cause, '文档差异计算失败，请重试'));
    }
  },
  { flush: 'post' }
);

watch(
  () => props.codeMirrorEnabled,
  () => {
    if (editorRef.value?.status === EditorStatus.Created)
      editorRef.value.action(codeBlocks.enabledChanged);
  },
  { flush: 'post' }
);

watch(
  () => props.showToolbar,
  (visible) => {
    if (!visible) {
      closeColorMenu();
      closeFontSizeSelection();
    }
  }
);

watch(
  () => props.attachments.map((file) => file.hash),
  () => attachmentExtensionRef.value?.refreshAvailability()
);

onBeforeUnmount(() => {
  disposed = true;
  finishOutlineNavigation();
  if (outlineFrame) cancelAnimationFrame(outlineFrame);
  outlineScrollTarget?.removeEventListener('scroll', scheduleOutlineUpdate);
  window.removeEventListener('resize', scheduleOutlineUpdate);
  outlineScrollTarget = null;
  editorStore.clearSelection(editorId);
  ready.value = false;
  closeColorMenu();
  closeFontSizeSelection();
  if (editorRef.value?.status === EditorStatus.Created) {
    editorRef.value.action((ctx) => {
      if (props.collaboration) ctx.get(collabServiceCtx).disconnect();
      const { dom } = ctx.get(editorViewCtx);
      const selection = dom.ownerDocument.getSelection();
      // 在 DOM 移除前释放焦点和选区，避免 Chromium 把输入光标留在页面根节点。
      if (dom.contains(dom.ownerDocument.activeElement)) dom.blur();
      if (selection && (dom.contains(selection.anchorNode) || dom.contains(selection.focusNode))) {
        selection.removeAllRanges();
      }
    });
  }
  pendingAttachments.length = 0;
  bookmarks.clear();
  links.hide();
  content.destroy();
  paste.destroy();
  imageImport.destroy();
  interactions.hide();
  attachmentExtensionRef.value = null;
  // Milkdown Vue 负责 editor.destroy()，此处仅清理组件自己的状态。
  editorRef.value = null;
});

function insertImportedFile(ctx: Ctx, file: FileInfo): boolean {
  if (inCardText(ctx.get(editorViewCtx).state.selection)) {
    notification.show('卡片文字区域只支持文字，请使用图片区域添加图片', 'info');
    return false;
  }
  if (!file.mime.startsWith('image/'))
    return attachmentExtensionRef.value?.insertAttachment(ctx, file) ?? false;
  const view = ctx.get(editorViewCtx);
  const node = createImportedImage(view, file, props.documentKey);
  view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
  view.focus();
  return true;
}

function insertAttachment(file: FileInfo): boolean {
  if (disposed || props.readonly || !props.allowAttachments) return false;
  const editor = editorRef.value;
  const extension = attachmentExtensionRef.value;
  if (!editor || !extension || editor.status !== EditorStatus.Created) {
    pendingAttachments.push(file);
    return true;
  }

  try {
    return editor.action((ctx) => insertImportedFile(ctx, file));
  } catch {
    return false;
  }
}

function getMarkdown(): string {
  return editorRef.value?.status === EditorStatus.Created
    ? editorRef.value.action(serializeMarkdown())
    : props.defaultValue;
}

function normalizeMarkdown(markdown: string): string {
  const editor = editorRef.value;
  if (!editor || editor.status !== EditorStatus.Created) throw new Error('编辑器尚未就绪');
  return editor.action((ctx) => {
    const document = ctx.get(parserCtx)(markdown);
    if (!document) throw new Error('文档格式无法解析');
    return ctx.get(serializerCtx)(document);
  });
}

// Used only after an explicitly reviewed save; does not open any insertion dialogs.
function setMarkdown(markdown: string) {
  if (props.collaboration) throw new Error('协同正文只能通过服务器应用修改');
  const editor = editorRef.value;
  if (!editor || editor.status !== EditorStatus.Created) throw new Error('编辑器尚未就绪');
  editor.action((ctx) => {
    const document = ctx.get(parserCtx)(markdown);
    if (!document) throw new Error('文档格式无法解析');
    content.replaceSavedDocument(ctx, document);
  });
  publishMarkdown(editor.action(serializeMarkdown()));
  refreshOutline();
}

defineExpose({ getMarkdown, insertAttachment, normalizeMarkdown, setMarkdown });
</script>

<style lang="stylus">
.milkdown-editor .ProseMirror-yjs-cursor
  position relative
  margin-left -1px
  margin-right -1px
  border-left 1px solid
  border-right 1px solid
  pointer-events none
  word-break normal
  > div
    position absolute
    top -1.5em
    left -1px
    max-width 160px
    overflow hidden
    text-overflow ellipsis
    white-space nowrap
    border-radius 3px 3px 3px 0
    padding 2px 5px
    color white
    font-size 11px
    line-height 1.3
    font-weight 500
    user-select none

.milkdown-mermaid
  position relative
  box-sizing border-box
  width 100%
  min-height 120px
  margin 12px 0
  padding 48px 16px 16px
  border 1px solid var(--color-border-primary)
  border-radius 6px
  background var(--color-bg-panel)
  outline 1px solid transparent

  &.ProseMirror-selectednode
    outline 2px solid var(--color-accent)

  &[data-state='error'] .milkdown-mermaid__feedback
    color var(--color-red)

  &__viewport
    overflow auto
    text-align center
    svg
      display block
      max-width 100%
      height auto
      margin 0 auto

  &__feedback
    display block
    padding 16px 0
    overflow-wrap anywhere
    white-space pre-wrap
    font-size 13px
    color var(--color-text-secondary)
    &[hidden]
      display none

  &__edit
    position absolute
    top 8px
    right 8px
    min-height 30px
    padding 4px 8px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)
    color var(--color-text-primary)
    font-family inherit
    font-size 12px
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-translucent)
    &:active:not(:disabled)
      filter brightness(.9)
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
    &:disabled
      cursor not-allowed
      opacity .6
    &[hidden]
      display none

.milkdown-editor--readonly .milkdown-mermaid
  padding-top 16px

.milkdown-latex
  position relative
  box-sizing border-box
  width 100%
  margin 12px 0
  overflow hidden
  outline 1px solid transparent

  &.ProseMirror-selectednode
    outline 2px solid var(--color-accent)

  &__viewport
    position absolute
    inset 0
    display flex
    align-items center
    justify-content center
    overflow hidden
    svg
      display block
      flex-shrink 0
      max-width none
      max-height none

  &__feedback
    position absolute
    inset 0
    display flex
    align-items center
    justify-content center
    padding 12px
    overflow-wrap anywhere
    font-size 13px
    text-align center
    color var(--color-text-secondary)
    &[hidden]
      display none

  &__edit
    position absolute
    top 6px
    right 6px
    min-height 30px
    padding 4px 8px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)
    color var(--color-text-primary)
    font-family inherit
    font-size 12px
    cursor pointer
    opacity 0
    pointer-events none
    &:hover:not(:disabled)
      background var(--color-bg-translucent)
    &:active:not(:disabled)
      filter brightness(.9)
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
    &:disabled
      cursor not-allowed
    &[hidden]
      display none

  &:hover, &:focus-within, &.ProseMirror-selectednode
    .milkdown-latex__edit
      opacity 1
      pointer-events auto

.milkdown-editor
  --editor-bg: var(--color-bg-primary, #fff)
  --editor-panel: var(--color-bg-panel, #fff)
  --editor-hover: var(--color-bg-translucent, #f5f5f5)
  --editor-text: var(--color-text-primary, #1a1a1a)
  --editor-secondary: var(--color-text-secondary, #555)
  --editor-muted: var(--color-text-tertiary, #666)
  --editor-border: var(--color-border-primary, #dcdcdc)
  --editor-accent: var(--color-accent, #0066cc)
  --editor-selected: var(--color-accent-tint, #e8f2ff)
  --editor-code-string: #116329
  --editor-code-value: #953800
  --editor-code-function: #8250df
  --editor-code-deleted: #b42318
  display grid
  grid-template-columns minmax(0, 1fr)
  align-items start
  column-gap var(--editor-outline-gap, 24px)
  position relative
  width 100%
  max-width var(--editor-layout-width, 1060px)
  min-height 100%
  margin 0 auto
  color var(--editor-text)
  background var(--editor-bg)

  [data-theme='dark'] &
    --editor-code-string: #98c379
    --editor-code-value: #e5c07b
    --editor-code-function: #61afef
    --editor-code-deleted: #e06c75

  &--outline
    grid-template-columns var(--editor-outline-width, 176px) minmax(0, 1fr)

  &--minimap
    grid-template-columns minmax(0, 1fr) var(--editor-minimap-width, 112px)
    max-width var(--editor-layout-width, 996px)

  &--outline&--minimap
    grid-template-columns var(--editor-outline-width, 176px) minmax(0, 1fr) var(--editor-minimap-width, 112px)
    max-width var(--editor-layout-width, 1196px)

  .milkdown
    position relative
    font-family inherit

  &__outline-anchor, &__minimap-anchor
    display contents

  &--floating-navigation
    &.milkdown-editor
      display block
      width calc(100% - var(--edit-canvas-inset, 0px) * 2)
      max-width var(--edit-content-width, 860px)

    .milkdown-editor__outline-anchor, .milkdown-editor__minimap-anchor
      position absolute
      top 0
      bottom 0
      display block

    .milkdown-editor__outline-anchor
      right calc(100% + var(--editor-outline-gap, 24px))
      width var(--editor-outline-width, 176px)

    .milkdown-editor__minimap-anchor
      left calc(100% + var(--editor-outline-gap, 24px))
      width var(--editor-minimap-width, 112px)

    @media (max-width: 1387px)
      .milkdown-editor__outline-anchor
        display none

    @media (max-width: 1199px)
      .milkdown-editor__minimap-anchor
        display none

  &__document
    min-width 0
    min-height 100%

  &__toolbar
    position sticky
    top 0
    z-index 10
    display flex
    align-items center
    gap 2px
    min-height 45px
    padding 6px 12px
    overflow-x auto
    border-bottom 1px solid var(--editor-border)
    background var(--editor-bg)

  &__action
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    min-width 32px
    height 32px
    padding 0 8px
    border-radius 6px
    background transparent
    color var(--editor-secondary)
    font-family inherit
    font-size 13px
    line-height 1
    cursor pointer
    transition background .15s, color .15s

    &:hover:not(:disabled)
      background var(--editor-hover)
      color var(--editor-text)

    &:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset -2px

    &:active:not(:disabled)
      background var(--editor-selected)

    &:disabled
      opacity .4
      cursor not-allowed

    &--active, &[aria-pressed='true']
      background var(--editor-selected)
      color var(--editor-accent)

    &[data-format='bold'], &[data-format='strong']
      font-weight 700

    &[data-format='italic'], &[data-format='emphasis']
      font-style italic

    &[data-format='strike_through']
      text-decoration line-through

    &[data-format='undo'], &[data-format='redo']
      font-size 20px

  &__font-size
    flex-shrink 0
    width 76px
    height 32px
    padding 0 4px
    border 1px solid var(--editor-border)
    border-radius 6px
    background var(--editor-bg)
    color var(--editor-text)
    font-family inherit
    font-size 13px
    cursor pointer

    &:hover:not(:disabled)
      background var(--editor-hover)

    &:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset -2px

    &:active:not(:disabled)
      background var(--editor-selected)

    &:disabled
      opacity .4
      cursor not-allowed

  &__color-controls
    display flex
    align-items center
    gap 4px

  &__color-button
    gap 5px

  &__color-icon
    position relative
    display inline-flex
    padding-bottom 4px

  &__color-indicator
    position absolute
    right 0
    bottom 0
    left 0
    height 3px
    border-radius 2px

  &__color-chevron
    transform rotate(90deg)

  &__uploading
    animation milkdown-toolbar-spin 1s linear infinite

  &__separator
    width 1px
    height 18px
    margin 0 6px
    background var(--editor-border)
    flex-shrink 0

  &__content
    box-sizing border-box
    width 100%
    max-width 860px
    min-height 360px
    margin 0 auto
    padding 36px 52px 100px
    outline none
    color var(--editor-text)
    font-family inherit
    font-size 15px
    line-height 1.8
    overflow-wrap anywhere
    caret-color var(--editor-accent)

    &:focus-visible
      outline none

    > :first-child
      margin-top 0

    p
      min-height 1.8em
      margin 8px 0

    h1, h2, h3, h4, h5, h6
      margin 28px 0 10px
      font-weight 600
      line-height 1.4
      letter-spacing -.015em
      scroll-margin-top 64px

    h1
      font-size 30px

    h2
      font-size 24px

    h3
      font-size 20px

    h4, h5, h6
      font-size 16px

    strong
      font-weight 650

    a
      color var(--editor-accent)
      text-decoration underline
      text-underline-offset 3px
      cursor pointer

      &[data-voex-file-reference]
        cursor default

      &:not([data-voex-file-reference]):hover
        text-decoration-thickness 2px
        background var(--editor-selected)

      &:focus-visible
        outline 2px solid var(--editor-accent)
        outline-offset 2px
        border-radius 2px

    blockquote
      margin 16px 0
      padding 2px 16px
      border-left 3px solid var(--editor-border)
      color var(--editor-secondary)

    ul, ol
      padding-left 26px
      margin 8px 0

    ul
      list-style disc

    ol
      list-style decimal

    li
      margin 4px 0

      p
        margin 0

      ul, ol
        margin 4px 0

    li[data-item-type='task']
      position relative
      list-style none

    li[data-checked='true'] > .milkdown-editor__list-content > p
      color var(--editor-muted)
      text-decoration line-through

    code
      padding 2px 5px
      border-radius 4px
      background var(--editor-hover)
      font-family 'Cascadia Code', Consolas, monospace
      font-size .88em

    pre
      margin 16px 0
      padding 16px
      overflow-x auto
      border 1px solid var(--editor-border)
      border-radius 8px
      background var(--editor-panel)
      white-space pre
      overflow-wrap normal
      tab-size 2

      code
        padding 0
        background transparent
        line-height 1.6

      // Prism 只标记 token，局部配色随编辑器主题切换。
      .token.comment, .token.prolog, .token.doctype, .token.cdata
        color var(--editor-muted)

      .token.punctuation, .token.operator
        color var(--editor-secondary)

      .token.keyword, .token.atrule, .token.attr-name, .token.tag
        color var(--editor-accent)

      .token.string, .token.char, .token.attr-value, .token.inserted
        color var(--editor-code-string)

      .token.number, .token.boolean, .token.constant, .token.regex
        color var(--editor-code-value)

      .token.function, .token.class-name, .token.builtin
        color var(--editor-code-function)

      .token.deleted
        color var(--editor-code-deleted)

      .token.bold
        font-weight 700

      .token.italic
        font-style italic

    hr
      margin 24px 0
      border 0
      border-top 1px solid var(--editor-border)

    img
      max-width 100%
      height auto
      border-radius 6px
      vertical-align middle

    .milkdown-emoji
      display inline-block
      width 1.1em
      height 1.1em
      vertical-align -0.15em
      line-height 1

      &__image
        display block
        width 100%
        height 100%
        border-radius 0

      &__fallback
        display block

      [hidden]
        display none

    .tableWrapper
      max-width 100%
      margin 16px 0
      overflow-x auto

    table
      width 100%
      table-layout fixed
      border-collapse collapse

    .column-resize-handle
      background var(--editor-accent)

    td, th
      position relative
      padding 8px 12px
      border 1px solid var(--editor-border)
      vertical-align top
      text-align left

    th
      background var(--editor-hover)
      font-weight 600

    .selectedCell:after
      background var(--editor-selected)
      opacity .4

    .ProseMirror-selectednode
      outline 2px solid var(--editor-accent)
      outline-offset 2px

    .ProseMirror-gapcursor:after
      border-top-color var(--editor-text)

  &__task-checkbox
    position absolute
    top 6px
    left -24px
    width 16px
    height 16px
    margin 0
    accent-color var(--editor-accent)
    cursor pointer

    &:disabled
      cursor default

    &:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset 2px

  &__image
    position relative
    display inline-block
    max-width 100%
    vertical-align middle
    border-radius 6px
    line-height 0

    &[data-align]
      display block
      width fit-content

    &[data-align='left']
      margin-left 0
      margin-right auto

    &[data-align='center']
      margin-left auto
      margin-right auto

    &[data-align='right']
      margin-left auto
      margin-right 0

      .milkdown-editor__image-handle
        left -7px
        right auto
        cursor nesw-resize

    [hidden]
      display none !important

    &--selected
      outline 2px solid var(--editor-accent)
      outline-offset 2px

    &--resizing
      user-select none

    &:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset 2px

  &__media
    display block
    margin 10px 0
    min-height 54px
    line-height 1.5

    .milkdown-attachment__media
      width 100%
      box-sizing border-box
      min-height 54px

    .milkdown-attachment__media-status
      flex-basis 100%

    &[data-kind='video'] .milkdown-attachment__media[aria-busy], &[data-kind='video'] .milkdown-attachment__media:has(> button:not([hidden]))
      min-height 100px
      padding 12px
      background var(--editor-hover)
      border-radius 6px

  &__image-media
    display block
    width 100%
    height auto

  &__image-handle
    position absolute
    right -7px
    bottom -7px
    z-index 2
    width 20px
    height 20px
    padding 0
    border 2px solid var(--editor-bg)
    border-radius 5px
    background var(--editor-accent)
    color var(--editor-bg)
    cursor nwse-resize
    touch-action none

    &:hover
      filter brightness(1.15)

    &:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset 3px

  &__image-controls
    position fixed
    z-index 30
    box-sizing border-box
    display flex
    align-items center
    flex-wrap nowrap
    gap 4px
    width max-content
    max-width calc(100vw - 24px)
    padding 6px
    overflow-x auto
    border 1px solid var(--editor-border)
    border-radius 6px
    background var(--editor-panel)
    box-shadow var(--shadow-medium)
    color var(--editor-text)
    font-size 12px
    line-height 1.5
    white-space nowrap

    input
      box-sizing border-box
      width 64px
      height 28px
      padding 0 6px
      border 1px solid var(--editor-border)
      border-radius 4px
      background var(--editor-bg)
      color var(--editor-text)
      font-size 12px

      &[aria-invalid='true']
        border-color var(--color-red)

    button
      display inline-flex
      flex-shrink 0
      align-items center
      justify-content center
      width 28px
      height 28px
      padding 6px
      border 0
      border-radius 4px
      color var(--editor-text)
      background transparent
      cursor pointer

      &:hover:not(:disabled)
        background var(--editor-selected)

      &:active:not(:disabled)
        filter brightness(.9)

    input, button
      &:focus-visible
        outline 2px solid var(--editor-accent)
        outline-offset 1px

      &:disabled
        opacity .5
        cursor not-allowed

  &__image-label
    display inline-flex
    flex-shrink 0
    align-items center
    gap 4px

  &__image-alignment
    display flex
    flex-shrink 0
    align-items center
    gap 2px

    button[aria-pressed='true']
      color var(--editor-accent)
      background var(--editor-selected)

  &__image-separator
    flex-shrink 0
    width 1px
    height 18px
    background var(--editor-border)

  &__image-validation
    position fixed
    z-index 31
    box-sizing border-box
    width max-content
    max-width calc(100vw - 24px)
    padding 4px 8px
    border 1px solid var(--color-red)
    border-radius 4px
    background var(--editor-panel)
    color var(--color-red)
    font-size 12px
    line-height 1.5

  &__image-error
    display inline-flex
    align-items center
    justify-content center
    min-width 140px
    min-height 72px
    padding 12px
    background var(--editor-hover)
    color var(--editor-muted)
    font-size 13px
    line-height 1.5

  @media (pointer: coarse)
    &__image-handle
      width 28px
      height 28px

    &__image-controls input, &__image-controls button
      min-height 40px

  &__list-content
    min-width 0

  &__empty[data-placeholder]:before
    float left
    height 0
    color var(--editor-muted)
    content attr(data-placeholder)
    pointer-events none

  &__upload
    display inline-block
    padding 4px 10px
    border 1px dashed var(--editor-border)
    border-radius 6px
    color var(--editor-muted)
    font-size 13px

  &__popover
    position absolute
    z-index 20
    border 1px solid var(--editor-border)
    border-radius 8px
    background var(--editor-panel)
    box-shadow var(--shadow-medium, 0 4px 24px #0002)
    color var(--editor-text)
    font-family inherit
    font-size 13px

    &[data-show='false'], &[hidden]
      display none

  &__link-popover
    position absolute
    z-index 20
    max-width calc(100vw - 32px)
    padding 6px
    border 1px solid var(--editor-border)
    border-radius 8px
    background var(--editor-panel)
    box-shadow var(--shadow-medium, 0 4px 24px #0002)
    color var(--editor-text)
    font-family inherit
    font-size 13px

    &[data-show='false']
      display none

    .link-preview, .link-edit
      display flex
      align-items center
      gap 4px
      min-width 0

    .link-display
      display block
      min-width 0
      max-width 320px
      padding 6px 8px
      overflow hidden
      text-overflow ellipsis
      white-space nowrap
      border-radius 6px
      color var(--editor-accent)
      text-decoration none
      cursor default

      &[href]
        cursor pointer

        &:hover
          background var(--editor-hover)
          text-decoration underline

    .button
      display inline-flex
      flex-shrink 0

      button
        display inline-flex
        align-items center
        justify-content center
        min-width 32px
        height 32px
        padding 6px 8px
        border 0
        border-radius 6px
        background transparent
        color var(--editor-secondary)
        font inherit
        cursor pointer

        &:hover
          background var(--editor-hover)
          color var(--editor-text)

        &:active
          background var(--editor-selected)

      svg
        width 16px
        height 16px
        fill currentColor
        pointer-events none

    button:focus-visible, .link-display:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset 1px

    .input-area
      width 280px
      min-width 0
      max-width calc(100vw - 112px)
      height 32px
      padding 6px 9px
      border 1px solid var(--editor-border)
      border-radius 6px
      outline none
      background var(--editor-bg)
      color var(--editor-text)
      font inherit

      &::placeholder
        color var(--editor-muted)

      &:focus
        border-color var(--editor-accent)
        box-shadow 0 0 0 1px var(--editor-accent)

      &[aria-invalid='true']
        border-color var(--color-red)

    .confirm button
      color var(--editor-accent)
      background var(--editor-selected)

    &[data-readonly='true']
      .link-edit-button, .link-remove-button
        display none

  &__format
    display flex
    flex-wrap wrap
    gap 2px
    padding 4px
    max-width calc(100vw - 24px)

  &__slash
    width 260px
    max-width calc(100vw - 24px)
    max-height unquote('min(360px, 60vh)')
    padding 6px
    overflow-y auto
    overscroll-behavior contain

  &__slash-title
    padding 6px 8px
    color var(--editor-muted)
    font-size 11px

  &__slash-item
    display flex
    align-items center
    gap 10px
    width 100%
    padding 7px 8px
    border-radius 6px
    background transparent
    color var(--editor-secondary)
    font-family inherit
    text-align left
    cursor pointer

    &:hover, &[aria-selected='true'], &:focus-visible
      outline none
      background var(--editor-selected)
      color var(--editor-accent)

    &:active
      background var(--editor-hover)

  &__slash-icon
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    width 28px
    height 28px
    border 1px solid var(--editor-border)
    border-radius 5px
    font-size 13px
    font-weight 600

  &__slash-label
    font-size 13px

  &__slash-hint
    margin-left auto
    color var(--editor-muted)
    font-size 11px

  &__slash .milkdown-editor__empty
    padding 12px 8px
    color var(--editor-muted)
    font-size 13px

  &__block
    position absolute
    z-index 5
    display flex
    gap 1px
    border 0
    border-radius 0
    background transparent
    box-shadow none

    // 定位前保留尺寸和 offsetParent，避免隐藏状态下算出页面坐标。
    &[data-show='false']
      display flex
      visibility hidden
      pointer-events none

    &[hidden]
      display none

  &__block-handle, &__block-add
    display inline-flex
    align-items center
    justify-content center
    width 22px
    height 28px
    border-radius 5px
    background var(--editor-bg)
    color var(--editor-muted)
    font-size 18px
    cursor pointer

    &:hover, &:focus-visible
      background var(--editor-hover)
      color var(--editor-text)

    &:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset -2px

  &__block-handle
    cursor grab

    &:active
      cursor grabbing

  &--readonly
    .milkdown-editor__popover, .milkdown-editor__block
      display none

  @media (max-width: 720px)
    &__content
      padding 24px 32px 72px

    &__block-add
      display none

    &__toolbar
      padding 6px 8px

  @media (pointer: coarse)
    &__action
      min-width 40px
      height 40px

    &__slash-item
      min-height 44px

    &__task-checkbox
      width 20px
      height 20px

.milkdown-attachment
  display flex
  align-items center
  flex-wrap wrap
  gap 12px
  box-sizing border-box
  width 100%
  min-height 64px
  margin 10px 0
  padding 10px 12px
  border 1px solid var(--editor-border)
  border-radius 10px
  background var(--editor-panel)
  color var(--editor-text)
  transition border-color .15s, background .15s, box-shadow .15s

  &:hover
    border-color var(--editor-accent)

  &--selected
    border-color var(--editor-accent)
    box-shadow 0 0 0 2px rgba(30, 144, 255, .14)

  &--unavailable
    border-style dashed
    background var(--editor-hover)

  &__media
    display flex
    flex 0 0 100%
    min-width 0
    flex-wrap wrap
    align-items center
    gap 8px

    &[hidden]
      display none

  &__media-status
    flex 1 1 180px
    color var(--editor-muted)
    font-size 12px
    line-height 20px
    overflow-wrap anywhere

    &[hidden]
      display none

  &__player
    display block
    box-sizing border-box
    width 100%
    min-width 0
    max-width 100%
    border-radius 6px

    &:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset 2px

  video&__player
    height auto
    object-fit contain
    background var(--editor-hover)

  &__icon
    display inline-flex
    align-items center
    justify-content center
    width 40px
    height 40px
    border-radius 9px
    background var(--editor-hover)
    color var(--editor-secondary)
    flex-shrink 0

  &__icon-svg
    width 20px
    height 20px

  &__info
    display flex
    flex 1
    min-width 0
    flex-direction column
    gap 3px

  &__name
    overflow hidden
    font-size 14px
    font-weight 600
    line-height 20px
    text-overflow ellipsis
    white-space nowrap

  &__meta
    overflow hidden
    color var(--editor-muted)
    font-size 12px
    line-height 18px
    text-overflow ellipsis
    white-space nowrap

  &__unavailable
    color #d14343
    font-size 12px
    line-height 18px

  &__preview
    display inline-flex
    align-items center
    justify-content center
    min-width 56px
    height 32px
    padding 0 12px
    border 1px solid var(--editor-border)
    border-radius 7px
    background var(--editor-panel)
    color var(--editor-secondary)
    cursor pointer
    font-size 12px
    font-weight 500
    flex-shrink 0
    transition border-color .15s, background .15s, color .15s
    -webkit-tap-highlight-color transparent
    touch-action manipulation
    user-select none

    @media (hover hover)
      &:hover
        border-color var(--editor-accent)
        background var(--editor-hover)
        color var(--editor-accent)

    &:active
      border-color var(--editor-accent)
      background var(--editor-selected)
      color var(--editor-accent)

    &:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset 2px

    &[hidden]
      display none

    @media (pointer coarse)
      min-height 44px
      min-width 44px
.milkdown-editor__color-menu
  box-sizing border-box
  width 280px
  max-width calc(100vw - 16px)
  border 1px solid var(--color-border-secondary)
  border-radius var(--border-radius-item-m)
  background var(--color-bg-secondary)
  color var(--color-text-primary)

  .color-picker
    box-sizing border-box
    width 100%
    border none

.milkdown-editor__color-footer
  display flex
  align-items center
  gap 6px
  padding 6px
  border-top 1px solid var(--color-border-secondary)

.milkdown-editor__color-clear
  display flex
  align-items center
  gap 8px
  min-height 32px
  padding 6px
  border-radius var(--border-radius-item-s)
  color var(--color-text-secondary)
  background transparent
  font-family inherit
  font-size 13px
  cursor pointer

  &:hover:not(:disabled)
    background var(--color-bg-translucent)
    color var(--color-text-primary)

  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset -2px

  &:active:not(:disabled)
    background var(--color-accent-tint)

  &:disabled
    opacity .4
    cursor not-allowed

.milkdown-editor__color-clear
  flex 1

@keyframes milkdown-toolbar-spin
  to
    transform rotate(360deg)

@media (prefers-reduced-motion: reduce)
  .milkdown-editor__uploading
    animation none

@media (max-width: 768px)
  .milkdown-editor
    grid-template-columns minmax(0, 1fr)
    column-gap 0
</style>
