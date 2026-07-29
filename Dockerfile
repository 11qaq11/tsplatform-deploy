FROM node:20-alpine
WORKDIR /app
COPY packages/cloud-server/package.json ./
RUN npm install --production
COPY packages/cloud-server/src/ ./src/
RUN mkdir -p /data

# Data cleanup script (30-day retention per FR-024)
COPY cleanup.sh /app/cleanup.sh
RUN chmod +x /app/cleanup.sh

# Start both the API server and crond for cleanup
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
CMD ["/app/entrypoint.sh"]
