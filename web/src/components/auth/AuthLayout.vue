<template>
  <component
    :is="embedded ? 'section' : 'main'"
    class="auth-layout"
    :class="{ 'auth-layout--embedded': embedded }"
    data-theme="dark"
  >
    <section class="auth-layout__content" :class="{ 'auth-layout__content--wide': wide }">
      <header class="auth-layout__header">
        <img
          v-if="!embedded"
          class="auth-layout__logo"
          :src="logo"
          alt="Voex"
          width="40"
          height="40"
        />
        <h1 class="auth-layout__title">{{ title }}</h1>
        <p v-if="description" class="auth-layout__description">{{ description }}</p>
      </header>
      <slot />
    </section>
    <span v-if="!embedded" class="auth-layout__signature" aria-hidden="true">Voex</span>
  </component>
</template>

<script setup lang="ts">
import logo from '@/assets/image/voex-icon-white-128.png';
import '@/assets/style/auth.styl';

defineProps<{ title: string; description?: string; wide?: boolean; embedded?: boolean }>();
</script>

<style scoped lang="stylus">
.auth-layout
  position relative
  display flex
  justify-content center
  align-items flex-start
  min-height 100dvh
  padding 18vh 24px 80px
  color var(--color-text-primary)
  background var(--auth-bg)
  color-scheme dark

.auth-layout__content
  width 100%
  max-width 320px
  z-index 1

  &--wide
    max-width 360px

.auth-layout__header
  text-align center
  margin-bottom 30px

.auth-layout__logo
  display block
  object-fit contain
  margin 0 auto 30px

.auth-layout__title
  font-size 20px
  line-height 1.4
  font-weight 600
  letter-spacing -.4px

.auth-layout__description
  margin-top 10px
  color var(--auth-muted)
  font-size 13px
  line-height 1.7

.auth-layout__signature
  position absolute
  bottom 24px
  color var(--auth-muted)
  font-size 12px
  letter-spacing 1px

@media (max-width: 600px), (max-height: 700px)
  .auth-layout
    padding-top 60px

@media (max-height: 500px)
  .auth-layout
    padding-top 28px

.auth-layout--embedded
  height 100%
  min-height 0
  overflow-y auto
  padding 32px 24px
  border-radius inherit
  background transparent

@media (max-width: 700px)
  .auth-layout--embedded
    padding 24px 16px
</style>
