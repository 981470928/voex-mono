# Vode - 技术栈

## 框架与核心

- **Vue 3.5** + **TypeScript 6.0**
- **Vite 8** 构建，base 路径 `/test/`
- **Node.js** `^22.18.0 || >=24.12.0`
- 包管理器：**pnpm**

## 路由与状态

- **Vue Router 4.6**
- **Pinia 4.0**

## 富文本编辑器

- **Milkdown 7.22**（@milkdown/crepe + @milkdown/kit + @milkdown/theme-nord + @milkdown/vue）

## UI 与图标

- **Remix Icon**（@remixicon/vue）
- 标题的补充解释统一放在标题后的圆圈问号图标中，使用 `VoexTooltip` 在 hover 或键盘聚焦时显示；图标使用可聚焦的原生 button 并提供中文 `aria-label`。不要重复铺开展示同一段说明，操作风险、错误及必须直接可见的信息仍保留在正文。

## 样式

- **Stylus**

1. 遵守BEM规则
2.

## HTTP 请求

- **Axios**，baseURL `/api`，代理到 `http://127.0.0.1:8090`

## 代码规范

- **ESLint 10** + **Prettier 3.9**
- eslint-plugin-vue、typescript-eslint、eslint-config-prettier

## 开发工具

- **vue-tsc** 类型检查
- **vite-plugin-vue-devtools**
