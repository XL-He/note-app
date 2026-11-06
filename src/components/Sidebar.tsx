import { Bell, Cloud, CloudOff, HardDrive, Plus, Pin, RefreshCw, RotateCcw, Search, Settings, Trash2 } from 'lucide-react'
import type { Note } from '../types'
import type { StorageStats } from '../db/assets'
import { formatBytes } from '../db/assets'
import { remainingDays } from '../db/notes'
import { formatWhen, noteColor } from '../lib/format'
import type { SyncPhase } from '../lib/useSync'

interface Props {
  notes: Note[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  query: string
  onQuery: (q: string) => void
  tab: 'all' | 'trash'
  onTab: (t: 'all' | 'trash') => void
  onTogglePin: (id: string) => void
  onRestore: (id: string) => void
  onPurgeOne: (id: string) => void
  stats: StorageStats | null
  onOpenStorage: () => void
  trashCount: number
  /** noteId -> 下次提醒时刻 */
  reminders: Map<string, number>
  syncPhase: SyncPhase
  syncLabel: string
  onSyncNow: () => void
  accountLabel: string
  onSignOut: () => void
}

export default function Sidebar({
  notes,
  activeId,
  onSelect,
  onNew,
  query,
  onQuery,
  tab,
  onTab,
  onTogglePin,
  onRestore,
  onPurgeOne,
  stats,
  onOpenStorage,
  trashCount,
  reminders,
  syncPhase,
  syncLabel,
  onSyncNow,
  accountLabel,
  onSignOut,
}: Props) {
  const q = query.trim().toLowerCase()
  const shown = q
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) || n.plainText.toLowerCase().includes(q),
      )
    : notes

  return (
    <aside className="flex h-full w-full flex-col border-r border-[#ececE6] bg-[#fbfbf8] md:w-[290px]">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <h1 className="text-[15px] font-medium tracking-tight">便签</h1>
        <button
          onClick={onNew}
          className="ml-auto flex h-7 items-center gap-1 rounded-md bg-[#2f6b4f] px-2.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus size={13} />
          新建
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-[#e8e8e2] bg-white px-2.5 py-1.5">
          <Search size={13} className="text-[#a3a89f]" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="搜索便签"
            className="w-full border-none bg-transparent text-[13px] outline-none placeholder:text-[#b9beb6]"
          />
        </div>
      </div>

      <div className="mx-3 mb-1 flex gap-1 rounded-lg bg-[#f0f0eb] p-0.5 text-[12px]">
        <button
          onClick={() => onTab('all')}
          className={`flex-1 rounded-md py-1 transition-colors ${
            tab === 'all' ? 'bg-white font-medium text-[#1f2320] shadow-sm' : 'text-[#737a70]'
          }`}
        >
          全部 {stats ? stats.activeNotes : ''}
        </button>
        <button
          onClick={() => onTab('trash')}
          className={`flex-1 rounded-md py-1 transition-colors ${
            tab === 'trash' ? 'bg-white font-medium text-[#1f2320] shadow-sm' : 'text-[#737a70]'
          }`}
        >
          回收站 {trashCount || ''}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {shown.length === 0 && (
          <div className="mt-10 px-4 text-center text-[12px] leading-relaxed text-[#a3a89f]">
            {tab === 'trash' ? '回收站是空的' : q ? '没有匹配的便签' : '还没有便签，点右上角新建'}
          </div>
        )}
        {shown.map((n) => {
          const active = n.id === activeId
          return (
            <div
              key={n.id}
              onClick={() => onSelect(n.id)}
              className={`group mb-1.5 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                active
                  ? 'border-[#2f6b4f]/35 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                  : 'border-transparent hover:bg-white/80'
              }`}
              style={{ background: active ? '#fff' : noteColor(n.color) }}
            >
              <div className="flex items-start gap-1.5">
                {n.pinned === 1 && <Pin size={11} className="mt-[5px] shrink-0 text-[#b08d3f]" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[#23271f]">
                    {n.title || '无标题'}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] leading-[1.55] text-[#7b8278]">
                    {n.plainText.slice(0, 120) || '（空白便签）'}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5 text-[11px] text-[#a8ada4]">
                  {reminders.has(n.id) && (
                    <span className="flex items-center gap-0.5 text-[#2f6b4f]">
                      <Bell size={9} />
                      {formatWhen(reminders.get(n.id)!)}
                    </span>
                  )}
                  <span>
                    {tab === 'trash' && n.deletedAt
                      ? `${remainingDays(n.deletedAt)}天`
                      : formatWhen(n.updatedAt)}
                  </span>
                </div>
              </div>

              <div className="mt-1.5 hidden items-center gap-1 group-hover:flex">
                {tab === 'all' ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePin(n.id)
                      }}
                      className="rounded px-1.5 py-0.5 text-[11px] text-[#7b8278] hover:bg-black/5"
                    >
                      {n.pinned ? '取消置顶' : '置顶'}
                    </button>
                    <span className="text-[11px] text-[#c4c8c0]">·</span>
                    <span className="text-[11px] text-[#a8ada4]">删除后保留 30 天</span>
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRestore(n.id)
                      }}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#2f6b4f] hover:bg-[#2f6b4f]/8"
                    >
                      <RotateCcw size={10} /> 恢复
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onPurgeOne(n.id)
                      }}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#c0392b] hover:bg-[#c0392b]/8"
                    >
                      <Trash2 size={10} /> 彻底删除
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-[#ececE6] px-3.5 py-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onSyncNow}
            title="打开同步设置"
            className={`flex min-w-0 items-center gap-1.5 text-[11.5px] transition-colors ${
              syncPhase === 'error'
                ? 'text-[#c0392b]'
                : syncPhase === 'syncing'
                  ? 'text-[#2f6b4f]'
                  : 'text-[#7b8278] hover:text-[#2f6b4f]'
            }`}
          >
            {syncPhase === 'error' ? (
              <CloudOff size={12} className="shrink-0" />
            ) : syncPhase === 'syncing' ? (
              <RefreshCw size={12} className="shrink-0 animate-spin" />
            ) : (
              <Cloud size={12} className="shrink-0" />
            )}
            <span className="truncate">{syncLabel}</span>
          </button>
          <button
            onClick={onSignOut}
            title={`同步账号：${accountLabel} · 点击重新配置`}
            className="ml-auto flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[#a8ada4] hover:bg-black/5 hover:text-[#2f6b4f]"
          >
            <span className="max-w-[92px] truncate">{accountLabel}</span>
            <Settings size={10} />
          </button>
        </div>
      </div>

      <button
        onClick={onOpenStorage}
        className="flex items-center gap-2 border-t border-[#ececE6] px-4 py-2.5 text-left text-[11.5px] text-[#7b8278] hover:bg-[#f3f3ee]"
      >
        <HardDrive size={13} />
        <span>占用 {stats ? formatBytes(stats.totalBytes) : '—'}</span>
        {window.desktop?.isDesktop && (
          <span className="rounded bg-[#2f6b4f]/10 px-1 py-px text-[10px] text-[#2f6b4f]">
            桌面版
          </span>
        )}
        <span className="ml-auto text-[#a8ada4]">管理存储</span>
      </button>
    </aside>
  )
}
