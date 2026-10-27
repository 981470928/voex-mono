<template>
  <VoexModal
    class="pexels-dialog-modal"
    :model-value="true"
    title="Pexels 图库"
    :width="960"
    height="min(780px, 86dvh)"
    @close="emit('close')"
  >
    <div class="pexels-dialog">
      <form class="pexels-dialog__filters" novalidate @submit.prevent="submit">
        <div class="pexels-dialog__search">
          <label :for="`${id}-search`">搜索图片</label>
          <div class="pexels-dialog__search-field">
            <input
              :id="`${id}-search`"
              ref="searchInput"
              v-model="query"
              type="search"
              placeholder="搜索风景、建筑、人物…"
              maxlength="200"
              autofocus
              @input="scheduleSearch"
              @compositionstart="startComposition"
              @compositionend="endComposition"
              @keydown.enter="handleEnter"
            />
            <button
              v-if="query"
              type="button"
              class="pexels-dialog__clear"
              aria-label="清空搜索"
              @click="clearSearch"
            >
              ×
            </button>
          </div>
        </div>
        <div class="pexels-dialog__filter">
          <label :for="`${id}-orientation`">方向</label>
          <select :id="`${id}-orientation`" v-model="orientation" @change="refresh">
            <option value="">全部方向</option>
            <option value="landscape">横向</option>
            <option value="portrait">纵向</option>
            <option value="square">正方形</option>
          </select>
        </div>
        <div class="pexels-dialog__filter">
          <label :for="`${id}-color`">颜色</label>
          <select :id="`${id}-color`" v-model="color" @change="refresh">
            <option value="">全部颜色</option>
            <option v-for="item in colors" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </div>
        <button class="pexels-dialog__button pexels-dialog__button--primary" type="submit">
          搜索
        </button>
      </form>
      <p class="pexels-dialog__hint">
        {{ inserting ? '正在导入图片…' : '点击图片导入并插入正文。'
        }}{{
          !query.trim() && (orientation || color)
            ? '未输入关键词时，筛选“自然”主题图片。'
            : '图片保留原始比例。'
        }}
      </p>
      <div ref="resultsElement" class="pexels-dialog__results" :aria-busy="loading">
        <div v-if="photos.length" class="pexels-dialog__masonry" aria-label="图片搜索结果">
          <article v-for="photo in photos" :key="photo.id" class="pexels-dialog__photo">
            <button
              type="button"
              class="pexels-dialog__image-button"
              :aria-label="`插入图片：${photo.alt || photo.photographer + ' 的照片'}`"
              :disabled="loading || inserting || failedImages.has(photo.id)"
              :aria-busy="insertingId === photo.id"
              :style="{
                aspectRatio: `${photo.width} / ${photo.height}`,
                backgroundColor: photo.avg_color,
              }"
              @click="selectPhoto(photo)"
            >
              <span v-if="failedImages.has(photo.id)" class="pexels-dialog__image-error"
                >图片无法加载</span
              >
              <img
                v-else
                :src="photo.src.medium"
                :alt="photo.alt || 'Pexels 摄影作品'"
                :width="photo.width"
                :height="photo.height"
                loading="lazy"
                @error="failedImages.add(photo.id)"
              />
              <span v-if="!failedImages.has(photo.id)" class="pexels-dialog__insert">{{
                insertingId === photo.id ? '正在导入…' : '插入图片'
              }}</span>
            </button>
            <a
              :href="photo.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="`查看 ${photo.photographer} 的 Pexels 作品`"
              >{{ photo.photographer }}</a
            >
          </article>
        </div>
        <div v-if="loading && !photos.length" class="pexels-dialog__state" role="status">
          正在加载图片…
        </div>
        <div
          v-else-if="!loading && !error && !photos.length"
          class="pexels-dialog__state"
          role="status"
        >
          没有找到图片，请更换关键词或筛选条件。
        </div>
        <div v-if="error" class="pexels-dialog__feedback" role="alert">
          <p>{{ error }}</p>
          <button
            class="pexels-dialog__button"
            type="button"
            :disabled="loading"
            @click="load(failedPage)"
          >
            重新加载
          </button>
        </div>
        <div v-if="photos.length && !error" class="pexels-dialog__more">
          <button
            v-if="hasMore"
            class="pexels-dialog__button"
            type="button"
            :disabled="loading"
            :aria-busy="loading"
            @click="load(page + 1)"
          >
            {{ loading ? '加载中…' : '加载更多' }}
          </button>
          <p v-else>已显示全部图片</p>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="pexels-dialog__footer">
        <a href="https://www.pexels.com/" target="_blank" rel="noopener noreferrer"
          >图片来自 Pexels</a
        >
        <span role="status"
          >已加载 {{ photos.length }} 张{{ total === undefined ? '' : ` / 共 ${total} 张` }}</span
        >
      </div>
    </template>
  </VoexModal>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { VoexModal } from '@/plugins/voex-modal';
