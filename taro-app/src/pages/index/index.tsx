import { useEffect, useRef, useState } from 'react'
import { View, Image, Button, Text, RichText } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { fetchYouzanProducts } from '../../services/youzan'
import { fetchAiIntro, fetchProIntro } from '../../services/ai'

function mapToImageData(products) {
  return products.map((p, idx) => ({
    id: p.id ?? idx,
    title: p.title ?? '商品',
    description: p.desc ?? '',
    imageUrl: p.imageUrl,
    productUrl: p.productUrl ?? ''
  }))
}

export default function Index() {
  const [images, setImages] = useState([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isRolling, setIsRolling] = useState(false)
  const [rollSpeed, setRollSpeed] = useState(120)
  const rollingTimeoutRef = useRef(null)
  const rollingEndTimeoutRef = useRef(null)
  const rollStartTimeRef = useRef(null)
  const currentIndexRef = useRef(0)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiText, setAiText] = useState('')

  const getRandomIndex = (excludeIndex) => {
    let randomIndex
    do {
      randomIndex = Math.floor(Math.random() * images.length)
    } while (randomIndex === excludeIndex)
    return randomIndex
  }

  const handleShuffle = () => {
    if (isRolling || images.length === 0) return
    setAiText('')
    setAiLoading(false)
    setIsRolling(true)
    setRollSpeed(120)
    rollStartTimeRef.current = Date.now()
    currentIndexRef.current = currentImageIndex
    const tick = () => {
      const elapsed = rollStartTimeRef.current ? Date.now() - rollStartTimeRef.current : 0
      const nextIndex = (currentIndexRef.current + 1) % images.length
      setCurrentImageIndex(nextIndex)
      currentIndexRef.current = nextIndex
      const base = 20
      const max = 100
      const total = 3000
      const t = Math.min(elapsed / total, 1)
      const easeOutExpo = (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x))
      const eased = base + (max - base) * easeOutExpo(t)
      const interval = Math.max(24, Math.round(eased))
      setRollSpeed(interval)
      if (elapsed < total) {
        rollingTimeoutRef.current = setTimeout(tick, interval)
      } else {
        const finalIndex = getRandomIndex(currentIndexRef.current)
        setCurrentImageIndex(finalIndex)
        currentIndexRef.current = finalIndex
        rollingEndTimeoutRef.current = setTimeout(() => {
          setIsRolling(false)
        }, interval)
      }
    }
    tick()
  }

  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeUrl = (u) => /^https?:\/\//.test(u) ? u : '#'
  const formatInline = (t) => escapeHtml(t)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, a, b) => `<a style="color:#2563eb" href="${safeUrl(b)}">${a}</a>`)
    .replace(/`([^`]+)`/g, '<code style="padding:2px 4px;background:#f3f4f6;border-radius:4px">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
  const markdownToHtml = (md) => {
    if (!md) return ''
    const lines = md.split(/\r?\n/)
    let inCode = false
    let buf = []
    let html = []
    const flushList = () => {
      if (buf.length > 0) { html.push('<ul style="padding-left:20px">' + buf.join('') + '</ul>'); buf = [] }
    }
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      if (/^```/.test(raw)) { if (!inCode) { inCode = true; html.push('<pre style="background:#f3f4f6;border-radius:8px;padding:12px;overflow:auto"><code>') } else { inCode = false; html.push('</code></pre>') } continue }
      if (inCode) { html.push(escapeHtml(raw) + '\n'); continue }
      const h6 = raw.match(/^######\s*(.*)$/); if (h6) { flushList(); html.push('<h6 style="font-size:12px;font-weight:500">' + formatInline(h6[1]) + '</h6>'); continue }
      const h5 = raw.match(/^#####\s*(.*)$/); if (h5) { flushList(); html.push('<h5 style="font-size:14px;font-weight:500">' + formatInline(h5[1]) + '</h5>'); continue }
      const h4 = raw.match(/^####\s*(.*)$/); if (h4) { flushList(); html.push('<h4 style="font-size:14px;font-weight:600">' + formatInline(h4[1]) + '</h4>'); continue }
      const h3 = raw.match(/^###\s*(.*)$/); if (h3) { flushList(); html.push('<h3 style="font-size:16px;font-weight:600">' + formatInline(h3[1]) + '</h3>'); continue }
      const h2 = raw.match(/^##\s*(.*)$/); if (h2) { flushList(); html.push('<h2 style="font-size:18px;font-weight:700">' + formatInline(h2[1]) + '</h2>'); continue }
      const h1 = raw.match(/^#\s*(.*)$/); if (h1) { flushList(); html.push('<h1 style="font-size:20px;font-weight:700">' + formatInline(h1[1]) + '</h1>'); continue }
      const li = raw.match(/^[-*]\s+(.*)$/); if (li) { buf.push('<li>' + formatInline(li[1]) + '</li>'); continue }
      flushList()
      if (!raw.trim()) { html.push(''); continue }
      html.push('<p>' + formatInline(raw) + '</p>')
    }
    flushList()
    return html.join('\n')
  }

  const handleAi = async () => {
    if (!currentImage?.title) return
    setAiLoading(true)
    setAiText('')
    const text = await fetchAiIntro(currentImage.title)
    setAiText(text)
    setAiLoading(false)
  }

  const handlePro = async () => {
    if (!currentImage?.title) return
    setAiLoading(true)
    setAiText('')
    const text = await fetchProIntro(currentImage.title, currentImage.description, currentImage.productUrl)
    setAiText(text)
    setAiLoading(false)
  }

  const handleOpenLink = async () => {
    const url = currentImage?.productUrl
    if (!url) return
    try { await Taro.setClipboardData({ data: url }); Taro.showToast({ title: '链接已复制', icon: 'none' }) } catch {}
  }

  useEffect(() => {
    return () => {
      if (rollingTimeoutRef.current) clearTimeout(rollingTimeoutRef.current)
      if (rollingEndTimeoutRef.current) clearTimeout(rollingEndTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      const products = await fetchYouzanProducts()
      const mapped = mapToImageData(products)
      if (mapped.length > 0) {
        setImages(mapped)
        const idx = Math.min(currentIndexRef.current, mapped.length - 1)
        setCurrentImageIndex(idx)
        currentIndexRef.current = idx
      }
    }
    load()
  }, [])

  const currentImage = images[currentImageIndex]

  return (
    <View style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <View style={{ maxWidth: '960px', width: '100%' }}>
        <View style={{ textAlign: 'center', marginBottom: '16px' }}>
          <Text style={{ fontSize: '28px', fontWeight: '700', color: '#2C3E50' }}>今天喝什么？</Text>
        </View>
        <View style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 10px 20px rgba(0,0,0,0.05)', overflow: 'hidden', border: '1px solid #f3f4f6' }}>
          <View style={{ position: 'relative', aspectRatio: '16/9', background: 'linear-gradient(135deg,#f3f4f6,#e5e7eb)' }}>
            {currentImage && (
              <Image
                src={currentImage.imageUrl}
                mode="aspectFit"
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </View>
          <View style={{ padding: '16px', background: 'linear-gradient(90deg,rgba(44,62,80,0.05),rgba(44,62,80,0.1))' }}>
            <Text style={{ fontSize: '18px', fontWeight: '700', color: '#2C3E50' }}>{currentImage?.title}</Text>
            <View style={{ marginTop: '6px' }}>
              <Text style={{ color: 'rgba(44,62,80,0.8)' }}>{currentImage?.description}</Text>
            </View>
            {aiText && !isRolling && (
              <View style={{ marginTop: '8px' }}>
                <RichText nodes={markdownToHtml(aiText)} />
              </View>
            )}
            {!isRolling && (
              <View style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
                <Button onClick={handleAi} disabled={aiLoading} style={{ background: '#16a34a', color: '#fff', fontSize: '14px', padding: '8px 12px', borderRadius: '8px' }}>AI介绍</Button>
                <Button onClick={handlePro} disabled={aiLoading} style={{ background: '#2563eb', color: '#fff', fontSize: '14px', padding: '8px 12px', borderRadius: '8px' }}>正经介绍</Button>
                {!!currentImage?.productUrl && (
                  <Button onClick={handleOpenLink} style={{ background: '#374151', color: '#fff', fontSize: '14px', padding: '8px 12px', borderRadius: '8px' }}>复制链接</Button>
                )}
                {aiLoading && (<Text style={{ marginLeft: '8px', color: '#6b7280', fontSize: '12px' }}>生成中...</Text>)}
              </View>
            )}
          </View>
        </View>
        <View style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Button onClick={handleShuffle} disabled={isRolling} style={{ background: '#2C3E50', color: '#fff', padding: '12px 24px', borderRadius: '12px' }}>
            <Text style={{ fontSize: '20px' }}>🎲</Text>
            <Text style={{ marginLeft: '8px' }}>Shuffle</Text>
          </Button>
        </View>
      </View>
    </View>
  )
}
