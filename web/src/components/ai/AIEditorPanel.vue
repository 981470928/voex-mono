<template>
  <aside
    class="ai-panel"
    aria-label="AI 文档助手"
    :aria-busy="
      pending.size > 0 || conversationList.loading || history.loading || running || applying
    "
  >
    <header class="ai-panel__header">
      <span class="ai-panel__heading">
        <SvgIcon name="ai" :size="18" />
        <span class="ai-panel__title" :title="activeConversation?.title || 'AI 文档助手'">{{
          activeConversation ? activeConversation.title : 'AI 文档助手'
        }}</span>
      </span>
      <div class="ai-panel__header-actions">
        <button
          class="ai-panel__header-button"
          type="button"
          title="新建对话"
          aria-label="新建对话"
          :disabled="conversationLocked || !conversationList.loaded || !!conversationList.error"
          :aria-busy="conversationList.creating"
          @click="newConversation"
        >
          <SvgIcon name="add" :size="18" />
        </button>
        <VoexTrigger
          v-model:popup-visible="conversationMenuOpen"
          trigger="click"
          position="bottom-end"
          strategy="fixed"
          :popup-offset="8"
          content-class="ai-panel__history-popup"
          role="dialog"
          aria-label="历史对话"
          @show="focusSelectedConversation"
        >
          <button
            ref="conversationTrigger"
            class="ai-panel__header-button"
            type="button"
            title="历史对话"
            aria-label="历史对话"
            aria-haspopup="dialog"
            @keydown.down.prevent="conversationMenuOpen = true"
            @keydown.up.prevent="conversationMenuOpen = true"
          >
            <SvgIcon name="conversation" :size="18" />
          </button>
          <template #content>
            <div
              ref="conversationMenu"
              class="ai-panel__history-menu"
              tabindex="-1"
              @keydown.tab="onConversationMenuTab"
            >
              <p
                v-if="!conversationList.loading && !conversations.length && !conversationList.error"
                class="ai-panel__history-status"
              >
                尚无对话
              </p>
              <ul v-if="conversations.length" class="ai-panel__history-list">
                <li
                  v-for="session in conversations"
                  :key="session.id"
                  class="ai-panel__history-row"
                >
                  <button
                    class="ai-panel__history-item"
                    type="button"
                    :title="conversationLabel(session)"
                    :aria-current="conversationId === session.id ? 'true' : undefined"
                    :disabled="conversationLocked"
                    @click="switchConversation(session.id)"
                  >
                    <strong>{{ session.title }}</strong>
                    <small>{{ conversationDate(session) }}</small>
                  </button>
                  <button
                    class="ai-panel__history-delete"
                    type="button"
                    :title="
                      hasPendingResponse(session.id) ? '请先保存此对话中尚未保存的回复' : '删除对话'
                    "
                    :aria-label="'删除对话：' + session.title"
                    :disabled="conversationLocked || hasPendingResponse(session.id)"
                    @click="deleteConversation(session)"
                  >
                    <SvgIcon name="trash" :size="16" />
                  </button>
                </li>
              </ul>
              <button
                v-if="conversationList.error"
                class="ai-button ai-panel__history-more"
                type="button"
                :disabled="conversationList.loading"
                @click="loadConversations()"
              >
                重新加载对话
              </button>
              <button
                v-if="conversationList.nextCursor"
                class="ai-button ai-panel__history-more"
                type="button"
                :disabled="conversationLocked"
                @click="loadConversations(true)"
              >
                加载更多对话
              </button>
            </div>
          </template>
        </VoexTrigger>
        <button
          ref="closeButton"
          class="ai-panel__header-button ai-panel__close"
          type="button"
          title="关闭 AI 助手"
          aria-label="关闭 AI 助手"
          @click="emit('close')"
        >
          <SvgIcon name="close" :size="18" />
        </button>
      </div>
    </header>
    <div
      ref="scroller"
      class="ai-panel__messages"
      tabindex="0"
      aria-label="对话记录"
      @scroll="onScroll"
    >
      <button
        v-if="history.error"
        type="button"
        class="ai-button"
        :disabled="conversationLocked"
        @click="loadConversationHistory()"
      >
        重新加载对话记录
      </button>
      <button
        v-if="history.nextCursor"
        type="button"
        class="ai-button"
        :disabled="history.loading"
        @click="loadOlder"
      >
        加载更早的消息
      </button>
      <article
        v-for="message in messages"
        :key="message.id"
        class="ai-panel__message"
        :class="`ai-panel__message--${message.role}`"
      >
        <div class="ai-panel__speaker">{{ message.role === 'user' ? '你' : 'AI' }}</div>
        <details
          v-if="
            message.role === 'assistant' && (message.reasoning || message.id === thinkingTurnId)
          "
          class="ai-panel__thinking"
          :open="message.id === thinkingTurnId"
        >
          <summary>{{ message.id === thinkingTurnId ? '思考中…' : '思考过程' }}</summary>
          <div class="ai-panel__thinking-content">
            <AIMessageMarkdown
              v-if="message.reasoning"
              :content="message.reasoning"
              :renderer="markdownRenderer"
              @rendered="scrollEnd"
            />
            <p v-else role="status">正在等待模型返回思考内容…</p>
          </div>
        </details>
        <AIMessageMarkdown
          v-if="message.role === 'assistant' && message.text"
          class="ai-panel__text ai-panel__text--markdown"
          :content="message.text"
          :renderer="markdownRenderer"
          @rendered="scrollEnd"
        />
        <p v-else-if="message.text" class="ai-panel__text">{{ message.text }}</p>
        <ul
          v-if="message.attachments?.length"
          class="ai-panel__sent-files"
          aria-label="本条消息的附件"
        >
          <li
            v-for="attachment in message.attachments"
            :key="attachment.id"
            :title="attachment.name"
          >
            <SvgIcon :name="attachment.kind === 'image' ? 'image' : 'attachment'" :size="15" />
            <span>{{ attachment.name }}</span>
            <small>{{ attachmentSize(attachment.size) }}</small>
          </li>
        </ul>
        <details v-if="message.activity?.length" class="ai-panel__activity">
          <summary>操作记录（{{ message.activity.length }}）</summary>
          <ol>
            <li v-for="(item, index) in message.activity" :key="index">{{ item }}</li>
          </ol>
        </details>
        <button
          v-if="message.persistence === 'failed'"
          type="button"
          class="ai-button"
          :disabled="conversationLocked"
          @click="retryMessage(message)"
        >
          重试保存回复
        </button>
        <button
          v-else-if="
            message.error || (message.state === 'incomplete' && message.id !== activeTurnId)
          "
          type="button"
          class="ai-button"
          @click="
            messageBox.error(message.error || '本轮尚未完成，可以发送新指令继续。', {
              key: 'turn:' + message.id,
            })
          "
        >
          查看本轮状态
        </button>
        <button
          v-if="message.review"
          class="ai-button ai-panel__review"
          :disabled="applying || running || pending.has('review')"
          @click="openReview(message.review)"
        >
          {{ message.review.status === 'applied' ? '查看已应用修改' : '审阅修改' }}
          · {{ message.review.fileCount }} 个文件
        </button>
      </article>
    </div>
    <form class="ai-panel__composer" novalidate @submit.prevent="send">
      <div class="ai-panel__input-box">
        <ul
          v-if="draftAttachments.length"
          class="ai-panel__files"
          aria-label="待发送附件"
          aria-live="polite"
        >
          <li v-for="item in draftAttachments" :key="item.id" class="ai-panel__file">
            <SvgIcon
              :name="item.attachment?.kind === 'image' ? 'image' : 'attachment'"
              :size="18"
            />
            <div class="ai-panel__file-info">
              <span :title="item.name">{{ item.name }}</span>
              <small :class="{ 'ai-error': item.status === 'error' }">
                {{
                  item.status === 'uploading'
                    ? item.progress < 100
                      ? `正在上传 ${item.progress}%`
                      : '正在解析…'
                    : item.status === 'error'
                      ? item.error
                      : attachmentSize(item.size) + ' · 已就绪'
                }}
              </small>
            </div>
            <button
              v-if="item.status === 'error'"
              type="button"
              class="ai-panel__control"
              :disabled="running || applying || !selectedModel?.multimodal_enabled"
              :aria-label="'重新上传：' + item.name"
              @click="retryAttachment(item)"
            >
              重试
            </button>
            <button
              type="button"
              class="ai-panel__control ai-panel__file-remove"
              :disabled="running || applying"
              :aria-label="'移除附件：' + item.name"
              :title="item.status === 'uploading' ? '取消上传并移除附件' : '移除附件'"
              @click="removeAttachment(item.id)"
            >
              <SvgIcon name="close" :size="16" />
            </button>
          </li>
        </ul>
        <p v-if="attachmentError" class="ai-error ai-panel__file-error" role="alert">
          {{ attachmentError }}
        </p>
        <p
          v-if="draftAttachments.length && !selectedModel?.multimodal_enabled"
          class="ai-error ai-panel__file-error"
          role="alert"
        >
          当前模型未开启多模态，请选择多模态模型或移除附件。
        </p>
        <textarea
          id="ai-message"
          ref="input"
          v-model="prompt"
          class="ai-panel__input"
          rows="2"
          style="resize: none"
          placeholder="续写文章、整理排版，或添加公式和流程图。"
          :disabled="applying"
          @input="resizeInput"
          @keydown="onInputKeydown"
        />
        <div class="ai-panel__toolbar">
          <VoexTrigger
            v-model:popup-visible="modelMenuOpen"
            trigger="click"
            position="top-start"
            strategy="fixed"
            :popup-offset="8"
            :disabled="running || applying || pending.has('models')"
            auto-fit-popup-width
            content-class="ai-panel__model-popup"
            role="dialog"
            aria-label="选择 AI 模型"
            @show="focusSelectedModel"
          >
            <button
              ref="modelTrigger"
              class="ai-panel__control ai-panel__model-trigger"
              type="button"
              :title="selectedModel ? selectedModel.name + ' · ' + selectedModel.model : '选择模型'"
              :aria-label="selectedModel ? '当前模型：' + selectedModel.name : '选择模型'"
              aria-haspopup="dialog"
              :disabled="running || applying || pending.has('models')"
              @keydown.down.prevent="modelMenuOpen = true"
              @keydown.up.prevent="modelMenuOpen = true"
            >
              <span>{{ selectedModel?.name || '选择模型' }}</span>
              <small v-if="selectedModel?.multimodal_enabled" class="ai-panel__multimodal"
                >多模态</small
              >
              <SvgIcon
                name="chevron-right"
                :size="14"
                class="ai-panel__model-chevron"
                :class="{ 'ai-panel__model-chevron--open': modelMenuOpen }"
              />
            </button>
            <template #content>
              <div ref="modelMenu" class="ai-panel__model-menu" @keydown.tab="onModelMenuTab">
                <fieldset v-if="models.length" class="ai-panel__model-options">
                  <legend class="ai-panel__sr-only">可用模型</legend>
                  <div v-for="model in models" :key="model.id" class="ai-panel__model-row">
                    <label
                      class="ai-panel__model-option"
                      :class="{ 'ai-panel__model-option--selected': selectedId === model.id }"
                    >
                      <input
                        v-model="selectedId"
                        type="radio"
                        :name="modelGroupName"
                        :value="model.id"
                        @click="selectModel(model.id)"
                        @keydown.enter.prevent="selectModel(model.id)"
                      />
                      <span>
                        <strong class="ai-panel__model-name"
                          >{{ model.name
                          }}<span v-if="model.multimodal_enabled" class="ai-panel__multimodal"
                            >多模态</span
                          ></strong
                        >
                        <small>{{ model.model }}</small>
                      </span>
                    </label>
                    <button
                      type="button"
                      class="ai-panel__control ai-panel__model-edit"
                      :aria-label="'编辑模型：' + model.name"
                      :title="'编辑模型：' + model.name"
                      @click="openModelSettings(model)"
                    >
                      <SvgIcon name="write" :size="16" />
                    </button>
                  </div>
                </fieldset>
                <p v-else class="ai-panel__model-empty">暂无模型，请先配置</p>
                <button
                  v-if="!models.length"
                  class="ai-panel__control ai-panel__model-settings"
                  type="button"
                  :disabled="pending.has('models')"
                  @click="loadModels"
                >
                  重新加载模型
                </button>
                <button
                  ref="modelSettingsButton"
                  class="ai-panel__control ai-panel__model-settings"
                  type="button"
                  @click="openModelSettings()"
                >
                  <SvgIcon name="add" :size="16" />
                  新增模型
                </button>
              </div>
            </template>
          </VoexTrigger>
          <input
            ref="attachmentInput"
            type="file"
            :accept="AI_ATTACHMENT_ACCEPT"
            multiple
            hidden
            aria-label="选择 AI 对话附件"
            :disabled="!canUpload"
            @change="selectAttachments"
          />
          <div class="ai-panel__toolbar-actions">
            <VoexTrigger
              v-model:popup-visible="webMenuOpen"
              trigger="click"
              position="top-end"
              strategy="fixed"
              :popup-offset="8"
              :disabled="running || applying"
              content-class="ai-panel__web-popup"
              role="dialog"
              aria-label="选择搜索引擎"
              @show="focusSelectedWebEngine"
            >
              <button
                ref="webTrigger"
                class="ai-panel__control ai-panel__icon-button"
                type="button"
                :aria-label="webSearchLabel"
                :title="webSearchLabel"
                aria-haspopup="dialog"
                :disabled="running || applying"
                @keydown.down.prevent="webMenuOpen = true"
                @keydown.up.prevent="webMenuOpen = true"
              >
                <SvgIcon
                  name="world"
                  :size="18"
                  :color="webSearchEnabled ? 'var(--color-brand-bg)' : undefined"
                />
              </button>
              <template #content>
                <div
                  ref="webMenu"
                  class="ai-panel__web-menu"
                  tabindex="-1"
                  @keydown.tab="onWebMenuTab"
                >
                  <div class="ai-panel__web-heading">
                    <span>搜索引擎</span>
                    <VoexTooltip
                      content="选择引擎后可搜索并读取公开网页；搜索词会发送给该引擎，网页内容会提供给当前模型。选择“无”关闭联网。Bing RSS 无需 Key，可用性可能波动。"
                    >
                      <button
                        type="button"
                        class="ai-panel__control ai-panel__web-help"
                        aria-label="联网搜索与网页读取说明"
                      >
                        <SvgIcon name="question-mark" :size="16" />
                      </button>
                    </VoexTooltip>
                  </div>
                  <fieldset class="ai-panel__web-options" :aria-describedby="webStatusId">
                    <legend class="ai-panel__sr-only">可用搜索引擎</legend>
                    <label
                      v-for="engine in webEngineOptions"
                      :key="engine.id"
                      class="ai-panel__web-option"
                      :class="{
                        'ai-panel__web-option--selected': selectedWebEngineId === engine.id,
                      }"
                    >
                      <input
                        v-model="selectedWebEngineId"
                        type="radio"
                        :name="webGroupName"
                        :value="engine.id"
                        :disabled="running || applying || (!!engine.id && webEnginesLoading)"
                        @change="webEngineError = ''"
                        @click="selectWebEngine(engine.id)"
                        @keydown.enter.prevent="selectWebEngine(engine.id)"
                      />
                      <span>{{ engine.name }}</span>
                      <small v-if="!engine.id">不开启搜索</small>
                    </label>
                  </fieldset>
                  <p
                    :id="webStatusId"
                    class="ai-panel__web-status"
                    :class="{ 'ai-error': webEngineError }"
                    role="status"
                  >
                    {{
                      webEnginesLoading
                        ? '正在加载搜索引擎…'
                        : webEngineError ||
                          (!webEngines.length
                            ? '暂无可用搜索引擎，请稍后重试。'
                            : webSearchEnabled
                              ? '已开启搜索和网页读取'
                              : '联网搜索已关闭')
                    }}
                  </p>
                  <button
                    v-if="webEngineError || (!webEnginesLoading && !webEngines.length)"
                    type="button"
                    class="ai-panel__control ai-panel__web-retry"
                    :disabled="running || applying || webEnginesLoading"
                    @click="loadWebEngines()"
                  >
                    重新加载搜索引擎
                  </button>
                </div>
              </template>
            </VoexTrigger>
            <button
              v-if="selectedModel?.multimodal_enabled"
              ref="attachmentButton"
              class="ai-panel__control ai-panel__icon-button"
              type="button"
              aria-label="上传图片或文档"
              title="上传图片或文档"
              :disabled="!canUpload"
              :aria-busy="uploadBusy"
              @click="attachmentInput?.click()"
            >
              <SvgIcon name="attachment" :size="18" />
            </button>
            <button
              v-if="running"
              type="button"
              class="ai-panel__control ai-panel__icon-button ai-panel__send"
              aria-label="停止生成"
              title="停止生成"
              @click="stop"
            >
              <SvgIcon name="close" :size="18" />
            </button>
            <button
              v-else
              type="submit"
              class="ai-panel__control ai-panel__icon-button ai-panel__send"
              aria-label="发送"
              title="发送"
              :disabled="!canSend"
            >
              <SvgIcon name="send" :size="18" />
            </button>
          </div>
        </div>
      </div>
    </form>
  </aside>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  useId,
  watch,
} from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import AIMessageMarkdown from './AIMessageMarkdown.vue';
import { createAIMessageRenderer, type AIMessageRenderer } from './message-markdown';
import { useMessageBox } from '@/composables/useMessageBox';
import { VoexTrigger } from '@/plugins/trigger';
import { VoexTooltip } from '@/plugins/tooltip';
import { useDialog } from '@/composables/useDialog';
import { useConfirm } from '@/composables/useConfirm';
import { MessageType } from '@/constant/status';
import { ModalType } from '@/stores/modal';
import {
  getAIReview,
  listAIModels,
  listAIWebEngines,
  uploadAIAttachment,
} from '@/service/api/ai-api';
import { randomUUID } from '@/utils/id';
import {
  AI_ATTACHMENT_ACCEPT,
  AI_ATTACHMENT_MAX_COUNT,
  AI_ATTACHMENT_TOTAL_SIZE,
  attachmentSize,
  validateAIAttachment,
} from '@/agent/attachments';
import { authUser } from '@/service/auth-session';
import { useAgentStore } from '@/stores/agent';
import { errorMessage } from '@/utils/error';
import { AgentDraft } from '@/agent/draft';
import { AgentToolRegistry } from '@/agent/registry';
import {
  registerEditorTools,
  registerFileTools,
  type FileCapabilities,
} from '@/agent/editor-tools';
import { runAgent } from '@/agent/run';
import { registerWebTools } from '@/agent/web-tools';
import type {
  AIModel,
  AIWebEngine,
  AIAttachmentDraft,
  AIConversationSession,
  ChatMessage,
  DocumentSnapshot,
  ReviewSnapshot,
  ReviewSummary,
} from '@/agent/types';
import './ai.styl';