import {
  getPexelsPhotos,
  type PexelsOrientation,
  type PexelsPhoto,
} from '@/service/api/pexels-api';

const props = defineProps<{ onInsert: (photo: PexelsPhoto) => void | Promise<void> }>();
const emit = defineEmits<{ close: [] }>();
const id = useId();
const searchInput = ref<HTMLInputElement>();
const resultsElement = ref<HTMLElement>();
const query = ref('');
const orientation = ref<PexelsOrientation>('');
const color = ref('');
const photos = ref<PexelsPhoto[]>([]);
const failedImages = ref(new Set<number>());
const loading = ref(false);
const inserting = ref(false);
const insertingId = ref<number>();
let disposed = false;
const error = ref('');
const page = ref(0);
const failedPage = ref(1);
const total = ref<number>();
const hasMore = ref(false);
const colors = [
  { value: 'red', label: '红色' },
  { value: 'orange', label: '橙色' },
  { value: 'yellow', label: '黄色' },
  { value: 'green', label: '绿色' },
  { value: 'turquoise', label: '青色' },
  { value: 'blue', label: '蓝色' },
  { value: 'violet', label: '紫色' },
  { value: 'pink', label: '粉色' },
  { value: 'brown', label: '棕色' },
  { value: 'black', label: '黑色' },
  { value: 'gray', label: '灰色' },
  { value: 'white', label: '白色' },
];
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let composing = false;
let compositionEndedAt = -Infinity;

function cancelPending() {
  clearTimeout(timer);
  controller?.abort();
  controller = undefined;
  loading.value = false;
}

