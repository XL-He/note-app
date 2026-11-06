import Dexie, { type Table } from 'dexie'
import type { Asset, BlobRecord, Note, Reminder, Tombstone } from '../types'

/** 回收站保留天数 */
export const TRASH_DAYS = 30
export const TRASH_MS = TRASH_DAYS * 24 * 60 * 60 * 1000

/**
 * 数据库名。正常情况下固定为 sticky-notes；
 * 允许环境变量覆盖，是为了在测试里用两个独立库模拟两台设备。
 * 用 globalThis 取，避免前端类型环境引入 node 类型。
 */
const DB_NAME =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.NOTE_DB_NAME || 'sticky-notes'

class NoteDB extends Dexie {
  notes!: Table<Note, string>
  assets!: Table<Asset, string>
  blobs!: Table<BlobRecord, string>
  reminders!: Table<Reminder, string>
  tombstones!: Table<Tombstone, string>

  constructor() {
    super(DB_NAME)
    this.version(1).stores({
      notes: 'id, updatedAt, deletedAt, pinned',
      assets: 'id, noteId',
      blobs: 'key, noteId, assetId',
      reminders: 'id, noteId, nextAt',
    })
    this.version(2).stores({
      tombstones: 'id, kind, deletedAt',
    })
  }
}

export const db = new NoteDB()

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function addTombstone(kind: Tombstone['kind'], entityId: string) {
  await db.tombstones.put({
    id: `${kind}:${entityId}`,
    kind,
    entityId,
    deletedAt: Date.now(),
  })
}
