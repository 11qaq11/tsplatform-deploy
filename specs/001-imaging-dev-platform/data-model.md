# Data Model: 中科影像开发平台（TsPlatform）

**Feature**: 001-imaging-dev-platform
**Date**: 2026-07-27

All entities are stored in a single SQLite database (`/data/tsplatform.db`) using WAL journal mode.

---

## Entity: `users`

Cloud-side user identity, linked to Feishu account.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | TEXT | PK, UUID | Unique user ID |
| `feishu_open_id` | TEXT | UNIQUE | Feishu user OpenID |
| `feishu_union_id` | TEXT | nullable | Feishu user UnionID (cross-app) |
| `username` | TEXT | | Display name from Feishu profile |
| `email` | TEXT | nullable | Email from Feishu profile |
| `avatar_url` | TEXT | nullable | Avatar URL from Feishu profile |
| `role` | TEXT | DEFAULT 'user', CHECK(user,admin) | User or admin |
| `created_at` | TEXT | DEFAULT datetime('now') | Registration timestamp |
| `last_login_at` | TEXT | DEFAULT datetime('now') | Last login timestamp |
| `session_token` | TEXT | nullable | Active session token (UUID) |
| `session_expires_at` | TEXT | nullable | Session expiry (created_at + 7d) |

**State transitions**:
- `new → active`: User first logs in via Feishu OAuth → row created with session_token
- `active → active`: Subsequent logins overwrite session_token (single-device active session)
- `active → expired`: session_expires_at passes → token invalid, user must re-login

**Identity rules**:
- `feishu_open_id` is the canonical identity key
- First login auto-registers (upsert on feishu_open_id)
- One user = one Feishu account

---

## Entity: `conversations`

User-Agent dialogue records, synced between desktop client and cloud.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | TEXT | PK | Unique conversation ID (UUID from client) |
| `user_id` | TEXT | FK → users.id, INDEXED | Owner user ID |
| `user_message` | TEXT | | User's input message |
| `agent_reply` | TEXT | | Agent's response |
| `model_name` | TEXT | | AI model used for this turn |
| `token_usage` | INTEGER | DEFAULT 0 | Token consumption for this turn |
| `created_at` | TEXT | DEFAULT datetime('now'), INDEXED | Conversation timestamp |
| `sync_status` | TEXT | DEFAULT 'synced' | Sync state: synced, pending |

**Sync behavior**:
- Client generates UUID as `id` → pushes to `POST /sync/push`
- Server uses `INSERT OR REPLACE` (remote-wins on conflict)
- `GET /sync/pull?since=...` returns records newer than `since`
- Cloud records auto-deleted after 30 days (cron cleanup)

**Indexes**:
- `idx_conv_user` on `user_id`
- `idx_conv_time` on `created_at DESC`

---

## Entity: `tools`

Community tools available in the tool marketplace.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | TEXT | PK, UUID | Unique tool ID |
| `name` | TEXT | UNIQUE | Tool name |
| `description` | TEXT | | Tool description (markdown) |
| `category` | TEXT | | Category label (e.g., "图像处理", "数据分析") |
| `version` | TEXT | | Semantic version (e.g., "1.0.0") |
| `author` | TEXT | | Author name/ID |
| `download_count` | INTEGER | DEFAULT 0 | Total downloads |
| `like_count` | INTEGER | DEFAULT 0, INDEXED DESC | Total likes |
| `manifest` | TEXT | | JSON string: tool metadata (inputs, outputs, deps) |
| `storage_path` | TEXT | | Server file path to tool package |
| `status` | TEXT | DEFAULT 'published', CHECK(published,unpublished) | Publication status |
| `created_at` | TEXT | DEFAULT datetime('now') | Creation timestamp |

**State transitions**:
- `draft → published`: Admin creates + publishes tool
- `published → unpublished`: Admin unpublishes (hidden from marketplace, preserves data)

**Indexes**:
- `idx_tools_likes` on `like_count DESC` (marketplace ranking)

---

## Entity: `operation_logs`

Audit trail of user operations.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | TEXT | PK | Unique log entry ID |
| `user_id` | TEXT | FK → users.id, INDEXED | User who performed the operation |
| `operation_type` | TEXT | | Type: login, sync_push, sync_pull, tool_download, tool_like, etc. |
| `detail` | TEXT | | Human-readable description |
| `duration_ms` | INTEGER | | Operation duration in milliseconds |
| `created_at` | TEXT | DEFAULT datetime('now') | Operation timestamp |

**Indexes**:
- `idx_ops_user` on `user_id`

---

## Entity: `referenced_files`

Files uploaded and referenced in conversations.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | TEXT | PK | Unique file reference ID |
| `user_id` | TEXT | FK → users.id | Owner user |
| `conversation_id` | TEXT | FK → conversations.id, nullable | Associated conversation |
| `file_hash` | TEXT | | SHA-256 hash of file content |
| `file_name` | TEXT | | Original filename |
| `file_size` | INTEGER | | File size in bytes |
| `upload_status` | TEXT | DEFAULT 'pending', CHECK(pending,uploaded,failed) | Upload progress state |
| `storage_path` | TEXT | | Server path to stored file |
| `referenced_at` | TEXT | DEFAULT datetime('now') | Timestamp when file was referenced |

**State transitions**:
- `pending → uploaded`: File upload completed successfully
- `pending → failed`: Upload error → error_logs records the failure

---

## Entity: `error_logs`

Error records from both client and server.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | TEXT | PK | Unique error ID |
| `user_id` | TEXT | FK → users.id, nullable | Affected user (null = server-wide) |
| `error_type` | TEXT | | Error category (e.g., "OAuth", "Network", "DB") |
| `message` | TEXT | | Human-readable error message |
| `stack_trace` | TEXT | | Full stack trace for debugging |
| `source` | TEXT | DEFAULT 'server', CHECK(server,client) | Origin of the error |
| `occurred_at` | TEXT | DEFAULT datetime('now'), INDEXED | Error timestamp |

**Indexes**:
- `idx_errors_time` on `occurred_at DESC`

---

## Entity Relationship Diagram

```
users (1) ──── (N) conversations
users (1) ──── (N) operation_logs
users (1) ──── (N) referenced_files
users (1) ──── (N) error_logs

conversations (1) ──── (N) referenced_files (nullable FK)

tools (standalone, no user FK — accessed via admin auth)
```

---

## Data Retention

Per FR-024: Cloud-side records in `conversations`, `error_logs`, `operation_logs` are auto-deleted after 30 days via a cron job running inside the Docker container:

```sql
DELETE FROM conversations  WHERE created_at < datetime('now', '-30 days');
DELETE FROM error_logs     WHERE occurred_at < datetime('now', '-30 days');
DELETE FROM operation_logs WHERE created_at  < datetime('now', '-30 days');
```

Local (desktop) SQLite retains all data indefinitely — users always keep their full local history.