const props = defineProps<{
  documentKey: string;
  documentName: string;
  canWrite: boolean;
  busy: boolean;
  prepare: () => Promise<DocumentSnapshot>;
  apply: (review: ReviewSnapshot) => Promise<boolean>;
  normalize: (content: string) => string;
  capabilities: FileCapabilities;
}>();
const emit = defineEmits<{ close: [] }>();
const models = ref<AIModel[]>([]);
const selectedId = ref('');
const webEngines = ref<AIWebEngine[]>([]);
const selectedWebEngineId = ref('');
const webSearchEnabled = computed(() => selectedWebEngineId.value !== '');
const webEngineOptions = computed(() => [{ id: '', name: '无' }, ...webEngines.value]);
const webMenuOpen = ref(false);
const webTrigger = ref<HTMLButtonElement>();
const webMenu = ref<HTMLElement>();
const webGroupName = useId() + '-web-engine';
const webEnginesLoading = ref(false);
const webEngineError = ref('');
const webStatusId = useId() + '-web-status';
const selectedWebEngine = computed(() =>
  webEngines.value.find((engine) => engine.id === selectedWebEngineId.value)
);
const webSearchLabel = computed(() =>
  webSearchEnabled.value ? `联网搜索：${selectedWebEngine.value?.name || '已开启'}` : '联网搜索：无'
);
const selectedModel = computed(() => models.value.find((model) => model.id === selectedId.value));
const messageBox = useMessageBox();
const { confirm } = useConfirm();
const modelMessages = useMessageBox();
const pending = reactive(new Set<'models' | 'review' | 'delete'>());
const settingsOpen = ref(false);
const editingModel = shallowRef<AIModel | null>(null);
const modelMenuOpen = ref(false);
const conversationMenuOpen = ref(false);
const conversationTrigger = ref<HTMLButtonElement>();
const conversationMenu = ref<HTMLElement>();
const closeButton = ref<HTMLButtonElement>();
const modelGroupName = useId() + '-ai-model';
const modelTrigger = ref<HTMLButtonElement>();
const modelMenu = ref<HTMLElement>();
const modelSettingsButton = ref<HTMLButtonElement>();
const attachmentInput = ref<HTMLInputElement>();
const attachmentButton = ref<HTMLButtonElement>();
const attachmentError = ref('');
const uploads = new Map<string, { controller: AbortController; draft: AIAttachmentDraft }>();
const agentStore = useAgentStore();
const conversationId = computed(() => agentStore.selectedSessions[props.documentKey] ?? '');
const conversations = computed(() => agentStore.conversations[props.documentKey] ?? []);
const activeConversation = computed(() =>
  conversations.value.find((session) => session.id === conversationId.value)
);
const conversationList = computed(() => agentStore.listState(props.documentKey));
const messages = computed(() => agentStore.messages(props.documentKey, conversationId.value));
const hasUnsavedResponse = computed(() => messages.value.some((message) => !!message.persistence));
const history = computed(() => agentStore.state(props.documentKey, conversationId.value));
const conversationReady = computed(
  () => conversationList.value.loaded && (!conversationId.value || history.value.loaded)
);
const prompt = computed({
  get: () => agentStore.draft(props.documentKey, conversationId.value),
  set: (value: string) => agentStore.setDraft(props.documentKey, conversationId.value, value),
});
const draftAttachments = computed(() =>
  agentStore.attachments(props.documentKey, conversationId.value)
);
const uploadBusy = computed(() =>
  draftAttachments.value.some((item) => item.status === 'uploading')
);
const running = ref(false);
const review = ref<ReviewSnapshot | null>(null);
const applying = ref(false);
const activeTurnId = ref('');
const thinkingTurnId = ref('');
const scroller = ref<HTMLElement>();
const input = ref<HTMLTextAreaElement>();

