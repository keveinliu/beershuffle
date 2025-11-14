import { useState, useEffect, useRef } from 'react'
import imagesData from './data/images.json'
import { fetchYouzanProducts, mapToImageData } from './services/youzan'
// 后端分离后，前端不再直接读取有赞凭证

interface ImageData {
  id: number
  filename: string
  description: string
  title: string
  imageUrl?: string
  productUrl?: string
}

function App() {
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [history, setHistory] = useState<number[]>([0])
  const [prevImageIndex, setPrevImageIndex] = useState<number | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isRolling, setIsRolling] = useState(false)
  const [rollSpeed, setRollSpeed] = useState(120) // ms, 初始较快
  const rollingTimeoutRef = useRef<number | null>(null)
  const rollingEndTimeoutRef = useRef<number | null>(null)
  const rollStartTimeRef = useRef<number | null>(null)
  const [snapReset, setSnapReset] = useState(false)
  const currentIndexRef = useRef(0)
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([])
  const thumbContainerRef = useRef<HTMLDivElement | null>(null)
  const [images, setImages] = useState<ImageData[]>(imagesData as ImageData[])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiText, setAiText] = useState('')

  const resolveImageSrc = (img: ImageData) => (img.filename ? `/images/${img.filename}` : (img.imageUrl ?? ''))

  const getRandomIndex = (excludeIndex: number): number => {
    let randomIndex
    do {
      randomIndex = Math.floor(Math.random() * images.length)
    } while (randomIndex === excludeIndex)
    return randomIndex
  }

  const handleShuffle = () => {
    if (isRolling) return
    setAiText('')
    setAiLoading(false)
    setIsRolling(true)
    setIsLoading(false) // 滚动期间不显示加载遮罩
    setRollSpeed(120)
    rollStartTimeRef.current = Date.now()
    currentIndexRef.current = currentImageIndex

    // 递归的滚动tick，逐渐减速
    const tick = () => {
      const elapsed = rollStartTimeRef.current ? Date.now() - rollStartTimeRef.current : 0
      // 顺序切换更像老虎机，也更连续
      const nextIndex = (currentIndexRef.current + 1) % images.length
      setPrevImageIndex(currentIndexRef.current)
      setCurrentImageIndex(nextIndex)
      currentIndexRef.current = nextIndex
      setHistory(prev => [...prev, nextIndex])
      setIsAnimating(true)

      // 根据已过时间调整速度（更快的 ease-out），提升频率
      const base = 20 // 更短的初始间隔，提升滚动速度
      const max = 100 // 结尾间隔也更短，整体更快
      const total = 3000
      const t = Math.min(elapsed / total, 1)
      const easeOutExpo = (x: number) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x))
      const eased = base + (max - base) * easeOutExpo(t)
      const interval = Math.max(24, Math.round(eased))
      setRollSpeed(interval)

      if (elapsed < total) {
        rollingTimeoutRef.current = window.setTimeout(tick, interval)
      } else {
        // 最终停在一个随机图片上
        const finalIndex = getRandomIndex(currentIndexRef.current)
        setPrevImageIndex(currentIndexRef.current)
        setCurrentImageIndex(finalIndex)
        currentIndexRef.current = finalIndex
        setHistory(prev => [...prev, finalIndex])
        setIsAnimating(true)

        // 最后一跳后结束滚动状态并清理前图
        rollingEndTimeoutRef.current = window.setTimeout(() => {
          setIsRolling(false)
          setIsLoading(false)
          setPrevImageIndex(null)
        }, interval)
      }
    }

    tick()
  }

  const handleAiIntro = async () => {
    if (!currentImage?.title) return
    setAiLoading(true)
    setAiText('')
    try {
      const res = await fetch('/api/ai/intro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentImage.title })
      })
      if (res.ok) {
        const data = await res.json()
        setAiText(String(data?.text || ''))
      } else {
        setAiText('')
      }
    } catch {
      setAiText('')
    } finally {
      setAiLoading(false)
    }
  }

  const handleProIntro = async () => {
    if (!currentImage?.title) return
    setAiLoading(true)
    setAiText('')
    try {
      const res = await fetch('/api/ai/pro-intro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentImage.title, desc: currentImage.description, url: currentImage.productUrl })
      })
      if (res.ok) {
        const data = await res.json()
        setAiText(String(data?.text || ''))
      } else {
        setAiText('')
      }
    } catch {
      setAiText('')
    } finally {
      setAiLoading(false)
    }
  }

  const handleImageLoad = () => {
    setIsLoading(false)
  }

  const handleImageError = () => {
    setIsLoading(false)
  }

  useEffect(() => {
    // 预加载下一张图片
    const nextIndex = getRandomIndex(currentImageIndex)
    const img = new Image()
    img.src = resolveImageSrc(images[nextIndex])
  }, [currentImageIndex])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (rollingTimeoutRef.current) {
        clearTimeout(rollingTimeoutRef.current)
      }
      if (rollingEndTimeoutRef.current) {
        clearTimeout(rollingEndTimeoutRef.current)
      }
    }
  }, [])

  // 缩略图自动居中当前项
  useEffect(() => {
    const el = thumbRefs.current[currentImageIndex]
    if (el) {
      el.scrollIntoView({ behavior: isRolling ? 'auto' : 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [currentImageIndex, isRolling])

  // 有赞商品同步：初始化与定时刷新（30分钟），通过后端API
  useEffect(() => {
    let timer: number | undefined
    const load = async () => {
      try {
        const products = await fetchYouzanProducts()
        const mapped = mapToImageData(products) as ImageData[]
        if (!isRolling && mapped.length > 0) {
          setImages(mapped)
          const idx = Math.min(currentIndexRef.current, mapped.length - 1)
          setCurrentImageIndex(idx)
          currentIndexRef.current = idx
        }
      } catch {
      }
    }
    load()
    timer = window.setInterval(load, 30 * 60 * 1000)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [isRolling])

  const currentImage = images[currentImageIndex]
  const prevImage = prevImageIndex !== null ? images[prevImageIndex] : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-[#2C3E50] mb-2">今天喝什么？</h1>
          <p className="text-[#2C3E50]/70">不知道该喝什么？点击Shuffle按钮</p>
        </div>

        {/* 图片展示区 */}
        <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-6 border border-gray-100">
          <div className="relative aspect-video bg-gradient-to-br from-gray-50 to-gray-100">
            {isRolling && (
              <div className="absolute top-3 left-3 z-20 bg-[#2C3E50] text-white text-xs px-2 py-1 rounded-md shadow-sm animate-pulse">
                Rolling...
              </div>
            )}
            {isLoading && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-none">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#2C3E50]"></div>
              </div>
            )}
            {/* 中央缩略图快速变换（滚动时）/ 正常大小（停止时） */}
            {isRolling ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-28 h-28 sm:w-36 sm:h-36 md:w-44 md:h-44 rounded-lg overflow-hidden ring-2 ring-[#2C3E50] shadow-lg bg-white">
                  {prevImage && (
                    <img
                      key={`prev-${prevImage.filename}`}
                      src={resolveImageSrc(prevImage)}
                      alt={prevImage.description}
                      title={prevImage.title}
                      className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity"
                      style={{ transitionDuration: `${rollSpeed}ms` }}
                    />
                  )}
                  <img
                    key={`cur-${currentImage.filename}`}
                    src={resolveImageSrc(currentImage)}
                    alt={currentImage.description}
                    title={currentImage.title}
                    className="absolute inset-0 w-full h-full object-cover opacity-100 transition-opacity"
                    style={{ transitionDuration: `${rollSpeed}ms` }}
                  />
                </div>
              </div>
            ) : (
              currentImage.productUrl ? (
                <a href={currentImage.productUrl} target="_blank" rel="noopener noreferrer">
                  <img
                    src={resolveImageSrc(currentImage)}
                    alt={currentImage.description}
                    title={currentImage.title}
                    className="w-full h-full object-contain transition-transform duration-300 hover:scale-105"
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                  />
                </a>
              ) : (
                <img
                  src={resolveImageSrc(currentImage)}
                  alt={currentImage.description}
                  title={currentImage.title}
                  className="w-full h-full object-contain transition-transform duration-300 hover:scale-105"
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              )
            )}
          </div>

          {/* 图片信息：滚动时隐藏，停止后淡入显示 */}
          <div
            className={`p-6 bg-gradient-to-r from-[#2C3E50]/5 to-[#2C3E50]/10 transition-opacity duration-300 ${
              isRolling ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <h3 className="text-xl font-bold text-[#2C3E50] mb-2">{currentImage.title}</h3>
            <p className="text-[#2C3E50]/80">{currentImage.description}</p>
            {!isRolling && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleAiIntro}
                  disabled={aiLoading}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white text-sm font-semibold px-4 py-2 rounded-md"
                >
                  AI介绍
                </button>
                <button
                  onClick={handleProIntro}
                  disabled={aiLoading}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm font-semibold px-4 py-2 rounded-md"
                >
                  正经介绍
                </button>
                {aiLoading && <span className="text-sm text-gray-500">生成中...</span>}
              </div>
            )}
            {aiText && !isRolling && (
              <div className="mt-3 text-sm text-[#2C3E50] whitespace-pre-line">{aiText}</div>
            )}
          </div>
      </div>

        {/* 控制区域：居中Shuffle按钮 */}
        <div className="mt-4 flex items-center justify-center">
          <button
            onClick={handleShuffle}
            disabled={isLoading || isRolling}
            className="bg-[#2C3E50] hover:bg-[#2C3E50]/90 disabled:bg-[#2C3E50]/50 text-white font-bold py-4 px-8 rounded-xl transition-all duration-200 flex items-center gap-3 min-w-[140px] justify-center shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95"
          >
            <span className="text-2xl">🎲</span>
            Shuffle
          </button>
        </div>

      </div>
      <footer className="fixed bottom-2 left-0 right-0 text-center text-gray-500 text-xs">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">京ICP备2023040676号-1</a>
      </footer>
    </div>
  )
}

export default App
