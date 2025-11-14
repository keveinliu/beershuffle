import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import fetch from 'node-fetch'

dotenv.config({ path: path.join(process.cwd(), 'scripts/.env') })

const app = express()
app.use(cors())
app.use(express.json())

const ROOT = process.cwd()
const PUBLIC_DIR = path.join(ROOT, 'public')
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images')
const DATA_DIR = path.join(PUBLIC_DIR, 'data')
const DIST_DIR = path.join(ROOT, 'dist')
const OUTPUT_JSON = path.join(DATA_DIR, 'youzan_local.json')
const SAMPLE_JSON = path.join(ROOT, 'src', 'data', 'youzan_sample.json')
const LOG_PREFIX = '[youzan]'
const AI_LOG_PREFIX = '[ai]'
const TOKEN_TTL_SEC = Number(process.env.YOUZAN_TOKEN_TTL_SECONDS || '1800')

// 访问令牌内存缓存（不持久化，仅进程内）
const tokenCache: {
  token?: string
  obtainedAt?: number
  expiresAt?: number
  hits: number
  refreshes: number
} = {
  token: undefined,
  obtainedAt: undefined,
  expiresAt: undefined,
  hits: 0,
  refreshes: 0,
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

ensureDir(IMAGES_DIR)
ensureDir(DATA_DIR)
// 静态资源：提供已下载的图片与本地数据文件
app.use('/images', express.static(IMAGES_DIR))
app.use('/data', express.static(DATA_DIR))
app.use(express.static(DIST_DIR))

function sanitizeFilename(name: string, id: number | string) {
  const safe = String(name || 'product')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, 40)
  return `${safe}_${id}`
}

function inferExtFromUrl(url: string) {
  try {
    const u = new URL(url)
    const p = u.pathname.toLowerCase()
    if (p.endsWith('.png')) return '.png'
    if (p.endsWith('.webp')) return '.webp'
    if (p.endsWith('.jpeg')) return '.jpeg'
    if (p.endsWith('.jpg')) return '.jpg'
    return '.jpg'
  } catch {
    return '.jpg'
  }
}

function maskToken(token: string) {
  if (!token) return 'n/a'
  const head = token.slice(0, 4)
  const tail = token.slice(-4)
  return `${head}****${tail}(len=${token.length})`
}

function previewText(s: string, limit = 400) {
  if (!s) return ''
  const oneLine = s.replace(/\s+/g, ' ')
  return oneLine.length > limit ? `${oneLine.slice(0, limit)}…(truncated)` : oneLine
}

async function requestYouzanToken(): Promise<{ token: string; expiresIn?: number }> {
  const client_id = process.env.YOUZAN_CLIENT_ID
  const client_secret = process.env.YOUZAN_CLIENT_SECRET
  const grant_id = process.env.YOUZAN_GRANT_ID
  const authorize_type = process.env.YOUZAN_AUTHORIZE_TYPE || 'silent'
  if (!client_id || !client_secret || !grant_id) {
    throw new Error('Missing YOUZAN_* env in scripts/.env')
  }
  console.log(`${LOG_PREFIX} request token: authorize_type=${authorize_type}, client_id_len=${client_id.length}, grant_id=${grant_id}`)
  const body = { authorize_type, client_id, client_secret, grant_id }
  const resp = await fetch('https://open.youzanyun.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`Youzan token HTTP ${resp.status}`)
  const json = await resp.json()
  if (!json || !json.success || !json.data || !json.data.access_token) {
    throw new Error(`Youzan token error: ${json && json.message ? json.message : 'unknown'}`)
  }
  const expires = json.data.expires_in ?? json.data.expire_in
  console.log(`${LOG_PREFIX} token ok: ${maskToken(json.data.access_token)}, expires_in=${expires ?? 'n/a'}`)
  return { token: json.data.access_token as string, expiresIn: typeof expires === 'number' ? expires : undefined }
}

async function getYouzanAccessTokenCached(): Promise<string> {
  const now = Date.now()
  if (tokenCache.token && tokenCache.expiresAt && now < (tokenCache.expiresAt - 60_000)) {
    tokenCache.hits += 1
    const leftSec = Math.max(0, Math.floor((tokenCache.expiresAt - now) / 1000))
    console.log(`${LOG_PREFIX} token cache hit: left=${leftSec}s, hits=${tokenCache.hits}, refreshes=${tokenCache.refreshes}`)
    return tokenCache.token
  }
  const res = await requestYouzanToken()
  const ttlMs = (res.expiresIn ? res.expiresIn : TOKEN_TTL_SEC) * 1000
  tokenCache.token = res.token
  tokenCache.obtainedAt = now
  tokenCache.expiresAt = now + ttlMs
  tokenCache.refreshes += 1
  console.log(`${LOG_PREFIX} token refreshed: ${maskToken(res.token)}, ttl=${Math.floor(ttlMs / 1000)}s, hits=${tokenCache.hits}, refreshes=${tokenCache.refreshes}`)
  return res.token
}

function pick(obj: any, keys: string[], fallback: any) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k]
  }
  return fallback
}

