<template>
  <main class="home">
    <img class="home__background" :src="getImages('bg.webp')" alt="" />
    <section class="home__container" :aria-busy="loading">
      <div class="voex-glow--container"></div>
      <HomeAside class="home-aside--content" />
      <div class="home__content">
        <div class="home__content_bg">
          <div class="voex-glow--content"></div>
        </div>
        <router-view v-slot="{ Component, route }">
          <Transition name="home__route" mode="out-in">
            <component
              :is="Component"
              :key="
                route.name === 'project'
                  ? `${route.name}:${route.params.projectId || ''}:${route.query.team_key || ''}`
                  : route.name
              "
            />
          </Transition>
        </router-view>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useImages } from '@/composables/useImages';
import HomeAside from './HomeAside.vue';
const loading = ref(false);
const { getImages } = useImages('/');
</script>

<style scoped lang="stylus">
.home
  width 100%
  height 100%
  background var(--color-bg-primary)
  color var(--color-text-primary)
  display flex
  align-items center
  overflow hidden
  position relative
.home__background
    position absolute
    top 0
    left 50%
    transform translateX(-50%)
    z-index 0
.home__container
    display flex
    position relative
    z-index 1
    margin 0 auto
    max-width 1440px
    width calc(100% - 48px)
    min-width 0
    height 80%
    padding 8px
    background var(--color-bg-secondary)
    border 1px solid var(--color-border-translucent-strong)
    border-radius var(--border-radius-container)
    box-shadow var(--shadow-high)

.home__content
    position relative
    z-index 2
    flex 1
    min-width 0
    min-height 0
    border 1px solid var(--color-border-translucent-strong)
    border-radius var(--border-radius-container)
    box-shadow var(--shadow-medium)
    &_bg
      width 100%
      height 100%
      overflow hidden
      position absolute
      border-radius var(--border-radius-container)
      z-index 0
      pointer-events none

@media (max-width: 700px)
  .home__container
    width 100%
    height 100%
    padding 4px
    flex-direction column
    border-radius 0
  .home-aside--content
    flex 0 0 auto
    width 100%
    height auto
    max-height 180px
    padding 8px
  .home__content
    flex 1

.home__route-enter-active,
.home__route-leave-active
  transition opacity .16s ease

.home__route-enter-from,
.home__route-leave-to
  opacity 0

.home__route-enter-to,
.home__route-leave-from
  opacity 1

@media (prefers-reduced-motion: reduce)
  .home__route-enter-active,
  .home__route-leave-active
    transition none
</style>
