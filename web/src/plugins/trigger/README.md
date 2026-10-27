# VoexTrigger

基于 `@floating-ui/dom@1.8.0` 的 Vue 3 弹层基础组件，定位复用 `src/composables/useFloating.ts`。参考 EdTrigger 的公开交互接口，使用 Vue SFC，不需要 JSX 插件。

## 使用

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { VoexTrigger } from '@/plugins/trigger';

const visible = ref(false);
</script>

<template>
  <VoexTrigger
    v-model:popup-visible="visible"
    trigger="click"
    position="bottom-start"
    :popup-offset="8"
    show-arrow
  >
    <button type="button">打开操作</button>
    <template #content="{ hide }">
      <div style="padding: 12px">
        <button type="button" @click="hide">关闭</button>
      </div>
    </template>
  </VoexTrigger>
</template>
```

默认插槽的第一个元素是定位锚点，会合并事件、class、ARIA 和原有 ref，不增加 DOM 包装。自定义锚点组件应提供单一 HTMLElement 根节点并透传原生事件/属性。优先使用 button、a、input 等可聚焦原生元素。

`content` 插槽和默认插槽都可获取 `{ visible, show, hide, update }`。组件通过 ref 暴露相同方法及 `referenceRef`、`popupRef`。没有传 `popupVisible` 时由组件管理状态，可用 `defaultPopupVisible` 设置初始值；传入后，父级必须通过 `update:popupVisible` 更新状态，拒绝更新时弹层保持父级给定状态。

## 行为

- `trigger` 支持 `hover`、`click`、`focus`、`contextMenu` 及数组。默认 hover，同时支持键盘焦点；默认 `fallbackTrigger="click"` 让触屏和笔输入可打开。
- Hover 进出延迟默认 100ms，支持 `popupHoverStay`；Focus 可从锚点移入弹层，不会误关。`focusDelay` 默认为 0。
- 点击外部和 Escape 默认关闭；嵌套弹层内部点击不会关闭祖先，Escape 优先关闭最内层，弹层内焦点在关闭时返回锚点。
- `contextMenu` 支持右键、ContextMenu 键及 Shift+F10。`alignPoint` 使用 viewport 坐标，重复右键会移动已打开弹层。
- `position` 支持 Floating UI 的 12 种 placement，也兼容 `tl/tr/bl/br/lt/lb/rt/rb`。`popupOffset` 控制间距，`popupTranslate` 支持 `[x,y]` 或按最终方向分别设置。
- `autoFitPosition` 默认启用 flip、shift 和可用空间限制。`autoFitPopupWidth`/`autoFitPopupMinWidth` 可匹配锚点宽度，`showArrow` 使用 arrow middleware。
- `autoFixPosition` 和 `updateAtScroll` 默认开启，分别处理尺寸/布局变化与祖先滚动。`strategy` 支持 `absolute`（默认）及 `fixed`。
- 默认 Teleport 到 body；锚点在原生打开的 dialog 内时挂到该 dialog，保持 top layer 的可见性与交互。`popupContainer` 可指定选择器/HTMLElement；`renderToBody=false` 保持在当前 DOM 层级。
- `unmountOnClose=true` 默认在退出动画后移除内容；设为 false 保留表单状态。`disabled` 隐藏弹层并阻止触发；`hideEmpty` 可隐藏空插槽。
- `preventFocus` 阻止弹层 mousedown 抢焦点。`popupStyle`、`contentStyle`、`arrowStyle` 及 class 属性支持定制；定位的 position/left/top 由 hook 管理。
- 默认浮层层级为 300，嵌套依次增加，可用 `popupZIndex` 覆盖。内容使用现有主题变量、圆角和阴影；默认渐隐动画遵循 reduced motion。
- 事件包括 `update:popupVisible`、`popupVisibleChange`、动画结束后的 `show`/`hide`、锚点尺寸变化的 `resize`，以及定位失败的 `positionError`。

这是通用非模态弹层。菜单的方向键导航、Listbox 选择逻辑等由内容组件管理。传入 `role="tooltip"` 时锚点关联 `aria-describedby`；其他场景提供 `aria-expanded` 和 `aria-controls`，内容角色和可访问名称由使用方按实际用途设置。

## useFloating

```vue
<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { flip, offset, shift } from '@floating-ui/dom';
import { useFloating } from '@/composables/useFloating';

const anchor = ref<HTMLElement>();
const popup = ref<HTMLElement>();
const open = ref(false);
const floating = useFloating();

async function show() {
  open.value = true;
  await nextTick();
  if (!anchor.value || !popup.value) return;
  floating.init(anchor.value, popup.value, {
    placement: 'bottom-start',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });
  floating.show();
}

function hide() {
  floating.hide();
  open.value = false;
}
</script>

<template>
  <button ref="anchor" type="button" @click="show">打开</button>
  <Teleport to="body">
    <div v-if="open" ref="popup" style="position: absolute; width: max-content; top: 0; left: 0">
      <button type="button" @click="hide">关闭</button>
    </div>
  </Teleport>
</template>
```

- `init(reference, floating, options)` 支持 Element 或 VirtualElement，初始化测量元素，不控制其 DOM 渲染。
- `show()` 开始自动定位，`hide()` 停止监听，`update()` 手动更新；`setOptions()` 合并配置并重建活动监听。
- `destroy()` 清理引用与监听；Vue scope 销毁自动执行。
- 暴露只读 `visible/isPositioned/position/error` 和 `floatingStyle`；定位结果同时写入浮层内联样式。
- `autoUpdate: false` 可关闭自动监听；传对象可配置 Floating UI 的 AutoUpdateOptions。
- 暴露 `virtualElement` 和 `generateGetBoundingClientRect(x, y, width, height)`，坐标使用 clientX/clientY。虚拟元素可以设置 `contextElement`，供滚动/裁剪边界计算使用。
- 异步定位带请求序号，隐藏、重新初始化或销毁后忽略旧结果。错误保存在 `error` 并交给可选 `onError` 回调。

官方 API：[computePosition](https://floating-ui.com/docs/computePosition)、[autoUpdate](https://floating-ui.com/docs/autoUpdate)。
