#!/usr/bin/env node
/**
 * 有赞商品同步脚本
 * 功能：
 * 1) 批量查询商品（目前默认使用本地示例数据，支持后续接入真实接口）
 * 2) 记录商品信息（标题、价格、描述、链接等，示例数据不含价格）
 * 3) 下载每个商品的首张图片到 public/images/
 * 4) 生成 public/data/youzan_local.json，包含本地图片 filename、商品信息与 miniProgramUrl（若可获取）
 *
 * 使用：
 *   node scripts/youzan_sync.js
 *
 * 可选环境变量（后续接入真实接口时使用）：
 *   YOUZAN_CLIENT_ID
 *   YOUZAN_CLIENT_SECRET
 *   YOUZAN_GRANT_ID  // kdt_id
 *   YOUZAN_PRODUCTS_ENDPOINT // 真实的有赞商品列表接口（需要携带 Bearer Token）
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const { URL } = require('url')

const ROOT = process.cwd()
const PUBLIC_DIR = path.join(ROOT, 'public')
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images')
const DATA_DIR = path.join(PUBLIC_DIR, 'data')
const OUTPUT_JSON = path.join(DATA_DIR, 'youzan_local.json')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}


function sanitizeFilename(name, id) {
  const safe = String(name || 'product')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, 40)
  return `${safe}_${id}`
}

function inferExtFromUrl(url) {
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

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    https
      .get(url, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // handle redirect
          https.get(res.headers.location, r2 => r2.pipe(file))
            .on('error', reject)
            .on('close', resolve)
          return
        }
        if (res.statusCode !== 200) {
          file.close()
          fs.unlink(destPath, () => {})
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
      })
      .on('error', err => {
        file.close()
        fs.unlink(destPath, () => {})
        reject(err)
      })
  })
}


async function requestYouzanTokenFromEnv() {
  const clientId = process.env.YOUZAN_CLIENT_ID
  const clientSecret = process.env.YOUZAN_CLIENT_SECRET
  const grantId = process.env.YOUZAN_GRANT_ID
  if (!clientId || !clientSecret || !grantId) return null
  const body = {
    authorize_type: 'silent',
    client_id: clientId,
    client_secret: clientSecret,
    grant_id: grantId,
  }
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
  return json.data.access_token
}

function pick(obj, keys, fallback) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k]
  }
  return fallback
}

function mapEndpointProduct(p) {
  const productUrl = pick(p, ['productUrl', 'url', 'detail_url'], undefined)
  let alias = pick(p, ['alias'], undefined)
  if (!alias && productUrl) {
    try {
      const u = new URL(productUrl)
      alias = u.searchParams.get('alias') || alias
    } catch {
      const m = /alias=([a-zA-Z0-9]+)/.exec(String(productUrl))
      alias = m ? m[1] : alias
    }
  }
  return {
    id: pick(p, ['id', 'item_id', 'goods_id'], undefined),
    title: pick(p, ['title', 'name', 'alias'], '商品'),
    desc: pick(p, ['desc', 'description'], ''),
    productUrl,
    imageUrl: pick(p, ['imageUrl', 'image', 'image_url', 'thumb_url'], undefined),
    price: pick(p, ['price', 'price_display'], undefined),
    alias,
  }
}

async function fetchAllProductsFromEndpoint(endpoint, token) {
  const resp = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`Products HTTP ${resp.status}`)
  const data = await resp.json()
  const list = Array.isArray(data) ? data : Array.isArray(data.products) ? data.products : Array.isArray(data.items) ? data.items : []
  return list.map(mapEndpointProduct)
}

async function fetchMiniProgramUrlByAlias(token, alias, title, permanent = false) {
  try {
    const u = new URL('https://open.youzanyun.com/api/youzan.users.channel.app.link.get/1.0.0')
    u.searchParams.set('access_token', token)
    const pageTitle = String(title || '商品').slice(0, 20)
    const body = {
      page_url: `packages/goods/detail/index?alias=${encodeURIComponent(String(alias))}`,
      page_title: pageTitle,
      is_permanent: Boolean(permanent),
    }
    console.log(`[youzan_sync] mp.link req: page_url=${body.page_url}`)
    const r = await fetch(u.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const t = await r.text()
    let j = null
    try { j = JSON.parse(t) } catch {}
    const url = j && j.data && typeof j.data.mini_program_url === 'string' ? j.data.mini_program_url : ''
    console.log(`[youzan_sync] mp.link resp: http=${r.status}, url_type=${j && j.data ? j.data.url_type : 'n/a'}, ok=${j && j.success === true}, mini_program_url=${url ? url : ''}`)
    return url || ''
  } catch {
    return ''
  }
}

async function main() {
  console.log('[youzan_sync] 开始同步商品数据与图片...')
  ensureDir(IMAGES_DIR)
  ensureDir(DATA_DIR)

  // 若提供真实接口与凭证，优先使用真实接口
  let products
  const endpoint = process.env.YOUZAN_PRODUCTS_ENDPOINT
  products = []
  if (endpoint) {
    let token = null
    try {
      token = await requestYouzanTokenFromEnv()
      if (!token) throw new Error('缺少 YOUZAN_* 环境变量')
      products = await fetchAllProductsFromEndpoint(endpoint, token)
      console.log(`[youzan_sync] 从接口获取 ${products.length} 条商品`)
    } catch (e) {
      console.warn('[youzan_sync] 接口获取失败：', e && e.message ? e.message : e)
      products = []
    }
    global.__YOUZAN_TOKEN__ = token
  } else {
    console.warn('[youzan_sync] 缺少 YOUZAN_PRODUCTS_ENDPOINT，生成空数据文件')
  }

  const output = { products: [] }
  for (const p of products) {
    if (!p.imageUrl) {
      console.warn(`[skip] 商品 ${p.id} 缺少图片URL`)
      continue
    }
    const ext = inferExtFromUrl(p.imageUrl)
    const base = sanitizeFilename(p.title, p.id)
    const filename = `${base}${ext}`
    const dest = path.join(IMAGES_DIR, filename)

    try {
      // 若文件已经存在，则跳过下载
      if (!fs.existsSync(dest)) {
        console.log(`[download] ${p.imageUrl} -> images/${filename}`)
        await downloadImage(p.imageUrl, dest)
      } else {
        console.log(`[skip] 已存在 images/${filename}`)
      }
      let mpUrl = ''
      if (p.alias && endpoint && global.__YOUZAN_TOKEN__) {
        mpUrl = await fetchMiniProgramUrlByAlias(global.__YOUZAN_TOKEN__, p.alias, p.title)
      }
      output.products.push({
        id: p.id,
        title: p.title,
        desc: p.desc,
        productUrl: p.productUrl,
        imageUrl: p.imageUrl,
        filename,
        alias: p.alias,
        miniProgramUrl: mpUrl,
      })
    } catch (e) {
      console.error(`[error] 下载失败: ${p.imageUrl}`, e && e.message ? e.message : e)
      // 仍然记录但不写入 filename
      let mpUrl = ''
      if (p.alias && endpoint && global.__YOUZAN_TOKEN__) {
        mpUrl = await fetchMiniProgramUrlByAlias(global.__YOUZAN_TOKEN__, p.alias, p.title)
      }
      output.products.push({
        id: p.id,
        title: p.title,
        desc: p.desc,
        productUrl: p.productUrl,
        imageUrl: p.imageUrl,
        alias: p.alias,
        miniProgramUrl: mpUrl,
      })
    }
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`[done] 已生成 ${path.relative(ROOT, OUTPUT_JSON)}，共 ${output.products.length} 条`) 
}

main().catch(err => {
  console.error('[youzan_sync] 发生错误：', err && err.message ? err.message : err)
  process.exit(1)
})