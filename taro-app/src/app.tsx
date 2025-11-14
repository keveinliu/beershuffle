import './app.scss'
import { useLaunch } from '@tarojs/taro'

export default function App({ children }) {
  useLaunch(() => {})
  return children
}
