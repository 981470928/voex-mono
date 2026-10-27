import { defineStore } from 'pinia';
import { ref, watchEffect } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'voex-theme';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>((localStorage.getItem(THEME_KEY) as ThemeMode) || 'dark');

  /** 实际生效的主题（解析 system 后的 light / dark） */
  const resolved = ref<'light' | 'dark'>(mode.value === 'system' ? getSystemTheme() : mode.value);

  /** 切换主题模式 */
  function setMode(newMode: ThemeMode) {
    mode.value = newMode;
    localStorage.setItem(THEME_KEY, newMode);
  }

  /** 在 light / dark 之间快捷切换 */
  function toggle() {
    setMode(resolved.value === 'dark' ? 'light' : 'dark');
  }

  // 同步 resolved 值并应用到 DOM
  watchEffect(() => {
    resolved.value = mode.value === 'system' ? getSystemTheme() : mode.value;
    applyTheme(resolved.value);
  });

  // 监听系统主题变化
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', () => {
    if (mode.value === 'system') {
      resolved.value = getSystemTheme();
      applyTheme(resolved.value);
    }
  });

  return {
    mode,
    resolved,
    setMode,
    toggle,
  };
});
