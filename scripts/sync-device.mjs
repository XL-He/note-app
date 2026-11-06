/**
 * 单设备 worker：在一个独立进程里扮演一台设备。
 * 每个进程用独立的 IndexedDB 库（NOTE_DB_NAME）+ 独立的设备 id（DEVICE_ID），
 * 所以两台设备之间不会共享内存状态，同步只能通过 mock WebDAV 发生。
 *
 * 用法：node --import tsx scripts/sync-device.mjs <cmd> [arg]
 *   seed <title>   写入一条便签
 *   sync           跑一轮同步，打印统计
 *   list           打印本地便签
 *   harddel <id>   硬删一条便签并留墓碑
 *   softdel <id>   软删（进回收站）
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import 'fake-indexeddb/auto'

const require = createRequire(import.meta.url)

/**
 * 桌面版走的是「渲染进程 → 主进程 IPC → Node fetch」，
 * 浏览器版走的是渲染进程直接 fetch。两条路径都要验证。
 * USE_IPC=1 时把 window.desktop.davRequest 挂上去，逼 webdav.ts 走 IPC 分支，
 * 背后接的是真实的 davProxy 实现，所以 base64 编解码、头部透传都会被覆盖。
 */
if (process.env.USE_IPC === '1') {
  const { davProxy } = require('../electron/dav-proxy.cjs')
  globalThis.window = {
    desktop: {
      isDesktop: true,
      davRequest: (opts) => davProxy(opts),
    },
  }
}

/* --- localStorage 兜底，Node 里没有 --- */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}

const endpoint = process.env.DAV_ENDPOINT
const device = process.env.DEVICE_ID
const stateFile = process.env.STATE_FILE
if (!endpoint || !device) {
  console.error('缺少 DAV_ENDPOINT / DEVICE_ID')
  process.exit(1)
}

/**
 * 每个进程都是新启动的，内存数据库会清空。
 * 用 STATE_FILE 把上一次会话的本地数据（含 localStorage）存盘再恢复，
 * 这样才能真实模拟「同一台设备跨会话」的行为。
 */
let prev = {}
if (stateFile && fs.existsSync(stateFile)) {
  try {
    prev = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    prev = {}
  }
}
if (prev.localStorage) {
  for (const [k, v] of Object.entries(prev.localStorage)) store.set(k, v)
}

/* 设备身份与账号要在恢复状态之后设置，避免被旧配置覆盖 */
localStorage.setItem('dav-device-id', device)

const { saveDavConfig } = await import('../src/lib/webdav.ts')
saveDavConfig({
  endpoint,
  username: 'test@example.com',
  password: 'app-password',
  rootDir: 'sticky-notes',
})

const { db } = await import('../src/db/index.ts')
const { syncNow } = await import('../src/lib/sync.ts')

/* 恢复本地数据 */
if (prev.notes?.length) await db.notes.bulkPut(prev.notes)
if (prev.reminders?.length) await db.reminders.bulkPut(prev.reminders)
if (prev.assets?.length) await db.assets.bulkPut(prev.assets)
if (prev.tombstones?.length) await db.tombstones.bulkPut(prev.tombstones)

const cmd = process.argv[2]
const arg = process.argv[3]

function out(obj) {
  console.log(JSON.stringify(obj))
}

if (cmd === 'seed') {
  const now = Date.now()
  const id = `note-${device}-${now}-${Math.random().toString(36).slice(2, 6)}`
  await db.notes.put({
    id,
    title: arg || '无标题',
    contentHtml: `<p>${arg || ''}</p>`,
    plainText: arg || '',
    color: 'default',
    pinned: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    assetIds: [],
    rev: 1,
  })
  out({ seeded: id, title: arg })
} else if (cmd === 'sync') {
  const r = await syncNow()
  out(r)
} else if (cmd === 'list') {
  const all = await db.notes.toArray()
  out(
    all
      .map((n) => ({ id: n.id, title: n.title, deletedAt: n.deletedAt }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  )
} else if (cmd === 'harddel') {
  const now = Date.now()
  await db.transaction('rw', db.notes, db.tombstones, async () => {
    await db.notes.delete(arg)
    await db.tombstones.put({
      id: `note:${arg}`,
      kind: 'note',
      entityId: arg,
      deletedAt: now,
    })
  })
  out({ hardDeleted: arg })
} else if (cmd === 'softdel') {
  const n = await db.notes.get(arg)
  const now = Date.now()
  await db.notes.put({ ...n, deletedAt: now, updatedAt: now, rev: (n.rev ?? 1) + 1 })
  out({ softDeleted: arg })
} else {
  console.error('未知命令:', cmd)
  process.exit(1)
}

/* 存盘，供下一次会话接着用 */
if (stateFile) {
  const snapshot = {
    localStorage: Object.fromEntries(store),
    notes: await db.notes.toArray(),
    reminders: await db.reminders.toArray(),
    assets: await db.assets.toArray(),
    tombstones: await db.tombstones.toArray(),
  }
  fs.writeFileSync(stateFile, JSON.stringify(snapshot))
}

await db.close()
