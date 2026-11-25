import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { authUser, sessionExpired } from '@/service/auth-session';
import { getUserConfig, patchUserConfig, type UserConfig } from '@/service/api/user-config-api';
import { errorMessage } from '@/utils/error';

export type AIPreferenceKey = 'aiModelId' | 'aiWebEngineId';

export type EditorPreferenceKey =
  | 'editorOutlineVisible'
  | 'editorMinimapVisible'
  | 'editorZenFullscreen'
  | 'editorCodeMirrorEnabled';

export const useUserConfigStore = defineStore('user-config', () => {
  const config = shallowRef<UserConfig>({});
  const loaded = ref(false);
  const loading = ref(false);
  const saving = ref(false);
  const saved = ref(false);
  const loadError = ref('');
  const saveError = ref('');
  const failedPatch = shallowRef<UserConfig | null>(null);
  const aiModelId = computed(() =>
    typeof config.value.aiModelId === 'string' ? config.value.aiModelId : ''
  );
  const aiWebEngineId = computed(() =>
    typeof config.value.aiWebEngineId === 'string' ? config.value.aiWebEngineId : ''
  );
  const aiSaveError = computed(() => {
    const patch = failedPatch.value;
    return patch && ('aiModelId' in patch || 'aiWebEngineId' in patch) ? saveError.value : '';
  });
  const showOutline = computed(() => config.value.editorOutlineVisible !== false);
  const showMinimap = computed(() => config.value.editorMinimapVisible !== false);
  const zenFullscreen = computed(() => config.value.editorZenFullscreen !== false);
  const codeMirrorEnabled = computed(() => config.value.editorCodeMirrorEnabled !== false);
  const canChange = computed(
    () =>
      loaded.value && !loading.value && !saving.value && !sessionExpired.value && !!authUser.value
  );
  let generation = 0;
  let activeSave: Promise<void> | undefined;
  let controller: AbortController | undefined;

  async function load() {
    if (!authUser.value || loading.value || saving.value) return;
    const current = generation;
    controller = new AbortController();
    loading.value = true;
    loadError.value = '';
    try {
      const result = await getUserConfig(controller.signal);
      if (current !== generation) return;
      config.value = result.userConfig;
      loaded.value = true;
    } catch (cause) {
      if (current === generation) loadError.value = errorMessage(cause, '设置读取失败，请重试');
    } finally {
      if (current === generation) {
        loading.value = false;
        controller = undefined;
      }
    }
  }

  function ensure() {
    if (!loaded.value) return load();
  }

  function save(patch: UserConfig): Promise<void> {
    const current = generation;
    if (activeSave)
      return activeSave.then(() => {
        if (current === generation) return save(patch);
      });
    if (
      !canChange.value ||
      Object.entries(patch).every(([key, value]) => config.value[key] === value)
    )
      return Promise.resolve();
    activeSave = persist(patch).finally(() => {
      if (generation === current) activeSave = undefined;
    });
    return activeSave;
  }

  async function persist(patch: UserConfig) {
    const current = generation;
    const previous = config.value;
    controller = new AbortController();
    saving.value = true;
    saved.value = false;
    saveError.value = '';
    failedPatch.value = null;
    config.value = { ...previous, ...patch };
    try {
      const result = await patchUserConfig(patch, controller.signal);
      if (current !== generation) return;
      config.value = result.userConfig;
      saved.value = true;
    } catch (cause) {
      if (current !== generation) return;
      config.value = previous;
      failedPatch.value = patch;
      saveError.value = '未能确认保存，已恢复上次显示。' + errorMessage(cause, '请重试');
    } finally {
      if (current === generation) {
        saving.value = false;
        controller = undefined;
      }
    }
  }

  function setAIPreference(key: AIPreferenceKey, value: string) {
    return save({ [key]: value });
  }

  function setEditorPreference(key: EditorPreferenceKey, value: boolean) {
    return save({ [key]: value });
  }

  function retrySave() {
    if (failedPatch.value) return save(failedPatch.value);
  }

  watch(
    () => authUser.value?.id,
    () => {
      generation++;
      activeSave = undefined;
      controller?.abort();
      controller = undefined;
      config.value = {};
      loaded.value = false;
      loading.value = false;
      saving.value = false;
      saved.value = false;
      loadError.value = '';
      saveError.value = '';
      failedPatch.value = null;
      void ensure();
    },
    { immediate: true, flush: 'sync' }
  );

  return {
    aiModelId,
    aiWebEngineId,
    aiSaveError,
    setAIPreference,
    showOutline,
    showMinimap,
    zenFullscreen,
    codeMirrorEnabled,
    loaded,
    loading,
    saving,
    saved,
    loadError,
    saveError,
    canChange,
    load,
    ensure,
    setEditorPreference,
    retrySave,
  };
});
