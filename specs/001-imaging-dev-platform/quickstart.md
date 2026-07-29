# Quickstart: TsPlatform 端到端验证指南

**Prerequisites**: Docker, curl (or any HTTP client), Feishu account

---

## Scenario 1: 云端 API 部署验证

```bash
cd /home/ubuntu/workspace/tsplatform-deploy
docker compose up -d --build
```

**Verify**:
```bash
curl http://localhost:3000/api/v1/health
# → {"status":"ok","timestamp":"..."}
```

**External verify** (from any machine):
```bash
curl http://122.51.90.193:3000/api/v1/health
# → {"status":"ok","timestamp":"..."}
```

---

## Scenario 2: 飞书 OAuth 登录流程

### 2.1 获取授权链接

```bash
curl http://localhost:3000/api/v1/auth/feishu/authorize | jq .
# → {"redirect_url":"https://open.feishu.cn/...", "state":"<UUID>"}
```

### 2.2 完成授权

1. 浏览器打开上一步返回的 `redirect_url`
2. 飞书授权页 → 同意授权
3. 回调到 `http://122.51.90.193:3000/api/v1/auth/feishu/callback?code=...`
4. 返回 `session_token` + 用户信息

### 2.3 验证登录态

```bash
TOKEN="<从回调中获取的 session_token>"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/auth/session
# → {"user":{"id":"...","username":"...","role":"user"}}
```

---

## Scenario 3: 会话同步

### 3.1 推送对话

```bash
TOKEN="<session_token>"
curl -X POST http://localhost:3000/api/v1/sync/push \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversations": [{
      "id": "test-conv-001",
      "user_message": "Hello, Agent!",
      "agent_reply": "Hello! How can I help you today?",
      "model_name": "gpt-4",
      "token_usage": 50,
      "created_at": "2026-07-27T00:00:00Z"
    }]
  }'
# → {"accepted":1,"rejected":0,"conflicts":[]}
```

### 3.2 拉取对话

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/sync/pull?since=2026-07-26T00:00:00Z" | jq .
# → {"conversations":[...], "operation_logs":[...], "server_time":"..."}
```

---

## Scenario 4: 工具市场

### 4.1 管理员发布工具

```bash
# 管理员 token (需先通过 SQLite 设置为 admin)
curl -X POST http://localhost:3000/api/v1/admin/tools \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"测试工具","description":"一个测试工具","category":"测试","version":"1.0.0","author":"admin","manifest":{},"storage_path":"/data/tools/test-v1.zip"}'
# → {"success":true,"id":"<UUID>"}
```

### 4.2 浏览工具

```bash
curl http://localhost:3000/api/v1/tools | jq .
# → {"items":[{...}], "total":0}

curl "http://localhost:3000/api/v1/tools?category=测试&search=测试" | jq .
# → 带筛选结果
```

### 4.3 点赞

```bash
TOOL_ID="<从上一步获取>"
curl -X POST http://localhost:3000/api/v1/tools/$TOOL_ID/like \
  -H "Authorization: Bearer $TOKEN"
# → {"like_count":1,"liked":true}
```

---

## Scenario 5: 个人空间

```bash
TOKEN="<session_token>"

# 面板概览
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/users/me/dashboard | jq .

# 历史对话
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/users/me/conversations | jq .

# 错误日志
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/users/me/errors | jq .
```

---

## Scenario 6: 管理面板

```bash
# 先设置管理员（在服务器 shell 中执行）
docker compose exec cloud-server sqlite3 /data/tsplatform.db \
  "UPDATE users SET role='admin' WHERE feishu_open_id='<你的飞书open_id>';"

# 验证管理员身份后访问
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/v1/admin/users | jq .
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/v1/admin/errors | jq .
```

---

## Scenario 7: 桌面端编译验证

```bash
# 在服务器上 (源码推送后)
cd /home/ubuntu/workspace/TsPlatform

# 安装依赖
pnpm install

# TypeScript 类型检查
pnpm tsc --noEmit

# Rust 编译检查
cargo check

# 完整构建 (耗时较长)
cargo build
```
