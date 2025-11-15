import { useEffect, useState } from 'react'
import { WebView } from '@tarojs/components'
import Taro, { getCurrentInstance } from '@tarojs/taro'

export default function WebviewPage() {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const inst = getCurrentInstance()
    const u = decodeURIComponent(inst?.router?.params?.url || '')
    setUrl(u)
  }, [])
  return <WebView src={url} />
}