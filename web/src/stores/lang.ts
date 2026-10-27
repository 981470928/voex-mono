import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Lang } from '@/constant/lang';

export const useLangStore = defineStore('lang', () => {
  const lang = ref<Lang>(Lang.ZH_CN);

  function setLang(newLang: Lang) {
    lang.value = newLang;
  }

  return {
    lang,
    setLang,
  };
});
