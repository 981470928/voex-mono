<template>
  <svg
    class="svg-icon"
    :style="{ '--svg-icon-size': iconSize, color }"
    :role="title ? 'img' : undefined"
    :aria-label="title || undefined"
    :aria-hidden="title ? undefined : true"
    focusable="false"
  >
    <title v-if="title">{{ title }}</title>
    <use :href="symbolId" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number | string;
    color?: string;
    title?: string;
  }>(),
  {
    size: '1em',
    color: undefined,
    title: '',
  }
);

const symbolId = computed(() => `#icon-${props.name}`);
const iconSize = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size));
</script>

<style scoped lang="stylus">
.svg-icon
  display inline-block
  width var(--svg-icon-size)
  height var(--svg-icon-size)
  flex-shrink 0
  vertical-align -0.125em
  fill currentColor
</style>
