# TsPlatform 任务执行计划

**Branch**: `001-imaging-dev-platform` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-imaging-dev-platform/spec.md`

---

## Summary

基于 BitFun 二次开发的影像开发桌面智能 Agent 平台。桌面端使用 Tauri v2 + Rust + TypeScript，云端使用 Node.js 20 纯 HTTP + SQLite，Docker Compose 单机部署，飞书 OAuth 登录。

---

## Technical Context

**Language/Version**: Rust (Tauri v2), TypeScript (desktop frontend), Node.js 20 (cloud API)

**Primary Dependencies**: Tauri v2, better-sqlite3, 飞书 OAuth 2.0 API

**Storage**: SQLite (better-sqlite3, WAL mode) — cloud: `/data/tsplatform.db`, desktop: local SQLite

**Testing**: Manual verification via curl (cloud API), cargo check + tsc --noEmit (desktop)

**Target Platform**: Ubuntu 22.04 server (cloud), Windows 10/11 (desktop client)

**Project Type**: Desktop app + Cloud API (monorepo)

**Performance Goals**: OAuth flow <5s, tool list query <200ms, sync batch ≤100 records

**Constraints**: Single-node Docker deployment, ≤2 GB memory, 30-day cloud data retention

**Scale/Scope**: <100 internal users, single Feishu organization

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| Simplicity | ✅ PASS | Zero-framework cloud API (290 lines), single SQLite DB, no microservices |
| Security | ✅ PASS | OAuth 2.0, client_secret server-side only, Bearer token auth on all endpoints |
| Maintainability | ✅ PASS | Monorepo structure, documented APIs in contracts/api.md, Docker Compose one-command deploy |
| Data Integrity | ✅ PASS | FK constraints, WAL journal, INSERT OR REPLACE for sync conflicts, 30-day cleanup |

No violations detected.

项目分为 **6 个阶段**，P0 必须在 P1 完成前验证通过。

```
Phase 0 (P0) → Phase 1 (P0) → Phase 2 (P1) → Phase 3 (P2) → Phase 4 (P3) → Phase 5 (P5) → Phase 6 (Polish)
  今天完成       本周完成        下周             次周            第三周          第四周         发布前
```

| 阶段 | 内容 | 优先级 | 工期 | 负责环境 |
|------|------|--------|------|----------|
| Phase 0 | 云端服务上线 | P0 | 30 分钟 | 服务器 |
| Phase 1 | 桌面端代码接入 & 品牌替换 | P0 | 1-2 天 | Windows → 服务器 |
| Phase 2 | 飞书登录集成 | P1 | 3-5 天 | 桌面端 + 服务器 |
| Phase 3 | 工具市场 | P2 | 5-7 天 | 桌面端 + 服务器 |
| Phase 4 | 个人空间 | P3 | 5-7 天 | 桌面端 + 服务器 |
| Phase 5 | 管理面板 & 操作历史 | P5 | 3-5 天 | 桌面端 + 服务器 |
| Phase 6 | 构建 & 发布 | Polish | 2-3 天 | Windows |
| Phase 7 | 飞书开放平台配置 | 前置依赖 | 1 小时 | 飞书后台 |

---

## Phase 0 — 云端服务上线（P0，可在服务器上直接执行）

### 目标

让 Cloud REST API 在 `http://122.51.90.193:3000` 上可用，飞书 OAuth 可正常回调。

### 环境现状

| 检查项 | 状态 |
|--------|------|
| 仓库已克隆 `~/workspace/tsplatform-deploy` | ✅ |
| `.env` 飞书凭证已配置 | ✅ |
| Docker 已安装 | ✅ |
| 容器未启动 | ❌ |
| 防火墙端口未开放 | ❌ |

### 执行步骤

**Step 0.1** — 修复 docker-compose.yml（移除过时的 `version` 字段）

```bash
cd ~/workspace/tsplatform-deploy
sed -i '/^version:/d' docker-compose.yml
```

**Step 0.2** — 构建并启动服务

```bash
docker compose up -d --build
```

