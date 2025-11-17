import Taro from '@tarojs/taro'

const API_BASE = process.env.TARO_API_BASE || 'https://your-domain'

function pick(obj, keys, fallback) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k]
  }
  return fallback
}

function mapEndpointProduct(p) {
  return {
    id: pick(p, ['id', 'item_id', 'goods_id'], 0),
    title: pick(p, ['title', 'name', 'alias'], '商品'),
    desc: pick(p, ['desc', 'description'], ''),
    productUrl: pick(p, ['productUrl', 'url', 'detail_url'], undefined),
    imageUrl: pick(p, ['imageUrl', 'image', 'image_url', 'thumb_url'], ''),
    price: pick(p, ['price', 'price_display'], undefined),
    miniProgramUrl: pick(p, ['miniProgramUrl'], ''),
    alias: pick(p, ['alias'], undefined),
  }
}

export async function fetchYouzanProducts() {
  const url = `${API_BASE}/api/youzan/products`
  const res = await Taro.request({ url, method: 'GET' })
  const data = res.data
  if (res.statusCode === 200 && data && Array.isArray(data.products)) {
    return data.products.map(mapEndpointProduct)
  }
  return []
}
