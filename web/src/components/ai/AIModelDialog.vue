<template>
  <VoexModal
    :model-value="modelValue"
    title="模型配置"
    :width="620"
    :busy="saving"
    :mask-closable="false"
    @update:model-value="close"
  >
    <form ref="form" class="ai-model" novalidate @submit.prevent="save">
      <div class="ai-field">
        <label for="ai-saved-model">已保存的配置</label
        ><select id="ai-saved-model" :value="draft.id" :disabled="saving" @change="selectModel">
          <option value="">新增模型配置</option>
          <option v-for="model in models" :key="model.id" :value="model.id">
            {{ model.name }}
          </option>
        </select>
      </div>
      <div class="ai-model__grid">
        <div class="ai-field">
          <label for="ai-name">配置名称</label
          ><input
            id="ai-name"
            v-model="draft.name"
            maxlength="128"
            :disabled="saving"
            :aria-invalid="!!errors.name"
            :aria-describedby="errors.name ? 'ai-name-error' : undefined"
          />
          <span v-if="errors.name" id="ai-name-error" class="ai-error">{{ errors.name }}</span>
        </div>
        <div class="ai-field">
          <label for="ai-protocol">接口协议</label
          ><select id="ai-protocol" v-model="draft.protocol" :disabled="saving">
            <option value="openai">OpenAI Chat Completions</option>
            <option value="anthropic">Claude Messages</option>
          </select>
        </div>
      </div>
      <div class="ai-field">
        <label for="ai-address">API 地址</label
        ><input
          id="ai-address"
          v-model="draft.base_url"
          type="url"
          placeholder="https://api.example.com/v1"
          :disabled="saving"
          :aria-invalid="!!errors.base_url"
          :aria-describedby="
            errors.base_url ? 'ai-address-help ai-address-error' : 'ai-address-help'
          "
        />
        <small id="ai-address-help">支持公网 HTTPS Base URL 或完整接口地址，由后端发起请求。</small>
        <span v-if="errors.base_url" id="ai-address-error" class="ai-error">{{
          errors.base_url
        }}</span>
      </div>
      <div class="ai-field">
        <label for="ai-key">API Key</label
        ><span class="ai-model__key">
          <input
            id="ai-key"
            v-model="draft.api_key"
            :type="showKey ? 'text' : 'password'"
            autocomplete="new-password"
            :placeholder="original ? '已保存；留空保持原密钥' : '输入供应商提供的 API Key'"
            :disabled="saving"
            :aria-invalid="!!errors.api_key"
            :aria-describedby="errors.api_key ? 'ai-key-help ai-key-error' : 'ai-key-help'"
          />
          <button
            type="button"
            class="ai-button"
            :aria-label="showKey ? '隐藏 API Key' : '显示 API Key'"
            :aria-pressed="showKey"
            @click="showKey = !showKey"
          >
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </span>
        <small id="ai-key-help">密钥按账号加密保存在后端；更换地址或协议时需重新填写。</small>
        <span v-if="errors.api_key" id="ai-key-error" class="ai-error">{{ errors.api_key }}</span>
      </div>
      <div class="ai-field">
        <label for="ai-model-id">模型 ID</label
        ><input
          id="ai-model-id"
          v-model="draft.model"
          placeholder="填写供应商提供的准确模型 ID"
          :disabled="saving"
          :aria-invalid="!!errors.model"
          :aria-describedby="errors.model ? 'ai-id-error' : undefined"
        />
        <span v-if="errors.model" id="ai-id-error" class="ai-error">{{ errors.model }}</span>
      </div>
      <div class="ai-model__grid">
        <div class="ai-field">
          <label for="ai-temperature">Temperature（可选）</label
          ><input
            id="ai-temperature"
            v-model="draft.temperature"
            type="number"
            min="0"
            :max="draft.protocol === 'anthropic' ? 1 : 2"
            step="0.1"
            placeholder="使用模型默认值"
            :disabled="saving"
            :aria-invalid="!!errors.temperature"
            :aria-describedby="errors.temperature ? 'ai-temperature-error' : undefined"
          />
          <span v-if="errors.temperature" id="ai-temperature-error" class="ai-error">{{
            errors.temperature
          }}</span>
        </div>
        <div class="ai-field">
          <label for="ai-max-tokens">最大输出 tokens</label
          ><input
            id="ai-max-tokens"
            v-model="draft.max_tokens"
            type="number"
            min="1"
            max="131072"
            step="1"
            :disabled="saving"
            :aria-invalid="!!errors.max_tokens"
            :aria-describedby="errors.max_tokens ? 'ai-tokens-error' : undefined"
          />
          <span v-if="errors.max_tokens" id="ai-tokens-error" class="ai-error">{{
            errors.max_tokens
          }}</span>
        </div>
      </div>
      <div v-if="draft.protocol === 'openai'" class="ai-field">
        <label for="ai-token-parameter">输出上限参数</label
        ><select id="ai-token-parameter" v-model="draft.token_parameter" :disabled="saving">
          <option value="max_completion_tokens">max_completion_tokens（OpenAI 标准）</option>
          <option value="max_tokens">max_tokens（部分兼容服务）</option>
        </select>
        <small>按供应商文档选择；Claude Messages 固定使用 max_tokens。</small>
      </div>
      <p v-if="error" class="ai-error" role="alert">{{ error }}</p>
      <p class="ai-model__hint">
        用于编辑的模型需要支持 tool calling。对话会发送当前文档内容到所配置的服务。
      </p>
      <div class="ai-actions">
        <button type="button" class="ai-button" :disabled="saving" @click="close(false)">
          取消
        </button>
        <button
          type="submit"
          class="ai-button ai-button--primary"
          :disabled="saving"
          :aria-busy="saving"
        >
          {{ saving ? '正在保存…' : '保存配置' }}
        </button>
      </div>
    </form>
  </VoexModal>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import VoexModal from '@/plugins/voex-modal/VoexModal.vue';