function mapEndpointProduct(p: any) {
  return {
    id: pick(p, ['id', 'item_id', 'goods_id'], undefined),
    title: pick(p, ['title', 'name', 'alias'], '商品'),
    desc: pick(p, ['desc', 'description'], ''),
    productUrl: pick(p, ['productUrl', 'url', 'detail_url'], undefined),
    imageUrl: pick(p, ['imageUrl', 'image', 'image_url', 'thumb_url'], undefined),
    price: pick(p, ['price', 'price_display'], undefined),
  }
}

async function fetchProductsFromEndpoint(): Promise<any[]> {
  const endpoint = process.env.YOUZAN_PRODUCTS_ENDPOINT
  if (!endpoint) throw new Error('Missing YOUZAN_PRODUCTS_ENDPOINT in scripts/.env')
  // 校验官方域名与HTTPS
  try {
    const u = new URL(endpoint)
    if (u.protocol !== 'https:') {
      console.warn('[server] YOUZAN_PRODUCTS_ENDPOINT 非 https，已继续但建议改为 https')
    }
    if (u.hostname !== 'open.youzanyun.com') {
      console.warn('[server] YOUZAN_PRODUCTS_ENDPOINT 非官方域名 open.youzanyun.com，如为代理可忽略')
    }
  } catch {
    console.warn('[server] YOUZAN_PRODUCTS_ENDPOINT 不是合法URL字符串')
  }
  const token = await getYouzanAccessTokenCached()
  const method = String(process.env.YOUZAN_HTTP_METHOD || 'GET').toUpperCase()
  const authStyle = String(process.env.YOUZAN_AUTH_STYLE || 'header').toLowerCase()
  let url = endpoint
  const headers: Record<string, string> = {}
  let body: string | undefined
  let payloadObj: any = undefined
  let pageNo = 1
  let pageSize = 20
  if (authStyle === 'header') {
    headers['Authorization'] = `Bearer ${token}`
  } else if (authStyle === 'query') {
    const u = new URL(url)
    u.searchParams.set('access_token', token)
    url = u.toString()
  }
  if (method !== 'GET') {
    const raw = process.env.YOUZAN_PRODUCTS_PAYLOAD_JSON
    if (raw && raw.trim()) {
      try {
        payloadObj = JSON.parse(raw)
        pageNo = Number(pick(payloadObj, ['page_no', 'pageNo'], 1)) || 1
        pageSize = Number(pick(payloadObj, ['page_size', 'pageSize'], 20)) || 20
        body = JSON.stringify({ ...payloadObj, page_no: pageNo, page_size: pageSize })
        headers['Content-Type'] = 'application/json'
      } catch {
        console.warn('[server] 无法解析 YOUZAN_PRODUCTS_PAYLOAD_JSON，将以无负载请求')
      }
    }
  }
  console.log(`${LOG_PREFIX} fetch products: url=${url}, method=${method}, auth=${authStyle}, payloadBytes=${body ? body.length : 0}`)
  let resp = await fetch(url, { method, headers, body })
  let ct = resp.headers.get('content-type') || 'n/a'
  let status = resp.status
  let text = await resp.text()
  console.log(`${LOG_PREFIX} response: http=${status}, content-type=${ct}, bodyPreview=${previewText(text)}`)
  // 凭证错误时自动尝试 query 风格（部分有赞接口不支持 Authorization 头部）
  if (status === 200 && /"err_code"\s*:\s*4201/.test(text)) {
    try {
      const u2 = new URL(endpoint)
      u2.searchParams.set('access_token', token)
      const url2 = u2.toString()
      console.warn(`${LOG_PREFIX} retry with query auth due to err_code=4201`)
      resp = await fetch(url2, { method, headers: { 'Content-Type': headers['Content-Type'] || '' }, body })
      ct = resp.headers.get('content-type') || 'n/a'
      status = resp.status
      text = await resp.text()
      console.log(`${LOG_PREFIX} response(retry): http=${status}, content-type=${ct}, bodyPreview=${previewText(text)}`)
    } catch (e) {
      console.warn(`${LOG_PREFIX} retry failed: ${String((e as any)?.message || e)}`)
    }
  }
  if (!resp.ok) throw new Error(`Products HTTP ${resp.status}`)
  let data: any = null
  try {
    data = JSON.parse(text)
  } catch (err) {
    console.warn(`${LOG_PREFIX} parse json failed: ${(err as any)?.message ?? 'unknown'}`)
  }
  const root = data && typeof data === 'object' && data.data ? data.data : data
  let list = Array.isArray(root)
    ? root
    : Array.isArray(root?.products)
    ? root.products
    : Array.isArray(root?.items)
    ? root.items
    : Array.isArray(root?.list)
    ? root.list
    : Array.isArray(root?.records)
    ? root.records
    : []
  const total = Number(pick(root, ['count', 'total', 'total_count'], 0)) || list.length
  let all = [...list]
  if (method !== 'GET' && payloadObj && all.length < total) {
    let curPage = pageNo
    while (all.length < total) {
      curPage += 1
      const nextBody = JSON.stringify({ ...payloadObj, page_no: curPage, page_size: pageSize })
      const r = await fetch(url, { method, headers, body: nextBody })
      const t = await r.text()
      let d: any = null
      try {
        d = JSON.parse(t)
      } catch {}
      const rt = d && typeof d === 'object' && d.data ? d.data : d
      const pageList = Array.isArray(rt)
        ? rt
        : Array.isArray(rt?.products)
        ? rt.products
        : Array.isArray(rt?.items)
        ? rt.items
        : Array.isArray(rt?.list)
        ? rt.list
        : Array.isArray(rt?.records)
        ? rt.records
        : []
      if (!pageList || pageList.length === 0) break
      all = all.concat(pageList)
      if (curPage > 100) break
    }
  }
  console.log(`${LOG_PREFIX} mapped list count=${all.length}`)
  return all.map(mapEndpointProduct)
}

