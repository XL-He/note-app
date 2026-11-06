import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { db } from '../db'
import { nextFireAt } from './schedule'
import type { Reminder } from '../types'

export interface FiredNotice {
  reminderId: string
  noteId: string
  title: string
  body: string
  at: number
}

type Listener = (n: FiredNotice) => void

const listeners = new Set<Listener>()

export function onFire(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function emitFire(n: FiredNotice) {
  for (const fn of listeners) fn(n)
}

/** 是否跑在安卓/iOS 原生壳里 */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** LocalNotifications 的 id 必须是 32 位整数，用字符串哈希稳定映射 */
function numericId(tag: string): number {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (Math.imul(h, 31) + tag.charCodeAt(i)) | 0
  return Math.abs(h) % 2_000_000_000 || 1
}

const CHANNEL_ID = 'reminders'

/** 安卓 8+ 需要先建通知渠道，否则通知不会显示 */
export async function initNativeNotify(): Promise<void> {
  if (!isNative()) return
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: '便签提醒',
      description: '到点提醒你便签里记的事',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#2f6b4f',
    })
  } catch {
    /* 渠道已存在或平台不支持，忽略 */
  }
}

export function notifySupported(): boolean {
  if (isNative()) return true
  return typeof window !== 'undefined' && 'Notification' in window
}

/**
 * 查询当前通知权限（只查询，不弹窗）。
 *
 * ⚠️ 安卓 WebView 里没有 window.Notification 这个全局对象，
 * 任何裸访问 Notification.permission 的代码在手机上都会直接抛
 * ReferenceError 并把 React 整棵树打崩（白屏）。
 * 所以统一从这里查：原生走插件，网页/Electron 走浏览器 API。
 */
export async function queryNotifyPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (isNative()) {
    try {
      const cur = await LocalNotifications.checkPermissions()
      // 原生返回 'granted' | 'denied' | 'prompt'，把 prompt 归一成 default
      return cur.display === 'granted' ? 'granted' : cur.display === 'denied' ? 'denied' : 'default'
    } catch {
      return 'denied'
    }
  }
  if (typeof window !== 'undefined' && 'Notification' in window) {
    return Notification.permission
  }
  return 'denied'
}

export async function ensureNotifyPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (isNative()) {
    try {
      const cur = await LocalNotifications.checkPermissions()
      if (cur.display === 'granted') return 'granted'
      const req = await LocalNotifications.requestPermissions()
      return req.display === 'granted' ? 'granted' : 'denied'
    } catch {
      return 'denied'
    }
  }
  if (!notifySupported()) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export function notifySystem(title: string, body: string, tag: string) {
  if (isNative()) {
    void LocalNotifications.schedule({
      notifications: [
        {
          id: numericId(tag),
          title,
          body,
          channelId: CHANNEL_ID,
          smallIcon: 'ic_stat_icon',
          iconColor: '#2f6b4f',
          // 立即触发。8.x 默认就是精确闹钟，无需（也没有）exact 参数
          schedule: { at: new Date(Date.now() + 50) },
          extra: { tag },
        },
      ],
    }).catch(() => {
      /* 排程失败不影响应用内提示 */
    })
    return
  }

  if (!notifySupported() || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body,
      tag,
      silent: false,
      requireInteraction: true,
    })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* 某些环境不允许直接构造，忽略 */
  }
}

/* ---------------- 原生排程：应用被系统杀掉后也能响 ---------------- */

/** 每条提醒最多预排几次；总条数受系统限制（iOS 64 条，安卓宽松） */
const PER_REMINDER_LIMIT = 8
const TOTAL_LIMIT = 60
const HORIZON_MS = 30 * 24 * 60 * 60 * 1000

/** 从当前 nextAt 往后推演出若干个未来的触发时刻 */
function planTimes(r: Reminder, limit: number): number[] {
  const out: number[] = []
  let next = r.nextAt
  let last = r.lastFire
  let count = r.firedCount
  const horizon = Date.now() + HORIZON_MS

  while (next && out.length < limit && next <= horizon) {
    out.push(next)
    last = next
    count += 1
    next = nextFireAt(r.trigger, last, count, r.createdAt)
  }
  return out
}

/**
 * 把本地所有活跃提醒排进系统通知队列。
 *
 * 应用在后台会被系统挂起，靠应用内轮询是不可靠的，
 * 必须提前把未来要响的时刻交给系统闹钟。每次数据变化就整体重排一遍，
 * 先取消旧的再排新的，避免重复或遗漏。
 */
export async function syncNativeReminders(): Promise<{ scheduled: number }> {
  if (!isNative()) return { scheduled: 0 }

  try {
    const pending = await LocalNotifications.getPending()
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      })
    }
  } catch {
    /* 取不到就算了，下面继续排 */
  }

  const reminders = (await db.reminders.toArray()).filter((r) => r.state === 'active' && r.nextAt)
  const notes = new Map((await db.notes.toArray()).map((n) => [n.id, n]))

  const notifications: {
    id: number
    title: string
    body: string
    channelId: string
    smallIcon: string
    iconColor: string
    schedule: { at: Date }
    extra: { reminderId: string; noteId: string }
  }[] = []

  for (const r of reminders) {
    if (notifications.length >= TOTAL_LIMIT) break
    const note = notes.get(r.noteId)
    const body = note?.plainText.slice(0, 100) || '时间到了'
    const times = planTimes(r, PER_REMINDER_LIMIT)

    times.forEach((at, idx) => {
      if (notifications.length >= TOTAL_LIMIT) return
      if (at < Date.now()) return
      notifications.push({
        // 同一个提醒的不同时间点要不同 id，用 idx 区分
        id: numericId(`${r.id}#${idx}`),
        title: r.title || note?.title || '便签提醒',
        body,
        channelId: CHANNEL_ID,
        smallIcon: 'ic_stat_icon',
        iconColor: '#2f6b4f',
        // 8.x 默认就是精确闹钟；若系统未授予精确闹钟权限会自动降级并给出 warning
        schedule: { at: new Date(at) },
        extra: { reminderId: r.id, noteId: r.noteId },
      })
    })
  }

  if (notifications.length) {
    try {
      const result = await LocalNotifications.schedule({ notifications })
      // 8.x：精确闹钟是默认行为，但若系统未授予精确闹钟权限会自动降级为非精确，
      // 并在 warning 里给出原因——真机排查「提醒不响」时先看这里
      if (result.warning) {
        console.warn('[notify] 提醒排程降级为非精确闹钟:', JSON.stringify(result.warning))
      }
    } catch (e) {
      console.warn('[notify] 提醒排程失败:', e)
      return { scheduled: 0 }
    }
  }
  return { scheduled: notifications.length }
}

/** 点系统通知后跳到对应便签 */
export async function onNotificationTap(cb: (noteId: string) => void): Promise<() => void> {
  if (!isNative()) return () => {}
  try {
    const handle = await LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (e) => {
        const extra = e.notification.extra as { noteId?: string } | undefined
        if (extra?.noteId) cb(extra.noteId)
      },
    )
    return () => {
      void handle.remove()
    }
  } catch {
    return () => {}
  }
}

/** 两声短促提示音，不依赖音频文件 */
export function chime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    ;[0, 0.18].forEach((offset, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = i === 0 ? 880 : 1174
      gain.gain.setValueAtTime(0, now + offset)
      gain.gain.linearRampToValueAtTime(0.12, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.24)
    })
    window.setTimeout(() => void ctx.close(), 800)
  } catch {
    /* 静默失败，不影响提醒本身 */
  }
}
