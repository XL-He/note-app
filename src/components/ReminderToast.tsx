import { Bell, X } from 'lucide-react'
import type { FiredNotice } from '../lib/notify'

interface Props {
  items: FiredNotice[]
  onDismiss: (reminderId: string) => void
  onSnooze: (reminderId: string) => void
  onOpen: (noteId: string) => void
}

export default function ReminderToast({ items, onDismiss, onSnooze, onOpen }: Props) {
  if (!items.length) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[300px] flex-col gap-2">
      {items.map((n) => (
        <div
          key={n.reminderId}
          className="pointer-events-auto rounded-lg border border-[#e3e3dc] border-l-[3px] border-l-[#2f6b4f] bg-white px-3 py-2.5 shadow-[0_6px_20px_rgba(0,0,0,0.08)]"
        >
          <div className="flex items-start gap-2">
            <Bell size={13} className="mt-0.5 shrink-0 text-[#2f6b4f]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-[#23271f]">{n.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[#7b8278]">
                {n.body}
              </div>
            </div>
            <button
              onClick={() => onDismiss(n.reminderId)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#b3b8af] hover:bg-black/5"
            >
              <X size={12} />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5 pl-5">
            <button
              onClick={() => onOpen(n.noteId)}
              className="rounded-md bg-[#2f6b4f] px-2 py-0.5 text-[11px] text-white hover:opacity-90"
            >
              打开便签
            </button>
            <button
              onClick={() => onSnooze(n.reminderId)}
              className="rounded-md border border-[#e4e4dd] px-2 py-0.5 text-[11px] text-[#5d645a] hover:bg-[#f7f7f2]"
            >
              5 分钟后再提醒
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
