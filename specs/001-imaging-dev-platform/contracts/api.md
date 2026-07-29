# API Contracts: TsPlatform Cloud Server

**Base URL**: `http://122.51.90.193:3000`
**Auth**: Bearer token (`Authorization: Bearer <session_token>`)

All `4xx`/`5xx` responses follow: `{ "error": { "code": "ERROR_CODE", "message": "..." } }`

---

## Health

### `GET /api/v1/health`

Public, no auth required.

**Response** `200`:
```json
{ "status": "ok", "timestamp": "2026-07-27T06:00:00.000Z" }
```

---

## Auth

### `GET /api/v1/auth/feishu/authorize`

Get Feishu OAuth authorization URL.

**Response** `200`:
```json
{
  "redirect_url": "https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=...&redirect_uri=...&state=...&scope=openid",
  "state": "<UUID>"
}
```

### `GET /api/v1/auth/feishu/callback?code=<code>`

OAuth callback. Server exchanges code for access_token, fetches user info, creates/updates user record, returns session token.

**Response** `200`:
```json
{
  "session_token": "<UUID>",
  "expires_at": "2026-08-03T06:00:00.000Z",
  "user": {
    "id": "<UUID>",
    "username": "张三",
    "email": "zhangsan@example.com",
    "avatar_url": "https://...",
    "role": "user"
  }
}
```

**Errors**:
- `400 VALIDATION_ERROR` — missing `code`
- `401 UNAUTHORIZED` — invalid code, token exchange failed

### `GET /api/v1/auth/session`

Restore session from Bearer token.

**Headers**: `Authorization: Bearer <session_token>`

**Response** `200`:
```json
{
  "user": { "id": "...", "username": "...", "email": "...", "role": "user" }
}
```
**Response** `401` — invalid or expired session.

---

## Sync

### `POST /api/v1/sync/push`

Push local conversations to cloud.

**Headers**: `Authorization: Bearer <token>` | `Content-Type: application/json`

**Request**:
```json
{
  "conversations": [
    { "id": "<UUID>", "user_message": "...", "agent_reply": "...", "model_name": "gpt-4", "token_usage": 150, "created_at": "2026-07-27T06:00:00Z" }
  ]
}
```

**Response** `200`:
```json
{ "accepted": 1, "rejected": 0, "conflicts": [] }
```

### `GET /api/v1/sync/pull?since=<ISO-8601>`

Pull conversations and operation logs since a given time.

**Headers**: `Authorization: Bearer <token>`

**Query params**: `since` (ISO-8601 datetime, default `"1970-01-01"`)

**Response** `200`:
```json
{
  "conversations": [ { "id": "...", "user_message": "...", ... } ],
  "operation_logs": [ { "id": "...", "operation_type": "...", ... } ],
  "server_time": "2026-07-27T06:00:00Z"
}
```
Limit: 100 records per entity type.

---

## Tools

### `GET /api/v1/tools?category=<cat>&search=<keyword>`

Browse tools marketplace. Public (no auth required for browsing).

**Query params**:
- `category` — optional filter by category
- `search` — optional keyword search on name + description (SQL LIKE)

**Response** `200`:
```json
{
  "items": [
    { "id": "...", "name": "...", "description": "...", "category": "图像处理", "version": "1.0.0", "author": "...", "download_count": 5, "like_count": 3 }
  ],
  "total": 0
}
```
Limit: 50 items, ordered by `like_count DESC`.

### `POST /api/v1/tools/:id/like`

Toggle like for a tool.

**Headers**: `Authorization: Bearer <token>`

**Response** `200`:
```json
{ "like_count": 4, "liked": true }
```
**Response** `401` — unauthenticated.

### `POST /api/v1/admin/tools`

Admin: publish a new tool.

**Headers**: `Authorization: Bearer <token>` (admin role required) | `Content-Type: application/json`

**Request**:
```json
{
  "name": "图像分割工具",
  "description": "基于 SAM 的图像分割",
  "category": "图像处理",
  "version": "1.0.0",
  "author": "admin",
  "manifest": { "inputs": ["image"], "outputs": ["mask"] },
  "storage_path": "/data/tools/segmentation-v1.zip"
}
```

**Response** `201`:
```json
{ "success": true, "id": "<UUID>" }
```
**Response** `403` — not admin.

---

## User Space

All require `Authorization: Bearer <token>`.

### `GET /api/v1/users/me/dashboard`

User dashboard overview.

**Response** `200`:
```json
{
  "total_conversations": 42,
  "total_operations": 156,
  "recent_operations": []
}
```

### `GET /api/v1/users/me/conversations`

User's conversation history.

**Response** `200`:
```json
{
  "items": [
    { "id": "...", "user_message": "(truncated 200 chars)", "agent_reply_summary": "(truncated 200 chars)", "model_name": "gpt-4", "created_at": "..." }
  ],
  "total": 1
}
```
Limit: 50 records, ordered by `created_at DESC`.

### `GET /api/v1/users/me/errors`

User's error logs (+ server-wide errors).

**Response** `200`:
```json
{
  "items": [
    { "id": "...", "error_type": "Network", "message": "...", "stack_trace": "...", "source": "client", "occurred_at": "..." }
  ],
  "total": 1
}
```
Limit: 50 records, ordered by `occurred_at DESC`.

---

## Admin

Both require `Authorization: Bearer <token>` + `role === "admin"`.

### `GET /api/v1/admin/users`

List all users.

**Response** `200`:
```json
{
  "items": [
    { "id": "...", "username": "...", "email": "...", "role": "user", "created_at": "...", "last_login_at": "..." }
  ],
  "total": 1
}
```

### `GET /api/v1/admin/errors`

All errors with by-type statistics.

**Response** `200`:
```json
{
  "items": [ { "id": "...", "error_type": "...", "message": "...", "occurred_at": "..." } ],
  "total": 15,
  "by_type": [ { "error_type": "Network", "c": 8 }, { "error_type": "OAuth", "c": 5 } ]
}
```

---

## Updates

### `GET /api/v1/updates/latest`

Check for client updates.

**Response** `200`:
```json
{ "latest_version": "0.0.1", "update_available": false }
```