**Step 0.3** — 验证容器状态

```bash
docker compose ps
# 预期: tsplatform-server 状态为 Up
docker compose logs --tail=20
# 预期: 看到 "TsPlatform API running on port 3000" 和 "Database initialized"
```

**Step 0.4** — 验证 API

```bash
curl http://localhost:3000/api/v1/health
# 预期: {"status":"ok","timestamp":"2026-07-27T..."}
```

**Step 0.5** — 开放防火墙

```bash
sudo ufw allow 3000/tcp
sudo ufw status verbose | grep 3000
```

**Step 0.6** — 外部验证（从 Windows 机器）

```powershell
curl http://122.51.90.193:3000/api/v1/health
```

**Step 0.7** — 测试飞书授权链接

```bash
curl http://localhost:3000/api/v1/auth/feishu/authorize | jq .
# 预期: 返回 redirect_url 字段
```

### 成功标准
- [ ] `GET /api/v1/health` 返回 `{"status":"ok"}`
- [ ] 从公网可访问 `http://122.51.90.193:3000/api/v1/health`
- [ ] 飞书授权跳转链接可以正常生成

### 常见问题

| 问题 | 排查方法 |
|------|---------|
| 端口冲突 | `sudo lsof -i :3000` 检查谁占用了端口 |
| Docker 未启动 | `sudo systemctl start docker` |
| 构建失败 | `docker compose logs cloud-server` 查看构建日志 |
| 防火墙阻止 | 检查云服务商安全组是否也开启了 3000 端口 |

---

## Phase 7 — 飞书开放平台配置（前置依赖，可与 Phase 0 并行）

### 目标

确保飞书 OAuth 登录流程可以跑通。

### 操作步骤

