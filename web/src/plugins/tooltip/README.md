# VoexTooltip

基于 `VoexTrigger` 的非交互提示组件。复用项目现有 Vue 3、Floating UI、Teleport、主题变量与渐隐动画，无新增依赖。此目录只提供组件和说明，未注册全局组件或接入现有页面。

## 基础使用

```vue
<script setup lang="ts">
import { VoexTooltip } from '@/plugins/tooltip';
</script>

<template>
  <VoexTooltip content="保存文档">
    <button type="button">保存</button>
  </VoexTooltip>
</template>
```

默认顶部显示，带箭头、8px 间距、320px 最大宽度；鼠标进入/离开延迟 100ms，键盘聚焦立即显示。支持自动翻转、视口避让、滚动更新、Escape 和外部点击关闭。鼠标可移入提示内容以阅读或选择文字，触屏/笔输入沿用 Trigger 的点击回退；不会阻止锚点本身的点击行为。

`content` 按纯文本渲染，数字 `0` 也会显示；空字符串、纯空白、缺少内容或只含注释的内容插槽不显示。传入 `#content` 时完全覆盖 `content`，即使该插槽为空也不会回退。

## 内容插槽与方向

```vue
<script setup lang="ts">
import { VoexTooltip } from '@/plugins/tooltip';
</script>

<template>
  <VoexTooltip position="right" :max-width="240" :show-arrow="false">
    <button type="button" aria-label="格式说明">?</button>
    <template #content>
      <span>支持 <strong>Markdown</strong>，也可以直接粘贴文字。</span>
    </template>
  </VoexTooltip>
</template>
```

内容插槽仅用于说明文字、强调或快捷键等非交互内容。按钮、链接、输入框和操作菜单应使用 `VoexTrigger` 配合合适的 Popover/Menu 语义，不放入 Tooltip。

## 受控显示

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { VoexTooltip } from '@/plugins/tooltip';

const visible = ref(false);
</script>

<template>
  <VoexTooltip v-model:popup-visible="visible" content="操作说明">
    <button type="button">查看说明</button>
  </VoexTooltip>
</template>
```

不传 `popupVisible` 时由内部管理显隐；`defaultPopupVisible` 只设置初始值。受控模式需要父级接受 `update:popupVisible` 才能响应 hover、Escape 等显隐请求；单向传入固定值时保持父级状态。`disabled`、空内容仍会阻止显示。

## Props

| 属性                | 类型                    | 默认值      | 说明                                                                     |
| ------------------- | ----------------------- | ----------- | ------------------------------------------------------------------------ |
| content             | `string \| number`      | —           | 纯文本内容，`#content` 优先                                              |
| popupVisible        | `boolean`               | `undefined` | 受控显隐，支持 `v-model:popup-visible`                                   |
| defaultPopupVisible | `boolean`               | `false`     | 非受控模式初始显隐                                                       |
| position            | `TriggerPosition`       | `top`       | Floating UI 12 种方向，兼容 Trigger 的简写                               |
| disabled            | `boolean`               | `false`     | 隐藏提示并禁止触发                                                       |
| showArrow           | `boolean`               | `true`      | 显示箭头                                                                 |
| popupOffset         | `number`                | `8`         | 锚点间距，单位 px                                                        |
| mouseEnterDelay     | `number`                | `100`       | 鼠标进入延迟，单位 ms                                                    |
| mouseLeaveDelay     | `number`                | `100`       | 鼠标离开延迟，单位 ms                                                    |
| focusDelay          | `number`                | `0`         | 键盘聚焦延迟，单位 ms                                                    |
| maxWidth            | `number \| string`      | `320`       | 数值按 px；字符串接受 CSS 长度，如 `20rem`，仍受视口可用空间限制         |
| strategy            | `'absolute' \| 'fixed'` | `absolute`  | 定位策略                                                                 |
| popupContainer      | `string \| HTMLElement` | —           | 挂载容器；默认 body；锚点挂载时所在 dialog 已打开，则默认挂载到该 dialog |
| renderToBody        | `boolean`               | `true`      | 关闭时在当前位置渲染，可能受祖先 overflow 裁剪                           |
| popupZIndex         | `number`                | —           | 复用 Trigger 默认层级 300，嵌套递增；可显式覆盖                          |

