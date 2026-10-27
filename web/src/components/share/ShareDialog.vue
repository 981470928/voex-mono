<template>
  <VoexModal
    :id="id + '-dialog'"
    :model-value="modelValue"
    title="分享文件"
    :width="560"
    :busy="busy"
    :mask-closable="false"
    @close="$emit('update:modelValue', false)"
    @keydown.esc.capture="handleTooltipEscape"
  >
    <div class="file-share">
      <p class="file-share__name">{{ fileName }}</p>
      <h3 class="file-share__section-title">
        <span>分享链接</span>
        <VoexTooltip
          ref="shareLinkTooltip"
          content="每份文件有固定的只读和编辑链接。关闭链接不会收回已经授予的权限。"
          :popup-container="'#' + id + '-dialog'"
        >
          <button type="button" class="file-share__help" aria-label="分享链接说明">
            <SvgIcon name="question-mark" :size="14" class="file-share__help-icon" />
          </button>
        </VoexTooltip>
      </h3>
      <p v-if="loading" role="status">正在读取分享设置…</p>
      <div v-else-if="loadError" role="alert">
        <p>{{ loadError }}</p>
        <button type="button" class="file-share__button" @click="load">重新读取</button>
      </div>
      <template v-else-if="settings">
        <section v-for="link in settings.links" :key="link.permission" class="file-share__created">
          <div class="file-share__actions">
            <strong>{{ link.permission === 'edit' ? '编辑链接' : '只读链接' }}</strong>
            <button
              v-if="settings.can_manage"
              type="button"
              role="switch"
              :aria-label="link.permission === 'edit' ? '编辑链接' : '只读链接'"
              :aria-checked="link.enabled"
              :disabled="busy"
              class="file-share__switch"
              :title="link.enabled ? '关闭链接' : '开启链接'"
              @click="toggle(link)"
            >
              <span class="file-share__track" aria-hidden="true" />
            </button>
            <span v-else>{{ link.enabled ? '已开启' : '已关闭，需项目编辑者开启' }}</span>
          </div>
          <div v-if="link.enabled" class="file-share__address">
            <input
              :id="id + '-' + link.permission"
              :aria-label="link.permission === 'edit' ? '编辑链接地址' : '只读链接地址'"
              type="text"
              :value="fileShareUrl(link.token)"
              readonly
              autocomplete="off"
              spellcheck="false"
            />
            <button
              type="button"
              class="file-share__icon-button"
              aria-label="复制链接"
              title="复制链接"
              :disabled="busy || !link.enabled"
              @click="copy(link)"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect
                  x="5.5"
                  y="5.5"
                  width="8"
                  height="8"
                  rx="1.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                />
                <path
                  d="M10.5 3.5v-1a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
        </section>
        <section v-if="settings.can_manage" class="file-share__history" aria-label="文件权限管理">
          <h3 class="file-share__section-title">
            <span>文件权限管理</span>
            <VoexTooltip
              ref="accessTooltip"
              content="团队只读成员可取消额外编辑权限；外部用户可移除文件授权。链接仍开启时，再次访问可重新获得权限。"
              :popup-container="'#' + id + '-dialog'"
            >
              <button type="button" class="file-share__help" aria-label="文件权限管理说明">
                <SvgIcon name="question-mark" :size="14" class="file-share__help-icon" />
              </button>
            </VoexTooltip>
          </h3>
          <p v-if="!settings.access.length">暂无可取消的额外授权。</p>
          <ul v-else>
            <li v-for="grant in settings.access" :key="grant.user_id" class="file-share__record">
              <div>
                <p>{{ grant.name }}</p>
                <small
                  >{{ grant.member ? '团队成员' : '外部用户' }} ·
                  {{ grant.permission === 'edit' ? '可编辑' : '只读' }}</small
                >
              </div>
              <button
                type="button"
                class="file-share__button file-share__button--danger"
                :disabled="busy"
                @click="revoke(grant)"
              >
                {{ grant.member ? '取消编辑权限' : '移除权限' }}
              </button>
            </li>
          </ul>
        </section>
      </template>
      <p class="file-share__error" role="alert">{{ error }}</p>
    </div>
  </VoexModal>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch } from 'vue';