async function downloadImage(url: string, destPath: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Image HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(destPath, buffer)
}

app.get('/api/youzan/products', async (req, res) => {
  try {
    // 优先返回本地缓存文件
    if (fs.existsSync(OUTPUT_JSON)) {
      const raw = fs.readFileSync(OUTPUT_JSON, 'utf-8')
      const json = JSON.parse(raw)
      if (json && Array.isArray(json.products) && json.products.length > 0) {
        return res.json(json)
      }
      // 本地存在但为空，回退示例数据避免页面无数据
      try {
        const sraw = fs.readFileSync(SAMPLE_JSON, 'utf-8')
        const sjson = JSON.parse(sraw)
        if (sjson && Array.isArray(sjson.products)) {
          return res.json(sjson)
        }
      } catch {}
      // 若示例也不可用，返回空结构
      return res.json({ products: [] })
    }
    // 若无本地，尝试实时拉取（不下载图片）
    const products = await fetchProductsFromEndpoint()
    res.json({ products })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'unknown error' })
  }
})

app.post('/api/youzan/sync', async (req, res) => {
  try {
    console.log(`${LOG_PREFIX} sync start`)
    const products = await fetchProductsFromEndpoint()
    if (!products || products.length === 0) {
      console.warn(`${LOG_PREFIX} sync upstream empty products`)
      return res.status(200).json({ ok: false, count: 0, reason: 'upstream returned empty products, skip write' })
    }
    const output: any = { products: [] }
    for (const p of products) {
      if (!p.imageUrl) continue
      const ext = inferExtFromUrl(p.imageUrl)
      const base = sanitizeFilename(p.title, p.id)
      const filename = `${base}${ext}`
      const dest = path.join(IMAGES_DIR, filename)
      try {
        if (!fs.existsSync(dest)) {
          await downloadImage(p.imageUrl, dest)
        }
        output.products.push({ ...p, filename })
      } catch (err) {
        output.products.push({ ...p })
      }
    }
    if (output.products.length > 0) {
      fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf-8')
      console.log(`${LOG_PREFIX} sync ok: write ${output.products.length} -> ${path.relative(ROOT, OUTPUT_JSON)}`)
      return res.json({ ok: true, count: output.products.length })
    } else {
      console.warn(`${LOG_PREFIX} sync no valid products to write`)
      return res.status(200).json({ ok: false, count: 0, reason: 'no valid products to write' })
    }
  } catch (e: any) {
    console.error(`${LOG_PREFIX} sync error:`, e?.message ?? e)
    res.status(500).json({ error: e?.message ?? 'unknown error' })
  }
})