**Step 7.1** — 登录 [飞书开放平台](https://open.feishu.cn) 进入你的企业自建应用

**Step 7.2** — 在「安全设置」中配置重定向 URL：

```
http://122.51.90.193:3000/api/v1/auth/feishu/callback
```

**Step 7.3** — 确保应用已发布、对组织成员可见

**Step 7.4** — 验证 OAuth 流程（Phase 0 完成后）：

1. 浏览器访问 `http://122.51.90.193:3000/api/v1/auth/feishu/authorize` 拿 redirect_url
2. 浏览器打开 redirect_url → 飞书授权页 → 同意授权
3. 回调到服务器 → 返回 `session_token` + 用户信息
4. 用 session_token 调 `GET /api/v1/auth/session` 验证登录态

### 成功标准
- [ ] 飞书用户可以通过 OAuth 登录并获得 session_token

---

## Phase 1 — 桌面端代码接入 & 品牌替换（P0，需要 Windows 开发机）

### 目标

将 Windows 上的 `E:\workspace\TsPlatform` 完整代码推到服务器，执行品牌替换，验证能编译通过。

### 前置条件
- [x] `.env` 已配置飞书凭证

### 执行步骤

**Step 1.1** — 从 Windows 推送源代码到服务器

```powershell
# 在 Windows PowerShell 中执行
scp -o PubkeyAuthentication=no -r E:\workspace\TsPlatform ubuntu@122.51.90.193:/home/ubuntu/workspace/
```

预计耗时取决于项目大小（交接文档提到 5000+ 源文件），约 5-15 分钟。

**Step 1.2** — 校验推送完整性

```bash
# 在服务器上
ls ~/workspace/TsPlatform/
# 预期: src/ packages/ docker/ scripts/ 等目录存在
diff <(cd ~/workspace/TsPlatform && find . -type f | sort) <(ssh ...) # 非必需，大项目跳过
```

**Step 1.3** — 在 Windows 上执行品牌替换

```powershell
# 在 Windows PowerShell 中执行
E:\workspace\TsPlatform\scripts\brand-replace.ps1
```

**Step 1.4** — 安装依赖（服务器端）

```bash
# 在服务器上
cd ~/workspace/TsPlatform
# 安装 Node.js 依赖
npm install -g pnpm   # 如果没有 pnpm
pnpm install
```

**Step 1.5** — 验证编译通过

```bash
# 在服务器上
cd ~/workspace/TsPlatform
cargo build          # Rust/Tauri 编译
cd packages/cloud-server && npm install && cd ../..
```

> **注意**: `cargo build` 可能需要安装 Rust 工具链和系统依赖（`libwebkit2gtk-4.1-dev` 等），首次构建时间较长（可能 20-60 分钟）。如果只想验证云端服务：

```bash
cd ~/workspace/TsPlatform/packages/cloud-server
npm install
npx tsc --noEmit    # TypeScript 类型检查
```

**Step 1.6** — 验证前端构建（可选，如果前端代码完整）

```bash
pnpm build    # 在 desktop 前端目录执行
```

### 成功标准
- [ ] 全部源代码在服务器上可访问
- [ ] 品牌替换脚本执行无报错
- [ ] `cargo build` 或 `tsc --noEmit` 编译/类型检查通过

### 风险

| 风险 | 缓解措施 |
|------|---------|
| scp 传输中断 | 使用 `rsync -avz --progress -e "ssh -o PubkeyAuthentication=no"` 替代，支持断点续传 |
| Rust 编译缺少系统依赖 | 参考 Tauri v2 文档安装 `libwebkit2gtk-4.1-dev` 等依赖 |
| 品牌替换脚本执行错误 | 检查 PowerShell 执行策略 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Windows 项目路径层级不同 | 只需推送项目根目录；不要推送 `node_modules/` 和 `target/` |

---

## Phase 2 — 飞书登录 UI（P1）

### 目标

桌面客户端（Tauri）支持飞书登录，登录后会话同步到云端。

### 任务清单（参考 `tasks.md` US1: T022-T043）

| 任务 | 内容 | 依赖 |
|------|------|------|
| T022-T025 | 飞书 OAuth 嵌入桌面端（WebView 方式） | Phase 0 |
| T026-T030 | 登录后本地存储 session_token | Phase 0 |
| T031-T035 | 双模式存储（本地 SQLite + 云端同步） | T026 |
| T036-T040 | 登录状态 UI（头像 + 名称 + 退出） | T031 |
| T041-T043 | 未登录时引导页 | T036 |

### 执行步骤

1. 把 `API_BASE_URL` 指向 `http://122.51.90.193:3000`
2. 在 Tauri WebView 中打开飞书授权页
3. 回调拦截 → 调 `/api/v1/auth/feishu/callback` → 获取 session_token
4. 本地存储 session_token
5. 调 `/api/v1/auth/session` 恢复登录态
6. 调 `/api/v1/sync/push` 同步本地会话到云端
7. 调 `/api/v1/sync/pull` 拉取云端会话到本地

### 验证

- [ ] 飞书授权页在 Tauri WebView 中正常加载
- [ ] 登录成功后 UI 显示用户头像和名称
- [ ] `GET /api/v1/users/me/dashboard` 返回用户数据
- [ ] 退出登录后 UI 回到引导页

---

## Phase 3 — 工具市场（P2）

### 目标

用户可浏览、搜索、下载社区工具，可点赞。

### 任务清单（参考 `tasks.md` US2: T044-T065）

| 任务 | 内容 | 依赖 |
|------|------|------|
| T044-T048 | 工具列表 UI（带搜索、分类筛选） | Phase 1 |
| T049-T055 | 工具详情页 + 下载 | T044 |
| T056-T060 | 点赞功能（调用 API like 接口） | T044 |
| T061-T065 | 管理员发布工具（调 `/api/v1/admin/tools`） | Phase 2 |

### API 接口（已实现）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/tools?category=...&search=...` | 浏览工具（按分类/搜索） |
| POST | `/api/v1/tools/:id/like` | 点赞 |
| POST | `/api/v1/admin/tools` | 管理员发布工具 |

### 验证

- [ ] 工具列表正常展示
- [ ] 搜索和分类筛选正常工作
- [ ] 点赞后 count 增加
- [ ] 管理员可以发布新工具

---

## Phase 4 — 个人空间（P3）

### 目标

用户可查看历史对话、操作记录、错误日志、上传文件。

### 任务清单（参考 `tasks.md` US3: T066-T078）

| 任务 | 内容 | 依赖 |
|------|------|------|
| T066-T070 | 历史对话列表 + 详情 | Phase 2 |
| T071-T074 | 文件上传与管理 | Phase 2 |
| T075-T078 | 错误日志展示 | Phase 2 |

### API 接口（已实现）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/users/me/dashboard` | 面板概览 |
| GET | `/api/v1/users/me/conversations` | 历史对话 |
| GET | `/api/v1/users/me/errors` | 错误日志 |

### 验证

- [ ] 对话历史分页展示
- [ ] 文件上传成功
- [ ] 错误日志按时间排序

---

## Phase 5 — 管理面板 & 操作历史（P5）

### 目标

管理员可查看所有用户、错误统计，用户操作历史可追溯。

### 任务清单（参考 `tasks.md` US5: T079-T088）

| 任务 | 内容 | 依赖 |
|------|------|------|
| T079-T082 | 管理员面板 UI（用户列表 + 错误统计） | Phase 2 |
| T083-T086 | 操作日志记录 + 展示 | Phase 2 |
| T087-T088 | 用户角色管理 | T079 |

### API 接口（已实现）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/users` | 用户列表 |
| GET | `/api/v1/admin/errors` | 错误列表 + 按类型统计 |

### 验证

- [ ] 管理员可见用户列表
- [ ] 错误按类型聚合展示
- [ ] 操作日志实时更新

---

## Phase 6 — 安装包构建 & 自动更新（Polish）

### 目标

生成 Windows 安装包，支持自动更新检查。

### 任务

1. Tauri 打包配置（图标、签名、Windows Installer）
2. 集成 `/api/v1/updates/latest` 做版本检查
3. 在各 Windows 版本上进行安装测试

### 验证

- [ ] `pnpm tauri build` 成功生成 `.msi` 安装包
- [ ] 安装后应用正常启动
- [ ] 版本更新检查功能正常

---

## 运维手册

### 日常命令速查

```bash
# 查看服务状态
docker compose ps
docker compose logs -f          # 实时日志
docker compose logs --tail=50   # 最近 50 行

# 重启
docker compose restart

# 更新部署（代码有变更时）
cd ~/workspace/tsplatform-deploy
git pull
docker compose up -d --build

# 进入容器调试
docker compose exec cloud-server sh
ls /data/                        # 查看数据库文件
sqlite3 /data/tsplatform.db ".tables"

# 设置管理员
docker compose exec cloud-server sqlite3 /data/tsplatform.db \
  "UPDATE users SET role='admin' WHERE feishu_open_id='ou_xxx';"

# 数据库备份
docker compose exec cloud-server cp /data/tsplatform.db /data/tsplatform.db.bak
```

### 如果服务挂了

```bash
docker compose restart   # 先尝试重启
docker compose down && docker compose up -d --build   # 如果不行，重建
```

### 推送代码到 GitHub

```bash
cd ~/workspace/TsPlatform        # 桌面端代码
git add -A && git commit -m "..." && git push

cd ~/workspace/tsplatform-deploy  # 部署包
git add -A && git commit -m "..." && git push
```

---

## 关键风险

| 风险 | 影响 | 概率 | 缓解 |
|------|------|------|------|
| 飞书应用审核不通过 | 无法登录 | 中 | 提前在开放平台提交审核 |
| 桌面端编译失败（系统依赖缺失） | Phase 1 阻塞 | 中 | 提前安装 Tauri v2 系统依赖 |
| scp 传输大文件失败 | 代码推不上服务器 | 低 | 改用 rsync 或 git clone |
| Rust 工具链未安装 | cargo build 失败 | 高 | 服务器需安装 `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| 服务器磁盘不足 | Docker 构建失败 | 低 | `df -h` 检查磁盘空间 |
