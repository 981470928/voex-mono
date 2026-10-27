<template>
  <VoexTrigger
    v-model:popup-visible="open"
    :trigger="[]"
    position="bottom-end"
    strategy="fixed"
    :popup-offset="8"
    content-class="collaboration-users__popup"
    role="dialog"
    aria-label="在线协作者"
    @show="focusList"
  >
    <button
      class="collaboration-users__trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-label="`查看在线协作者：${members.map((member) => member.name).join('、')}`"
      title="查看在线协作者"
      @click="open = !open"
      @keydown.down.prevent="open = true"
    >
      <span class="collaboration-users__stack" aria-hidden="true">
        <span
          v-for="member in visibleMembers"
          :key="member.id"
          class="collaboration-users__avatar"
          :style="member.style"
          :title="member.name"
        >
          <img
            v-if="member.image"
            :src="member.image"
            alt=""
            width="28"
            height="28"
            @error="discardImage(member.path)"
          />
          <span v-else>{{ member.initials }}</span>
        </span>
        <span
          v-if="remaining"
          class="collaboration-users__avatar collaboration-users__avatar--more"
          :title="`另有 ${remaining} 位协作者`"
          >{{ remaining > 99 ? '99+' : `+${remaining}` }}</span
        >
      </span>
    </button>
    <template #content>
      <h2 class="collaboration-users__title">在线协作者</h2>
      <ul ref="list" class="collaboration-users__list" tabindex="-1" aria-label="在线用户列表">
        <li v-for="member in members" :key="member.id" class="collaboration-users__member">
          <span class="collaboration-users__avatar" :style="member.style" aria-hidden="true">
            <img
              v-if="member.image"
              :src="member.image"
              alt=""
              width="28"
              height="28"
              @error="discardImage(member.path)"
            />
            <span v-else>{{ member.initials }}</span>
          </span>
          <span class="collaboration-users__name">{{ member.name }}</span>
        </li>
      </ul>
    </template>
  </VoexTrigger>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowReactive, watch } from 'vue';
import { VoexTrigger } from '@/plugins/trigger';
import http from '@/service/api/https';
import type { CollaborationUser } from '@/service/api/collaboration-api';

const props = defineProps<{ users: CollaborationUser[] }>();
const open = ref(false);
const list = ref<HTMLUListElement | null>(null);
const images = shallowReactive(new Map<string, string>());
const requests = new Map<string, AbortController>();
const attempted = new Set<string>();
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
let disposed = false;

/** 按可见字符截取，避免拆开扩展汉字、组合重音或 emoji。 */
function initials(name: string) {
  const characters = Array.from(segmenter.segment(name.trim()), (part) => part.segment).filter(
    (character) => character.trim()
  );
  return characters.slice(0, /\p{Script=Han}/u.test(characters[0] || '') ? 1 : 2).join('');
}

function avatarPath(value?: string) {
  return typeof value === 'string' && /^\/api\/assets\/[a-f0-9-]{36}$/.test(value) ? value : '';
}

function avatarStyle(value: string) {
  const backgroundColor = /^#[a-f0-9]{6}$/i.test(value) ? value : '#2563eb';
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(backgroundColor.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return { backgroundColor, color: luminance > 0.179 ? '#000000' : '#ffffff' };
}

const members = computed(() =>
  props.users.map((user) => {
    const name = user.name.trim() || '协作者';
    const path = avatarPath(user.avator);
    return {
      id: user.id,
      name,
      path,
      initials: initials(name),
      style: avatarStyle(user.color),
      image: images.get(path),
    };
  })
);
const visibleMembers = computed(() => members.value.slice(0, 5));
const remaining = computed(() => Math.max(0, members.value.length - visibleMembers.value.length));

function discardImage(path: string) {
  const source = images.get(path);
  if (source) URL.revokeObjectURL(source);
  images.delete(path);
}

// 头像沿用现有资产鉴权；只读取受控的同源头像路径，失败静默回退昵称。
watch(
  () => props.users.map((user) => avatarPath(user.avator)).join('|'),
  () => {
    const wanted = new Set(props.users.map((user) => avatarPath(user.avator)).filter(Boolean));
    for (const path of attempted) {
      if (wanted.has(path)) continue;
      requests.get(path)?.abort();
      requests.delete(path);
      attempted.delete(path);
      discardImage(path);
    }
    for (const path of wanted) {
      if (attempted.has(path)) continue;
      attempted.add(path);
      const controller = new AbortController();
      requests.set(path, controller);
      void http
        .get<unknown, Blob>(path.slice('/api'.length), {
          responseType: 'blob',
          signal: controller.signal,
        })
        .then((blob) => {
          if (disposed || controller.signal.aborted || requests.get(path) !== controller) return;
          if (blob.type.startsWith('image/')) images.set(path, URL.createObjectURL(blob));
        })
        .catch(() => undefined)
        .finally(() => {
          if (requests.get(path) === controller) requests.delete(path);
        });
    }
    if (!props.users.length) open.value = false;
  },
  { immediate: true }
);

async function focusList() {
  await nextTick();
  if (open.value) list.value?.focus({ preventScroll: true });
}

onBeforeUnmount(() => {
  disposed = true;
  for (const controller of requests.values()) controller.abort();
  for (const source of images.values()) URL.revokeObjectURL(source);
});
</script>

<style lang="stylus">
.collaboration-users
  &__trigger
    display inline-flex
    align-items center
    flex-shrink 0
    min-height 32px
    padding 2px
    border 0
    border-radius 18px
    background transparent
    cursor pointer
    line-height 1

    &:hover, &[aria-expanded='true']
      background var(--color-bg-tertiary)

    &:active
      background var(--color-bg-quaternary)

    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px

  &__stack
    display inline-flex
    align-items center

    .collaboration-users__avatar + .collaboration-users__avatar
      margin-left -7px

  &__avatar
    display inline-flex
    align-items center
    justify-content center
    position relative
    flex-shrink 0
    width 28px
    height 28px
    overflow hidden
    border 2px solid var(--color-bg-primary)
    border-radius 50%
    box-sizing border-box
    font-size 11px
    font-weight 600
    line-height 1

    img
      display block
      width 100%
      height 100%
      object-fit cover

    &--more
      background var(--color-bg-quaternary)
      color var(--color-text-secondary)
      font-size 10px

  &__popup
    width 220px
    padding 12px

  &__title
    margin 0 0 10px
    font-size 12px
    font-weight 600
    line-height 1.5
    color var(--color-text-secondary)

  &__list
    display flex
    flex-direction column
    gap 10px
    max-height 260px
    margin 0
    padding 0
    overflow-y auto
    list-style none

    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px

  &__member
    display flex
    align-items center
    gap 10px
    min-width 0

  &__name
    min-width 0
    overflow-wrap anywhere
    font-size 13px
    line-height 1.5
    color var(--color-text-primary)
</style>
