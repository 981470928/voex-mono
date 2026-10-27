<template>
  <main class="shared-file">
    <header class="shared-file__header">
      <div class="shared-file__home">
        <RouterLink v-if="recentKey" class="shared-file__button" :to="{ name: 'recent' }">
          最近文件
        </RouterLink>
        <span v-else class="shared-file__brand">Voex</span>
      </div>
      <h1>{{ file?.file_name || '分享文件' }}</h1>
      <nav v-if="file && !loading && !loadError" class="shared-file__actions" aria-label="阅读设置">
        <button
          type="button"
          class="shared-file__button"
          role="switch"
          :aria-checked="showMinimap"
          :disabled="isMobile"
          :title="isMobile ? '手机端不显示小地图' : undefined"
          @click="showMinimap = !showMinimap"
        >
          小地图
        </button>
        <button
          type="button"
          class="shared-file__button"
          role="switch"
          :aria-checked="showOutline"
          @click="showOutline = !showOutline"
        >
          目录
        </button>
        <RouterLink
          v-if="file.permissions.write && !authenticated"
          class="shared-file__button"
          :to="{ name: 'login', query: { return: '/share' }, hash: route.hash }"
        >
          登录可编辑
        </RouterLink>
      </nav>
    </header>
    <div v-if="loading || loadError" class="shared-file__state">
      <h2>{{ loading ? '正在打开文件…' : '无法打开文件' }}</h2>
      <p :role="loadError ? 'alert' : 'status'">{{ loadError || '正在检查访问权限并加载正文' }}</p>
      <button v-if="loadError" type="button" class="shared-file__button" @click="load">
        重新加载
      </button>
    </div>
    <p v-if="file && collaborationStatus" class="shared-file__collaboration" role="status">
      {{ collaborationStatus }}
      <button v-if="collaborationError" type="button" class="shared-file__button" @click="load">
        重新加载
      </button>
    </p>
    <section
      v-if="file && !loading && !loadError"
      class="shared-file__document"
      aria-label="分享文件正文"
    >
      <MilkdownProvider :key="file.file_key">
        <MilkdownEditor
          :default-value="file.file_content ?? ''"
          :document-key="file.file_key"
          :collaboration="collaborationBinding"
          :attachments="file.attachments"
          :allow-attachments="false"
          :load-image="loadImage"
          :show-outline="showOutline"
          :show-minimap="showMinimap"
          readonly
          @load-error="onEditorError"
        />
      </MilkdownProvider>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { MilkdownProvider } from '@milkdown/vue';
import MilkdownEditor from '@/views/edit/milkdown/MilkdownEditor.vue';
import { useDocumentCollaboration } from '@/composables/useDocumentCollaboration';
import { authenticated } from '@/service/auth-session';
import { errorMessage } from '@/utils/error';
import { isMobile } from '@/utils/platform';
import { getRecentFile, downloadRecentAttachment } from '@/service/api/recent-api';
import {
  downloadSharedAttachment,
  getSharedFile,
  restoreOptionalShareSession,
  type SharedFile,
} from '@/service/api/share-api';

const route = useRoute();
const router = useRouter();
const recentKey = computed(() =>
  route.name === 'recent-file' ? String(route.params.file_key ?? '') : ''
);
const file = ref<SharedFile | null>(null);
const loading = ref(true);
const loadError = ref('');
const showOutline = ref(true);
const showMinimap = ref(!isMobile);
const collaboration = useDocumentCollaboration({
  onReplaced: () => void load(),
  onMetadataChanged: () => void refreshMetadata(),
  onAttachmentsChanged: () => void refreshMetadata(),
});
const {
  binding: collaborationBinding,
  status: collaborationStatus,
  error: collaborationError,
} = collaboration;
let controller: AbortController | undefined;
let generation = 0;
let token = '';

// Keep the share credential in the fragment and out of referrer headers.
const referrerMeta = document.createElement('meta');
referrerMeta.name = 'referrer';
referrerMeta.content = 'no-referrer';
document.head.append(referrerMeta);

function parseToken() {
  try {
    return decodeURIComponent(route.hash.slice(1));
  } catch {
    return '';
  }
}

