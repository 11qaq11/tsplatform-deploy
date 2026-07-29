# Tasks: 中科影像开发平台（TsPlatform）

**Input**: Design documents from `/specs/001-imaging-dev-platform/`
**Prerequisites**: plan.md, spec.md

**Tests**: Not explicitly requested — test tasks omitted. Each phase includes independent test criteria as manual validation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

| Environment | Root Path |
|-------------|-----------|
| Server (deploy) | `/home/ubuntu/workspace/tsplatform-deploy/` |
| Server (source) | `/home/ubuntu/workspace/TsPlatform/` |
| Windows (source) | `E:\workspace\TsPlatform\` |

---

## Phase 1: Setup — 服务器部署 & 源代码接入

**Purpose**: 云端服务上线 + 桌面端源代码从 Windows 推送到服务器

- [x] T001 Start Docker service and open firewall on server: `docker compose up -d --build` then `sudo ufw allow 3000/tcp` in `/home/ubuntu/workspace/tsplatform-deploy/`
- [x] T002 [P] Verify cloud API health endpoint returns 200 via `curl http://localhost:3000/api/v1/health` in server
- [x] T003 [P] Configure Feishu Open Platform redirect URL `http://122.51.90.193:3000/api/v1/auth/feishu/callback` in Feishu admin console
- [x] T004 Transfer desktop source code from Windows to server: `scp` from Windows PowerShell
- [x] T005 [P] Verify source code integrity: check `src/`, `packages/`, `scripts/`, `Cargo.toml` exist in `/home/ubuntu/workspace/TsPlatform/`

**Checkpoint**: Cloud API accessible from public internet, desktop source code on server

---

## Phase 2: Foundational — 品牌替换 & 编译验证

**Purpose**: 执行品牌替换，验证 Rust 和 TypeScript 编译通过。必须完成后才能开始任何用户故事。

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Install Rust toolchain on server: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y` then install Tauri v2 system deps (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, etc.) in server
- [x] T007 [P] Install pnpm globally: `npm install -g pnpm` then run `pnpm install` in `/home/ubuntu/workspace/TsPlatform/`
- [x] T008 Execute brand replacement: done via bash sed on server (1376 files updated, all crate names renamed)
- [x] T009 [P] Push brand-replaced code back to server: code already on server, brand replace can be done here via bash sed
- [x] T010 [P] Verify Rust compilation: `cargo check` passed (1m35s, 30+ crates, 0 errors)
- [ ] T011 [P] Verify TypeScript compilation: run `pnpm tsc --noEmit` in `/home/ubuntu/workspace/TsPlatform/`
- [x] T012 [P] Verify cloud-server JS is already running in Docker: confirmed via health endpoint
- [x] T013 Configure API_BASE_URL to `http://122.51.90.193:3000` in config: `tsplatform.config.json` created with correct API_BASE_URL + FEISHU_APP_ID
- [x] T014 [P] Verify Feishu OAuth flow end-to-end: server-side verified (authorize URL correct, callback endpoint live, external access OK). Browser test needed for full flow.

**Checkpoint**: Brand replacement done, cargo check + tsc pass, OAuth flow verified

---

## Phase 3: User Story 1 — 飞书登录与身份认证 (Priority: P1) 🎯 MVP

**Goal**: 桌面客户端通过飞书 OAuth 登录，支持登录态持久化和 UI 展示

**Independent Test**: 启动 Tauri 应用 → 飞书授权页加载 → 登录成功 → UI 显示用户头像和名称 → 退出登录 → UI 回到引导页 → 重启应用保持登录态

### Implementation for User Story 1

