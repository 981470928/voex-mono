import { onBeforeUnmount, onMounted, readonly, ref } from 'vue';

const STORAGE_KEY = 'voex-recent-colors';
const MAX_RECENT_COLORS = 20;
const recentColors = ref<string[]>([]);
let subscribers = 0;

export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim();
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) return null;
  const digits = hex.slice(1).toUpperCase();
  return `#${digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits}`;
}

function parseColors(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const colors = parsed.map(normalizeColor).filter((color): color is string => color !== null);
    return [...new Set(colors)].slice(0, MAX_RECENT_COLORS);
  } catch {
    return [];
  }
}

function loadColors() {
  try {
    recentColors.value = parseColors(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage may be unavailable; keep the in-memory history usable.
  }
}

function syncColors(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  try {
    if (event.storageArea === window.localStorage) loadColors();
  } catch {
    // Access to storage can be disabled while the component is mounted.
  }
}

function addRecentColor(value: string) {
  const color = normalizeColor(value);
  if (!color) return;
  recentColors.value = [color, ...recentColors.value.filter((item) => item !== color)].slice(
    0,
    MAX_RECENT_COLORS
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recentColors.value));
  } catch {
    // A storage failure must not prevent choosing a color.
  }
}

export function useRecentColors() {
  let subscribed = false;
  onMounted(() => {
    subscribed = true;
    if (subscribers++ === 0) {
      loadColors();
      window.addEventListener('storage', syncColors);
    }
  });
  onBeforeUnmount(() => {
    if (subscribed && --subscribers === 0) window.removeEventListener('storage', syncColors);
  });
  return { recentColors: readonly(recentColors), addRecentColor };
}
