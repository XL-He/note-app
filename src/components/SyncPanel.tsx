import { Cloud, CloudOff, RefreshCw, Unlink, X } from 'lucide-react'
import {
  SYNC_INTERVALS,
  intervalMsOf,
  type SyncIntervalKey,
  type SyncPhase,
} from '../lib/useSync'

interface Props {
  open: boolean
  onClose: () => void
  configured: boolean
  accountLabel: string
  intervalKey: SyncIntervalKey
  onIntervalChange: (key: SyncIntervalKey) => void
  phase: SyncPhase
  lastAt: number | null
  message: string
  onSyncNow: () => void
  onDisconnect: () => void
}

function timeAgo(at: number | null): string {
  if (!at) return '还没成功同步过'
  const diff = Math.round((Date.now() - at) / 1000)
  if (diff < 20) return '刚刚'
  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

export default function SyncPanel({
  open,
  onClose,
  configured,
  accountLabel,
  intervalKey,
  onIntervalChange,
  phase,
  lastAt,
  message,
  onSyncNow,
  onDisconnect,
}: Props) {
  if (!open) return null

  const manual = intervalMsOf(intervalKey) === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[460px] rounded-xl border border-[#e6e6df] bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          {phase === 'error' ? (
            <CloudOff size={16} className="text-[#c0392b]" />
          ) : (
            <Cloud size={16} className="text-[#2f6b4f]" />
          )}
          <h2 className="text-[14px] font-medium">同步设置</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-[#8b9188] hover:bg-black/5"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mb-4 rounded-lg border border-[#ececE6] bg-[#fbfbf8] px-3 py-2.5">
          <div className="text-[11px] text-[#8b9188]">同步账号</div>
          <div className="mt-0.5 text-[13px] text-[#1f2320]">
            {configured ? accountLabel : '未配置（便签只存在本机）'}
          </div>
          <div className="mt-1 text-[11px] text-[#a8ada4]">
            {phase === 'syncing'
              ? '正在同步…'
              : phase === 'error'
                ? `上次失败：${message || '网络问题'}`
                : `上次同步：${timeAgo(lastAt)}`}
          </div>
        </div>

        <div className="mb-2 text-[12px] font-medium text-[#3a4038]">同步频率</div>
        <p className="m-0 mb-2 text-[11.5px] leading-relaxed text-[#8b9188]">
          网盘不能主动推送，只能按间隔去问一下「有没有新东西」。每次只查目录约 1KB，
          没有变化就不会下载内容，所以间隔调大能省流量，但另一台设备的改动会更晚看到。
        </p>
        <div className="space-y-1.5">
          {SYNC_INTERVALS.map((opt) => {
            const active = opt.key === intervalKey
            return (
              <button
                key={opt.key}
                onClick={() => onIntervalChange(opt.key)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors ${
                  active
                    ? 'border-[#2f6b4f]/40 bg-[#f2f6f2] text-[#1f2320]'
                    : 'border-[#e6e6df] hover:bg-[#f7f7f2]'
                }`}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    active ? 'border-[#2f6b4f]' : 'border-[#cfd3cb]'
                  }`}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-[#2f6b4f]" />}
                </span>
                <span>{opt.label}</span>
                <span className="ml-auto text-[11px] text-[#a3a89f]">{opt.hint}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onSyncNow}
            disabled={!configured || phase === 'syncing'}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#2f6b4f] py-2 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw size={13} className={phase === 'syncing' ? 'animate-spin' : ''} />
            {phase === 'syncing' ? '同步中…' : '立即同步'}
          </button>
          {configured && (
            <button
              onClick={onDisconnect}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-[#f0d9d6] px-3 py-2 text-[12.5px] text-[#c0392b] hover:bg-[#fdf6f5]"
            >
              <Unlink size={13} />
              断开
            </button>
          )}
        </div>

        {manual && (
          <div className="mt-3 rounded-lg bg-[#fbf8ee] px-3 py-2 text-[11.5px] leading-relaxed text-[#7a6a45]">
            当前是「仅手动」：改完便签不会自动上传，另一台设备也收不到。记得在两台设备上都点一次「立即同步」。
          </div>
        )}

        <p className="m-0 mt-3 text-[11px] leading-relaxed text-[#a8ada4]">
          数据保存在你自己的坚果云网盘里，不经过任何第三方服务器。别人装这个软件要用他自己的坚果云账号，
          花的是他自己的额度，和你的完全隔离。
        </p>
      </div>
    </div>
  )
}