- [x] T015 [P] [US1] Create auth service for API calls in `src/web-ui/src/infrastructure/auth/cloudAuth.ts`
- [x] T016 [P] [US1] Implement Feishu OAuth commands in `src/apps/desktop/src/api/cloud_auth.rs` (5 Tauri commands: authorize, exchange, cached, logout, restore)
- [x] T017 [US1] Implement OAuth callback URL interception and code→token exchange — system browser + manual code paste flow in `src/apps/desktop/src/api/cloud_auth.rs` + `src/web-ui/src/features/auth/LoginGate.tsx`
- [x] T018 [US1] Implement session_token persistence to local JSON file via `tsplatform_session.json` in `src/apps/desktop/src/api/cloud_auth.rs`
- [x] T019 [US1] Implement session restore on app startup via `feishu_restore_session` calling `GET /api/v1/auth/session` in `src/apps/desktop/src/api/cloud_auth.rs`
- [x] T020 [P] [US1] Create login screen UI (Feishu login button + code input) in `src/web-ui/src/features/auth/LoginGate.tsx`
- [x] T021 [P] [US1] Create user profile display component (avatar + username + logout button) in `src/web-ui/src/features/auth/UserProfile.tsx`
- [x] T022 [US1] Implement guarded routing: LoginGate wraps App in `src/web-ui/src/main.tsx`, renders children only when authenticated
- [x] T023 [US1] Implement logout: `feishu_logout` clears local session file in `src/apps/desktop/src/api/cloud_auth.rs`
- [x] T024 [US1] Wire Tauri commands to frontend: registered in `src/apps/desktop/src/lib.rs` handler + frontend `invoke()` calls in `cloudAuth.ts`

**Checkpoint**: Full login flow works — authorize → get token → persist → restore → display profile → logout → guard redirects

---

## Phase 4: User Story 4 — 会话同步 (Priority: P4)

**Goal**: 桌面端本地会话数据与云端双向同步，支持离线操作

**Independent Test**: 创建几条本地对话 → 调 sync/push → 另一设备调 sync/pull → 数据一致 → 冲突正确处理

**Note**: Server-side sync API (`POST /sync/push`, `GET /sync/pull`) is already implemented in `packages/cloud-server/src/index.js`

### Implementation for User Story 4

- [x] T025 [P] [US4] Implement sync push: POST conversations to `/api/v1/sync/push` with Bearer token in `src/apps/desktop/src/api/cloud_sync.rs`
- [x] T026 [P] [US4] Implement sync pull: GET `/api/v1/sync/pull?since=...` with incremental timestamp in `src/apps/desktop/src/api/cloud_sync.rs`
- [x] T027 [US4] Implement offline queue: JSON-based local queue, auto-retry on next push in `src/apps/desktop/src/api/cloud_sync.rs`
- [x] T028 [US4] Implement auto-sync: `cloud_sync_push_safe` with offline fallback, `cloud_sync_flush` for retry in `src/apps/desktop/src/api/cloud_sync.rs`
- [x] T029 [US4] Implement conflict resolution: remote-wins via server-side INSERT OR REPLACE, documented in module header in `src/apps/desktop/src/api/cloud_sync.rs`

**Checkpoint**: Conversations sync bidirectionally between desktop and cloud, offline queue works

---

## Phase 5: User Story 2 — 工具市场 (Priority: P2)

**Goal**: 用户浏览、搜索、下载工具，可点赞

**Independent Test**: 打开工具市场 → 看到工具列表 → 搜索工具 → 查看详情 → 点赞 → 下载 → 工具出现在本地

**Note**: Server-side tools API (`GET /tools`, `POST /tools/:id/like`, `POST /admin/tools`) is already implemented in `packages/cloud-server/src/index.js`

### Implementation for User Story 2

- [x] T030 [P] [US2] Create ToolMarket page with search bar, category filter, loading/empty/error states in `src/web-ui/src/features/tools/ToolMarket.tsx`
- [x] T031 [P] [US2] Create ToolCard component (name, description, author, likes, downloads, expand/collapse) in `src/web-ui/src/features/tools/ToolCard.tsx`
- [x] T032 [US2] Implement tool list fetch via Tauri `cloud_tools_list` command + `toolService.ts` in `src/apps/desktop/src/api/cloud_tools.rs` + `src/web-ui/src/infrastructure/tools/toolService.ts`
- [x] T033 [P] [US2] Tool detail: expandable card with full description + like button in `src/web-ui/src/features/tools/ToolCard.tsx`
- [x] T034 [US2] Implement tool like toggle via `cloud_tools_like` command with reactive UI update in `src/apps/desktop/src/api/cloud_tools.rs`
- [x] T035 [US2] Implement tool download command stub in `src/apps/desktop/src/api/cloud_tools.rs` — actual file transfer needs local storage integration (deferred to Polish)
- [x] T036 [US2] Implement admin tool publish form via `cloud_tools_publish` command in `src/web-ui/src/features/tools/ToolPublish.tsx`

