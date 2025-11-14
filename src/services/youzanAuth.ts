// 有赞 access token 获取与缓存
// 参考官方文档：https://doc.youzanyun.com/resource/doc/3031

export interface YouzanAuthConfig {
  clientId: string
  clientSecret: string
  grantId: string // kdt_id
  refresh?: boolean
}

interface TokenRespData {
  expires: number
  access_token: string
}

interface TokenResp {
  success: boolean
  code: number
  data?: TokenRespData
  message?: string | null
}

interface CacheEntry {
  token: string
  expires: number
}

const AUTH_URL = 'https://open.youzanyun.com/auth/token'

function cacheKey(cfg: YouzanAuthConfig) {
  return `yz_token_${cfg.grantId}_${cfg.clientId}`
}

function readCache(cfg: YouzanAuthConfig): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(cfg))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    return parsed
  } catch {
    return null
  }
}

function writeCache(cfg: YouzanAuthConfig, entry: CacheEntry) {
  try {
    localStorage.setItem(cacheKey(cfg), JSON.stringify(entry))
  } catch {}
}

function isExpired(entry: CacheEntry) {
  // expires 为失效时间戳（毫秒）
  return Date.now() >= entry.expires
}

async function requestToken(cfg: YouzanAuthConfig): Promise<CacheEntry> {
  const body = {
    authorize_type: 'silent',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_id: cfg.grantId,
    refresh: Boolean(cfg.refresh),
  }

  const resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`Youzan auth failed: ${resp.status}`)
  const json = (await resp.json()) as TokenResp
  if (!json.success || !json.data) throw new Error(`Youzan auth error: ${json.message ?? 'unknown'}`)
  return { token: json.data.access_token, expires: json.data.expires }
}

export async function getYouzanAccessToken(cfg: YouzanAuthConfig): Promise<string> {
  // 先读缓存
  const cached = readCache(cfg)
  if (cached && !isExpired(cached) && !cfg.refresh) return cached.token

  // 简单重试机制（最多 3 次，指数退避）
  let lastErr: unknown
  for (let i = 0; i < 3; i++) {
    try {
      const entry = await requestToken(cfg)
      writeCache(cfg, entry)
      return entry.token
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, 200 * Math.pow(2, i)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Youzan auth unknown error')
}