`position` 支持 `top`、`bottom`、`left`、`right` 及各方向的 `-start` / `-end`；简写为 `tl/tr/bl/br/lt/lb/rt/rb`。

`id`、`class`、`style` 等额外属性透传到提示浮层；可用 class 定制外观。Tooltip 固定 `role="tooltip"`、hover 触发和空内容隐藏，完整底层选项请直接使用 `VoexTrigger`，不要依赖未声明的透传选项。

原生 `dialog` 如果保留组件挂载、之后才通过 `showModal()` 打开，需显式传入 `popup-container="#your-dialog-id"`。Trigger 的自动容器判断依赖组件响应式更新，不能单凭原生 dialog 的 open 属性变化可靠刷新；指定容器可避免提示落在 top layer 外；同时应让 dialog 自身允许浮层溢出（`overflow: visible`），长正文由内部区域滚动，避免提示被 dialog 裁剪。

## 插槽、事件与实例

- 默认插槽：锚点；`content` 插槽：提示内容。两个插槽均接收 `{ visible, show, hide, update }`，含义与 Trigger 相同。
- `update:popupVisible(visible)`：显隐更新请求。
- `popupVisibleChange(visible)`：与显隐更新请求同步触发；禁用/内容为空导致的实际隐藏不一定发出该请求。
- `show()` / `hide()` 事件：进入/退出动画结束后触发，不是显隐请求时刻。
- `positionError(error)`：定位失败。
- 组件 ref 暴露 `show()`、`hide()`、`update()`、只读 `visible`；受控模式下 show/hide 仍需父级更新绑定值。`update()` 返回定位 Promise 或尚未挂载时的 `undefined`。

## 锚点与可访问性

默认插槽第一个真实元素作为锚点，不增加布局包装。优先使用可聚焦原生 button/a/input；自定义组件必须有单一 HTMLElement 根节点并透传属性和原生事件。纯文字或多个并列元素需要由调用方显式包装为一个锚点。

显示时 Trigger 将浮层 ID 合并到锚点的 `aria-describedby`，关闭后恢复原描述；Tooltip 不添加菜单的 `aria-expanded` / `aria-controls`。它补充说明，不替代按钮名称：图标按钮仍需提供 `aria-label`，不要同时添加重复的原生 `title`。

原生 disabled 按钮无法可靠接收焦点及指针事件；需要说明禁用原因时，使用可聚焦包装并为其提供可访问名称：

```vue
<script setup lang="ts">
import { VoexTooltip } from '@/plugins/tooltip';
</script>

<template>
  <VoexTooltip content="当前没有编辑权限">
    <span tabindex="0" aria-label="保存（不可用）" style="display: inline-flex">
      <button type="button" disabled style="pointer-events: none">保存</button>
    </span>
  </VoexTooltip>
</template>
```

提示不主动抢焦点，Escape 关闭；动画继承 Trigger 的 reduced-motion 支持。避免用它承载必须依靠 Tooltip 才能发现的关键操作或信息。

## 样式

采用现有 `--color-text-primary`、`--color-bg-secondary`、`--shadow-medium`、`--border-radius-item-s`，继承应用字体；12px 字号、1.5 行高、6px × 10px 内边距。支持换行及长单词折行，亮/暗主题取决于挂载容器继承到的主题变量。局部主题容器内的锚点可通过 `popupContainer` 将提示挂载到同一主题容器。

可通过 `.voex-tooltip`、`.voex-tooltip__content`、`.voex-tooltip__arrow` 定制样式。定位、层级与默认 120ms 渐隐动画由 `VoexTrigger` 管理。
