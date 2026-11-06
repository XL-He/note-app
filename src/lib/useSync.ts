import { useCallback, useEffect, useRef, useState } from 'react'
import { syncNow } from './sync'

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'error'

/** 同步间隔选项。ms = 0 表示只手动同步 */
export const SYNC_INTERVALS = [
  { key: '1m', label: '每 1 分钟', ms: 60_000, hint: '最及时，约 60MB/月' },
  { key: '3m', label: '每 3 分钟', ms: 3 * 60_000, hint: '推荐，约 20MB/月' },
  { key: '30m', label: '每 30 分钟', ms: 30 * 60_000, hint: '省流量，约 2MB/月' },
  { key: '6h', label: '每 6 小时', ms: 6 * 60 * 60_000, hint: '几乎不耗流量' },
  { key: 'manual', label: '仅手动', ms: 0, hint: '只在你点同步时联网' },
] as const

export type SyncIntervalKey = (typeof SYNC_INTERVALS)[number]['key']

const INTERVAL_KEY = 'dav-sync-interval'
const DEFAULT_INTERVAL: SyncIntervalKey = '3m'

export function loadIntervalKey(): SyncIntervalKey {
  try {
    const raw = localStorage.getItem(INTERVAL_KEY)
    if (raw && SYNC_INTERVALS.some((i) => i.key === raw)) return raw as SyncIntervalKey
  } catch {
    /* localStorage 不可用时回落到默认值 */
  }
  return DEFAULT_INTERVAL
}

export function saveIntervalKey(key: SyncIntervalKey): void {
  localStorage.setItem(INTERVAL_KEY, key)
}

export function intervalMsOf(key: SyncIntervalKey): number {
  return SYNC_INTERVALS.find((i) => i.key === key)?.ms ?? 3 * 60_000
}

/**
 * 同步调度。
 *
 * 网盘没有推送能力，只能轮询。但轮询本身很轻：一次 PROPFIND 只有 1KB 左右，
 * 真正的开销是「没变化还下载全文」，那部分由 sync.ts 里的 lastModified 缓存挡掉了。
 * 所以这里只管「多久问一次」，间隔交给用户按流量偏好决定。
 */
export function useSync(enabled: boolean, onApplied: () => void, intervalKey: SyncIntervalKey) {
  const [phase, setPhase] = useState<SyncPhase>(enabled ? 'idle' : 'off')
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const applied = useRef(onApplied)
  applied.current = onApplied
  const timer = useRef<number | undefined>(undefined)
  const busy = useRef(false)

  const run = useCallback(async () => {
    if (!enabled || busy.current) return
    busy.current = true
    setPhase('syncing')
    try {
      const r = await syncNow()
      setLastAt(Date.now())
      setMessage('')
      setPhase('idle')
      if (r.pulled || r.deleted) applied.current()
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : '同步失败')
    } finally {
      busy.current = false
    }
  }, [enabled])

  /** 本地改完，隔两秒推一次，避免每次敲键盘都打网络 */
  const requestSync = useCallback(() => {
    if (!enabled) return
    // 选了「仅手动」就不自动推，否则名不副实
    if (intervalMsOf(intervalKey) === 0) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void run(), 2000)
  }, [enabled, run, intervalKey])

  useEffect(() => {
    setPhase(enabled ? 'idle' : 'off')
    if (!enabled) return

    void run()

    const ms = intervalMsOf(intervalKey)
    // 手动模式不设定时器；但切回窗口仍补一次，避免回来看到旧数据
    const id = ms > 0 ? window.setInterval(() => void run(), ms) : undefined

    const onFocus = () => void run()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (id) window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, run, intervalKey])

  return { phase, lastAt, message, run, requestSync }
}
