# TsPlatform 部署包

## 服务器部署

```bash
# 1. 克隆
git clone <repo-url>
cd tsplatform-deploy

# 2. 配置飞书凭证
cp .env.example .env
vim .env   # 填入 FEISHU_APP_ID / FEISHU_APP_SECRET

# 3. 一键启动
docker compose up -d --build

# 4. 验证
curl http://localhost:3000/api/v1/health
```

## 飞书开放平台配置

重定向 URL: `http://122.51.90.193:3000/api/v1/auth/feishu/callback`

## 防火墙

```bash
sudo ufw allow 3000/tcp
```
