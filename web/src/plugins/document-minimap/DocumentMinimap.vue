<template>
  <aside
    v-show="available"
    class="document-minimap"
    :class="{ 'document-minimap--inactive': !active }"
    :aria-hidden="!active || undefined"
    :inert="!active"
    aria-label="文档小地图"
  >
    <div ref="track" class="document-minimap__track" :style="{ height: `${trackHeight}px` }" />
  </aside>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createDocumentMinimap, type MinimapPlaceholderRule } from './controller';

const props = withDefaults(
  defineProps<{
    sourceRoot: HTMLElement | null;
    active: boolean;
    contentSelector: string;
    placeholders: MinimapPlaceholderRule[];
    ignoreSelectors: string[];
    minSourceWidth?: number;
  }>(),
  { minSourceWidth: 1000 }
);

const emit = defineEmits<{
  availability: [available: boolean];
}>();

const track = ref<HTMLElement>();
const available = ref(false);
const trackHeight = ref(0);

let instance: ReturnType<typeof createDocumentMinimap> | undefined;
let currentContent: HTMLElement | undefined;
let observer: ResizeObserver | undefined;
let observedElements = new Set<HTMLElement>();
let lastViewport: HTMLElement | null | undefined;
let lastDimensions = '';
let emittedAvailability: boolean | undefined;
let mounted = false;
let disposed = false;
let frame = 0;
let revision = 0;
let rebuildPending = false;

function findScrollViewport(root: HTMLElement | null): HTMLElement | null {
  let element = root?.parentElement ?? null;
  while (element) {
    if (element === document.scrollingElement) return null;
    if (/^(auto|scroll)$/.test(window.getComputedStyle(element).overflowY)) return element;
    element = element.parentElement;
  }
  return null;
}

function observeLayout(root: HTMLElement | null, viewport: HTMLElement | null) {
  if (!observer) return;
  const targets = new Set(
    [root, viewport, track.value].filter((element): element is HTMLElement => !!element)
  );
  for (const element of observedElements) {
    if (!targets.has(element)) observer.unobserve(element);
  }
  for (const element of targets) {
    if (!observedElements.has(element)) observer.observe(element);
  }
  observedElements = targets;
}

function destroyMinimap() {
  instance?.destroy();
  instance = undefined;
  currentContent = undefined;
}

async function syncMinimap(rebuild: boolean, resize: boolean) {
  const expectedRevision = ++revision;
  await nextTick();
  if (disposed || revision !== expectedRevision) return;

  const source = props.sourceRoot;
  const host = track.value;
  if (!props.active || !available.value || !source?.isConnected || !host?.isConnected) {
    destroyMinimap();
    return;
  }

  const content = source.querySelector<HTMLElement>(props.contentSelector);
  if (!content || !host.clientWidth || !host.clientHeight) {
    destroyMinimap();
    return;
  }

  if (instance && currentContent === content && !rebuild) {
    if (resize) instance.resize();
    return;
  }

  destroyMinimap();
  try {
    instance = createDocumentMinimap({
      content,
      host,
      placeholders: props.placeholders,
      ignoreSelectors: props.ignoreSelectors,
    });
    currentContent = content;
  } catch (error) {
    // An optional navigation aid must not interrupt document editing.
    destroyMinimap();
    console.error('[DocumentMinimap] 初始化失败', error);
  }
}

watch(
  () => props.minSourceWidth,
  () => scheduleLayout()
);

