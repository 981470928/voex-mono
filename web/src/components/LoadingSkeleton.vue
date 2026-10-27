<template>
  <div
    class="loading-skeleton"
    :class="'loading-skeleton--' + variant"
    role="status"
    aria-live="polite"
    :aria-label="label"
  >
    <div v-if="variant === 'ai-models'" class="loading-skeleton__model" aria-hidden="true">
      <div class="loading-skeleton__field">
        <span class="loading-skeleton__bar loading-skeleton__bar--label" />
        <span class="loading-skeleton__bar loading-skeleton__bar--control" />
      </div>
      <span class="loading-skeleton__bar loading-skeleton__bar--button" />
    </div>
    <div v-else aria-hidden="true">
      <span
        v-if="variant === 'document'"
        class="loading-skeleton__bar loading-skeleton__bar--title"
      />
      <div v-for="group in 3" :key="group" class="loading-skeleton__group">
        <span
          v-if="variant === 'ai-messages'"
          class="loading-skeleton__bar loading-skeleton__bar--label"
        />
        <span v-for="line in 3" :key="line" class="loading-skeleton__bar" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  variant: 'document' | 'ai-models' | 'ai-messages';
  label: string;
}>();
</script>

<style scoped lang="stylus">
.loading-skeleton
  width 100%
  animation loading-skeleton-pulse 1.4s ease-in-out infinite

  &__bar
    display block
    width 100%
    height 12px
    border-radius var(--border-radius-item-s)
    background var(--color-bg-tertiary)

    & + &
      margin-top 14px

    &:last-child
      width 72%

    &--title
      width 48%
      height 28px
      margin-bottom 36px

    &--label
      width 72px
      height 10px

  &__group + &__group
    margin-top 32px

  &--document
    max-width 860px
    margin 0 auto
    padding 36px 52px 100px

    .loading-skeleton__group:nth-child(3) .loading-skeleton__bar:last-child
      width 88%

  &__model
    display flex
    align-items flex-end
    gap 8px

  &__field
    flex 1
    min-width 0

  &--ai-models
    padding 16px 16px 8px

    .loading-skeleton__bar--control
      width 100%
      height 37px
      margin-top 8px

    .loading-skeleton__bar--button
      width 82px
      height 37px
      margin-top 0
      flex-shrink 0

  &--ai-messages
    .loading-skeleton__group:nth-child(2)
      padding 16px
      border-radius var(--border-radius-item-m)
      background var(--color-bg-translucent)

  @media (prefers-reduced-motion: reduce)
    animation none

@keyframes loading-skeleton-pulse
  0%, 100%
    opacity .55
  50%
    opacity 1
</style>
