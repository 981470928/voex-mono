import { computed } from 'vue';
import { useLangStore } from '@/stores/lang';

/**
 * 图片路径引用工具
 *
 * @param template - 路径模板，如 `/icons/{lang}/flags`，对应 public 文件夹下的路径
 * @param vars - 模板变量替换对象，`lang` 占位符会自动从 lang store 获取，无需手动传入
 *
 * @example
 * ```ts
 * const { getImages } = useImages('/icons/{lang}/flags')
 * getImages('us.png') // => '/test/icons/zh-CN/flags/us.png'
 *
 * const { getImages } = useImages('/images/{category}/icons', { category: 'avatar' })
 * getImages('user.png') // => '/test/images/avatar/icons/user.png'
 * ```
 */
export function useImages(template: string, vars: Record<string, string> = {}) {
  const base = import.meta.env.BASE_URL;
  const langStore = useLangStore();
  const resolvedPath = computed(() => {
    return template.replace(/\{(\w+)\}/g, (_, key: string) => {
      if (key === 'lang') {
        return langStore.lang;
      }
      return vars[key] ?? '';
    });
  });

  function getImages(filename: string): string {
    return `${base}${resolvedPath.value}/${filename}`;
  }

  return { getImages };
}
