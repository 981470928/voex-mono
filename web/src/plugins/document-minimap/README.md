# Document Minimap

独立的 Vue + DOM 导航组件。唯一入口为 `src/plugins/document-minimap/index.ts`。

- `DocumentMinimap.vue`：右侧 sticky 轨道、主题、响应式布局及挂载/卸载。
- `controller.ts`：MutationObserver / ResizeObserver、约 180ms 合并调度与 idle 回调、块级差量同步和键盘导航。
- `clone.ts`：普通 DOM 浅克隆后递归；匹配复杂节点时立即生成等尺寸占位符，不遍历或克隆其子树。
- `vendor/`：保留 MIT LICENSE 的 dom-minimap 0.6.0 本地适配源码；不是 node_modules 补丁，无新增 npm 依赖。
- `src/views/edit/milkdown/editor-minimap.ts`：Milkdown 节点选择器与忽略规则；通用组件不依赖 Milkdown / ProseMirror。

## 接入

组件接收 `sourceRoot`、`active`、`contentSelector`、`placeholders`、`ignoreSelectors`，通过 `availability` 通知宿主分配右侧一列。`active` 只控制引擎生命周期，不改变已经分配的列宽，避免加载时跳动。宿主仅在手机端不挂载该组件，平板沿用桌面逻辑，不提供手机端交互或窄屏适配。当前桌面视口至少 1100px 且宿主至少 1000px 时显示，轨道默认 112px；窄屏销毁引擎。

默认以最近的纵向 overflow auto/scroll 祖先为滚动容器，找不到时使用页面滚动。主编辑器继续持有正文与滚动；缩略图只读取 DOM 并调整 scrollTop，不派发编辑事务、序列化 Markdown 或访问保存接口。复制品 inert / aria-hidden，不提供重复的编辑、链接或媒体操作。

## 更新与导航

首次可用时 idle 构建；单个段落的文本和格式变化只替换对应顶层块。插入/删除通过 DOM identity 计算变化范围，相邻脏块合并；常规宽度变化让普通文本自然重排，只重新测量复杂占位。复杂节点内部的光标、选择、表格手柄等 UI 变化忽略，真实尺寸改变由 ResizeObserver 更新。滚动使用库内缓存几何和 transform，不复制正文；开发环境根元素 data-minimap-builds / patches / blocks 可用于手动核对更新行为。

点击或拖拽轨道定位，拖动视口框保留抓取位置；滚轮继续滚动正文；Tab 可聚焦，方向键、Page Up / Down、Home / End 支持非拖动导航。沿用 dom-minimap 的 fit 视图：长文档的缩略内容随正文滚动；点击按实际可见缩略内容的缩放与平移反算正文坐标，将目标置于正文视口中部，首尾自然夹紧。拖动距离按缩略内容实际可移动范围换算，不把未铺满轨道的空白计入。所有监听、observer、idle、timeout、RAF 和临时 aria-controls ID 在销毁时清理。

DOM 方案仍保留一份普通文本的缩略 DOM；超长的纯文本并非虚拟渲染。这里不承诺无界文档大小或未经测量的帧率。
