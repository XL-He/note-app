import { useEffect, useState } from 'react'
import { AlertTriangle, HardDrive, RefreshCw, Trash2, X } from 'lucide-react'
import type { StorageStats } from '../db/assets'
import { formatBytes } from '../db/assets'

interface Props {
  open: boolean
  stats: StorageStats | null
  onClose: () => void
  onPurgeExpired: () => Promise<string>
  onEmptyTrash: () => Promise<string>
  onSweep: () => Promise<string>
  onRefresh: () => void
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[#ececE6] bg-[#fbfbf8] px-3 py-2.5">
      <div className="text-[11px] text-[#8b9188]">{label}</div>
      <div className="mt-0.5 text-[17px] font-medium tabular-nums text-[#1f2320]">{value}</div>
      {hint && <div className="mt-0.5 text-[10.5px] text-[#a8ada4]">{hint}</div>}
    </div>
  )
}

export default function StoragePanel({
  open,
  stats,
  onClose,
  onPurgeExpired,
  onEmptyTrash,
  onSweep,
  onRefresh,
}: Props) {
  const [msg, setMsg] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) setMsg('')
  }, [open])

  if (!open) return null

  async function run(fn: () => Promise<string>) {
    setBusy(true)
    try {
      const m = await fn()
      setMsg(m)
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-xl border border-[#e6e6df] bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <HardDrive size={16} className="text-[#2f6b4f]" />
          <h2 className="text-[14px] font-medium">存储管理</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-[#8b9188] hover:bg-black/5"
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="总占用"
            value={stats ? formatBytes(stats.totalBytes) : '—'}
            hint={stats ? `${stats.imageCount} 张图片` : ''}
          />
          <Stat
            label="回收站占用"
            value={stats ? formatBytes(stats.trashBytes) : '—'}
            hint={stats ? `${stats.trashNotes} 条便签` : ''}
          />
          <Stat label="原图" value={stats ? formatBytes(stats.origBytes) : '—'} />
          <Stat label="缩略图" value={stats ? formatBytes(stats.thumbBytes) : '—'} />
        </div>

        <div className="mt-4 space-y-2">
          <button
            disabled={busy}
            onClick={() => run(onPurgeExpired)}
            className="flex w-full items-center gap-2 rounded-lg border border-[#e6e6df] px-3 py-2 text-left text-[12.5px] hover:bg-[#f7f7f2] disabled:opacity-50"
          >
            <RefreshCw size={13} className="text-[#2f6b4f]" />
            清理到期便签
            <span className="ml-auto text-[11px] text-[#a3a89f]">超过 30 天</span>
          </button>
          <button
            disabled={busy}
            onClick={() => run(onSweep)}
            className="flex w-full items-center gap-2 rounded-lg border border-[#e6e6df] px-3 py-2 text-left text-[12.5px] hover:bg-[#f7f7f2] disabled:opacity-50"
          >
            <RefreshCw size={13} className="text-[#2f6b4f]" />
            扫描残留文件
            <span className="ml-auto text-[11px] text-[#a3a89f]">孤儿文件</span>
          </button>
          <button
            disabled={busy}
            onClick={() => run(onEmptyTrash)}
            className="flex w-full items-center gap-2 rounded-lg border border-[#f0d9d6] bg-[#fdf6f5] px-3 py-2 text-left text-[12.5px] text-[#c0392b] hover:bg-[#fbeceb] disabled:opacity-50"
          >
            <Trash2 size={13} />
            清空回收站
            <span className="ml-auto text-[11px] text-[#c99b95]">立即释放空间</span>
          </button>
        </div>

        {msg && (
          <div className="mt-3 rounded-lg bg-[#f2f6f2] px-3 py-2 text-[12px] text-[#2f6b4f]">
            {msg}
          </div>
        )}

        <div className="mt-4 flex gap-2 rounded-lg bg-[#fbf8ee] px-3 py-2.5 text-[11.5px] leading-relaxed text-[#7a6a45]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <p className="m-0">
            便签删除后进入回收站保留 30 天，期间图片和缩略图仍占空间。彻底删除时会同时清除
            原图、缩略图和目录记录。软件只管理自己存的副本，不会碰你手机相册里的照片。
          </p>
        </div>
      </div>
    </div>
  )
}
