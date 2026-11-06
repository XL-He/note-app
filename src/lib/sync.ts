/**
 * 基于坚果云 WebDAV 的同步实现。
 *
 * 与云端数据库方案最大的不同：网盘没有并发控制，也没有「表」的概念。
 * 因此采用「每台设备各写一份快照文件」的策略：
 *
 *   <rootDir>/
 *     <deviceId>.json       本机数据的完整快照（notes/reminders/assets/tombstones）
 *     files/<assetId>.<ext> 原图，按 assetId 独立存放
 *
 * 读取时把网盘里所有 *.json 都拉下来，按 updatedAt 逐条取「时间较新」的合并，
 * 所以永远不会出现写冲突；删除用墓碑（tombstone）传播，和之前一致。
 *
 * 设备 id 存 localStorage，首次运行随机生成并固定。
 */

import type { Asset, Note, Reminder, TimeTrigger } from '../types'
import { db } from '../db'
import { loadDavConfig, davGet, davPut, davDelete, davListFiles, davListEntries, davEnsureRoot } from './webdav'

/* ---------------- 设备标识 ---------------- */

const DEVICE_KEY = 'dav-device-id'

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id =
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '') ||
      Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

/* ---------------- 快照结构 ---------------- */

interface Snapshot {
  version: 1
  deviceId: string
  savedAt: number
  notes: NoteRow[]
  reminders: ReminderRow[]
  assets: AssetRow[]
  tombstones: TombRow[]
}

