import type { Note } from '../types'
import { dehydrateHtml, deleteNoteFiles, syncNoteAssets } from './assets'
import { db, TRASH_MS, uid } from './index'

export const NOTE_COLORS = [
  { key: 'default', label: '白', swatch: '#FFFFFF' },
  { key: 'yellow', label: '米黄', swatch: '#FFF8E1' },
  { key: 'green', label: '淡绿', swatch: '#EAF6EC' },
  { key: 'blue', label: '淡蓝', swatch: '#EAF2FC' },
  { key: 'pink', label: '淡粉', swatch: '#FCEDF2' },
  { key: 'gray', label: '浅灰', swatch: '#F4F4F2' },
] as const

export function htmlToText(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.textContent || '').replace(/\u00a0/g, ' ').trim()
}

export async function listNotes(trash = false): Promise<Note[]> {
  const all = await db.notes.toArray()
  const filtered = all.filter((n) => (trash ? !!n.deletedAt : !n.deletedAt))
  return filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned
    return b.updatedAt - a.updatedAt
  })
}

export async function createNote(init?: Partial<Note>): Promise<Note> {
  const now = Date.now()
  const note: Note = {
    id: uid(),
    title: '',
    contentHtml: '',
    plainText: '',
    color: 'default',
    pinned: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    assetIds: [],
    rev: 1,
    ...init,
  }
  await db.notes.add(note)
  return note
}

export async function saveNote(
  id: string,
  patch: { title?: string; contentHtml?: string; color?: string; pinned?: number },
): Promise<Note | null> {
  const note = await db.notes.get(id)
  if (!note) return null

  let assetIds = note.assetIds
  let contentHtml = note.contentHtml
  let plainText = note.plainText

  if (patch.contentHtml !== undefined) {
    contentHtml = dehydrateHtml(patch.contentHtml)
    plainText = htmlToText(contentHtml)
    assetIds = await syncNoteAssets(id, contentHtml, note.assetIds)
  }

  const autoTitle = plainText.split('\n')[0]?.slice(0, 80) || ''
  const title = patch.title !== undefined ? patch.title : note.title || autoTitle

  const next: Note = {
    ...note,
    ...patch,
    title,
    contentHtml,
    plainText,
    assetIds,
    updatedAt: Date.now(),
    rev: note.rev + 1,
  }
  await db.notes.put(next)
  return next
}

export async function togglePin(id: string) {
  const n = await db.notes.get(id)
  if (!n) return
  await db.notes.put({ ...n, pinned: n.pinned ? 0 : 1, updatedAt: Date.now(), rev: n.rev + 1 })
}

/** 软删：进回收站，文件保留 30 天 */
export async function softDelete(id: string) {
  const n = await db.notes.get(id)
  if (!n) return
  const now = Date.now()
  await db.notes.put({ ...n, deletedAt: now, updatedAt: now, rev: n.rev + 1 })
}

export async function restore(id: string) {
  const n = await db.notes.get(id)
  if (!n) return
  await db.notes.put({ ...n, deletedAt: null, updatedAt: Date.now(), rev: n.rev + 1 })
}

/** 硬删：文件 + 记录 + 提醒，一处不留；同时打删除标记防止对端推回来 */
export async function hardDelete(id: string) {
  const reminderIds = (await db.reminders.where('noteId').equals(id).toArray()).map((r) => r.id)
  const freed = await deleteNoteFiles(id)
  await db.transaction('rw', db.notes, db.reminders, db.tombstones, async () => {
    await db.reminders.where('noteId').equals(id).delete()
    await db.notes.delete(id)
    await db.tombstones.put({ id: `note:${id}`, kind: 'note', entityId: id, deletedAt: Date.now() })
    for (const rid of reminderIds) {
      await db.tombstones.put({
        id: `reminder:${rid}`,
        kind: 'reminder',
        entityId: rid,
        deletedAt: Date.now(),
      })
    }
  })
  return freed
}

/** 回收站到期清理，返回清理条数与释放字节 */
export async function purgeExpired(): Promise<{ count: number; freed: number }> {
  const now = Date.now()
  const expired = (await db.notes.toArray()).filter(
    (n) => n.deletedAt && n.deletedAt + TRASH_MS <= now,
  )
  let freed = 0
  for (const n of expired) freed += await hardDelete(n.id)
  return { count: expired.length, freed }
}

export async function emptyTrash(): Promise<{ count: number; freed: number }> {
  const trash = (await db.notes.toArray()).filter((n) => !!n.deletedAt)
  let freed = 0
  for (const n of trash) freed += await hardDelete(n.id)
  return { count: trash.length, freed }
}

export function remainingDays(deletedAt: number): number {
  return Math.max(0, Math.ceil((deletedAt + TRASH_MS - Date.now()) / 86400000))
}
