import type { TimeTrigger } from '../types'

export const UNIT_MS: Record<TimeTrigger['step']['unit'], number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
}

export const UNIT_LABEL: Record<TimeTrigger['step']['unit'], string> = {
  minute: '分钟',
  hour: '小时',
  day: '天',
  week: '周',
}

export const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六']

export function parseHM(s: string): number {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10) || 0)
  return h * 60 + m
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 把一个时间点规整进"活跃窗口"：
 * 已在窗口内 → 原样返回；早于窗口 → 推到当天窗口开始；晚于窗口 → 推到下一个合法日的窗口开始。
 */
export function alignToWindow(
  t: number,
  w: { days: number[]; from: string; to: string },
): number {
  const from = parseHM(w.from)
  const to = parseHM(w.to)
  const days = w.days.length ? new Set(w.days) : null
  const base = startOfDay(t)

  for (let i = 0; i < 21; i++) {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    if (days && !days.has(d.getDay())) continue

    const dayStart = d.getTime()
    const winStart = dayStart + from * 60_000
    const crossesMidnight = to <= from
    const winEnd = dayStart + to * 60_000 + (crossesMidnight ? 86_400_000 : 0)

    if (t < winStart) return winStart
    if (t < winEnd) return t
  }
  return t
}

export function isInWindow(t: number, w: { days: number[]; from: string; to: string }): boolean {
  return alignToWindow(t, w) === t
}

/**
 * 计算下一次触发时刻。返回 null 表示这条规则已经走到终点。
 * @param lastFire 上一次计划触发时刻（不是实际响铃时刻，避免间隔漂移）
 * @param firedCount 已触发次数
 * @param anchorAt 锚点为 now 时使用的基准时刻（通常是创建时间）
 */
export function nextFireAt(
  trigger: TimeTrigger,
  lastFire: number | null,
  firedCount: number,
  anchorAt: number,
): number | null {
  const end = trigger.end
  if (end.type === 'count' && firedCount >= end.value) return null

  let base: number
  if (lastFire === null) {
    base = trigger.anchor.type === 'absolute' ? trigger.anchor.at : anchorAt
  } else {
    base = lastFire + trigger.step.amount * UNIT_MS[trigger.step.unit]
  }

  if (end.type === 'until' && base > end.at) return null

  const t = trigger.window ? alignToWindow(base, trigger.window) : base

  if (end.type === 'until' && t > end.at) return null
  if (lastFire !== null && t <= lastFire) return null
  return t
}

/** 生成一句人话描述，列表和面板上直接用 */
export function describeTrigger(trigger: TimeTrigger): string {
  const { step, window: w, end, anchor } = trigger

  // 一次性到点提醒，不提"间隔"
  if (end.type === 'count' && end.value === 1 && anchor.type === 'absolute' && !w) {
    return `${fmtDateTime(anchor.at)} 提醒一次`
  }

  const parts: string[] = []
  const interval =
    step.amount === 1
      ? `每${UNIT_LABEL[step.unit]}`
      : `每 ${step.amount} ${UNIT_LABEL[step.unit]}`

  if (anchor.type === 'absolute') {
    parts.push(`${fmtDateTime(anchor.at)} 起，${interval}`)
  } else {
    parts.push(interval)
  }

  if (w) {
    const dayText = w.days.length === 7 || w.days.length === 0
      ? '每天'
      : w.days.map((d) => `周${WEEK_LABEL[d]}`).join('、')
    parts.push(`${dayText} ${w.from}–${w.to}`)
  }

  if (end.type === 'count') parts.push(`共 ${end.value} 次`)
  else if (end.type === 'until') parts.push(`到 ${fmtDateTime(end.at)} 为止`)
  else parts.push('手动停止')

  return parts.join(' · ')
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtRelative(ts: number, now = Date.now()): string {
  const diff = ts - now
  if (diff <= 0) return '即将'
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return '不到 1 分钟'
  if (mins < 60) return `${mins} 分钟后`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} 小时后`
  const days = Math.round(hours / 24)
  return `${days} 天后`
}

function pad(n: number): string {
  return `${n}`.padStart(2, '0')
}

/** 建一条规则的快捷模板 */
export function presetTrigger(
  kind: 'in1m' | 'in30m' | 'in3h' | 'tonight' | 'tomorrow9' | 'every2h',
): TimeTrigger {
  const now = Date.now()
  const base: TimeTrigger = {
    kind: 'time',
    anchor: { type: 'now' },
    step: { amount: 1, unit: 'hour' },
    window: null,
    end: { type: 'count', value: 1 },
    escalate: [{ after: 0, channel: 'local' }],
    quiet: null,
  }

  switch (kind) {
    case 'in1m':
      return { ...base, anchor: { type: 'absolute', at: now + 60_000 } }
    case 'in30m':
      return { ...base, anchor: { type: 'absolute', at: now + 30 * 60_000 } }
    case 'in3h':
      return { ...base, anchor: { type: 'absolute', at: now + 3 * 3_600_000 } }
    case 'tonight': {
      const d = new Date()
      d.setHours(20, 0, 0, 0)
      const at = d.getTime() > now ? d.getTime() : d.getTime() + 86_400_000
      return { ...base, anchor: { type: 'absolute', at } }
    }
    case 'tomorrow9': {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return { ...base, anchor: { type: 'absolute', at: d.getTime() } }
    }
    case 'every2h':
      return {
        ...base,
        anchor: { type: 'now' },
        step: { amount: 2, unit: 'hour' },
        window: { days: [], from: '09:00', to: '21:00' },
        end: { type: 'count', value: 6 },
      }
  }
}
