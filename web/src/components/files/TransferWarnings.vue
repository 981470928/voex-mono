<template>
  <section v-if="warnings.length" class="document-transfer__warnings" aria-label="处理提示">
    <p class="document-transfer__warning-title" role="status">
      有 {{ warnings.length }} 项需要注意
    </p>
    <ul class="document-transfer__warning-list" tabindex="0" aria-label="完整处理提示列表">
      <li v-for="(warning, index) in warnings" :key="index">
        <strong v-if="warning.name">{{ warning.name }}</strong>
        <span>{{ warning.message }}</span>
        <span v-if="showSource(warning)" class="document-transfer__hint">{{ warning.source }}</span>
      </li>
    </ul>
  </section>
</template>
<script setup lang="ts">
import type { TransferWarning } from '@/service/api/document-transfer-api';
defineProps<{ warnings: TransferWarning[] }>();

function showSource(warning: TransferWarning): boolean {
  return Boolean(
    warning.source &&
    warning.source !== warning.name &&
    !(
      warning.code === 'missing_attachment' &&
      warning.name &&
      /^[a-f0-9]{64}$/i.test(warning.source)
    )
  );
}
</script>
