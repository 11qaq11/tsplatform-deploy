#!/bin/sh
# Start crond for daily cleanup at 3 AM
echo "0 3 * * * /app/cleanup.sh >> /data/cleanup.log 2>&1" | crontab -
crond -b -l 8

# Start the API server
exec node src/index.js
