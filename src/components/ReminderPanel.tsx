import { useEffect, useMemo, useState } from 'react'
import { Bell, BellRing, Clock, Trash2, X } from 'lucide-react'
import type { Note, Reminder, TimeTrigger } from '../types'
import { createReminder, listByNote, removeReminder } from '../db/reminders'
import {
  UNIT_LABEL,
  WEEK_LABEL,
  describeTrigger,
  fmtDateTime,
  fmtRelative,
  nextFireAt,
  presetTrigger,
} from '../lib/schedule'
import { ensureNotifyPermission, notifySupported, queryNotifyPermission } from '../lib/notify'

interface Props {
  note: Note
  open: boolean
  onClose: () => void
  onChanged: () => void
}

const PRESETS: { key: Parameters<typeof presetTrigger>[0]; label: string }[] = [
  { key: 'in1m', label: '1 分钟后' },
  { key: 'in30m', label: '30 分钟后' },
  { key: 'in3h', label: '3 小时后' },
  { key: 'tonight', label: '今晚 20:00' },
  { key: 'tomorrow9', label: '明早 9:00' },
  { key: 'every2h', label: '每 2 小时（9–21 点）' },
]

function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function ReminderPanel({ note, open, onClose, onChanged }: Props) {
  const [items, setItems] = useState<Reminder[]>([])
  const [perm, setPerm] = useState<NotificationPermission>('default')

  const [anchorMode, setAnchorMode] = useState<'now' | 'at'>('now')
  const [anchorAt, setAnchorAt] = useState(() => toLocalInput(Date.now() + 3600_000))
  const [amount, setAmount] = useState(1)
  const [unit, setUnit] = useState<'minute' | 'hour' | 'day' | 'week'>('hour')
  const [windowOn, setWindowOn] = useState(false)
  const [winFrom, setWinFrom] = useState('09:00')
  const [winTo, setWinTo] = useState('21:00')
  const [days, setDays] = useState<number[]>([])
  const [endType, setEndType] = useState<'count' | 'until' | 'manual'>('count')
  const [endCount, setEndCount] = useState(1)

  useEffect(() => {
    if (!open) return
    void listByNote(note.id).then(setItems)
    // 不能裸读 Notification.permission：安卓 WebView 没有这个全局对象，
    // 之前在这里裸读导致手机端一打开面板就 ReferenceError 白屏
    void queryNotifyPermission().then(setPerm)
  }, [open, note.id])

  const draft = useMemo<TimeTrigger>(() => {
    return {
      kind: 'time',
      anchor:
        anchorMode === 'now'
          ? { type: 'now' }
          : { type: 'absolute', at: new Date(anchorAt).getTime() },
      step: { amount: Math.max(1, amount), unit },
      window: windowOn ? { days, from: winFrom, to: winTo } : null,
      end:
        endType === 'count'
          ? { type: 'count', value: Math.max(1, endCount) }
          : endType === 'until'
            ? { type: 'until', at: Date.now() + 7 * 86_400_000 }
            : { type: 'manual' },
      escalate: [{ after: 0, channel: 'local' }],
      quiet: null,
    }
  }, [anchorMode, anchorAt, amount, unit, windowOn, days, winFrom, winTo, endType, endCount])

  const firstAt = nextFireAt(draft, null, 0, Date.now())

  if (!open) return null

  async function save(trigger: TimeTrigger) {
    await ensureNotifyPermission()
    await createReminder(note.id, note.title || '便签提醒', trigger)
    onChanged()
    onClose()
  }

  async function drop(id: string) {
    await removeReminder(id)
    setItems(await listByNote(note.id))
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[380px] flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[#eeeeea] px-4 py-3">
          <BellRing size={15} className="text-[#2f6b4f]" />
          <h2 className="text-[13.5px] font-medium">提醒</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-[#8b9188] hover:bg-black/5"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {items.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 text-[11px] font-medium text-[#8b9188]">已设置</div>
              {items.map((r) => (
                <div
                  key={r.id}
                  className="mb-2 flex items-start gap-2 rounded-lg border border-[#ececE6] bg-[#fbfbf8] px-3 py-2.5"
                >
                  <Clock size={13} className="mt-0.5 shrink-0 text-[#2f6b4f]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-[#2b302a]">
                      {r.nextAt ? (
                        <>
                          {fmtDateTime(r.nextAt)}
                          <span className="ml-1.5 text-[11px] text-[#8b9188]">
                            {fmtRelative(r.nextAt)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[#8b9188]">已结束</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[#8b9188]">
                      {describeTrigger(r.trigger)}
                      {r.firedCount > 0 && ` · 已响 ${r.firedCount} 次`}
                    </div>
                  </div>
                  <button
                    onClick={() => void drop(r.id)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#b3b8af] hover:bg-[#fdecec] hover:text-[#c0392b]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mb-2 text-[11px] font-medium text-[#8b9188]">快速设置</div>
          <div className="mb-5 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => void save(presetTrigger(p.key))}
                className="rounded-full border border-[#e4e4dd] px-2.5 py-1 text-[11.5px] text-[#4a5048] transition-colors hover:border-[#2f6b4f]/50 hover:bg-[#f2f6f2] hover:text-[#2f6b4f]"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mb-2 text-[11px] font-medium text-[#8b9188]">自定义</div>
          <div className="space-y-3 rounded-lg border border-[#ececE6] p-3">
            <div>
              <div className="mb-1.5 text-[11.5px] text-[#6b7168]">从什么时候开始</div>
              <div className="flex items-center gap-1.5">
                <div className="flex rounded-md bg-[#f0f0eb] p-0.5">
                  {(['now', 'at'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setAnchorMode(m)}
                      className={`rounded px-2 py-0.5 text-[11.5px] ${
                        anchorMode === m ? 'bg-white font-medium shadow-sm' : 'text-[#737a70]'
                      }`}
                    >
                      {m === 'now' ? '现在' : '指定时刻'}
                    </button>
                  ))}
                </div>
                {anchorMode === 'at' && (
                  <input
                    type="datetime-local"
                    value={anchorAt}
                    onChange={(e) => setAnchorAt(e.target.value)}
                    className="flex-1 rounded-md border border-[#e4e4dd] px-2 py-1 text-[11.5px] outline-none"
                  />
                )}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[11.5px] text-[#6b7168]">间隔</div>
              <div className="flex items-center gap-1.5 text-[11.5px]">
                <span className="text-[#737a70]">每</span>
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-14 rounded-md border border-[#e4e4dd] px-2 py-1 outline-none"
                />
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as typeof unit)}
                  className="rounded-md border border-[#e4e4dd] bg-white px-1.5 py-1 outline-none"
                >
                  {(['minute', 'hour', 'day', 'week'] as const).map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u]}
                    </option>
                  ))}
                </select>
                <span className="text-[#9aa097]">提醒一次</span>
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11.5px] text-[#6b7168]">
                <input
                  type="checkbox"
                  checked={windowOn}
                  onChange={(e) => setWindowOn(e.target.checked)}
                />
                只在特定时段提醒
              </label>
              {windowOn && (
                <div className="mt-2 space-y-2 pl-5">
                  <div className="flex items-center gap-1.5 text-[11.5px]">
                    <input
                      type="time"
                      value={winFrom}
                      onChange={(e) => setWinFrom(e.target.value)}
                      className="rounded-md border border-[#e4e4dd] px-1.5 py-1 outline-none"
                    />
                    <span className="text-[#9aa097]">到</span>
                    <input
                      type="time"
                      value={winTo}
                      onChange={(e) => setWinTo(e.target.value)}
                      className="rounded-md border border-[#e4e4dd] px-1.5 py-1 outline-none"
                    />
                  </div>
                  <div className="flex gap-1">
                    {WEEK_LABEL.map((label, idx) => {
                      const on = days.includes(idx)
                      return (
                        <button
                          key={idx}
                          onClick={() =>
                            setDays((d) => (on ? d.filter((x) => x !== idx) : [...d, idx]))
                          }
                          className={`h-6 w-6 rounded-full text-[11px] transition-colors ${
                            on ? 'bg-[#2f6b4f] text-white' : 'bg-[#f0f0eb] text-[#737a70]'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="text-[10.5px] text-[#a3a89f]">不选任何一天 = 每天都适用</div>
                </div>
              )}
            </div>

            <div>
              <div className="mb-1.5 text-[11.5px] text-[#6b7168]">什么时候停</div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                {(['count', 'manual'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setEndType(t)}
                    className={`rounded-md px-2 py-0.5 ${
                      endType === t
                        ? 'bg-[#2f6b4f]/10 font-medium text-[#2f6b4f]'
                        : 'bg-[#f4f4ef] text-[#737a70]'
                    }`}
                  >
                    {t === 'count' ? '响固定次数' : '手动停'}
                  </button>
                ))}
                {endType === 'count' && (
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      value={endCount}
                      onChange={(e) => setEndCount(Number(e.target.value))}
                      className="w-14 rounded-md border border-[#e4e4dd] px-2 py-0.5 outline-none"
                    />
                    次
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-[#f5f8f5] px-3 py-2 text-[11.5px] leading-relaxed text-[#3f6b53]">
            <div>{describeTrigger(draft)}</div>
            <div className="mt-0.5 text-[#6b8a78]">
              首次提醒：{firstAt ? `${fmtDateTime(firstAt)}（${fmtRelative(firstAt)}）` : '不会触发'}
            </div>
          </div>

          {notifySupported() && perm !== 'granted' && (
            <button
              onClick={async () => {
                const p = await ensureNotifyPermission()
                setPerm(p)
              }}
              className="mt-2 flex w-full items-center gap-2 rounded-lg border border-[#e4e4dd] px-3 py-2 text-left text-[11.5px] text-[#6b7168] hover:bg-[#f7f7f2]"
            >
              <Bell size={12} />
              开启系统通知
              <span className="ml-auto text-[10.5px] text-[#a3a89f]">页面关掉就收不到</span>
            </button>
          )}
        </div>

        <div className="border-t border-[#eeeeea] p-3">
          <button
            onClick={() => void save(draft)}
            disabled={!firstAt}
            className="w-full rounded-lg bg-[#2f6b4f] py-2 text-[12.5px] font-medium text-white disabled:opacity-40"
          >
            保存这条提醒
          </button>
        </div>
      </div>
    </div>
  )
}