app.get('/api/youzan/sync/status', (req, res) => {
  try {
    if (!fs.existsSync(OUTPUT_JSON)) return res.json({ synced: false })
    const stat = fs.statSync(OUTPUT_JSON)
    res.json({ synced: true, updatedAt: stat.mtimeMs })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'unknown error' })
  }
})

const port = process.env.PORT ? Number(process.env.PORT) : 3001
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`)
})

// -----------------------
// 定时自动同步与通知机制
// -----------------------

type SyncStatus = {
  inProgress: boolean
  lastRunAt?: number
  lastSuccessAt?: number
  lastError?: string | null
  lastCount?: number
}

const status: SyncStatus = {
  inProgress: false,
  lastRunAt: undefined,
  lastSuccessAt: undefined,
  lastError: null,
  lastCount: undefined,
}

const sseClients = new Set<import('http').ServerResponse>()

function sseBroadcast(event: string, payload: any) {
  const data = `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`
  for (const client of sseClients) {
    try {
      client.write(data)
    } catch {}
  }
}

app.get('/api/youzan/sync/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  res.write(':ok\n\n')
  sseClients.add(res)
  req.on('close', () => {
    sseClients.delete(res)
  })
})

app.get('*', (req, res) => {
  try {
    const indexPath = path.join(DIST_DIR, 'index.html')
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath)
    }
    res.status(404).send('Not Found')
  } catch {
    res.status(404).send('Not Found')
  }
})

async function runSyncOnce(retries = 2) {
  if (status.inProgress) return
  status.inProgress = true
  status.lastRunAt = Date.now()
  status.lastError = null
  try {
    console.log(`${LOG_PREFIX} cron sync start`)
    const products = await fetchProductsFromEndpoint()
    if (!products || products.length === 0) {
      status.lastError = 'upstream returned empty products'
      console.warn(`${LOG_PREFIX} cron upstream empty products`)
      sseBroadcast('sync-error', { error: status.lastError, at: Date.now() })
      return
    }
    const output: any = { products: [] }
    for (const p of products) {
      if (!p.imageUrl) continue
      const ext = inferExtFromUrl(p.imageUrl)
      const base = sanitizeFilename(p.title, p.id)
      const filename = `${base}${ext}`
      const dest = path.join(IMAGES_DIR, filename)
      try {
        if (!fs.existsSync(dest)) {
          await downloadImage(p.imageUrl, dest)
        }
        output.products.push({ ...p, filename })
      } catch (err) {
        output.products.push({ ...p })
      }
    }
    if (output.products.length > 0) {
      fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf-8')
      status.lastSuccessAt = Date.now()
      status.lastCount = output.products.length
      console.log(`${LOG_PREFIX} cron sync ok: write ${output.products.length}`)
      sseBroadcast('sync-complete', { count: output.products.length, at: status.lastSuccessAt })
    } else {
      status.lastError = 'no valid products to write'
      console.warn(`${LOG_PREFIX} cron no valid products to write`)
      sseBroadcast('sync-error', { error: status.lastError, at: Date.now() })
    }
  } catch (e: any) {
    status.lastError = e?.message ?? 'unknown error'
    console.error(`${LOG_PREFIX} cron sync error:`, status.lastError)
    if (retries > 0) {
      const wait = 500 * Math.pow(2, (2 - retries))
      setTimeout(() => runSyncOnce(retries - 1), wait)
    } else {
      sseBroadcast('sync-error', { error: status.lastError, at: Date.now() })
    }
  } finally {
    status.inProgress = false
  }
}

// 状态查询增强
app.get('/api/youzan/sync/status', (req, res) => {
  try {
    let updatedAt: number | undefined
    if (fs.existsSync(OUTPUT_JSON)) {
      const stat = fs.statSync(OUTPUT_JSON)
      updatedAt = stat.mtimeMs
    }
    res.json({
      synced: Boolean(updatedAt),
      updatedAt,
      ...status,
    })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'unknown error' })
  }
})

// 启动后根据配置定时执行
const intervalMin = Number(process.env.SYNC_INTERVAL_MINUTES || '30')
const intervalMs = Math.max(1, intervalMin) * 60 * 1000
const productsEndpoint = process.env.YOUZAN_PRODUCTS_ENDPOINT
if (productsEndpoint) {
  setInterval(() => {
    runSyncOnce(2)
  }, intervalMs)
  // 立即执行一次（不阻塞启动）
  setTimeout(() => runSyncOnce(2), 1000)
} else {
  console.warn('[server] SYNC disabled: missing YOUZAN_PRODUCTS_ENDPOINT')
}
app.post('/api/ai/intro', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ error: 'missing name' })
    const apiKey = process.env.ARK_API_KEY || ''
    const apiBase = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
    const model = process.env.ARK_MODEL || 'doubao-pro-128k'
    const prompt = `请用简洁、生动的中文，面向一般消费者，用150-200字介绍产品「${name}」，突出风味、适合场景与搭配建议。`
    if (!apiKey) {
      return res.json({ text: `未配置AI服务，产品「${name}」` })
    }
    const payload = {
      model,
      messages: [
        { role: 'system', content: '你是资深啤酒和威士忌的爱好者，输出自然中文，简洁生动，包含风味、场景与搭配建议。' },
        { role: 'user', content: prompt }
      ]
    }
    const r = await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    })
    const t = await r.text()
    let j: any = null
    try { j = JSON.parse(t) } catch {}
    const text = j?.choices?.[0]?.message?.content || ''
    if (text) return res.json({ text })
    return res.status(200).json({ text: `暂无法生成介绍，产品「${name}」` })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'unknown error' })
  }
})

app.post('/api/ai/pro-intro', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    const desc = String(req.body?.desc || '').trim()
    const url = String(req.body?.url || '').trim()
    if (!name) return res.status(400).json({ error: 'missing name' })
    const apiKey = process.env.ARK_API_KEY || ''
    const apiBase = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
    const model = process.env.ARK_MODEL || 'doubao-pro-128k'
    const prompt = `请以专业酒类从业者视角，基于公开资料（如 Untappd）为「${name}」撰写不超过500字的正经介绍，重点涵盖：核心风味、酒体与苦度、典型评分区间，避免夸张营销。`
    if (!apiKey) {
      return res.json({ text: `未配置AI服务，产品「${name}」` })
    }
    const payload = {
      model,
      messages: [
        { role: 'system', content: '你是专业的酒类从业者，参考公开评价与评分（如 Untappd），以专业但易懂的中文输出，聚焦风味与评分信息。' },
        { role: 'user', content: prompt }
      ]
    }
    console.log(`${AI_LOG_PREFIX} pro-intro payload: ${JSON.stringify(payload)}`)
    const r = await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    })
    const t = await r.text()
    let j: any = null
    try { j = JSON.parse(t) } catch {}
    const text = j?.choices?.[0]?.message?.content || ''
    if (text) return res.json({ text })
    return res.status(200).json({ text: `暂无法生成介绍，产品「${name}」` })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'unknown error' })
  }
})
