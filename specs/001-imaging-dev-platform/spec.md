# TsPlatform — 中科影像开发平台

**Feature**: 001-imaging-dev-platform
**Status**: In Progress
**Input**: 基于 BitFun 二次开发的影像开发桌面智能 Agent 平台

## Clarifications

### Session 2026-07-27

- Q: 同一飞书用户在多个设备上登录时如何处理？ → A: 单设备活跃会话（新登录覆盖旧 token，旧设备 session 失效，提示重新登录）
- Q: 离线时哪些操作可用？ → A: 离线时 Agent 不可用；仅可浏览已有本地对话记录和历史数据，不可发起新对话
- Q: 工具如何分发和安装？ → A: 云端代理下载（工具包托管在服务器，用户通过 API 获取，客户端自动安装到本地）
- Q: 云端 API 或飞书 OAuth 不可达时客户端如何表现？ → A: 显示非阻塞错误横幅，允许浏览已有本地数据，阻止需要网络的操作（登录、搜索工具、新对话），自动重试连接
- Q: 对话记录、错误日志、操作日志保留多长时间？ → A: 30 天自动清理（超期云端删除，本地保留副本）

## User Stories

### US1 (P1) — 飞书登录与身份认证
用户通过飞书 OAuth 登录桌面客户端，系统验证身份后分配 session_token，支持登录态持久化和跨设备会话同步。

**Acceptance Criteria**:
- 飞书授权页在 Tauri WebView 中正常加载
- 授权回调正确解析并获取 session_token
- 本地持久化存储 session_token
- 支持 GET /api/v1/auth/session 恢复登录态
- 未登录时显示引导页面
- 登录后显示用户头像和名称
- 支持退出登录

### US2 (P2) — 工具市场
用户可以浏览、搜索、下载社区工具，对工具点赞。工具通过云端 API 代理分发，客户端自动安装到本地存储。

**Acceptance Criteria**:
- 工具列表支持按分类筛选和关键词搜索
- 工具详情页展示完整信息
- 点赞后 count 实时更新
- 管理员可发布新工具（上传工具包到服务器）
- 用户点击下载后，客户端通过 API 获取工具包并自动安装

### US3 (P3) — 个人空间
用户可以查看历史对话、操作记录、错误日志和文件管理。

**Acceptance Criteria**:
- 面板概览显示对话数和操作数
- 历史对话列表支持分页
- 错误日志按时间排序展示
- 支持文件上传

### US4 (P4) — 会话同步
桌面端与云端之间双向同步会话数据，支持离线浏览已有数据。

**Acceptance Criteria**:
- POST /api/v1/sync/push 推送本地会话到云端
- GET /api/v1/sync/pull 拉取云端会话到本地
- 离线时 Agent 不可用，仅可浏览已有本地对话记录
- 冲突检测和处理

### US5 (P5) — 管理面板
管理员可查看所有用户、错误统计、操作历史，支持用户角色管理。

**Acceptance Criteria**:
- 管理员面板显示用户列表
- 错误按类型聚合统计
- 操作日志可追溯

## Functional Requirements

### Auth
- FR-001: 飞书 OAuth 2.0 授权码流程
- FR-002: session_token 生成与验证（单设备活跃会话：新登录覆盖旧 token）
- FR-003: 用户首次登录自动注册
- FR-004: session 7 天过期，旧设备因 token 被覆盖而失效，提示重新登录
- FR-005: Bearer token 鉴权中间件

### Sync
- FR-006: 客户端推送会话数据到云端
- FR-007: 客户端从云端拉取会话数据
- FR-008: 增量同步（since 参数）

### Tools
- FR-009: 工具列表查询（分类+搜索）
- FR-010: 工具点赞/取消点赞
- FR-011: 管理员发布工具（上传工具包到服务器存储）
- FR-011a: 工具下载：客户端通过云 API 代理获取工具包并自动安装到本地

### User Space
- FR-012: 个人面板概览（对话数+操作数）
- FR-013: 历史对话列表
- FR-014: 错误日志列表
- FR-015: 文件引用记录

### Admin
- FR-016: 用户列表
- FR-017: 错误统计（按类型）
- FR-018: 操作日志记录

### Desktop
- FR-019: Tauri WebView 嵌入飞书授权页
- FR-020: 本地 SQLite 存储
- FR-021: 双模式存储（本地+云端）
- FR-022: 品牌替换（BitFun → TsPlatform）
- FR-023: API 不可达时显示非阻塞错误横幅，允许浏览本地数据，阻断网络依赖操作，支持自动重试
- FR-024: 云端数据 30 天自动清理（对话、错误日志、操作日志），超期数据删除但保留本地副本

## Success Criteria
- SC-001: Health endpoint 返回 200
- SC-002: OAuth 完整流程 <5 秒
- SC-003: 工具列表查询 <200ms
- SC-004: 会话同步单次 <100 条记录
- SC-005: 桌面端首次 cargo build 成功
- SC-006: brand-replace.ps1 无报错执行
- SC-007: API 从公网可访问
- SC-008: Docker Compose 一键部署
- SC-009: 防火墙端口正确放行
- SC-010: session_token 过期后自动失效
- SC-011: 错误日志保留完整堆栈

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop | Tauri v2 + Rust + TypeScript |
| Cloud API | Node.js 20 (HTTP, zero-framework) |
| Cloud DB | SQLite (better-sqlite3) |
| Auth | 飞书企业自建应用 OAuth 2.0 |
| Deploy | Docker Compose single-node |
| OS | Ubuntu 22.04 server, Windows client |