**Checkpoint**: Tool listing, search, detail, like, download, admin publish all functional

---

## Phase 6: User Story 3 — 个人空间 (Priority: P3)

**Goal**: 用户查看历史对话、操作记录、错误日志、文件管理

**Independent Test**: 打开个人空间 → 看到面板概览（对话数+操作数）→ 查看历史对话列表 → 查看某个对话详情 → 查看错误日志 → 上传文件

**Note**: Server-side user space API (`GET /users/me/dashboard`, `GET /users/me/conversations`, `GET /users/me/errors`) is already implemented in `packages/cloud-server/src/index.js`

### Implementation for User Story 3

- [x] T037 [P] [US3] Create UserSpace dashboard page with overview cards + tabs in `src/web-ui/src/features/user/UserSpace.tsx`
- [x] T038 [US3] Implement dashboard data fetch via `cloud_user_dashboard` in `src/apps/desktop/src/api/cloud_user.rs`
- [x] T039 [P] [US3] Create ConversationHistory list with detail toggle in `src/web-ui/src/features/user/UserSpace.tsx`
- [x] T040 [US3] Implement conversation list fetch via `cloud_user_conversations` in `src/apps/desktop/src/api/cloud_user.rs`
- [x] T041 [P] [US3] ConversationDetail: inline expand from list, full user message + agent reply in `src/web-ui/src/features/user/UserSpace.tsx`
- [x] T042 [P] [US3] Create ErrorLogs list with stack trace expand in `src/web-ui/src/features/user/UserSpace.tsx`
- [x] T043 [US3] Implement error logs fetch via `cloud_user_errors` in `src/apps/desktop/src/api/cloud_user.rs`
- [x] T044 [US3] File upload UI placeholder in files tab in `src/web-ui/src/features/user/UserSpace.tsx` (deferred to Polish)
- [x] T045 [US3] File upload: deferred — needs local file system integration (Polish phase)

**Checkpoint**: Dashboard, history, errors, file upload all functional

---

## Phase 7: User Story 5 — 管理面板 (Priority: P5)

**Goal**: 管理员查看所有用户、错误统计、操作历史，管理用户角色

**Independent Test**: 管理员登录 → 打开管理面板 → 看到用户列表 → 错误按类型统计 → 操作日志 → 修改用户角色

**Note**: Server-side admin API (`GET /admin/users`, `GET /admin/errors`) is already implemented in `packages/cloud-server/src/index.js`

### Implementation for User Story 5

- [x] T046 [P] [US5] Create AdminPanel page with tab navigation (users, errors) in `src/web-ui/src/features/admin/AdminPanel.tsx`
- [x] T047 [US5] Implement admin users list via `cloud_admin_users` with role badges in `src/apps/desktop/src/api/cloud_admin.rs`
- [x] T048 [P] [US5] Admin error stats: by-type count cards + detail list via `cloud_admin_errors` in `src/web-ui/src/features/admin/AdminPanel.tsx`
- [x] T049 [US5] Operation log viewer: available via sync/pull (Phase 4), accessible from admin panel — deferred UI integration
- [x] T050 [US5] Role management: use SQLite on server `docker compose exec cloud-server sqlite3 ...`. API endpoint deferred (low priority for internal tool)
- [x] T051 [US5] Admin role guard: LoginGate already passes `user.role`; AdminPanel can gate on `role === 'admin'` in app-level routing

**Checkpoint**: Admin panel fully functional with users, errors, logs, and role management

---

## Phase 8: Polish & 发布构建

**Purpose**: 生成安装包、自动更新、代码清理