import type { AIModel, AIProtocol } from '@/agent/types';
import { saveAIModel } from '@/service/api/ai-api';
import { errorMessage } from '@/utils/error';
import { randomUUID } from '@/utils/id';
import { useConfirm } from '@/composables/useConfirm';
import { MessageType } from '@/constant/status';
import { authUser } from '@/service/auth-session';
import './ai.styl';

const props = defineProps<{ modelValue: boolean; models: AIModel[]; selectedId: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [model: AIModel] }>();
const initial = () => ({
  id: '',
  name: '',
  protocol: 'openai' as AIProtocol,
  base_url: '',
  api_key: '',
  model: '',
  temperature: '' as string | number,
  max_tokens: 4096 as string | number,
  token_parameter: 'max_completion_tokens' as AIModel['token_parameter'],
});
const draft = reactive(initial());
const original = computed(() => props.models.find((model) => model.id === draft.id));
const errors = ref<Record<string, string>>({});
const error = ref('');
const saving = ref(false);
const showKey = ref(false);
const form = ref<HTMLFormElement>();
const { confirm } = useConfirm();
let baseline = '';

function load(id: string) {
  const model = props.models.find((item) => item.id === id);
  Object.assign(
    draft,
    initial(),
    model ? { ...model, api_key: '', temperature: model.temperature ?? '' } : {}
  );
  errors.value = {};
  error.value = '';
  showKey.value = false;
  baseline = JSON.stringify(draft);
}
watch(
  () => props.modelValue,
  (open) => {
    if (open) load(props.selectedId);
    else draft.api_key = '';
  },
  { immediate: true }
);

async function discardAllowed() {
  return (
    JSON.stringify(draft) === baseline ||
    (await confirm({
      type: MessageType.WARNING,
      title: '放弃未保存的模型配置？',
      content: '本次输入尚未保存。',
      confirmText: '放弃修改',
      cancelText: '继续填写',
    }))
  );
}
async function close(value: boolean) {
  if (!value && !saving.value && (await discardAllowed())) emit('update:modelValue', false);
}
async function selectModel(event: Event) {
  const select = event.target as HTMLSelectElement;
  const id = select.value;
  select.value = draft.id;
  if (await discardAllowed()) load(id);
}
async function save() {
  if (saving.value) return;
  const issues: Record<string, string> = {};
  if (!draft.name.trim()) issues.name = '请输入配置名称';
  if (!draft.model.trim()) issues.model = '请输入模型 ID';
  try {
    const url = new URL(draft.base_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error();
  } catch {
    issues.base_url = '请输入无账号和查询参数的 HTTPS 地址';
  }
  if (
    (!original.value ||
      original.value.base_url !== draft.base_url ||
      original.value.protocol !== draft.protocol) &&
    !draft.api_key.trim()
  )
    issues.api_key = '请填写 API Key';
  const temperature = draft.temperature === '' ? null : Number(draft.temperature);
  if (
    temperature !== null &&
    (!Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > (draft.protocol === 'anthropic' ? 1 : 2))
  )
    issues.temperature = 'Temperature 超出协议范围';
  const maxTokens = Number(draft.max_tokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 131072)
    issues.max_tokens = '请输入 1–131072 的整数';
  errors.value = issues;
  if (Object.keys(issues).length) {
    await nextTick();
    form.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  const user = authUser.value?.id;
  saving.value = true;
  error.value = '';
  try {
    const model = await saveAIModel({
      id: draft.id || randomUUID(),
      name: draft.name.trim(),
      protocol: draft.protocol,
      base_url: draft.base_url.trim(),
      api_key: draft.api_key.trim(),
      model: draft.model.trim(),
      temperature,
      max_tokens: maxTokens,
      token_parameter: draft.token_parameter,
    });
    if (user !== authUser.value?.id) return;
    draft.api_key = '';
    emit('saved', model);
    emit('update:modelValue', false);
  } catch (cause) {
    error.value = errorMessage(cause, '模型配置保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="stylus">
.ai-model
  display flex
  flex-direction column
  gap 16px
  &__grid
    display grid
    grid-template-columns 1fr 1fr
    gap 16px
  &__key
    display flex
    gap 8px
    input
      flex 1
  &__hint
    color var(--color-text-tertiary)
    font-size 12px
    line-height 1.6
    margin 0
</style>