// 快照里的行结构，直接复用本地对象序列化后的形态。
// 用 snake_case 是为了将来方便，也避免和本地字段名混淆。
interface NoteRow {
  id: string
  title: string
  content_html: string
  plain_text: string
  color: string
  pinned: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

interface ReminderRow {
  id: string
  note_id: string
  title: string
  trigger: TimeTrigger
  next_at: number | null
  last_fire: number | null
  fired_count: number
  state: 'active' | 'done' | 'expired'
  created_at: number
  updated_at: number
}

interface AssetRow {
  id: string
  note_id: string
  mime: string
  size: number
  width: number
  height: number
  created_at: number
  updated_at: number
}

interface TombRow {
  id: string
  kind: 'note' | 'reminder' | 'attachment'
  entity_id: string
  deleted_at: number
}

/* ---------------- 行 <-> 本地对象 ---------------- */

function noteToRow(n: Note): NoteRow {
  return {
    id: n.id,
    title: n.title,
    content_html: n.contentHtml,
    plain_text: n.plainText,
    color: n.color,
    pinned: n.pinned,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
    deleted_at: n.deletedAt,
  }
}

function noteFromRow(r: NoteRow): Note {
  const assetIds = new Set<string>()
  const re = /data-asset="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(r.content_html))) assetIds.add(m[1])
  return {
    id: r.id,
    title: r.title,
    contentHtml: r.content_html,
    plainText: r.plain_text,
    color: r.color,
    pinned: r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    assetIds: [...assetIds],
    rev: 0,
  }
}

function reminderToRow(r: Reminder): ReminderRow {
  return {
    id: r.id,
    note_id: r.noteId,
    title: r.title,
    trigger: r.trigger,
    next_at: r.nextAt,
    last_fire: r.lastFire,
    fired_count: r.firedCount,
    state: r.state,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }
}

function reminderFromRow(r: ReminderRow): Reminder {
  return {
    id: r.id,
    noteId: r.note_id,
    title: r.title,
    trigger: r.trigger,
    nextAt: r.next_at,
    lastFire: r.last_fire,
    firedCount: r.fired_count,
    state: r.state,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function assetToRow(a: Asset): AssetRow {
  return {
    id: a.id,
    note_id: a.noteId,
    mime: a.mime,
    size: a.size,
    width: a.width,
    height: a.height,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  }
}

function assetFromRow(r: AssetRow): Asset {
  return {
    id: r.id,
    noteId: r.note_id,
    mime: r.mime,
    size: r.size,
    thumbSize: 0,
    width: r.width,
    height: r.height,
    createdAt: r.created_at,
    storagePath: `files/${r.id}.${extOf(r.mime)}`,
    updatedAt: r.updated_at,
  }
}

function tombToRow(t: { id: string; kind: 'note' | 'reminder' | 'attachment'; entityId: string; deletedAt: number }): TombRow {
  return { id: t.id, kind: t.kind, entity_id: t.entityId, deleted_at: t.deletedAt }
}

function extOf(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('gif')) return 'gif'
  return 'webp'
}

/* ---------------- 快照读写 ---------------- */

async function buildSnapshot(): Promise<Snapshot> {
  const [notes, reminders, assets, tombstones] = await Promise.all([
    db.notes.toArray(),
    db.reminders.toArray(),
    db.assets.toArray(),
    db.tombstones.toArray(),
  ])
  return {
    version: 1,
    deviceId: deviceId(),
    savedAt: Date.now(),
    notes: notes.map(noteToRow),
    reminders: reminders.map(reminderToRow),
    assets: assets.map(assetToRow),
    tombstones: tombstones.map((t) =>
      tombToRow({ id: t.id, kind: t.kind, entityId: t.entityId, deletedAt: t.deletedAt }),
    ),
  }
}

function snapshotFileName(devId: string): string {
  return `${devId}.json`
}

/**
 * 已下载快照的内存缓存：key = 文件名，value = 服务端 lastModified + 解析结果。
 * 网盘按流量限额计费，稳态下必须做到「没变就不下载」。
 */
const snapshotCache = new Map<string, { lastModified: string; snap: Snapshot }>()

/** 本地数据的最新修改时间，用来判断「我这边的数据变了没」 */
async function localStamp(): Promise<number> {
  const [notes, reminders, assets, tombs] = await Promise.all([
    db.notes.toArray(),
    db.reminders.toArray(),
    db.assets.toArray(),
    db.tombstones.toArray(),
  ])
  let max = 0
  for (const n of notes) if (n.updatedAt > max) max = n.updatedAt
  for (const r of reminders) if (r.updatedAt > max) max = r.updatedAt
  for (const a of assets) if (a.updatedAt > max) max = a.updatedAt
  for (const t of tombs) if (t.deletedAt > max) max = t.deletedAt
  return max
}

/** 上次成功上传快照时的本地时间戳；不存在表示从没传过 */
const PUSH_STAMP_KEY = 'dav-last-push-stamp'

/** 换账号时调用，避免沿用上一个账号的推送记录 */
export function resetSyncState(): void {
  localStorage.removeItem(PUSH_STAMP_KEY)
  snapshotCache.clear()
}

/** 拉取网盘里所有设备快照，合并成「每条实体取 updated_at 最大」的行集 */
async function fetchMerged(cfg: NonNullable<ReturnType<typeof loadDavConfig>>): Promise<{
  notes: Map<string, NoteRow>
  reminders: Map<string, ReminderRow>
  assets: Map<string, AssetRow>
  tombstones: Map<string, TombRow>
}> {
  const entries = await davListEntries(cfg, '')
  const myFile = snapshotFileName(deviceId())
  // 只收根目录下的 .json，且跳过自己那份（本地就是最新，没必要回环下载）
  const snapshots = entries.filter(
    (e) => e.path.endsWith('.json') && !e.path.includes('/') && e.path !== myFile,
  )

  const notes = new Map<string, NoteRow>()
  const reminders = new Map<string, ReminderRow>()
  const assets = new Map<string, AssetRow>()
  const tombstones = new Map<string, TombRow>()

  for (const e of snapshots) {
    // 有 lastModified 且与缓存一致 → 直接用缓存，不发请求
    const cached = snapshotCache.get(e.path)
    let snap: Snapshot | null =
      cached && e.lastModified && cached.lastModified === e.lastModified ? cached.snap : null

    if (!snap) {
      const blob = await davGet(cfg, e.path)
      if (!blob) continue
      try {
        const parsed = JSON.parse(await blob.text()) as Snapshot
        if (!parsed || parsed.version !== 1) continue
        snap = parsed
        snapshotCache.set(e.path, { lastModified: e.lastModified, snap: parsed })
      } catch {
        continue // 坏文件跳过，不影响其他设备
      }
    }

    const take = <T extends { id: string; updated_at?: number }>(
      map: Map<string, T>,
      row: T,
    ) => {
      const cur = map.get(row.id)
      const stamp = row.updated_at ?? 0
      const curStamp = cur ? (cur.updated_at ?? 0) : -1
      if (!cur || stamp >= curStamp) map.set(row.id, row)
    }

    for (const r of snap.notes ?? []) take(notes, r)
    for (const r of snap.reminders ?? []) take(reminders, r)
    for (const r of snap.assets ?? []) take(assets, r)
    for (const r of snap.tombstones ?? []) {
      const cur = tombstones.get(r.id)
      if (!cur || (r.deleted_at ?? 0) >= (cur.deleted_at ?? 0)) tombstones.set(r.id, r)
    }
  }

  /**
   * 关键：必须把「本机自己的墓碑」也合并进来。
   *
   * 上面刻意跳过了自己的快照文件（本地就是最新，不必回环下载），
   * 但那样会连带丢掉自己刚写下的墓碑。后果是：本机刚彻底删掉一条便签，
   * 拉取时因为「本地没有这一行」而判定成新数据，又从对端的旧快照里拉了回来，
   * 下次同步还会再推给对方——表现就是「删了又自己长回来」。
   *
   * 把这些墓碑补进来之后，第 3 步的删除逻辑会先把这些行剔掉，再谈拉取。
   */
  const localTombs = await db.tombstones.toArray()
  for (const t of localTombs) {
    const cur = tombstones.get(t.id)
    if (!cur || t.deletedAt >= (cur.deleted_at ?? 0)) {
      tombstones.set(t.id, {
        id: t.id,
        kind: t.kind,
        entity_id: t.entityId,
        deleted_at: t.deletedAt,
      })
    }
  }

  return { notes, reminders, assets, tombstones }
}

/* ---------------- 图片上传/下载 ---------------- */

function assetFilePath(assetId: string, mime: string): string {
  return `files/${assetId}.${extOf(mime)}`
}

async function uploadAssetBlob(cfg: NonNullable<ReturnType<typeof loadDavConfig>>, asset: Asset): Promise<boolean> {
  const row = await db.blobs.get(`${asset.noteId}/orig/${asset.id}`)
  if (!row) return false
  await davPut(cfg, assetFilePath(asset.id, asset.mime), row.blob)
  return true
}

export async function pullAssetBlob(asset: Asset): Promise<Blob | null> {
  const cfg = loadDavConfig()
  if (!cfg) return null
  const rel = asset.storagePath || assetFilePath(asset.id, asset.mime)
  const blob = await davGet(cfg, rel)
  if (!blob) return null
  await db.blobs.put({
    key: `${asset.noteId}/orig/${asset.id}`,
    noteId: asset.noteId,
    assetId: asset.id,
    kind: 'orig',
    blob,
    size: blob.size || asset.size,
    createdAt: Date.now(),
  })
  return blob
}

/* ---------------- 主流程 ---------------- */

export interface SyncResult {
  pulled: number
  pushed: number
  uploaded: number
  deleted: number
}

let inflight: Promise<SyncResult> | null = null

export function syncNow(): Promise<SyncResult> {
  if (!inflight) {
    inflight = doSync().finally(() => {
      inflight = null
    })
  }
  return inflight
}

async function doSync(): Promise<SyncResult> {
  const cfg = loadDavConfig()
  if (!cfg) throw new Error('未配置同步账号')
  const result: SyncResult = { pulled: 0, pushed: 0, uploaded: 0, deleted: 0 }

  // 0. 首次同步时根目录还不存在，先建出来（MKCOL 已存在会返回 405，不影响）
  await davEnsureRoot(cfg)

  // 1. 本地数据变了才上传快照。没变就不发请求，省流量也省时间。
  //    注意：网盘按流量计费，30 秒一轮全量上传会很快耗尽额度。
  const stamp = await localStamp()
  const lastRaw = localStorage.getItem(PUSH_STAMP_KEY)
  const lastPush = lastRaw === null ? -1 : Number(lastRaw)
  const myFile = snapshotFileName(deviceId())
  if (lastPush < 0 || stamp > lastPush) {
    const snap = await buildSnapshot()
    await davPut(cfg, myFile, JSON.stringify(snap))
    localStorage.setItem(PUSH_STAMP_KEY, String(stamp))
    result.pushed += 1
  }

  // 2. 拉取并合并所有设备的快照
  const merged = await fetchMerged(cfg)

  // 3. 应用远端墓碑：删除本地对应内容，避免已删内容复活
  const localNotes = await db.notes.toArray()
  const localReminders = await db.reminders.toArray()
  const localAssets = await db.assets.toArray()

  for (const [, t] of merged.tombstones) {
    if (t.kind === 'note') {
      const local = localNotes.find((n) => n.id === t.entity_id)
      if (local) {
        await db.notes.delete(t.entity_id)
        await db.blobs.where('noteId').equals(t.entity_id).delete()
        await db.assets.where('noteId').equals(t.entity_id).delete()
        await db.reminders.where('noteId').equals(t.entity_id).delete()
        result.deleted += 1
      }
      merged.notes.delete(t.entity_id)
    } else if (t.kind === 'reminder') {
      if (localReminders.some((r) => r.id === t.entity_id)) {
        await db.reminders.delete(t.entity_id)
        result.deleted += 1
      }
      merged.reminders.delete(t.entity_id)
    } else if (t.kind === 'attachment') {
      if (localAssets.some((a) => a.id === t.entity_id)) {
        await db.blobs.where('assetId').equals(t.entity_id).delete()
        await db.assets.delete(t.entity_id)
        result.deleted += 1
      }
      merged.assets.delete(t.entity_id)
    }
  }

  // 4. 应用远端实体：比本地新的写入本地
  const localNoteMap = new Map((await db.notes.toArray()).map((n) => [n.id, n]))
  const noteRows = [...merged.notes.values()]
  const notesToPull = noteRows.filter((r) => (localNoteMap.get(r.id)?.updatedAt ?? -1) < r.updated_at)
  if (notesToPull.length) {
    await db.notes.bulkPut(notesToPull.map(noteFromRow))
    result.pulled += notesToPull.length
  }

  const localReminderMap = new Map((await db.reminders.toArray()).map((r) => [r.id, r]))
  const reminderRows = [...merged.reminders.values()]
  const remindersToPull = reminderRows.filter((r) => (localReminderMap.get(r.id)?.updatedAt ?? -1) < r.updated_at)
  if (remindersToPull.length) {
    await db.reminders.bulkPut(remindersToPull.map(reminderFromRow))
    result.pulled += remindersToPull.length
  }

  const localAssetMap = new Map((await db.assets.toArray()).map((a) => [a.id, a]))
  const assetRows = [...merged.assets.values()]
  const assetsToPull = assetRows.filter((r) => (localAssetMap.get(r.id)?.updatedAt ?? -1) < r.updated_at)
  if (assetsToPull.length) {
    await db.assets.bulkPut(
      assetsToPull.map((r) => {
        const existing = localAssetMap.get(r.id)
        const a = assetFromRow(r)
        return { ...a, thumbSize: existing?.thumbSize ?? 0 }
      }),
    )
    result.pulled += assetsToPull.length
  }

  // 5. 上传本地图片：有 blob 但远端还没有对应文件的
  const remoteFiles = new Set(await davListFiles(cfg, 'files'))
  const localAssetList = await db.assets.toArray()
  for (const a of localAssetList) {
    const rel = assetFilePath(a.id, a.mime)
    if (remoteFiles.has(rel)) continue
    if (await uploadAssetBlob(cfg, a)) {
      result.uploaded += 1
      remoteFiles.add(rel)
    }
  }

  // 6. 清理远端已删除的图片文件（墓碑里标记过的 attachment）
  for (const [, t] of merged.tombstones) {
    if (t.kind !== 'attachment') continue
    // 精确删：尝试常见扩展名
    for (const ext of ['webp', 'png', 'jpg', 'jpeg', 'gif']) {
      const candidate = `files/${t.entity_id}.${ext}`
      if (remoteFiles.has(candidate)) {
        await davDelete(cfg, candidate)
        remoteFiles.delete(candidate)
      }
    }
  }

  return result
}

/* ---------------- 状态 ---------------- */

export function isConfigured(): boolean {
  return loadDavConfig() !== null
}
