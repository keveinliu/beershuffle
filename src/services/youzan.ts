export interface YouzanProduct {
  id: number
  title: string
  desc?: string
  productUrl?: string
  imageUrl: string
  filename?: string
  price?: number
}

// 示例数据作为后备
import sample from '../data/youzan_sample.json'

async function fetchLocalProducts(): Promise<YouzanProduct[] | null> {
  try {
    const res = await fetch('/data/youzan_local.json', { cache: 'no-cache' })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || !Array.isArray(data.products)) return null
    return (data.products as any[]).map(p => ({
      id: p.id,
      title: p.title,
      desc: p.desc,
      productUrl: p.productUrl,
      imageUrl: p.imageUrl,
      filename: p.filename,
      price: p.price,
    }))
  } catch {
    return null
  }
}

export async function fetchYouzanProducts(): Promise<YouzanProduct[]> {
  try {
    // 优先使用本地已下载数据
    const local = await fetchLocalProducts()
    if (local && local.length > 0) return local

    // 通过后端API获取（无需在前端携带token）
    const res = await fetch('/api/youzan/products')
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.products)) return data.products as YouzanProduct[]
    }
    throw new Error('fallback to sample')
  } catch (_) {
    return sample.products as YouzanProduct[]
  }
}

export function mapToImageData(products: YouzanProduct[]) {
  return products.map((p, idx) => ({
    id: p.id ?? idx,
    filename: p.filename ?? '',
    description: p.desc ?? '',
    title: p.title ?? '商品',
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
  }))
}