async function load() {
  collaboration.close();
  controller?.abort();
  const request = new AbortController();
  controller = request;
  const current = ++generation;
  const key = recentKey.value;
  token = parseToken();
  loading.value = true;
  document.title = '正在打开分享文件 · Voex';
  loadError.value = '';
  file.value = null;
  try {
    if (!key && (!token || token.length > 512))
      throw new Error('分享链接无效，请联系分享者获取完整链接。');
    if (!key) await restoreOptionalShareSession();
    if (request.signal.aborted) return;
    const result = key
      ? await getRecentFile(key, request.signal)
      : await getSharedFile(token, request.signal);
    if (request.signal.aborted || current !== generation) return;
    if (authenticated.value && result.permissions.write) {
      const failure = await router.replace({
        name: 'edit',
        params: { file_key: result.file_key },
      });
      if (failure) throw new Error('无法进入编辑页，请重试。');
      return;
    }
    await collaboration.open(
      {
        fileKey: result.file_key,
        access: key ? 'recent' : 'share',
        shareToken: key ? undefined : token,
        contentMode: result.content_mode,
      },
      request.signal
    );
    if (request.signal.aborted || current !== generation) return;
    file.value = result;
    document.title = `${result.file_name} · ${key ? '最近文件' : '分享'} · Voex`;
  } catch (cause) {
    if (request.signal.aborted || current !== generation) return;
    loadError.value =
      isAxiosError(cause) && (cause.response?.status === 404 || cause.response?.status === 403)
        ? key
          ? '查看记录已移除或访问权限已失效，请从原文件或有效分享链接重新打开。'
          : '分享链接已失效或被撤销，请联系分享者。'
        : errorMessage(cause, '文件加载失败，请重试');
    document.title = '分享文件不可用 · Voex';
  } finally {
    if (current === generation) loading.value = false;
  }
}

async function refreshMetadata() {
  const current = generation;
  const key = recentKey.value;
  try {
    const latest = key ? await getRecentFile(key) : await getSharedFile(token);
    if (current !== generation || file.value?.file_key !== latest.file_key) return;
    file.value.file_name = latest.file_name;
    file.value.attachments = latest.attachments;
    document.title = `${latest.file_name} · ${key ? '最近文件' : '分享'} · Voex`;
  } catch {
    // Preserve the readable shared document; authorization is independently refreshed by the provider.
  }
}

function onEditorError(message: string) {
  loadError.value = message;
  document.title = '分享文件不可用 · Voex';
}

// Embedded document images still need the existing authorized resource loader.
function loadImage(hash: string, signal: AbortSignal): Promise<Blob> {
  return recentKey.value
    ? downloadRecentAttachment(recentKey.value, hash, { signal })
    : downloadSharedAttachment(token, hash, { signal });
}

watch([() => route.hash, recentKey], load, { immediate: true });
onBeforeUnmount(() => {
  generation++;
  token = '';
  controller?.abort();
  referrerMeta.remove();
});
</script>

<style scoped lang="stylus">
.shared-file
  min-height 100dvh
  background var(--color-bg-primary)
  color var(--color-text-primary)
  &__header
    display grid
    grid-template-columns minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)
    align-items center
    gap 16px
    min-height 64px
    padding 12px 32px
    border-bottom 1px solid var(--color-border-primary)
    h1
      min-width 0
      margin 0
      overflow-wrap anywhere
      text-align center
      font-size 16px
      font-weight 600
  &__collaboration
    display flex
    align-items center
    justify-content center
    gap 12px
    padding 8px 16px
    font-size 12px
    color var(--color-text-secondary)
  &__home
    justify-self start
  &__brand
    font-size 18px
    font-weight 650
    color var(--color-text-secondary)
  &__actions
    display flex
    justify-content flex-end
    flex-wrap wrap
    gap 8px
  &__document
    max-width 1196px
    margin 0 auto
    min-height 360px
    :deep(.milkdown-attachment__preview)
      display none
  &__state
    display flex
    flex-direction column
    align-items center
    justify-content center
    gap 18px
    padding 48px 24px
    min-height 360px
    text-align center
    h2
      font-size 20px
    p
      font-size 14px
      color var(--color-text-secondary)
  &__button
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    min-height 36px
    padding 6px 14px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)
    color var(--color-text-primary)
    font-size 13px
    text-decoration none
    cursor pointer
    &[aria-checked='true']
      border-color var(--color-accent)
      background var(--color-accent-tint)
    &:hover:not(:disabled)
      border-color var(--color-accent)
      background var(--color-accent-tint)
    &:active:not(:disabled)
      filter brightness(.94)
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
    &:disabled
      opacity .5
      cursor not-allowed
  @media (max-width: 960px)
    &__header
      grid-template-columns minmax(0, 1fr) minmax(0, 1fr)
      padding 12px 16px
      gap 10px
      h1
        grid-column 1 / -1
        grid-row 1
    &__actions
      min-width 0
</style>
