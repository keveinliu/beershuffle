# Beershuffle 应用部署与打包说明

## 前提条件
- Node.js 20+（建议 LTS）
- 已安装 npm

## 环境配置
- 在项目根目录创建并填写 `scripts/.env`（服务器端读取）：

```
YOUZAN_CLIENT_ID=你的ClientID
YOUZAN_CLIENT_SECRET=你的ClientSecret
YOUZAN_AUTHORIZE_TYPE=silent
YOUZAN_GRANT_ID=你的GrantId
YOUZAN_PRODUCTS_ENDPOINT="https://open.youzanyun.com/api/youzan.item.search/3.0.0"
YOUZAN_AUTH_STYLE=query
YOUZAN_HTTP_METHOD=POST
YOUZAN_PRODUCTS_PAYLOAD_JSON='{"page_no":1,"page_size":50,"show_sold_out":0}'
PORT=3001
SYNC_INTERVAL_MINUTES=30

# —— 大模型（Ark）配置 ——
# 用于普通“AI介绍”与“正经介绍”接口
ARK_API_KEY=你的Ark密钥
ARK_API_BASE=https://ark.cn-beijing.volces.com/api/v3/chat/completions
ARK_MODEL=doubao-pro-128k
```

## 构建与启动
- 安装依赖：`npm ci`
- 生产构建前端：`npm run build`（生成 `dist/`）
- 启动服务端：`npm run server`（默认监听 `PORT`，并托管 `dist/`、`/images`、`/data`）
- 打包：`npm run package`（生成 `beershuffle.zip`）

## 首次数据同步（可选）
- 触发一次同步以生成本地缓存与图片：
  - `curl -X POST http://localhost:3001/api/youzan/sync`
- 验证接口：
  - `curl http://localhost:3001/api/youzan/products`
- 页面访问：
  - `http://<服务器>:<PORT>/`

## 大模型接口与日志
- 普通介绍：`POST /api/ai/intro`
  - Body：`{"name":"产品名"}`
  - 示例：
    - `curl -X POST http://localhost:3001/api/ai/intro -H 'Content-Type: application/json' -d '{"name":"Lagunitas IPA"}'`
- 正经介绍（专业版）：`POST /api/ai/pro-intro`
  - Body：`{"name":"产品名","desc":"可选描述","url":"可选参考链接"}`
  - 示例：
    - `curl -X POST http://localhost:3001/api/ai/pro-intro -H 'Content-Type: application/json' -d '{"name":"Lagunitas IPA","desc":"美国IPA，酒花香气明显","url":"https://untappd.com/b/lagunitas-ipa/6114"}'`
- 后台日志
  - 服务端会在调用“正经介绍”时输出完整 payload（请求体），日志前缀为 `[ai]`，便于排查与复现。

## 反向代理（可选，Nginx 示例）
```
# /etc/nginx/conf.d/beershuffle.conf

upstream beershuffle_backend {
    server 127.0.0.1:3001;
    keepalive 64;
}

server {
    listen 80;
    server_name jthsm.live;  # 与 HTTPS 域名一致

    # 永久重定向到 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name jthsm.live;


    ssl_certificate /etc/nginx/ssl/fullchain.pem;  # 公钥证书路径
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;  # 私钥路径

    # 可选：SSL 安全优化配置（推荐添加）
    ssl_protocols TLSv1.2 TLSv1.3;  # 仅支持安全的 TLS 协议版本
    ssl_prefer_server_ciphers on;  # 优先使用服务器端加密套件
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;  # 安全的加密套件
    ssl_session_cache shared:SSL:10m;  # 启用 SSL 会话缓存
    ssl_session_timeout 1d;  # 会话超时时间
    ssl_stapling on;  # 启用 OCSP  stapling（需要证书支持）
    ssl_stapling_verify on;  # 验证 OCSP 响应

    root /var/www/beershuffle/dist;
    index index.html;

    # 前端静态资源（Vite 构建产物）
    location /assets/ {
        try_files $uri =404;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }

    # 同步生成的图片（直接由 Nginx 读取磁盘）
    location /images/ {
        alias /var/www/beershuffle/public/images/;
        try_files $uri =404;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }

    # 本地产品缓存 JSON（直接由 Nginx 读取磁盘）
    location /data/ {
        alias /var/www/beershuffle/public/data/;
        try_files $uri =404;
    }

    # SSE 事件流（需禁用缓冲）
    location /api/youzan/sync/events {
        proxy_pass http://beershuffle_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    # 其他后端接口
    location /api/ {
        proxy_pass http://beershuffle_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA 路由：前端就绪时，所有非接口路径回退到 index.html
    location / {
        try_files $uri /index.html;
    }
}
```

## 进程守护（可选，PM2）
- `pm2 start npm --name beershuffle-server -- run server`
- `pm2 save`
- （可选）`pm2 startup`

## 重要说明
- 环境文件仅服务器端读取，路径固定为 `scripts/.env`。
- `YOUZAN_PRODUCTS_PAYLOAD_JSON` 支持分页与过滤，`show_sold_out=0` 表示不同步售罄商品；后端会根据返回的 `count` 自动翻页并合并全量结果。
- 请勿将 `scripts/.env` 提交到版本库，避免泄露凭证。
- 大模型密钥（`ARK_API_KEY`）属于敏感信息，请确保仅在服务器侧配置，避免在前端或版本库中暴露。

## 目录结构要点
- `dist/`：前端构建产物（由服务端静态托管）
- `public/images/`：同步时下载的图片
- `public/data/youzan_local.json`：同步生成的本地产品缓存
- `server/index.ts`：服务端与前端静态托管入口