import { VoexModal } from '@/plugins/voex-modal';
import { VoexTooltip } from '@/plugins/tooltip';
import SvgIcon from '@/components/SvgIcon.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useNotificationStore } from '@/stores/notification';
import { errorMessage } from '@/utils/error';
import {
  getFileSharing,
  setFileSharing,
  revokeFileAccess,
  fileShareUrl,
  type SharingSettings,
  type ShareLink,
  type FileGrant,
} from '@/service/api/share-api';
const props = defineProps<{ modelValue: boolean; fileKey: string; fileName: string }>();
defineEmits<{ 'update:modelValue': [boolean] }>();
const id = useId();
const shareLinkTooltip = ref<InstanceType<typeof VoexTooltip>>();
const accessTooltip = ref<InstanceType<typeof VoexTooltip>>();
function handleTooltipEscape(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented) return;
  const tooltip = [shareLinkTooltip.value, accessTooltip.value].find((item) => item?.visible);
  if (!tooltip) return;
  // A hovered help icon may differ from the focused control inside the native dialog.
  event.preventDefault();
  event.stopPropagation();
  tooltip.hide();
}
const settings = ref<SharingSettings | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const loadError = ref('');
const { confirm } = useConfirm();
const notification = useNotificationStore();
let controller: AbortController | undefined;
let disposed = false;
async function load() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await getFileSharing(props.fileKey, request.signal);
    if (!request.signal.aborted) settings.value = result;
  } catch (cause) {
    if (!request.signal.aborted) loadError.value = errorMessage(cause, '分享设置读取失败');
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}
async function toggle(link: ShareLink) {
  if (busy.value || disposed || !settings.value?.can_manage) return;
  const currentSettings = settings.value;
  const enabled = !link.enabled;
  busy.value = true;
  error.value = '';
  try {
    await setFileSharing(props.fileKey, link.permission, enabled);
    if (!disposed && settings.value === currentSettings) link.enabled = enabled;
  } catch (cause) {
    if (!disposed && settings.value === currentSettings) {
      error.value = errorMessage(cause, '分享开关更新失败');
    }
  } finally {
    busy.value = false;
  }
}
async function revoke(grant: FileGrant) {
  if (busy.value || !settings.value?.can_manage) return;
  busy.value = true;
  error.value = '';
  try {
    const accepted = await confirm({
      title: grant.member ? '取消文件编辑权限' : '移除文件权限',
      content: `${grant.member ? '取消后仍保留项目只读权限。' : '移除后不再拥有此文件的独立授权。'}如果分享链接仍开启，对方再次访问可重新获得权限。`,
      confirmText: grant.member ? '取消编辑权限' : '移除权限',
    });
    if (!accepted || disposed) return;
    await revokeFileAccess(props.fileKey, grant.user_id);
    if (!disposed) await load();
  } catch (cause) {
    if (!disposed) error.value = errorMessage(cause, '权限更新失败');
  } finally {
    busy.value = false;
  }
}
async function copy(link: ShareLink) {
  try {
    await navigator.clipboard.writeText(fileShareUrl(link.token));
    notification.show('分享链接已复制', 'success');
  } catch {
    error.value = '复制失败，请选中链接手动复制。';
  }
}
watch(
  () => [props.modelValue, props.fileKey] as const,
  ([visible]) => {
    controller?.abort();
    settings.value = null;
    error.value = '';
    if (visible) void load();
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
});
</script>
<style scoped lang="stylus">
.file-share
  display grid
  gap 16px
  color var(--color-text-primary)
  font-size 13px
  line-height 1.65
  &__name
    font-weight 600
    overflow-wrap anywhere
  small
    color var(--color-text-secondary)
  &__section-title
    display flex
    align-items center
    gap 4px
    margin 0
    font-size 13px
    font-weight 600
  &__help
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    width 24px
    height 24px
    padding 0
    border 0
    border-radius 50%
    background transparent
    color var(--color-text-tertiary)
    cursor pointer
    &:hover
      color var(--color-text-primary)
      background var(--color-accent-tint)
    &:active
      filter brightness(.94)
  &__help-icon
    border 1px solid currentColor
    border-radius 50%
  &__form
    display grid
    gap 12px
    fieldset
      display grid
      gap 8px
      padding 0
      border 0
    legend
      margin-bottom 8px
      font-weight 600
  &__choice
    display flex
    align-items center
    gap 8px
    min-height 36px
    cursor pointer
    input
      accent-color var(--color-accent)
    span
      margin-left auto
      color var(--color-text-secondary)
      font-size 12px
  &__button
    min-height 36px
    padding 6px 12px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)
    color var(--color-text-primary)
    cursor pointer
    white-space nowrap
    &:hover:not(:disabled)
      background var(--color-accent-tint)
      border-color var(--color-accent)
    &:active:not(:disabled)
      filter brightness(.94)
    &:disabled
      opacity .55
      cursor not-allowed
    &--primary
      color var(--color-brand-text)
      background var(--color-brand-bg)
      &:hover:not(:disabled)
        background var(--color-brand-bg)
        opacity .9
    &--danger
      color var(--color-red)
  &__created
    display grid
    gap 8px
    padding 12px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-translucent)
  &__actions
    display flex
    align-items center
    justify-content space-between
    gap 8px
  &__switch
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    width 44px
    height 32px
    padding 0
    border 0
    border-radius 6px
    background transparent
    cursor pointer
    &:active:not(:disabled)
      filter brightness(.94)
    &:disabled
      opacity 1
      cursor not-allowed
    &[aria-checked='true'] .file-share__track
      background var(--color-accent)
      &::after
        transform translateX(16px)
  &__track
    position relative
    width 36px
    height 20px
    border-radius 20px
    background var(--color-border-secondary)
    transition background .15s
    &::after
      content ''
      position absolute
      top 3px
      left 3px
      width 14px
      height 14px
      border-radius 50%
      background var(--color-brand-text)
      transition transform .15s
  &__address
    display flex
    align-items center
    min-width 0
    padding-right 3px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-primary)
    input
      flex 1
      min-width 0
      width 100%
      box-sizing border-box
      height 38px
      padding 8px
      border 0
      border-radius 6px
      background transparent
      color var(--color-text-primary)
  &__icon-button
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    width 32px
    height 32px
    padding 0
    border 0
    border-radius 6px
    background transparent
    color var(--color-text-secondary)
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-accent-tint)
      color var(--color-text-primary)
    &:active:not(:disabled)
      filter brightness(.94)
    &:disabled
      opacity .55
      cursor not-allowed
  &__error
    color var(--color-red)
  &__history
    min-height 100px
    h3
      margin-bottom 8px
      font-size 13px
    ul
      list-style none
      padding 0
      max-height 250px
      overflow-y auto
  &__record
    display flex
    align-items center
    justify-content space-between
    gap 12px
    padding 10px 0
    border-bottom 1px solid var(--color-border-primary)
    div
      min-width 0
      overflow-wrap anywhere
  button:focus-visible, input:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset 2px
  @media (prefers-reduced-motion: reduce)
    &__track, &__track::after
      transition none
</style>
