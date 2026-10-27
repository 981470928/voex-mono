// Package app 组装应用依赖，并管理 HTTP 服务的启动和关闭。
package app

import (
	"context"                        // 创建带截止时间的上下文，限制服务关闭的等待时间。
	"fmt"                            // 格式化并构造初始化错误。
	"log"                            // 输出运行日志，并创建独立的访问日志记录器。
	"net/http"                       // 提供 HTTP 服务器和服务正常关闭时的错误标识。
	"os"                             // 提供标准输入输出相关对象及操作系统信号类型。
	"os/signal"                      // 注册和停止接收操作系统信号。
	"syscall"                        // 提供 SIGINT、SIGTERM 等信号常量。
	"time"                           // 提供秒、分钟等时间单位。
	"voex-server/internal/config"    // 读取应用配置。
	"voex-server/internal/database"  // 初始化数据库连接。
	"voex-server/internal/filestore" // 初始化文件存储及其临时目录。
	"voex-server/internal/router"    // 组装 Gin 路由和中间件。
	"voex-server/internal/security"  // 加载或创建 JWT 签名密钥。
	"voex-server/internal/service"   // 创建业务服务并注入依赖。
)

// Run 初始化应用并运行 HTTP 服务，直到服务退出或收到关闭信号。
// err 是命名返回值，初始值为 nil，可由延迟执行的函数改写。
func Run() (err error) {
	// 将匿名函数延迟到 Run 退出时执行；多个 defer 按注册顺序的逆序执行。
	defer func() {
		// recover 捕获当前 goroutine 的 panic；v 非 nil 时进入错误转换分支。
		// 此处无法捕获后面启动的 HTTP goroutine 中的 panic。
		if v := recover(); v != nil {
			// 将 panic 转换为返回错误；%T 仅记录 v 的类型，不包含其具体内容。
			err = fmt.Errorf("initialization failed (%T)", v)
		}
	}()
	// 将标准日志记录器的输出目标设置为标准错误流。
	log.SetOutput(os.Stderr)
	// 读取环境配置，得到监听地址、数据库、存储和密钥文件等设置。
	cfg := config.Read()
	readTimeout, err := time.ParseDuration(config.Env("VOEX_HTTP_READ_TIMEOUT", "2m"))
	if err != nil || readTimeout <= 0 {
		return fmt.Errorf("VOEX_HTTP_READ_TIMEOUT must be a positive duration such as 2m or 30m")
	}
	// 使用存储配置创建文件存储；:= 声明 files，并复用命名返回值 err。
	files, err := filestore.New(cfg.Storage)
	// 存储初始化返回非 nil 错误时，终止启动。
	if err != nil {
		// 添加存储初始化失败的上下文；%w 包装原始错误，保留错误链。
		return fmt.Errorf("storage initialization failed: %w", err)
	}
	// Run 退出时清理存储的进程临时目录；Close 仅删除空目录。
	defer files.Close()
	// 连接已初始化的数据库，不自动修改表结构。
	db, err := database.Open(cfg.Database)
	// 数据库初始化失败时，终止启动；此前注册的 defer 仍会执行。
	if err != nil {
		// 保留连接错误，便于诊断数据库配置。
		return fmt.Errorf("database initialization failed: %w", err)
	}
	// 从 GORM 获取底层的 *sql.DB 连接池，供退出时统一关闭。
	pool, err := db.DB()
	// 获取连接池失败时，进入错误返回分支。
	if err != nil {
		// 将获取连接池时产生的错误原样返回。
		return err
	}
	// Run 退出时关闭数据库连接池；当前代码忽略 Close 返回的错误。
	defer pool.Close()
	// 从 cfg.SecretFile 加载 JWT 签名密钥，文件不存在时创建密钥。
	// 将数据库、文件存储和密钥注入业务服务。
	business := service.New(db, files, security.LoadSecret(cfg.SecretFile))
	if err := business.ConfigureCollaboration(cfg.Collaboration); err != nil {
		return err
	}

	cleanupCtx, cancelCleanup := context.WithCancel(context.Background())
	collaborationDone := make(chan struct{})
	go func() { defer close(collaborationDone); business.RunCollaborationEvents(cleanupCtx) }()
	defer func() { cancelCleanup(); <-collaborationDone }()
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		business.RunTrashCleanup(cleanupCtx)
	}()
	defer func() {
		cancelCleanup()
		<-cleanupDone
	}()
	// 创建路由并传入业务服务。
	// log.New 创建写入标准输出的访问日志记录器，空字符串表示不添加自定义前缀。
	// 按位或运算 | 合并日志选项：LstdFlags 添加日期和时间，LUTC 使用 UTC 时区。
	routes := router.New(business, log.New(os.Stdout, "", log.LstdFlags|log.LUTC))
	// 构造 HTTP 服务器并通过 & 取得指针；此时尚未开始监听端口。
	server := &http.Server{
		// 使用配置中的主机和端口作为监听地址。
		Addr: cfg.Address,
		// 将收到的 HTTP 请求交给 routes.ServeHTTP 处理。
		Handler: routes,
		// 将 10 乘以秒单位，限制读取请求头的时间为 10 秒。
		ReadHeaderTimeout: 10 * time.Second,
		// 限制整个请求读取时间，默认 2 分钟，可通过环境变量调整。
		ReadTimeout: readTimeout,
		// 将 60 乘以秒单位，限制长连接等待下一个请求的空闲时间为 60 秒。
		IdleTimeout: 60 * time.Second,
		// 将 1 左移 20 位得到 1,048,576，设置请求头上限为 1 MiB（含请求行）。
		MaxHeaderBytes: 1 << 20,
	}
	// 创建容量为 1 的信号 channel，可暂存一个尚未被接收的操作系统信号。
	stopped := make(chan os.Signal, 1)
	// 将中断信号 SIGINT（通常来自 Ctrl+C）和终止信号 SIGTERM 投递到 stopped。
	signal.Notify(stopped, syscall.SIGINT, syscall.SIGTERM)
	// Run 退出时注销此 channel 的信号通知；Stop 不会关闭 channel。
	defer signal.Stop(stopped)
	// 创建容量为 1 的错误 channel；即使主流程转入关闭分支，服务结果仍可写入。
	done := make(chan error, 1)
	// 在新的 goroutine 中执行匿名函数，让主流程能够同时等待服务结果和退出信号。
	go func() {
		// 用 %s 输出配置的监听地址；日志发生在实际监听之前，不表示启动已经成功。
		log.Printf("[Server] Gin HTTP listening on %s", server.Addr)
		// 启动 HTTP 监听并处理请求；调用返回后，通过 <- 将返回错误发送到 done。
		done <- server.ListenAndServe()
	}()
	// 阻塞等待以下任一 channel 就绪；若同时就绪，select 选择其中一个分支。
	select {
	// 接收服务退出结果；这里的 err 仅属于此 case，不是 Run 的命名返回值。
	case err := <-done:
		// ErrServerClosed 表示服务已关闭，其他错误（如端口占用）需要向调用方报告。
		if err != http.ErrServerClosed {
			// 返回服务启动或运行过程中产生的异常错误。
			return err
		}
		// 服务正常关闭时返回 nil，表示没有需要报告的错误。
		return nil
	// 接收操作系统信号并保存为 sig，随后执行 select 后面的关闭流程。
	case sig := <-stopped:
		// 用 %s 输出本次触发关闭的信号名称。
		log.Printf("[Server] shutdown requested: %s", sig)
	}
	cancelCleanup()
	// 基于无截止时间、不会主动取消的 Background 上下文创建 25 秒超时上下文。
	// ctx 用于限制优雅关闭的等待时间，cancel 用于提前取消并释放相关资源。
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	// Run 退出时调用 cancel，释放超时上下文占用的资源。
	defer cancel()
	// 停止接收新连接并等待活动请求结束；局部 err 非 nil 时执行强制关闭分支。
	if err := server.Shutdown(ctx); err != nil {
		// 优雅关闭失败时立即关闭服务连接；当前代码忽略 Close 返回的错误。
		server.Close()
		// 记录关闭超时提示；此分支实际会在 Shutdown 返回任意非 nil 错误时执行。
		log.Print("[Server] shutdown deadline reached")
	}
	// 记录 HTTP 监听器已经关闭。
	log.Print("[Server] HTTP listener closed")
	// 信号触发的关闭流程返回 nil；即使进入过强制关闭分支，也不返回关闭错误。
	return nil
}
