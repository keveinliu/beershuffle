# Beershuffle 应用部署与打包说明

## 前提条件
- Node.js 18+（建议 LTS）
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
```

## 构建与启动
- 安装依赖：`npm ci`
- 生产构建前端：`npm run build`（生成 `dist/`）
- 启动服务端：`npm run server`（默认监听 `PORT`，并托管 `dist/`、`/images`、`/data`）

## 首次数据同步（可选）
- 触发一次同步以生成本地缓存与图片：
  - `curl -X POST http://localhost:3001/api/youzan/sync`
- 验证接口：
  - `curl http://localhost:3001/api/youzan/products`
- 页面访问：
  - `http://<服务器>:<PORT>/`

## 反向代理（可选，Nginx 示例）
```
server {
  listen 80;
  server_name example.com;
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
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

## 目录结构要点
- `dist/`：前端构建产物（由服务端静态托管）
- `public/images/`：同步时下载的图片
- `public/data/youzan_local.json`：同步生成的本地产品缓存
- `server/index.ts`：服务端与前端静态托管入口
