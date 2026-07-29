# Research: 中科影像开发平台（TsPlatform）

**Feature**: 001-imaging-dev-platform
**Date**: 2026-07-27

---

## 1. 飞书 OAuth 集成模式

**Decision**: OAuth 2.0 Authorization Code Grant（授权码模式），服务端 token 交换

**Rationale**:
- 客户端（Tauri WebView）打开飞书授权页，用户授权后飞书回调到服务端 `GET /api/v1/auth/feishu/callback`
- 服务端用 `client_secret` 向飞书交换 `access_token`，再调用 `user_info` 获取用户身份
- `client_secret` 仅存服务端，桌面端不接触密钥 → 安全性高
- 服务端生成 `session_token`（UUID）返回给客户端，后续请求用 Bearer token 鉴权

**Alternatives considered**:
- PKCE (Proof Key for Code Exchange): 更安全但飞书开放平台当前 API 不完全支持
- Implicit Grant: 已过时，不推荐
- 客户端直接交换 token: client_secret 会暴露在桌面端，不安全

---

## 2. 桌面端 OAuth WebView 实现

**Decision**: Tauri v2 使用系统 WebView 打开飞书授权 URL，监听导航 URL 变化拦截回调

**Rationale**:
- Tauri v2 提供 `WebviewWindow` API，可以打开外部 URL 并监听 `on_navigation` 事件
- 飞书授权完成后浏览器导航到 `FEISHU_REDIRECT_URI?code=...`，客户端拦截此 URL 中的 `code`
- 将 `code` 通过 HTTP POST 发给服务端完成 token 交换
- 不需要嵌入式 iframe（可能有安全限制），系统浏览器更可靠

**Alternatives considered**:
- Deep-link / custom protocol (`tsplatform://callback`): 需要额外配置，增加复杂度
- Embedded iframe in Tauri: 飞书可能会阻止 iframe 加载授权页（X-Frame-Options）

---

## 3. 云端服务框架选型

**Decision**: 纯 Node.js HTTP（`http.createServer`），零框架依赖，`better-sqlite3` 作数据库驱动

**Rationale**:
- 单机部署、低并发（内部工具平台），不需要 Express/Hono/Fastify 的路由和中间件系统
- 减少依赖 → 更小的 Docker 镜像（`node:20-alpine`基础镜像仅 ~50MB）
- 代码量小（290 行），手工路由和鉴权完全可控
- `better-sqlite3` 同步 API，无需处理 async/await 数据库错误，适合单用户场景

**Alternatives considered**:
- Hono: 更现代，但增加 20+ 依赖，无显著收益
- Express + Sequelize: 太重，不适合 SQLite 单机场景
- Fastify: 性能好但路由和插件系统比实际需求复杂

---

## 4. 数据同步策略

**Decision**: Push/Pull 双向增量同步，`since` 时间戳增量拉取

**Rationale**:
- 客户端 `POST /api/v1/sync/push` 将本地会话批量推送到云端
- 客户端 `GET /api/v1/sync/pull?since=<timestamp>` 拉取指定时间后的新数据
- `since` 参数实现增量同步，避免全量传输
- 冲突策略: 远程优先（remote-wins），因为云端是单一数据源。多条记录按 ID 覆盖
- 离线队列: 客户端在无网络时将待同步数据暂存本地 SQLite，恢复网络后自动重试

**Alternatives considered**:
- WebSocket 实时同步: 增加长连接管理复杂度，内网场景收益低
- CRDT (Conflict-free Replicated Data Types): 实现复杂度高，对话记录类数据不需要
- 定时轮询: 浪费带宽，体验差

---

## 5. SQLite 数据库设计

**Decision**: 单文件 SQLite，WAL 模式，外键约束开启

**Rationale**:
- 项目数据量小（内部平台，<100 用户），不需要 PostgreSQL/MySQL
- WAL (Write-Ahead Logging): 支持并发读写，性能优于默认 journal 模式
- 外键约束: 保证数据完整性（conversations.user_id → users.id）
- Docker volume 持久化: `tsplatform_data:/data` 挂载，容器重建数据不丢失
- 30 天自动清理: Docker 容器内 cron 任务定期执行 DELETE WHERE created_at < date('now', '-30 days')

**Alternatives considered**:
- PostgreSQL: 单机部署过于复杂，需要额外容器和服务
- Better-sqlite3 使用 WAL + 预编译语句 → 已有足够性能

---

## 6. Docker Compose 单机部署

**Decision**: 单服务 Docker Compose，`node:20-alpine` 基础镜像，`restart: unless-stopped`

**Rationale**:
- 单一 Node.js 进程，不需要多服务编排
- Alpine 镜像 → 最小体积（~50MB 基础 + ~30MB node_modules）
- `unless-stopped`: 自动重启但手动 stop 后不重启
- `.env` 文件管理密钥，不硬编码在 compose 文件或镜像中
- 单端口 3000，nginx 反代不必要（内网 / 个人工具场景）

**Alternatives considered**:
- Kubernetes / Swarm: 单机部署不需要编排
- Nginx 反向代理: 当前单服务可直接暴露，无负载均衡需求
- systemd 直接运行 Node.js: Docker 提供更好的隔离和可移植性

---

## 7. 离线策略

**Decision**: 离线时 Agent 不可用，仅可浏览已有本地对话记录。API 不可达时显示非阻塞错误横幅

**Rationale**:
- AI Agent 推理需要网络连接后端模型服务，离线时无法提供有意义的新对话
- 本地 SQLite 已存储历史对话，离线浏览提供价值而不需要网络
- 错误横幅而非全屏阻塞: 用户可以继续使用已有功能（查阅历史、查看工具信息）
- UI 状态管理: `online`/`offline` 全局标志控制 UI 按钮可用性

**Alternatives considered**:
- 本地 LLM 推理: 桌面端资源有限，不适合运行本地模型
- 全屏阻塞等待恢复: 用户失去对本地数据的所有访问，体验差，已被 clarification 否决

---

## 8. 工具分发模型

**Decision**: 云端代理下载，工具包托管在服务器，客户端通过 API 获取并自动安装

**Rationale**:
- 管理员通过 `POST /api/v1/admin/tools` 上传工具包到服务器 `/data/tools/`
- 用户点击下载时，客户端调用 `GET /api/v1/tools/:id/download`（待实现）获取 zip/archive
- 服务端记录下载统计 (`download_count`)
- 客户端解压到本地工具目录，更新本地工具注册表

**Alternatives considered**:
- 直接 URL 分发: 用户需要手动管理下载和安装，体验差
- Git 仓库分发: 需要安装 Git，不适合非技术用户
