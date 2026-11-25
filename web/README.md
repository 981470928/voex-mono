# .

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## 本地开发与手动打包

在 `web/` 目录执行。首次安装依赖并创建前端配置：

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
```

编辑 `.env`。默认访问路径是 `/app/`，开发服务端口是 `3500`。Go API 或协同服务使用其他地址时，填写对应的开发代理地址。生产前端通过同源的 `/api` 访问后端。

开发时运行 `npm run dev`。手动打包：

```sh
npm run build
```

静态文件输出到 `dist/`。更改前端构建配置后，重新运行此命令。

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。

个人和团队可以在许可证允许的非商业用途范围内私有化部署、使用、修改和分发本项目。商业用途需另行获得权利人的授权；内网部署或团队内部使用本身不代表非商业用途。

以上仅为说明，完整授权范围、义务及例外以 [LICENSE](LICENSE) 原文为准。
