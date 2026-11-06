import { nextFireAt, alignToWindow, describeTrigger, presetTrigger } from '../src/lib/schedule.ts'
import type { TimeTrigger } from '../src/types.ts'

const H = 3600_000
const M = 60_000

function at(h: number, m = 0): number {
  const d = new Date(2026, 10, 5, h, m, 0, 0)
  return d.getTime()
}

let pass = 0
let fail = 0

function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else {
    fail++
    console.log(`FAIL ${name}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`)
  }
}

function fmt(ts: number | null) {
  if (ts === null) return null
  const d = new Date(ts)
  const p = (n: number) => `${n}`.padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const base: TimeTrigger = {
  kind: 'time',
  anchor: { type: 'now' },
  step: { amount: 1, unit: 'hour' },
  window: null,
  end: { type: 'count', value: 1 },
  escalate: [],
  quiet: null,
}

// 1. 一次性：3 小时后，响完就结束
const once = { ...base, anchor: { type: 'absolute', at: at(14) } } as TimeTrigger
eq('一次性首次', fmt(nextFireAt(once, null, 0, at(11))), '11-05 14:00')
eq('一次性结束后', nextFireAt(once, at(14), 1, at(11)), null)

// 2. 每 2 小时，9–21 点，共 6 次
const every2h: TimeTrigger = {
  ...base,
  anchor: { type: 'now' },
  step: { amount: 2, unit: 'hour' },
  window: { days: [], from: '09:00', to: '21:00' },
  end: { type: 'count', value: 6 },
}
eq('间隔首次', fmt(nextFireAt(every2h, null, 0, at(9))), '11-05 09:00')
eq('间隔第2次', fmt(nextFireAt(every2h, at(9), 1, at(9))), '11-05 11:00')
eq('间隔第7次超次数', nextFireAt(every2h, at(21), 6, at(9)), null)
// 21:00 之后 +2h = 23:00 在窗口外 → 推到次日 9:00
eq('窗口外顺延', fmt(nextFireAt(every2h, at(21), 5, at(9))), '11-06 09:00')

// 3. 窗口规整
eq('窗口内保持', fmt(alignToWindow(at(10), { days: [], from: '09:00', to: '21:00' })), '11-05 10:00')
eq('早于窗口', fmt(alignToWindow(at(7), { days: [], from: '09:00', to: '21:00' })), '11-05 09:00')
eq('晚于窗口', fmt(alignToWindow(at(23), { days: [], from: '09:00', to: '21:00' })), '11-06 09:00')

// 4. 只在工作日：周六 10 点 → 下周一 9 点
const workday = { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }
eq(
  '跳过周末',
  fmt(alignToWindow(new Date(2026, 10, 7, 10, 0).getTime(), workday)),
  '11-09 09:00',
)

// 5. 手动停：永远有下一次
const manual = { ...base, step: { amount: 5, unit: 'minute' as const }, end: { type: 'manual' as const } }
eq('手动停首次', fmt(nextFireAt(manual, null, 0, at(9))), '11-05 09:00')
eq('手动停第100次', fmt(nextFireAt(manual, at(17, 25), 100, at(9))), '11-05 17:30')

// 6. 到某日为止
const until: TimeTrigger = {
  ...base,
  step: { amount: 1, unit: 'day' },
  end: { type: 'until', at: at(10) + 2 * 24 * H },
}
eq('未到期', fmt(nextFireAt(until, null, 0, at(9))), '11-05 09:00')
eq('已过截止', nextFireAt(until, at(9) + 2 * 24 * H, 2, at(9)), null)

// 7. 描述文案
console.log('\n预览文案:')
console.log(' ', describeTrigger(every2h))
console.log(' ', describeTrigger(presetTrigger('tomorrow9')))
console.log(' ', describeTrigger(presetTrigger('every2h')))

// 8. 贪睡不改节奏：snooze 只改 nextAt，这里验证规则本身仍从计划时刻推进
eq('贪睡后下一次仍按节奏', fmt(nextFireAt(every2h, at(9), 1, at(9))), '11-05 11:00')

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
if (fail > 0) process.exit(1)
