import Taro from '@tarojs/taro'

const API_BASE = process.env.TARO_API_BASE || 'https://your-domain'

export async function fetchAiIntro(name) {
  const url = `${API_BASE}/api/ai/intro`
  const res = await Taro.request({ url, method: 'POST', data: { name }, header: { 'Content-Type': 'application/json' } })
  if (res.statusCode === 200 && res.data && typeof res.data.text === 'string') return String(res.data.text)
  return ''
}

export async function fetchProIntro(name, desc, url) {
  const api = `${API_BASE}/api/ai/pro-intro`
  const res = await Taro.request({ url: api, method: 'POST', data: { name, desc, url }, header: { 'Content-Type': 'application/json' } })
  if (res.statusCode === 200 && res.data && typeof res.data.text === 'string') return String(res.data.text)
  return ''
}