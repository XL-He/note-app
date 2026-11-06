import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Command, ImageIcon, Plus } from 'lucide-react'
import EditorPane from './components/EditorPane'
import LoginGate from './components/LoginGate'
import ReminderPanel from './components/ReminderPanel'
import ReminderToast from './components/ReminderToast'
import Sidebar from './components/Sidebar'
import StoragePanel from './components/StoragePanel'
import SyncPanel from './components/SyncPanel'
import {
  purgeOrphans,
  storageStats,
  type StorageStats,
} from './db/assets'
import {
  dueReminders,
  fireReminder,
  listByNote,
  nearestByNote,
  snoozeReminder,
} from './db/reminders'
import {
  chime,
  emitFire,
  ensureNotifyPermission,
  initNativeNotify,
  isNative,
  notifySystem,
  onFire,
  onNotificationTap,
  syncNativeReminders,
  type FiredNotice,
} from './lib/notify'
import { fmtDateTime } from './lib/schedule'
import {
  createNote,
  emptyTrash,
  hardDelete,
  listNotes,
  purgeExpired,
  restore,
  saveNote,
  softDelete,
  togglePin,
} from './db/notes'
import type { Note, Reminder } from './types'
import { formatBytes } from './db/assets'
import { useSync } from './lib/useSync'
import { isConfigured, loadDavConfig } from './lib/webdav'
import { loadIntervalKey, saveIntervalKey, type SyncIntervalKey } from './lib/useSync'

const SKIP_KEY = 'dav-skip'