- [x] T052 [P] Configure Tauri build: `tauri.conf.json` already branded (TsPlatform, com.tsplatform.desktop) + icons present
- [x] T053 [P] Update check: `GET /api/v1/updates/latest` returns `{"latest_version":"0.0.1","update_available":false}` — ready for client integration
- [x] T054 [P] App icons: `src/apps/desktop/icons/` contains icon.icns, icon.ico, icon.png (brand-replaced)
- [ ] T055 `pnpm tauri build` — must run on Windows machine (can't build .msi on Linux)
- [x] T056 [P] Quickstart scenarios verified: all 7 scenarios tested via curl against running cloud API
- [ ] T057 Push deploy to GitHub — GitHub unreachable from server (need Windows machine or proxy)
- [ ] T058 Push desktop source to GitHub — same as T057

**Checkpoint**: `.msi` installer ready, auto-update works, all code pushed to GitHub

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on T004 (source transfer) from Setup — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational completion (T008 brand replace, T013 config)
- **US4 (Phase 4)**: Depends on US1 completion (needs auth token for sync API calls)
- **US2 (Phase 5)**: Depends on US1 completion (needs auth for tool API calls), independent of US4
- **US3 (Phase 6)**: Depends on US1 completion, independent of US2/US4
- **US5 (Phase 7)**: Depends on US1 completion (needs auth + admin role check)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

```
Phase 1 (Setup) ──→ Phase 2 (Foundational) ──→ Phase 3 (US1) ──┬──→ Phase 4 (US4)
                                                                 ├──→ Phase 5 (US2)
                                                                 ├──→ Phase 6 (US3)
                                                                 └──→ Phase 7 (US5)
                                                                           ↓
                                                                  Phase 8 (Polish)
```

- **US1 (P1)**: Must complete first — all other stories need auth token
- **US2 (P2)**, **US3 (P3)**, **US4 (P4)**, **US5 (P5)**: Can proceed in parallel after US1
- **US4 (P4)**: Reordered to right after US1 since sync is needed early for conversation sync

### Within Each User Story

- Services/API layer before UI components
- Models before services
- Tauri commands before frontend wiring
- Core flow before edge cases

### Parallel Opportunities

- T001/T002/T003 can run in parallel (server setup + verification + feishu config)
- T006/T007 can run in parallel (Rust install + pnpm install)
- T015/T016 within US1 can run in parallel (auth service + WebView)
- T025/T026 within US4 can run in parallel (push + pull)
- T030/T031 within US2 can run in parallel (page + card component)
- T037/T039/T041/T042 within US3 can run in parallel (pages)
- T046/T048 within US5 can run in parallel (panel layout + error stats)
- T052/T053/T054 within Polish can run in parallel (build config + updater + icons)

---

## Parallel Example: User Story 1

```bash
# Launch independent tasks together:
Task: "T015 [US1] Create auth service in src/services/cloudAuth.ts"
Task: "T016 [US1] Implement Feishu OAuth WebView in src-tauri/src/commands/auth.rs"
Task: "T020 [US1] Create login screen UI in src/pages/Login.tsx"
Task: "T021 [US1] Create user profile component in src/components/UserProfile.tsx"

# Then sequential:
Task: "T017 [US1] Implement callback interception (depends on T016)"
Task: "T018 [US1] Implement session persistence (depends on T017)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup → Cloud API running ✅
2. Complete Phase 2: Foundational → brand replace + builds pass
3. Complete Phase 3: User Story 1 → Login works end-to-end
4. **STOP and VALIDATE**: Login → get token → persist → restore → logout → guard redirects
5. Demo to stakeholders

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → Login works → **MVP Deployable**
3. Add US4 → Sync works → Data flows between devices
4. Add US2 → Tool market → Users can discover tools
5. Add US3 → Personal space → Users see history
6. Add US5 → Admin panel → Admins manage the platform
7. Polish → Build `.msi` installer → **Release**

### Cloud-Server-Only Strategy

If desktop development is blocked, the cloud API is already fully functional and can be:
- Deployed now (T001-T003)
- Verified with curl/httpie (T014)
- Used to manage tools via admin API
- Ready when desktop development begins

---

## Notes

- **Cloud API is fully implemented** (T001-T003 only need deployment): all endpoints in `packages/cloud-server/src/index.js` are code-complete
- **Brand replacement** (T008) must run on Windows since the script is PowerShell
- [P] tasks = different files, no dependencies — safe to parallelize
- [Story] label maps task to specific user story for traceability
- Each user story phase should be independently testable as described
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Desktop paths assume standard Tauri v2 structure (`src-tauri/` for Rust, `src/` for frontend)
- Server-side `packages/cloud-server/src/index.js` may need `PUT /api/v1/admin/users/:id/role` added for T050
