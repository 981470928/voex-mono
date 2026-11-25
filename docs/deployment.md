# 手动打包

前后端可以独立构建。以下两组命令都从仓库根目录开始。

## 前端

首次使用时进入 `web/`，安装锁定的依赖，将 `.env.example` 复制为 `.env`。已有配置可直接使用。

```sh
cd web
pnpm install --frozen-lockfile
```

在 `web/.env` 填写 `VITE_BASE_PATH`（默认 `/app/`）。如果要运行开发服务，将 `VITE_API_PROXY_TARGET` 设为 Go 的监听地址。填好配置后，在当前目录构建。

```sh
npm run build
```

静态文件输出到 `web/dist/`。更改前端构建配置后重新打包。

## 后端

```sh
cd server
go build
```

当前目录生成 `voex-server`，Windows 下为 `voex-server.exe`。首次启动前，将 `.env.example` 复制为 `.env`，填写 MySQL 连接、监听地址、文件存储和签名密钥路径。已有实例应沿用原存储目录和密钥文件。

在含 `.env` 的目录运行 `./voex-server`。后续只改后端配置时，重启进程即可。要让 Go 同时提供前端页面，可在后端配置中将 `VOEX_WEB_ROOT` 设为 `web/dist/` 的绝对路径，使用默认的前端路径 `/app/`。

服务参数和可选的多人协同见[后端说明](../server/README.md)和[协同服务说明](../server/collab/README.md)。
