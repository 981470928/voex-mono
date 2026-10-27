<template>
  <VoexModal v-model="visible" title="详细信息" :width="520">
    <div class="file-details" :aria-busy="loading">
      <div ref="nameElement" class="file-details__name" tabindex="-1">
        <SvgIcon name="page" :size="22" /><span>{{ details?.file_name || fileName }}</span>
      </div>
      <p v-if="loading" class="file-details__state" role="status">正在加载详细信息…</p>
      <div v-else-if="error" class="file-details__state" role="alert">
        <p>{{ error }}</p>
        <button ref="retryButton" class="file-details__button" type="button" @click="load">
          重新加载
        </button>
      </div>
      <dl v-else-if="details" class="file-details__fields">
        <div class="file-details__row">
          <dt>创建时间</dt>
          <dd>
            <time :datetime="details.created_at">{{ formatTime(details.created_at) }}</time>
          </dd>
        </div>
        <div class="file-details__row">
          <dt>修改时间</dt>
          <dd>
            <time :datetime="details.updated_at">{{ formatTime(details.updated_at) }}</time>
          </dd>
        </div>
        <div class="file-details__row">
          <dt>修改人</dt>
          <dd>{{ modifier }}</dd>
        </div>
        <div v-if="canNavigate && details.path" class="file-details__row">
          <dt>文件路径</dt>
          <dd>
            <nav class="file-details__path" aria-label="文件路径">
              <span aria-hidden="true">/</span>
              <RouterLink
                :to="desktopLocation(details.path.project_key, undefined, details.path.team_key)"
                @click="visible = false"
                >{{ details.path.project_name }}</RouterLink
              >
              <span aria-hidden="true">/</span>
              <RouterLink :to="directoryLocation" @click="visible = false">{{
                details.path.folder_name
              }}</RouterLink>
              <span aria-hidden="true">/</span>
              <RouterLink :to="directoryLocation" @click="visible = false">{{
                details.file_name
              }}</RouterLink>
            </nav>
          </dd>
        </div>
      </dl>
    </div>
    <template #footer
      ><button class="file-details__button" type="button" @click="visible = false">
        关闭
      </button></template
    >
  </VoexModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import SvgIcon from '@/components/SvgIcon.vue';
import { VoexModal } from '@/plugins/voex-modal';
import { getDocumentDetails, type FileDetails } from '@/service/api/document-api';
import { getRecentFileDetails } from '@/service/api/recent-api';
import { authUser } from '@/service/auth-session';
import { usePermissionStore } from '@/stores/permission';
import { desktopLocation, formatTime } from '@/utils/workspace';
import { errorMessage } from '@/utils/error';

const props = defineProps<{ fileKey: string; fileName: string; source: 'project' | 'recent' }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ resolved: [details: FileDetails] }>();
const permission = usePermissionStore();
const route = useRoute();
const details = ref<FileDetails | null>(null);
const nameElement = ref<HTMLElement>();
const retryButton = ref<HTMLButtonElement>();
const loading = ref(false);
const error = ref('');
const canNavigate = computed(() => permission.recent(details.value).directory);
const directoryLocation = computed(() =>
  desktopLocation(
    details.value?.path?.project_key,
    details.value?.path?.folder_key,
    details.value?.path?.team_key
  )
);
const modifier = computed(() => {
  if (details.value?.updated_by_kind === 'anonymous') return '匿名用户';
  return details.value?.updated_by?.name || '未记录';
});
let controller: AbortController | undefined;

async function load() {
  controller?.abort();
  const restoreFocus = retryButton.value === document.activeElement;
  details.value = null;
  error.value = '';
  if (!visible.value || !props.fileKey) {
    loading.value = false;
    return;
  }
  const request = new AbortController();
  controller = request;
  loading.value = true;
  try {
    const result = await (props.source === 'recent' ? getRecentFileDetails : getDocumentDetails)(
      props.fileKey,
      request.signal
    );
    if (request.signal.aborted) return;
    if (!permission.recent(result).details) throw new Error('你已没有此文件的访问权限');
    details.value = result;
    emit('resolved', result);
  } catch (cause) {
    if (!request.signal.aborted) error.value = errorMessage(cause, '详细信息加载失败，请重试');
  } finally {
    if (!request.signal.aborted) {
      loading.value = false;
      await nextTick();
      if (
        !request.signal.aborted &&
        restoreFocus &&
        visible.value &&
        document.activeElement === document.body
      )
        nameElement.value?.focus({ preventScroll: true });
    }
  }
}
watch([visible, () => props.fileKey, () => props.source, () => authUser.value?.id], load, {
  immediate: true,
});
watch(
  () => route.fullPath,
  () => {
    visible.value = false;
  }
);
onBeforeUnmount(() => controller?.abort());
</script>

<style scoped lang="stylus">
.file-details
  min-width 0
  color var(--color-text-primary)
  font-size 13px
  line-height 1.6
  &__name
    display flex
    align-items flex-start
    gap 10px
    padding-bottom 20px
    font-size 14px
    font-weight 500
    overflow-wrap anywhere
    svg
      flex-shrink 0
      margin-top 1px
      color var(--color-text-tertiary)
  &__fields
    display grid
    gap 16px
    margin 0
  &__row
    display grid
    grid-template-columns 72px minmax(0, 1fr)
    gap 16px
    dt
      color var(--color-text-tertiary)
    dd
      margin 0
      overflow-wrap anywhere
  &__path
    display flex
    flex-wrap wrap
    align-items baseline
    gap 2px 4px
    a
      min-width 0
      border-radius var(--border-radius-item-s)
      color var(--color-accent)
      text-decoration none
      overflow-wrap anywhere
      cursor pointer
      &:hover
        text-decoration underline
        background var(--color-bg-translucent)
      &:active
        background var(--color-bg-quaternary)
      &:focus-visible
        outline 2px solid var(--color-accent)
        outline-offset 2px
  &__state
    display flex
    flex-direction column
    align-items center
    justify-content center
    gap 12px
    min-height 160px
    color var(--color-text-secondary)
    overflow-wrap anywhere
  &__button
    min-height 32px
    padding 4px 14px
    border 1px solid var(--color-border-translucent-strong)
    border-radius var(--border-radius-item-s)
    background var(--color-bg-translucent)
    color var(--color-text-secondary)
    font-size 13px
    cursor pointer
    &:hover
      background var(--color-bg-quaternary)
      color var(--color-text-primary)
    &:active
      filter brightness(.94)
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
@media (max-width: 440px)
  .file-details__row
    gap 8px
    grid-template-columns 64px minmax(0, 1fr)
</style>
