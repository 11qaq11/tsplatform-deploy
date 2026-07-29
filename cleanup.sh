#!/bin/sh
# 30-day data cleanup per FR-024
sqlite3 /data/tsplatform.db "DELETE FROM conversations WHERE created_at < datetime('now', '-30 days');"
sqlite3 /data/tsplatform.db "DELETE FROM error_logs WHERE occurred_at < datetime('now', '-30 days');"
sqlite3 /data/tsplatform.db "DELETE FROM operation_logs WHERE created_at < datetime('now', '-30 days');"
echo "$(date): Cleanup completed"