export default function App() {
  const [ready, setReady] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [trash, setTrash] = useState<Note[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'trash'>('all')
  const [query, setQuery] = useState('')
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [storageOpen, setStorageOpen] = useState(false)
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [intervalKey, setIntervalKey] = useState<SyncIntervalKey>(() => loadIntervalKey())
  const [mobileEditor, setMobileEditor] = useState(false)
  const [reminderMap, setReminderMap] = useState<Map<string, number>>(new Map())
  const [activeReminder, setActiveReminder] = useState<Reminder | null>(null)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [fired, setFired] = useState<FiredNotice[]>([])
  const notesRef = useRef<Note[]>([])

  const refresh = useCallback(async () => {
    const [a, t, s, nearest] = await Promise.all([
      listNotes(false),
      listNotes(true),
      storageStats(),
      nearestByNote(),
    ])
    setNotes(a)
    setTrash(t)
    setStats(s)
    notesRef.current = a
    const m = new Map<string, number>()
    for (const [noteId, r] of nearest) if (r.nextAt) m.set(noteId, r.nextAt)
    setReminderMap(m)
    setActiveId((cur) => {
      if (cur && (a.some((n) => n.id === cur) || t.some((n) => n.id === cur))) return cur
      return a[0]?.id ?? null
    })
  }, [])

  const configured = isConfigured()
  const sync = useSync(configured, () => void refresh(), intervalKey)
  const requestSync = sync.requestSync
  const afterChange = useCallback(async () => {
    await refresh()
    requestSync()
  }, [refresh, requestSync])

  useEffect(() => {
    void (async () => {
      await purgeExpired()
      await purgeOrphans()
      await refresh()
      setReady(true)
    })()
  }, [refresh])

  // 提醒调度：5 秒一轮，分钟级精度足够，也不空耗 CPU
  useEffect(() => {
    let busy = false
    async function tick() {
      if (busy) return
      busy = true
      try {
        const now = Date.now()
        const due = await dueReminders(now)
        if (!due.length) return
        for (const r of due) {
          const target = notesRef.current.find((n) => n.id === r.noteId)
          const body = target?.plainText.slice(0, 80) || r.title || '时间到了'
          emitFire({
            reminderId: r.id,
            noteId: r.noteId,
            title: r.title || '便签提醒',
            body,
            at: now,
          })
          notifySystem(r.title || '便签提醒', body, r.id)
          chime()
          await fireReminder(r, r.nextAt ?? now)
        }
        await refresh()
        requestSync()
      } finally {
        busy = false
      }
    }
    const id = window.setInterval(() => void tick(), 5000)
    void tick()
    return () => window.clearInterval(id)
  }, [refresh, requestSync])

  useEffect(() => onFire((n) => setFired((f) => [...f, n])), [])

  // 安卓：建通知渠道，并支持点通知直接跳到对应便签
  useEffect(() => {
    if (!isNative()) return
    void initNativeNotify()
    // 安卓 13+ 必须显式申请，否则到点也不会弹
    void ensureNotifyPermission()
    let off: (() => void) | undefined
    void onNotificationTap((noteId) => {
      setActiveId(noteId)
      setTab('all')
      setMobileEditor(true)
    }).then((fn) => {
      off = fn
    })
    return () => off?.()
  }, [])

  // 安卓：物理返回键先退回列表，再按一次才退出应用
  useEffect(() => {
    if (!isNative()) return
    let off: (() => void) | undefined
    void import('@capacitor/app')
      .then(({ App: CapApp }) =>
        CapApp.addListener('backButton', () => {
          if (mobileEditor) setMobileEditor(false)
          else void CapApp.exitApp()
        }),
      )
      .then((handle) => {
        off = () => void handle.remove()
      })
      .catch(() => {
        /* 非原生环境没有这个插件，忽略 */
      })
    return () => off?.()
  }, [mobileEditor])

  // 安卓：把未来要响的提醒交给系统闹钟，应用被系统杀掉也能准时响
  useEffect(() => {
    if (!isNative()) return
    void syncNativeReminders()
  }, [reminderMap])

  useEffect(() => {
    if (!activeId) {
      setActiveReminder(null)
      return
    }
    void listByNote(activeId).then((rs) => {
      setActiveReminder(rs.find((r) => r.state === 'active') ?? rs[0] ?? null)
    })
  }, [activeId, reminderMap])

  const active = useMemo(
    () => [...notes, ...trash].find((n) => n.id === activeId) ?? null,
    [notes, trash, activeId],
  )

  const handleNew = useCallback(async () => {
    const n = await createNote()
    setTab('all')
    setQuery('')
    setActiveId(n.id)
    setMobileEditor(true)
    await afterChange()
  }, [afterChange])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void handleNew()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleNew])

  // 桌面版：把下一条提醒同步到托盘菜单
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.desktop : undefined
    if (!api?.setNextReminder) return
    if (reminderMap.size === 0) {
      api.setNextReminder('')
      return
    }
    const [noteId, at] = [...reminderMap.entries()].sort((a, b) => a[1] - b[1])[0]
    const note = notes.find((n) => n.id === noteId)
    api.setNextReminder(`${fmtDateTime(at)} ${note?.title || '便签'}`)
  }, [reminderMap, notes])

  // 桌面版：全局快捷键 Ctrl+Alt+N 唤出并新建
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.desktop : undefined
    if (!api?.onQuickNew) return
    return api.onQuickNew(() => {
      void handleNew()
    })
  }, [handleNew])

  async function handlePatch(patch: { title?: string; contentHtml?: string; color?: string }) {
    if (!activeId) return
    await saveNote(activeId, patch)
    await afterChange()
  }

  async function handleSoftDelete() {
    if (!activeId) return
    await softDelete(activeId)
    setActiveId(null)
    setMobileEditor(false)
    await afterChange()
  }

  async function handleSelect(id: string) {
    setActiveId(id)
    setMobileEditor(true)
  }

  async function handleSignOut() {
    localStorage.removeItem('dav-config')
    localStorage.removeItem('dav-skip')
    window.location.reload()
  }

  function handleConfigured() {
    localStorage.removeItem(SKIP_KEY)
    window.location.reload()
  }

  const currentList = tab === 'trash' ? trash : notes

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-[#f6f7f3] text-[12.5px] text-[#a3a89f]">
        正在读取本地便签…
      </div>
    )
  }

  if (!configured && !localStorage.getItem(SKIP_KEY)) {
    return (
      <LoginGate
        onConfigured={handleConfigured}
      />
    )
  }

  const accountLabel = loadDavConfig()?.username
    ? maskEmail(loadDavConfig()!.username)
    : '未连接'

  const syncLabel =
    sync.phase === 'off'
      ? '未开启同步'
      : sync.phase === 'syncing'
        ? '同步中…'
        : sync.phase === 'error'
          ? `同步失败，${sync.message || '网络问题'}`
          : sync.lastAt
            ? `已同步 · ${timeAgo(sync.lastAt)}`
            : '等待同步'

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className={`${mobileEditor ? 'hidden md:flex' : 'flex'} h-full w-full shrink-0 md:w-[290px]`}
      >
        <Sidebar
          notes={currentList}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNew}
          query={query}
          onQuery={setQuery}
          tab={tab}
          onTab={setTab}
          onTogglePin={async (id) => {
            await togglePin(id)
            await afterChange()
          }}
          onRestore={async (id) => {
            await restore(id)
            await afterChange()
          }}
          onPurgeOne={async (id) => {
            await hardDelete(id)
            setActiveId(null)
            await afterChange()
          }}
          stats={stats}
          onOpenStorage={() => setStorageOpen(true)}
          trashCount={trash.length}
          reminders={reminderMap}
          syncPhase={sync.phase}
          syncLabel={syncLabel}
          onSyncNow={() => {
            if (!configured) {
              // 还没配置账号，点一下直接带去配置页
              localStorage.removeItem(SKIP_KEY)
              window.location.reload()
              return
            }
            setSyncPanelOpen(true)
          }}
          accountLabel={accountLabel}
          onSignOut={handleSignOut}
        />
      </div>

      <main className={`${mobileEditor ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {active ? (
          <EditorPane
            key={active.id}
            note={active}
            onPatch={handlePatch}
            onDelete={handleSoftDelete}
            onBack={() => setMobileEditor(false)}
            showBack
            reminder={activeReminder}
            onOpenReminder={() => setReminderOpen(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-white px-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f0f2ee]">
              <ImageIcon size={19} className="text-[#8a9187]" />
            </div>
            <div className="text-[14px] font-medium text-[#3a4038]">选一条便签，或者新建一条</div>
            <p className="m-0 max-w-[300px] text-[12.5px] leading-relaxed text-[#8b9188]">
              截图直接粘贴就能插图。删除的便签会在回收站保留 30 天，图片一并清理。
            </p>
            <button
              onClick={handleNew}
              className="mt-1 flex items-center gap-1.5 rounded-lg bg-[#2f6b4f] px-3.5 py-2 text-[12.5px] font-medium text-white hover:opacity-90"
            >
              <Plus size={14} /> 新建便签
            </button>
            <div className="mt-4 flex items-center gap-1.5 text-[11.5px] text-[#a8ada4]">
              <Command size={12} />
              按 Ctrl + N 随时新建
            </div>
            {stats && (
              <div className="mt-6 text-[11px] text-[#b3b8af]">
                已有 {stats.activeNotes} 条便签 · 图片占用 {formatBytes(stats.totalBytes)}
              </div>
            )}
          </div>
        )}
      </main>

      <StoragePanel
        open={storageOpen}
        stats={stats}
        onClose={() => setStorageOpen(false)}
        onRefresh={() => void refresh()}
        onPurgeExpired={async () => {
          const { count, freed } = await purgeExpired()
          sync.requestSync()
          return count
            ? `已清理 ${count} 条到期便签，释放 ${formatBytes(freed)}`
            : '没有到期的便签，回收站里的都还在 30 天保护期内'
        }}
        onEmptyTrash={async () => {
          const { count, freed } = await emptyTrash()
          sync.requestSync()
          return count
            ? `已清空 ${count} 条便签，释放 ${formatBytes(freed)}，文件已全部删除`
            : '回收站已经是空的'
        }}
        onSweep={async () => {
          const r = await purgeOrphans()
          if (!r.orphanFiles && !r.orphanAssets) return '扫描完成，没有发现残留文件'
          return `清掉残留文件 ${r.orphanFiles} 个、失效记录 ${r.orphanAssets} 条，释放 ${formatBytes(r.freed)}`
        }}
      />

      <SyncPanel
        open={syncPanelOpen}
        onClose={() => setSyncPanelOpen(false)}
        configured={configured}
        accountLabel={accountLabel}
        intervalKey={intervalKey}
        onIntervalChange={(key) => {
          saveIntervalKey(key)
          setIntervalKey(key)
        }}
        phase={sync.phase}
        lastAt={sync.lastAt}
        message={sync.message}
        onSyncNow={() => void sync.run()}
        onDisconnect={handleSignOut}
      />

      {active && (
        <ReminderPanel
          note={active}
          open={reminderOpen}
          onClose={() => setReminderOpen(false)}
          onChanged={() => void afterChange()}
        />
      )}

      <ReminderToast
        items={fired}
        onDismiss={(id) => setFired((f) => f.filter((x) => x.reminderId !== id))}
        onSnooze={async (id) => {
          await snoozeReminder(id, 5)
          setFired((f) => f.filter((x) => x.reminderId !== id))
          await afterChange()
        }}
        onOpen={(noteId) => {
          setActiveId(noteId)
          setTab('all')
          setMobileEditor(true)
          setFired((f) => f.filter((x) => x.noteId !== noteId))
        }}
      />
    </div>
  )
}

function maskEmail(email?: string): string {
  if (!email) return ''
  const [name, domain] = email.split('@')
  if (!domain) return email
  const head = name.slice(0, 2)
  return `${head}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`
}

function timeAgo(at: number): string {
  const diff = Math.round((Date.now() - at) / 1000)
  if (diff < 20) return '刚刚'
  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  return `${Math.floor(diff / 3600)} 小时前`
}