function resizeInput() {
  const element = input.value;
  if (!element) return;
  const style = window.getComputedStyle(element);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  element.style.setProperty('--ai-input-padding-block', `${padding}px`);
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

watch([input, prompt], resizeInput, { flush: 'post' });
watch(
  input,
  (element, _previous, onCleanup) => {
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resizeInput();
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  },
  { flush: 'post' }
);
let followScroll = true;
let controller: AbortController | undefined;
let modelController: AbortController | undefined;
let webEngineController: AbortController | undefined;
let reviewController: AbortController | undefined;
let disposed = false;
const markdownRenderer = shallowRef<AIMessageRenderer>();
onMounted(async () => {
  try {
    const renderer = await createAIMessageRenderer();
    if (disposed) await renderer.destroy();
    else markdownRenderer.value = renderer;
  } catch {
    if (!disposed) messageBox.error('对话排版加载失败，已显示原文。', { key: 'markdown' });
  }
});
const conversationLocked = computed(
  () =>
    running.value ||
    applying.value ||
    conversationList.value.loading ||
    conversationList.value.creating ||
    pending.has('review') ||
    pending.has('delete') ||
    uploadBusy.value ||
    history.value.loading ||
    messages.value.some((message) => message.persistence === 'saving')
);
const canUpload = computed(
  () =>
    !!selectedModel.value?.multimodal_enabled &&
    !conversationLocked.value &&
    !props.busy &&
    !pending.has('models') &&
    !settingsOpen.value
);
const canSend = computed(
  () =>
    (!!prompt.value.trim() || draftAttachments.value.length > 0) &&
    draftAttachments.value.every((item) => item.status === 'ready') &&
    (!draftAttachments.value.length || !!selectedModel.value?.multimodal_enabled) &&
    !!selectedModel.value &&
    (!webSearchEnabled.value ||
      (!webEnginesLoading.value && !webEngineError.value && !!selectedWebEngine.value)) &&
    !!props.documentKey &&
    !props.busy &&
    !conversationLocked.value &&
    conversationReady.value &&
    !history.value.error &&
    !conversationList.value.error &&
    !hasUnsavedResponse.value
);
useDialog(ModalType.AI_MODEL_DIALOG, {
  visible: () => settingsOpen.value,
  props: () => ({ model: editingModel.value, onSaved: modelSaved }),
  onClose: () => {
    settingsOpen.value = false;
  },
});
useDialog(ModalType.AI_REVIEW_DIALOG, {
  visible: () => !!review.value,
  props: () => ({
    review: review.value,
    applying: applying.value,
    canApply: props.canWrite && !props.busy && !running.value,
    onApply: applyReview,
  }),
  onClose: closeReview,
});
function conversationDate(session: AIConversationSession) {
  return new Date(session.createdAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
function conversationLabel(session: AIConversationSession) {
  return `${session.title} · ${conversationDate(session)}`;
}
function focusSelectedConversation() {
  if (!conversationMenuOpen.value) return;
  const menu = conversationMenu.value;
  const selected = menu?.querySelector<HTMLButtonElement>('button[aria-current="true"]:enabled');
  (selected ?? menu?.querySelector<HTMLButtonElement>('button:enabled') ?? menu)?.focus({
    preventScroll: true,
  });
}
function onConversationMenuTab(event: KeyboardEvent) {
  const buttons = conversationMenu.value?.querySelectorAll<HTMLButtonElement>('button:enabled');
  if (!buttons?.length || (event.shiftKey && event.target === buttons[0])) {
    event.preventDefault();
    conversationMenuOpen.value = false;
    conversationTrigger.value?.focus({ preventScroll: true });
  } else if (!event.shiftKey && event.target === buttons[buttons.length - 1]) {
    event.preventDefault();
    conversationMenuOpen.value = false;
    (closeButton.value?.getClientRects().length ? closeButton.value : input.value)?.focus({
      preventScroll: true,
    });
  }
}
function captureContext(sessionId?: string) {
  const key = props.documentKey;
  const user = authUser.value?.id;
  return () =>
    !disposed &&
    key === props.documentKey &&
    user === authUser.value?.id &&
    (sessionId === undefined || sessionId === conversationId.value);
}
async function loadConversations(older = false) {
  if (older && conversationList.value.loading) return;
  const current = captureContext();
  const key = props.documentKey;
  const notice = messageBox.loading('正在加载对话列表…', { key: 'conversations' });
  await agentStore.loadConversations(key, older);
  if (!current()) return notice.close();
  const state = agentStore.listState(key);
  if (state.error) {
    notice.error(state.error, { retry: () => loadConversations(older) });
    return;
  }
  notice.close();
  if (!older && conversationId.value) await loadConversationHistory();
  void scrollEnd();
}
async function loadConversationHistory(older = false) {
  const key = props.documentKey;
  const id = conversationId.value;
  if (!id || (older && history.value.loading)) return;
  const current = captureContext(id);
  const notice = messageBox.loading(older ? '正在加载更早的消息…' : '正在加载对话…', {
    key: 'history',
  });
  await agentStore.load(key, id, older);
  if (!current()) return notice.close();
  const state = agentStore.state(key, id);
  if (state.error)
    notice.error(state.error, { retry: () => (older ? loadOlder() : loadConversationHistory()) });
  else notice.close();
}
async function newConversation() {
  if (conversationLocked.value || !conversationList.value.loaded || conversationList.value.error)
    return;
  conversationMenuOpen.value = false;
  messageBox.clear();
  const key = props.documentKey;
  const current = captureContext();
  const notice = messageBox.loading('正在新建对话…', { key: 'create' });
  try {
    await agentStore.createConversation(key);
    notice.close();
    if (!current()) return;
    if (history.value.error) {
      messageBox.error(history.value.error, {
        key: 'history',
        retry: () => loadConversationHistory(),
      });
    }
    await nextTick();
    input.value?.focus();
  } catch (cause) {
    if (current())
      notice.error(errorMessage(cause, '新建对话失败，请重试'), { retry: newConversation });
    else notice.close();
  }
}
async function switchConversation(id: string) {
  if (conversationLocked.value) return;
  conversationMenuOpen.value = false;
  conversationTrigger.value?.focus({ preventScroll: true });
  const current = captureContext();
  messageBox.clear();
  agentStore.selectConversation(props.documentKey, id);
  await loadConversationHistory();
  if (current() && id === conversationId.value) void scrollEnd();
}

function hasPendingResponse(id: string) {
  return agentStore.messages(props.documentKey, id).some((message) => !!message.persistence);
}
async function deleteConversation(session: AIConversationSession) {
  if (conversationLocked.value || hasPendingResponse(session.id)) return;
  const key = props.documentKey;
  const current = captureContext();
  pending.add('delete');
  conversationMenuOpen.value = false;
  try {
    await nextTick();
    const accepted = await confirm({
      type: MessageType.WARNING,
      title: '删除对话',
      content: `删除“${session.title}”及其全部消息、未发送草稿和审阅快照，无法恢复。已应用的文档修改不会撤销。`,
      confirmText: '删除对话',
      cancelText: '取消',
    });
    if (!current()) return;
    if (!accepted) {
      conversationMenuOpen.value = true;
      return;
    }
    const selected = conversationId.value;
    const notice = messageBox.loading('正在删除对话…', { key: 'delete' });
    try {
      await agentStore.removeConversation(key, session.id);
      notice.close();
      if (!current()) return;
      messageBox.info('对话已删除', { key: 'delete' });
      if (!conversations.value.length && conversationList.value.nextCursor)
        await loadConversations();
      else if (selected === session.id && conversationId.value) await loadConversationHistory();
      if (current()) conversationMenuOpen.value = true;
    } catch (cause) {
      if (current())
        notice.error(errorMessage(cause, '删除对话失败，请重试'), {
          retry: () => deleteConversation(session),
          actionLabel: '重试删除',
        });
      else notice.close();
    }
  } finally {
    pending.delete('delete');
  }
}

function onScroll() {
  const element = scroller.value;
  if (element) followScroll = element.scrollHeight - element.scrollTop - element.clientHeight < 70;
}
async function scrollEnd() {
  await nextTick();
  if (followScroll && scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}
async function loadOlder() {
  const key = props.documentKey;
  const sessionId = conversationId.value;
  const element = scroller.value;
  const height = element?.scrollHeight ?? 0;
  const top = element?.scrollTop ?? 0;
  await loadConversationHistory(true);
  await nextTick();
  if (
    key === props.documentKey &&
    sessionId === conversationId.value &&
    element &&
    element === scroller.value
  )
    element.scrollTop = element.scrollHeight - height + top;
}
async function loadModels() {
  modelController?.abort();
  const request = new AbortController();
  modelController = request;
  const user = authUser.value?.id;
  const notice = modelMessages.loading('正在加载 AI 模型…', { key: 'models' });
  pending.add('models');
  try {
    const result = await listAIModels(request.signal);
    if (request.signal.aborted || disposed || user !== authUser.value?.id) {
      notice.close();
      return;
    }
    models.value = result;
    if (!result.some((model) => model.id === selectedId.value))
      selectedId.value = result[0]?.id ?? '';
    notice.close();
  } catch (cause) {
    if (!request.signal.aborted && !disposed && user === authUser.value?.id)
      notice.error(errorMessage(cause, '模型配置加载失败'), { retry: loadModels });
    else notice.close();
  } finally {
    if (modelController === request) {
      pending.delete('models');
      modelController = undefined;
    }
  }
}
async function loadWebEngines(signal?: AbortSignal): Promise<AIWebEngine[] | undefined> {
  webEngineController?.abort();
  const request = new AbortController();
  webEngineController = request;
  const cancel = () => request.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) request.abort();
  const user = authUser.value?.id;
  webEnginesLoading.value = true;
  webEngineError.value = '';
  try {
    const { engines } = await listAIWebEngines(request.signal);
    if (request.signal.aborted || disposed || user !== authUser.value?.id) return;
    const removed =
      !!selectedWebEngineId.value &&
      !engines.some((engine) => engine.id === selectedWebEngineId.value);
    webEngines.value = engines;
    if (removed) {
      selectedWebEngineId.value = '';
      webEngineError.value = '原搜索引擎已不可用，已切换为“无”，请重新选择。';
    }
    return engines;
  } catch (cause) {
    if (!request.signal.aborted && !disposed && user === authUser.value?.id) {
      webEngines.value = [];
      selectedWebEngineId.value = '';
      webEngineError.value = errorMessage(cause, '搜索引擎加载失败，请重试');
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (webEngineController === request) {
      webEnginesLoading.value = false;
      webEngineController = undefined;
    }
  }
}
watch(modelMenuOpen, (open) => {
  if (open) webMenuOpen.value = false;
});
watch(webMenuOpen, (open) => {
  if (!open) return;
  modelMenuOpen.value = false;
  if (!running.value && !applying.value) void loadWebEngines();
});
function focusSelectedWebEngine() {
  if (!webMenuOpen.value) return;
  const selected = webMenu.value?.querySelector<HTMLInputElement>('input:checked:not(:disabled)');
  (selected ?? webMenu.value)?.focus({ preventScroll: true });
}
function selectWebEngine(id: string) {
  if (running.value || applying.value) return;
  if (id && (webEnginesLoading.value || !webEngines.value.some((engine) => engine.id === id)))
    return;
  selectedWebEngineId.value = id;
  webEngineError.value = '';
  webMenuOpen.value = false;
  webTrigger.value?.focus({ preventScroll: true });
}
function onWebMenuTab(event: KeyboardEvent) {
  const controls = webMenu.value?.querySelectorAll<HTMLElement>(
    'button:enabled, input:checked:not(:disabled)'
  );
  if (!controls?.length) return;
  if (event.shiftKey && event.target === controls[0]) {
    event.preventDefault();
    webMenuOpen.value = false;
    webTrigger.value?.focus({ preventScroll: true });
  } else if (!event.shiftKey && event.target === controls[controls.length - 1]) {
    event.preventDefault();
    webMenuOpen.value = false;
    const nextControl = attachmentButton.value;
    (nextControl && !nextControl.disabled ? nextControl : input.value)?.focus({
      preventScroll: true,
    });
  }
}
function modelSaved(model: AIModel) {
  models.value = [...models.value.filter((item) => item.id !== model.id), model];
  selectedId.value = model.id;
}
function focusSelectedModel() {
  if (!modelMenuOpen.value) return;
  const selected = modelMenu.value?.querySelector<HTMLInputElement>('input:checked');
  (selected ?? modelSettingsButton.value)?.focus({ preventScroll: true });
}
function selectModel(id: string) {
  if (running.value || applying.value) return;
  selectedId.value = id;
  modelMenuOpen.value = false;
  modelTrigger.value?.focus({ preventScroll: true });
}
async function openModelSettings(model: AIModel | null = null) {
  editingModel.value = model;
  modelMenuOpen.value = false;
  modelTrigger.value?.focus({ preventScroll: true });
  await nextTick();
  settingsOpen.value = true;
}
function onModelMenuTab(event: KeyboardEvent) {
  const firstControl = modelMenu.value?.querySelector('input:checked, button:enabled');
  const atStart = event.target === firstControl;
  if (event.shiftKey && atStart) {
    event.preventDefault();
    modelMenuOpen.value = false;
    modelTrigger.value?.focus({ preventScroll: true });
  } else if (!event.shiftKey && event.target === modelSettingsButton.value) {
    event.preventDefault();
    modelMenuOpen.value = false;
    (webTrigger.value ?? input.value)?.focus({ preventScroll: true });
  }
}
async function selectAttachments(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  target.value = '';
  const model = selectedModel.value;
  if (!model?.multimodal_enabled || !canUpload.value || !files.length) return;
  const key = props.documentKey;
  const session = conversationId.value;
  const queue = agentStore.attachments(key, session);
  const failures: string[] = [];
  const added: AIAttachmentDraft[] = [];
  for (const file of files) {
    const issue = validateAIAttachment(file);
    if (issue) {
      failures.push(`${file.name}：${issue}`);
      continue;
    }
    if (queue.length >= AI_ATTACHMENT_MAX_COUNT) {
      failures.push('每轮最多上传 4 个文件');
      break;
    }
    if (queue.reduce((size, item) => size + item.size, 0) + file.size > AI_ATTACHMENT_TOTAL_SIZE) {
      failures.push(`${file.name}：本轮文件总大小不能超过 12 MiB`);
      continue;
    }
    const item = reactive<AIAttachmentDraft>({
      id: randomUUID(),
      name: file.name,
      size: file.size,
      file,
      status: 'uploading',
      progress: 0,
      error: '',
    });
    queue.push(item);
    added.push(item);
  }
  attachmentError.value = failures.join('；');
  await Promise.allSettled(added.map((item) => uploadAttachment(item, key, session, model.id)));
}
async function uploadAttachment(
  item: AIAttachmentDraft,
  fileKey: string,
  sessionId: string,
  modelId: string
) {
  if (!item.file) return;
  const user = authUser.value?.id;
  const request = new AbortController();
  const active = { controller: request, draft: item };
  uploads.set(item.id, active);
  item.status = 'uploading';
  item.progress = 0;
  item.error = '';
  try {
    const result = await uploadAIAttachment(modelId, item.file, request.signal, (percent) => {
      item.progress = percent;
    });
    if (
      request.signal.aborted ||
      user !== authUser.value?.id ||
      disposed ||
      !agentStore.attachments(fileKey, sessionId).includes(item)
    )
      return;
    item.attachment = result;
    item.status = 'ready';
    item.file = undefined;
  } catch (cause) {
    if (user === authUser.value?.id && agentStore.attachments(fileKey, sessionId).includes(item)) {
      item.status = 'error';
      item.error = request.signal.aborted
        ? '上传已取消，可重试'
        : errorMessage(cause, '上传失败，请重试');
    }
  } finally {
    if (uploads.get(item.id) === active) uploads.delete(item.id);
  }
}
function retryAttachment(item: AIAttachmentDraft) {
  if (
    running.value ||
    applying.value ||
    !selectedModel.value?.multimodal_enabled ||
    item.status !== 'error'
  )
    return;
  void uploadAttachment(item, props.documentKey, conversationId.value, selectedModel.value.id);
}
function removeAttachment(id: string) {
  if (running.value || applying.value) return;
  uploads.get(id)?.controller.abort();
  agentStore.setAttachments(
    props.documentKey,
    conversationId.value,
    draftAttachments.value.filter((item) => item.id !== id)
  );
  attachmentError.value = '';
}
function cancelAttachmentUploads() {
  for (const { controller, draft } of uploads.values()) {
    controller.abort();
    draft.status = 'error';
    draft.error = '上传已取消，可重试';
  }
  uploads.clear();
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!running.value) void send();
}
function stop() {
  controller?.abort();
}
async function openReview(summary: ReviewSummary) {
  reviewController?.abort();
  const request = new AbortController();
  reviewController = request;
  const current = captureContext(conversationId.value);
  const notice = messageBox.loading('正在读取审阅…', { key: 'review' });
  pending.add('review');
  try {
    const snapshot = await getAIReview(summary.id, request.signal);
    if (request.signal.aborted || !current()) {
      notice.close();
      return;
    }
    for (const change of snapshot.changes) Object.freeze(change);
    Object.freeze(snapshot.changes);
    if (snapshot.status === 'applied') agentStore.markApplied(snapshot.id);
    review.value = snapshot;
    notice.close();
  } catch (cause) {
    if (!request.signal.aborted && current())
      notice.error(errorMessage(cause, '审阅读取失败，请重试'), {
        retry: () => openReview(summary),
      });
    else notice.close();
  } finally {
    if (reviewController === request) {
      pending.delete('review');
      reviewController = undefined;
    }
  }
}
function closeReview() {
  if (!applying.value) {
    review.value = null;
    messageBox.clear('apply');
  }
}

async function send() {
  const model = selectedModel.value;
  if (!model || !canSend.value) return;
  const webEngine = selectedWebEngineId.value;
  modelMenuOpen.value = false;
  webMenuOpen.value = false;
  const sourceKey = props.documentKey;
  const originalSessionId = conversationId.value;
  let sessionId = originalSessionId;
  const user = authUser.value?.id;
  const request = new AbortController();
  controller = request;
  running.value = true;
  const current = captureContext();
  const notice = messageBox.loading('准备文档…', { key: 'send' });
  let failure = '';
  review.value = null;
  let draft: AgentDraft | undefined;
  let assistant: ChatMessage | undefined;
  const submittedDraft = prompt.value;
  const submittedItems = draftAttachments.value.slice();
  const submittedAttachments = submittedItems.flatMap((item) =>
    item.attachment ? [item.attachment] : []
  );
  const text = submittedDraft.trim() || '请分析上传的文件。';
  try {
    if (webEngine) {
      notice.update('正在检查搜索引擎…');
      const engines = await loadWebEngines(request.signal);
      request.signal.throwIfAborted();
      if (!engines?.some((engine) => engine.id === webEngine))
        throw new Error(webEngineError.value || '所选搜索引擎不可用，请重新选择或关闭联网搜索。');
    }
    const source = await props.prepare();
    request.signal.throwIfAborted();
    if (source.file_key !== sourceKey) throw new Error('文档已切换，请重新发送');
    if (!sessionId) {
      notice.update('正在新建对话…');
      sessionId = (await agentStore.createConversation(sourceKey)).id;
      request.signal.throwIfAborted();
      const createdHistory = agentStore.state(sourceKey, sessionId);
      if (!createdHistory.loaded || createdHistory.error)
        throw new Error(createdHistory.error || '对话历史尚未加载，请重试加载');
    }
    notice.update('正在保存指令…');
    assistant = await agentStore.begin(
      sourceKey,
      sessionId,
      model.id,
      text,
      request.signal,
      submittedAttachments
    );
    activeTurnId.value = assistant.id;
    thinkingTurnId.value = assistant.id;
    request.signal.throwIfAborted();
    if (sourceKey !== props.documentKey || user !== authUser.value?.id)
      throw new Error('文档或账号已切换');
    const conversation = agentStore
      .messages(sourceKey, sessionId)
      .filter((message) => message.id !== assistant!.id);
    for (const id of new Set([originalSessionId, sessionId])) {
      if (agentStore.draft(sourceKey, id) === submittedDraft)
        agentStore.setDraft(sourceKey, id, '');
      agentStore.setAttachments(
        sourceKey,
        id,
        agentStore
          .attachments(sourceKey, id)
          .filter((item) => !submittedItems.some((submitted) => submitted.id === item.id))
      );
    }
    attachmentError.value = '';
    followScroll = true;
    void scrollEnd();
    draft = new AgentDraft(source);
    const registry = new AgentToolRegistry();
    registerEditorTools(
      registry,
      draft,
      getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary').trim()
    );
    registerFileTools(registry, draft, props.capabilities);
    registerWebTools(registry, webEngine);
    await runAgent({
      model,
      registry,
      context: {
        document: source,
        userRequest: text,
        webSearchEngine: webEngine,
        signal: request.signal,
      },
      history: conversation,
      onText: (text) => {
        assistant!.text = text;
        void scrollEnd();
      },
      onReasoning: (text) => {
        assistant!.reasoning = text;
        void scrollEnd();
      },
      onActivity: (text) => {
        notice.update(text);
        assistant!.activity!.push(text);
        void scrollEnd();
      },
    });
    if (!assistant.text) assistant.text = '本轮操作已完成，请查看修改建议。';
  } catch (cause) {
    const message = request.signal.aborted
      ? '已停止；完成的草稿仍可审阅。'
      : errorMessage(cause, 'AI 请求失败，请检查配置后重试');
    if (assistant) assistant.error = message;
    failure = message;
  } finally {
    thinkingTurnId.value = '';
    try {
      if (assistant && user === authUser.value?.id) {
        let snapshot = draft?.snapshot();
        if (snapshot && !disposed && props.documentKey === sourceKey) {
          try {
            for (const change of snapshot.changes) {
              if (change.kind === 'create' || change.after_content !== change.before_content)
                change.after_content = props.normalize(change.after_content);
            }
          } catch {
            assistant.error = '生成的文档格式无法解析，请调整指令后重新生成。';
            snapshot = undefined;
          }
        }
        notice.update('正在保存回复和审阅…');
        await agentStore.save(sourceKey, sessionId, assistant.id, {
          text: assistant.text,
          activity: assistant.activity ?? [],
          error: assistant.error ?? '',
          review: snapshot ? { id: snapshot.id, changes: snapshot.changes } : undefined,
        });
      }
      if (current()) {
        if (request.signal.aborted) {
          notice.close();
          messageBox.info('已停止；完成的草稿仍可审阅。', { key: 'send' });
        } else if (assistant?.error || failure) {
          notice.error(assistant?.error || failure);
        } else notice.close();
        if (assistant?.review && !request.signal.aborted && conversationId.value === sessionId)
          await openReview(assistant.review);
      } else notice.close();
    } catch (cause) {
      notice.close();
      if (current() && assistant) showSaveError(assistant, cause);
    } finally {
      if (controller === request) {
        running.value = false;
        controller = undefined;
      }
      activeTurnId.value = '';
      void scrollEnd();
    }
  }
}

function showSaveError(message: ChatMessage, cause: unknown) {
  messageBox.error('回复尚未保存，刷新会丢失这份回复。' + errorMessage(cause, '保存失败'), {
    key: 'save:' + message.id,
    retry: () => retryMessage(message),
    actionLabel: '重试保存',
  });
}
async function retryMessage(message: ChatMessage) {
  if (conversationLocked.value) return;
  const current = captureContext(conversationId.value);
  const notice = messageBox.loading('正在重试保存回复…', { key: 'save:' + message.id });
  try {
    await agentStore.retry(message.id);
    notice.close();
    if (current() && message.review) await openReview(message.review);
  } catch (cause) {
    if (current())
      notice.error('回复尚未保存，刷新会丢失这份回复。' + errorMessage(cause, '保存失败'), {
        retry: () => retryMessage(message),
        actionLabel: '重试保存',
      });
    else notice.close();
  }
}

async function applyReview() {
  const snapshot = review.value;
  if (!snapshot || snapshot.status === 'applied' || applying.value || running.value) return;
  applying.value = true;
  const user = authUser.value?.id;
  const current = captureContext(conversationId.value);
  const notice = messageBox.loading('正在应用并保存…', { key: 'apply' });
  try {
    if (!(await props.apply(snapshot))) {
      notice.close();
      return;
    }
    snapshot.status = 'applied';
    if (current()) review.value = null;
    notice.close();
  } catch (cause) {
    if (current())
      notice.error(errorMessage(cause, '应用失败，修改建议已保留，可重试'), {
        retry: snapshot.status === 'applied' ? undefined : applyReview,
        actionLabel: '重试应用',
      });
    else notice.close();
  } finally {
    if (snapshot.status === 'applied' && user === authUser.value?.id)
      agentStore.markApplied(snapshot.id);
    applying.value = false;
  }
}
watch(
  () => props.documentKey,
  () => {
    messageBox.clear();
    cancelAttachmentUploads();
    attachmentError.value = '';
    stop();
    reviewController?.abort();
    review.value = null;
    modelMenuOpen.value = false;
    webMenuOpen.value = false;
    conversationMenuOpen.value = false;
  }
);
watch(conversationId, () => {
  attachmentError.value = '';
  messageBox.clear('review');
  messageBox.clear('apply');
  reviewController?.abort();
  review.value = null;
  modelMenuOpen.value = false;
  webMenuOpen.value = false;
  conversationMenuOpen.value = false;
  followScroll = true;
  void scrollEnd();
});
watch(
  () => authUser.value?.id,
  (id) => {
    messageBox.clear();
    modelMessages.clear();
    cancelAttachmentUploads();
    attachmentError.value = '';
    stop();
    modelController?.abort();
    webEngineController?.abort();
    webEngines.value = [];
    selectedWebEngineId.value = '';
    webEngineError.value = '';
    webEnginesLoading.value = false;
    reviewController?.abort();
    models.value = [];
    selectedId.value = '';
    settingsOpen.value = false;
    modelMenuOpen.value = false;
    webMenuOpen.value = false;
    conversationMenuOpen.value = false;
    review.value = null;
    if (id) {
      void loadModels();
      void loadWebEngines();
    }
  },
  { immediate: true }
);
watch(
  [() => props.documentKey, () => authUser.value?.id],
  ([key, id]) => {
    if (key && id) void loadConversations();
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  disposed = true;
  cancelAttachmentUploads();
  void markdownRenderer.value?.destroy();
  stop();
  modelController?.abort();
  webEngineController?.abort();
  reviewController?.abort();
});
</script>

<style lang="stylus">
.ai-panel
  width 100%
  min-width 0
  flex-shrink 0
  display flex
  flex-direction column
  min-height 0
  height 100%
  background transparent
  color var(--color-text-primary)
  &__header
    height 56px
    flex-shrink 0
    padding 0 16px
    display flex
    align-items center
    justify-content space-between
    gap 8px
    font-size 14px
    > span
      min-width 0
      &:not(.ai-panel__title)
        display flex
        align-items center
        gap 8px
        > svg
          flex-shrink 0
  &__heading
    flex 1
    min-width 0
  &__title
    flex 1
    min-width 0
    display block
    overflow hidden
    text-overflow ellipsis
    white-space nowrap
  &__header-actions
    display flex
    align-items center
    flex-shrink 0
    gap 4px
  &__header-button
    box-sizing border-box
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    width 32px
    height 32px
    padding 0
    border 0
    border-radius 50%
    background transparent
    color var(--color-text-secondary)
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-tertiary)
      color var(--color-text-primary)
    &:active:not(:disabled)
      transform translateY(1px)
    &[aria-expanded='true']
      background var(--color-selection-dim)
      color var(--color-accent-hover)
    &:disabled
      opacity .4
      cursor not-allowed
  &__history-popup
    border 1px solid var(--color-border-secondary)
    max-height unquote('min(280px, var(--voex-trigger-available-height, 280px))')
  &__history-menu
    box-sizing border-box
    width 280px
    max-width unquote('min(calc(100vw - 18px), var(--voex-trigger-available-width, 280px))')
    padding 4px
  &__history-list
    margin 0
    padding 0
    list-style none
  &__history-row
    display flex
    align-items center
    gap 4px
  &__history-delete
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    width 28px
    height 28px
    padding 0
    border 0
    border-radius var(--border-radius-item-s, 6px)
    background transparent
    color var(--color-text-tertiary)
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-tertiary)
      color var(--color-red)
    &:active:not(:disabled)
      background var(--color-selection-dim)
    &:disabled
      opacity .4
      cursor not-allowed
  &__history-item
    display block
    flex 1
    min-width 0
    padding 9px 8px
    border 0
    border-radius var(--border-radius-item-s, 6px)
    background transparent
    color var(--color-text-primary)
    font inherit
    text-align left
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-tertiary)
    &:active:not(:disabled)
      background var(--color-selection-bg)
    &[aria-current='true']
      background var(--color-selection-dim)
    &:disabled
      opacity .5
      cursor not-allowed
    strong, small
      display block
    strong
      overflow hidden
      text-overflow ellipsis
      white-space nowrap
      font-size 13px
      font-weight 500
    small
      margin-top 3px
      color var(--color-text-tertiary)
      font-size 11px
  &__history-status
    margin 0
    padding 12px 8px
    color var(--color-text-secondary)
    font-size 12px
  &__history-more
    width 100%
    margin-top 4px
  &__messages
    min-height 0
    flex 1
    overflow-y auto
    overscroll-behavior contain
    padding 16px
  &__empty
    color var(--color-text-tertiary)
    font-size 13px
    line-height 1.8
  &__message
    margin-bottom 22px
    font-size 13px
    line-height 1.75
    overflow-wrap anywhere
    &--user
      padding 10px 12px
      border-radius 6px
      background var(--color-bg-secondary)
  &__speaker
    font-size 12px
    font-weight 600
    color var(--color-text-tertiary)
  &__text
    margin 4px 0 8px
    white-space pre-wrap
    &--markdown:not(.ai-markdown--plain)
      white-space normal
  &__thinking, &__activity
    color var(--color-text-tertiary)
    font-size 12px
    summary
      border-radius 4px
      cursor pointer
      &:hover
        color var(--color-text-primary)
      &:active
        color var(--color-accent)
  &__thinking
    margin 6px 0 10px
    color var(--color-text-secondary)
  &__thinking-content
    max-height 240px
    overflow-y auto
    margin-top 6px
    padding-left 12px
    border-left 2px solid var(--color-border-secondary)
    p:last-child
      margin 0
  &__activity
    ol
      padding-left 20px
      max-height 180px
      overflow auto
  &__review
    margin-top 10px
    width 100%
    text-align left
    border-color var(--color-accent)
  &__multimodal
    display inline-block
    flex-shrink 0
    padding 1px 4px
    border 1px solid var(--color-border-secondary)
    border-radius 4px
    color var(--color-accent)
    font-size 10px
    font-weight 400
    line-height 1.4
    white-space nowrap
  &__model-option strong.ai-panel__model-name
    display flex
    align-items center
    gap 6px
  &__sent-files, &__files
    list-style none
    margin 6px 0
    padding 0
  &__sent-files li
    display flex
    align-items center
    gap 6px
    min-width 0
    color var(--color-text-secondary)
    font-size 12px
    svg, small
      flex-shrink 0
    span
      min-width 0
      overflow hidden
      text-overflow ellipsis
      white-space nowrap
    small
      color var(--color-text-tertiary)
  &__files
    max-height 180px
    overflow-y auto
    padding 0 8px
  &__file
    display flex
    align-items center
    gap 6px
    padding 6px 0
    min-width 0
    > svg
      flex-shrink 0
      color var(--color-text-secondary)
  &__file-info
    flex 1
    min-width 0
    font-size 12px
    > span
      display block
      overflow hidden
      text-overflow ellipsis
      white-space nowrap
    small
      display block
      color var(--color-text-tertiary)
      font-size 11px
      overflow-wrap anywhere
      &.ai-error
        color var(--color-red)
  &__file-remove
    flex-shrink 0
    width 28px
    min-height 28px
  &__file-error
    padding 0 8px
    margin 4px 0 8px
    font-size 12px
  &__composer
    flex-shrink 0
    padding 12px 16px 16px
  &__input-box
    border 1px solid var(--color-border-secondary)
    border-radius var(--border-radius-item-m, 8px)
    background var(--color-bg-secondary)
    padding-top 8px

  &__input
    display block
    box-sizing border-box
    width 100%
    min-height calc(3.2em + var(--ai-input-padding-block, 0px))
    max-height calc(6.4em + var(--ai-input-padding-block, 0px))
    overflow-y auto
    border 0
    border-radius inherit
    background transparent
    color var(--color-text-primary)
    font inherit
    font-size 13px
    line-height 1.6
    resize none
    padding 0 8px
    margin-bottom 8px
    &:focus-visible
      outline none
    &::placeholder
      color var(--color-text-tertiary)
    &:disabled
      opacity .5
      cursor not-allowed
  &__toolbar
    display flex
    align-items center
    justify-content space-between
    gap 6px
    padding 8px
  &__toolbar-actions
    display flex
    align-items center
    flex-shrink 0
    gap 6px
  &__control
    display inline-flex
    align-items center
    justify-content center
    padding 6px
    border-radius var(--border-radius-item-s, 6px)
    color var(--color-text-secondary)
    font-size 12px
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-tertiary)
      color var(--color-text-primary)
    &:active:not(:disabled)
      transform translateY(1px)
    &:disabled
      opacity .4
      cursor not-allowed
  &__model-trigger
    justify-content space-between
    gap 6px
    padding-inline 8px
    span
      flex 1
      min-width 0
      text-align left
      overflow hidden
      text-overflow ellipsis
      white-space nowrap
  &__model-chevron
    flex-shrink 0
    transform rotate(-90deg)
    &--open
      transform rotate(90deg)
  &__model-popup
    border 1px solid var(--color-border-secondary)
    min-width unquote('min(280px, calc(100vw - 24px))')
  &__model-menu
    display flex
    flex-direction column
    max-height unquote('min(320px, var(--voex-trigger-available-height, 320px))')
    padding 4px
    overflow-y auto
    overscroll-behavior contain
  &__model-options
    flex-shrink 0
    min-width 0
    min-height 0
    margin 0
    padding 0
    border 0
  &__model-row
    display flex
    align-items center
    gap 4px
  &__model-edit
    flex-shrink 0
    width 32px
    height 32px
    padding 6px
  &__model-option
    flex 1
    min-width 0
    display flex
    align-items center
    gap 8px
    padding 9px 8px
    border-radius var(--border-radius-item-s, 6px)
    cursor pointer
    &:hover
      background var(--color-bg-tertiary)

    &:active
      background var(--color-bg-tertiary)
    &--selected
      background var(--color-selection-dim)
    input
      flex-shrink 0
      width 14px
      height 14px
      margin 0
      accent-color var(--color-accent)
      cursor pointer
    span
      min-width 0
      overflow-wrap anywhere
    strong, small
      display block
    strong
      color var(--color-text-primary)
      font-size 12px
      font-weight 500
    small
      margin-top 3px
      color var(--color-text-tertiary)
      font-size 11px
  &__model-empty
    margin 0
    padding 12px 8px
    color var(--color-text-tertiary)
    font-size 12px
  &__web-popup
    width unquote('min(240px, calc(100vw - 24px))')
    border 1px solid var(--color-border-secondary)
  &__web-menu
    box-sizing border-box
    max-height unquote('min(320px, var(--voex-trigger-available-height, 320px))')
    padding 8px
    overflow-y auto
    overscroll-behavior contain
  &__web-heading
    display flex
    align-items center
    gap 4px
    padding 0 4px 4px
    color var(--color-text-primary)
    font-size 12px
    font-weight 500
  &__web-help
    width 28px
    min-height 28px
    padding 4px
  &__web-options
    margin 0
    padding 0
    border 0
    min-width 0
  &__web-option
    display flex
    align-items center
    gap 8px
    min-height 36px
    padding 8px
    border-radius var(--border-radius-item-s, 6px)
    color var(--color-text-primary)
    font-size 12px
    cursor pointer
    &:hover:not(:has(input:disabled))
      background var(--color-bg-tertiary)

    &:active:not(:has(input:disabled))
      background var(--color-selection-dim)
    &--selected
      background var(--color-selection-dim)
    &:has(input:disabled)
      opacity .5
      cursor not-allowed
    input
      flex-shrink 0
      margin 0
      width 14px
      height 14px
      accent-color var(--color-accent)
      cursor inherit
    span
      overflow-wrap anywhere
    small
      color var(--color-text-tertiary)
      font-size 11px
  &__web-retry
    margin-top 4px
  &__web-status
    min-height 18px
    margin 6px 0 0
    color var(--color-text-tertiary)
    font-size 11px
    line-height 1.6
    overflow-wrap anywhere
    &.ai-error
      color var(--color-red)
  &__model-settings
    flex-shrink 0
    justify-content flex-start
    gap 8px
    width 100%
    margin-top 4px
    padding 10px 8px
    border-top 1px solid var(--color-border-secondary)
  &__icon-button
    flex-shrink 0
    width 28px
    height 28px
  &__send
    background var(--color-brand-bg)
    color var(--color-brand-text)
    &:hover:not(:disabled)
      background var(--color-accent)
      color var(--color-brand-text)
  &__sr-only
    position absolute
    width 1px
    height 1px
    padding 0
    margin -1px
    overflow hidden
    clip-path inset(50%)
    white-space nowrap
    border 0

.edit-page__panel--mobile .ai-panel .ai-panel__header
  display flex
  .ai-panel__close
    display none
</style>