async function load(nextPage: number) {
  if (loading.value || composing) return;
  const request = new AbortController();
  controller = request;
  loading.value = true;
  error.value = '';
  failedPage.value = nextPage;
  try {
    const result = await getPexelsPhotos(
      { query: query.value, orientation: orientation.value, color: color.value, page: nextPage },
      request.signal
    );
    if (request.signal.aborted) return;
    const seen = new Set(photos.value.map((photo) => photo.id));
    photos.value.push(...result.photos.filter((photo) => !seen.has(photo.id)));
    page.value = result.page;
    total.value = result.total_results;
    hasMore.value = Boolean(result.next_page) && result.photos.length > 0;
  } catch (cause) {
    if (!request.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '图片加载失败，请重试';
  } finally {
    if (controller === request) loading.value = false;
  }
}

function resetResults() {
  photos.value = [];
  failedImages.value.clear();
  error.value = '';
  page.value = 0;
  total.value = undefined;
  hasMore.value = false;
  resultsElement.value?.scrollTo({ top: 0 });
}

function refresh() {
  cancelPending();
  resetResults();
  void load(1);
}

function scheduleSearch() {
  cancelPending();
  resetResults();
  if (!composing) {
    loading.value = true;
    timer = setTimeout(() => {
      loading.value = false;
      void load(1);
    }, 300);
  }
}

function startComposition() {
  composing = true;
  cancelPending();
}
function endComposition(event: CompositionEvent) {
  composing = false;
  compositionEndedAt = event.timeStamp;
  scheduleSearch();
}
function handleEnter(event: KeyboardEvent) {
  if (event.isComposing || composing || event.timeStamp - compositionEndedAt < 50)
    event.preventDefault();
}
function submit() {
  if (!composing) refresh();
}
function clearSearch() {
  query.value = '';
  refresh();
  searchInput.value?.focus();
}
async function selectPhoto(photo: PexelsPhoto) {
  if (loading.value || inserting.value || failedImages.value.has(photo.id)) return;
  inserting.value = true;
  insertingId.value = photo.id;
  error.value = '';
  try {
    await props.onInsert(photo);
    if (!disposed) emit('close');
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : '图片插入失败，请重试';
  } finally {
    inserting.value = false;
    insertingId.value = undefined;
  }
}
onMounted(() => {
  void load(1);
});
onBeforeUnmount(() => {
  disposed = true;
  cancelPending();
});
</script>

<style scoped lang="stylus">
:global(.pexels-dialog-modal .voex-modal__body)
  display flex
  overflow hidden

.pexels-dialog
  width 100%
  display flex
  flex-direction column
  height 100%
  min-height 0

  &__filters
    display flex
    align-items flex-end
    flex-wrap wrap
    gap 12px

  &__search
    flex 1 1 240px
    min-width 0

  &__filter
    flex 0 1 128px

  label
    display block
    margin-bottom 6px
    font-size 12px
    color var(--color-text-secondary)

  input, select
    width 100%
    height 36px
    padding 0 10px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)
    color var(--color-text-primary)
    font inherit

    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 1px

  input
    padding-right 36px
    &::-webkit-search-cancel-button
      display none

  select
    cursor pointer

  &__search-field
    position relative

  &__clear
    position absolute
    top 2px
    right 2px
    width 32px
    height 32px
    border-radius 4px
    background transparent
    color var(--color-text-secondary)
    font-size 20px

  button, a
    cursor pointer
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
    &:hover:not(:disabled)
      filter brightness(1.15)
    &:active:not(:disabled)
      filter brightness(.9)

  button:disabled
    cursor not-allowed
    opacity .6

  &__button
    min-width 86px
    height 36px
    padding 0 14px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)
    color var(--color-text-primary)
    font inherit

    &--primary
      background var(--color-brand-bg)
      color var(--color-brand-text)
      border-color var(--color-brand-bg)

  &__hint
    margin 12px 0
    font-size 12px
    color var(--color-text-tertiary)

  &__results
    min-height 0
    flex 1
    overflow-y auto
    overscroll-behavior contain
    scrollbar-gutter stable

  &__masonry
    columns 3
    column-gap 14px

  &__photo
    display inline-block
    width 100%
    margin-bottom 14px
    break-inside avoid
    vertical-align top

    a
      display block
      margin-top 5px
      color var(--color-text-secondary)
      font-size 12px
      overflow-wrap anywhere
      &:hover
        color var(--color-accent)

  &__image-button
    position relative
    display block
    width 100%
    padding 0
    overflow hidden
    border-radius 6px

    img
      display block
      width 100%
      height 100%
      object-fit contain

    &:hover .pexels-dialog__insert, &:focus-visible .pexels-dialog__insert
      background var(--color-brand-bg)
      color var(--color-brand-text)

  &__insert
    position absolute
    right 8px
    bottom 8px
    padding 4px 8px
    border-radius 4px
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    font-size 12px

  &__image-error
    display grid
    place-items center
    height 100%
    padding 12px
    background var(--color-bg-panel)
    color var(--color-text-secondary)

  &__state
    display grid
    place-items center
    min-height 260px
    padding 20px
    text-align center
    color var(--color-text-secondary)

  &__feedback, &__more
    padding 16px
    text-align center
    p
      margin 0 0 10px

  &__feedback
    color var(--color-red)

  &__more
    color var(--color-text-tertiary)
    font-size 12px

  &__footer
    display flex
    flex-wrap wrap
    justify-content space-between
    gap 8px
    width 100%
    color var(--color-text-tertiary)
    font-size 12px
    a
      color var(--color-link-primary)
      &:hover
        color var(--color-accent)
      &:focus-visible
        outline 2px solid var(--color-accent)

@media (max-width: 600px)
  .pexels-dialog
    &__search
      flex-basis 100%
    &__filter
      flex 1 1 90px
    &__masonry
      columns 2
      column-gap 10px

@media (max-width: 360px)
  .pexels-dialog__masonry
    columns 1
</style>