function updateLayout() {
  frame = 0;
  if (disposed) return;

  const source = props.sourceRoot;
  const viewport = findScrollViewport(source);
  const sourceWidth = source?.clientWidth ?? 0;
  const viewportHeight = viewport?.clientHeight ?? window.innerHeight;
  const height = Math.max(0, viewportHeight - 16);
  const nextAvailable =
    !!source?.isConnected && window.innerWidth >= 1100 && sourceWidth >= props.minSourceWidth;
  const dimensions = `${sourceWidth}:${window.innerWidth}:${height}:${track.value?.clientWidth ?? 0}`;
  const resized = dimensions !== lastDimensions;
  const rebuild = rebuildPending || viewport !== lastViewport;
  rebuildPending = false;
  lastDimensions = dimensions;
  lastViewport = viewport;

  observeLayout(source, viewport);
  trackHeight.value = height;
  available.value = nextAvailable;
  // Keep the right column stable while the editor is loading or replacing its document.
  if (emittedAvailability !== nextAvailable) {
    emittedAvailability = nextAvailable;
    emit('availability', nextAvailable);
  }

  if (!nextAvailable || !props.active) {
    revision++;
    destroyMinimap();
    return;
  }

  void syncMinimap(rebuild, resized);
}

function scheduleLayout(rebuild = false) {
  rebuildPending ||= rebuild;
  if (!mounted || disposed || frame) return;
  frame = window.requestAnimationFrame(updateLayout);
}

function handleWindowResize() {
  scheduleLayout();
}

watch(
  () => props.sourceRoot,
  () => {
    revision++;
    destroyMinimap();
    scheduleLayout(true);
  },
  { flush: 'post' }
);

watch(
  () => [props.active, props.contentSelector, props.placeholders, props.ignoreSelectors] as const,
  () => {
    revision++;
    if (!props.active) destroyMinimap();
    scheduleLayout(true);
  },
  { flush: 'post', deep: true }
);

onMounted(() => {
  mounted = true;
  observer = new ResizeObserver(() => scheduleLayout());
  window.addEventListener('resize', handleWindowResize, { passive: true });
  scheduleLayout(true);
});

onBeforeUnmount(() => {
  disposed = true;
  revision++;
  if (frame) window.cancelAnimationFrame(frame);
  frame = 0;
  observer?.disconnect();
  observer = undefined;
  observedElements.clear();
  window.removeEventListener('resize', handleWindowResize);
  destroyMinimap();
});
</script>

<style scoped lang="stylus">
.document-minimap
  position sticky
  top 8px
  align-self start
  width var(--editor-minimap-width, 112px)
  min-width 0
  color var(--editor-text)

  &--inactive
    visibility hidden
    pointer-events none

  &__track
    position relative
    width 100%
    min-height 0
    overflow hidden
    border-radius 4px

  :deep(.dom-minimap)
    position absolute
    inset 0
    box-sizing border-box
    width 100% !important
    border-left 0 !important
    border-radius inherit
    background transparent !important
    cursor pointer !important

    &:focus-visible
      outline 2px solid var(--editor-accent)
      outline-offset -2px

  :deep(.dom-minimap-content)
    opacity .7

  :deep(.dom-minimap-slider)
    box-sizing border-box
    border 1px solid unquote('color-mix(in srgb, var(--editor-border) 80%, transparent)')
    border-radius 3px
    background unquote('color-mix(in srgb, var(--editor-accent) 10%, transparent)') !important
    transition background-color .12s, border-color .12s

  :deep(.dom-minimap:hover .dom-minimap-slider)
  :deep(.dom-minimap:focus-visible .dom-minimap-slider)
    border-color unquote('color-mix(in srgb, var(--editor-accent) 35%, transparent)')
    background unquote('color-mix(in srgb, var(--editor-accent) 14%, transparent)') !important

  :deep(.dom-minimap:active .dom-minimap-slider)
    border-color unquote('color-mix(in srgb, var(--editor-accent) 50%, transparent)')
    background unquote('color-mix(in srgb, var(--editor-accent) 20%, transparent)') !important

  :deep(.document-minimap-placeholder)
  :deep([data-minimap-placeholder])
    box-sizing border-box
    overflow hidden
    border 1px solid unquote('color-mix(in srgb, var(--editor-border) 55%, transparent)')
    border-radius 6px
    background unquote('color-mix(in srgb, var(--editor-muted) 8%, transparent)')
    color var(--editor-muted)

@media (max-width: 1099px)
  .document-minimap
    display none

@media (prefers-reduced-motion: reduce)
  .document-minimap :deep(.dom-minimap-slider)
    transition none
</style>
