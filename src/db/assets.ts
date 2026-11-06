import { db, uid } from './index'
import { pullAssetBlob } from '../lib/sync'
import type { Asset } from '../types'

const MAX_ORIG_EDGE = 2560
const THUMB_EDGE = 420

/* ---------------- 图片处理 ---------------- */

async function drawToBlob(
  bmp: ImageBitmap,
  w: number,
  h: number,
  type: string,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
      type,
      quality,
    )
  })
}

export async function prepareImage(file: File) {
  const bmp = await createImageBitmap(file)
  const { width, height } = bmp
  const edge = Math.max(width, height)

  let orig: Blob = file
  let origMime = file.type || 'image/jpeg'

  if (edge > MAX_ORIG_EDGE || file.size > 2 * 1024 * 1024) {
    const scale = Math.min(1, MAX_ORIG_EDGE / edge)
    orig = await drawToBlob(bmp, width * scale, height * scale, 'image/webp', 0.85)
    origMime = 'image/webp'
  }

  const tScale = Math.min(1, THUMB_EDGE / edge)
  const thumb = await drawToBlob(
    bmp,
    width * tScale,
    height * tScale,
    'image/webp',
    0.72,
  )
  bmp.close?.()

  return { orig, origMime, thumb, width, height }
}

/* ---------------- 展示用 URL 缓存 ---------------- */

const urlCache = new Map<string, string>()

export function releaseUrls(ids?: string[]) {
  const targets = ids ?? [...urlCache.keys()]
  for (const id of targets) {
    const url = urlCache.get(id)
    if (url) URL.revokeObjectURL(url)
    urlCache.delete(id)
  }
}

export async function ensureUrls(ids: string[], kind: 'orig' | 'thumb' = 'orig') {
  const missing = ids.filter((id) => !urlCache.has(id))
  if (missing.length) {
    const rows = await db.blobs
      .where('assetId')
      .anyOf(missing)
      .filter((b) => b.kind === kind)
      .toArray()
    for (const row of rows) {
      if (!urlCache.has(row.assetId)) {
        urlCache.set(row.assetId, URL.createObjectURL(row.blob))
      }
    }
  }

  // 本机没有这张图（另一台设备上传的），从云端取回来再缓存
  const stillMissing = ids.filter((id) => !urlCache.has(id))
  if (stillMissing.length) {
    const remote = await db.assets.where('id').anyOf(stillMissing).toArray()
    for (const asset of remote) {
      if (!asset.storagePath) continue
      const blob = await pullAssetBlob(asset)
      if (blob) urlCache.set(asset.id, URL.createObjectURL(blob))
    }
  }

  const out = new Map<string, string>()
  for (const id of ids) {
    const u = urlCache.get(id)
    if (u) out.set(id, u)
  }
  return out
}

export function extractAssetIds(html: string): string[] {
  const ids = new Set<string>()
  const re = /data-asset="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) ids.add(m[1])
  return [...ids]
}

/** 存库前把 blob: 地址还原成 asset://，保证 HTML 可移植 */
export function dehydrateHtml(html: string): string {
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const id = /data-asset="([^"]+)"/.exec(tag)?.[1]
    if (!id) return tag
    return tag.replace(/\ssrc="[^"]*"/, ` src="asset://${id}"`)
  })
}

/** 渲染前把 asset:// 换成可显示的 blob 地址 */
export async function hydrateHtml(html: string): Promise<string> {
  const ids = extractAssetIds(html)
  if (!ids.length) return html
  const urls = await ensureUrls(ids)
  return html.replace(/src="asset:\/\/([^"]+)"/g, (whole, id: string) => {
    const u = urls.get(id)
    return u ? `src="${u}"` : whole
  })
}

/* ---------------- 资产增删 ---------------- */

export async function addImage(noteId: string, file: File) {
  const { orig, origMime, thumb, width, height } = await prepareImage(file)
  const assetId = uid()
  const now = Date.now()
  const asset: Asset = {
    id: assetId,
    noteId,
    mime: origMime,
    size: orig.size,
    thumbSize: thumb.size,
    width,
    height,
    createdAt: now,
    storagePath: null,
    updatedAt: now,
  }

  await db.transaction('rw', db.assets, db.blobs, async () => {
    await db.assets.add(asset)
    await db.blobs.bulkAdd([
      {
        key: `${noteId}/orig/${assetId}`,
        noteId,
        assetId,
        kind: 'orig',
        blob: orig,
        size: orig.size,
        createdAt: now,
      },
      {
        key: `${noteId}/thumb/${assetId}`,
        noteId,
        assetId,
        kind: 'thumb',
        blob: thumb,
        size: thumb.size,
        createdAt: now,
      },
    ])
  })

  const url = URL.createObjectURL(orig)
  urlCache.set(assetId, url)
  return { assetId, url }
}

/** 删掉若干张图：原图 + 缩略图 + 记录，一处不留 */
export async function deleteAssets(ids: string[]) {
  if (!ids.length) return 0
  let freed = 0
  const paths = new Map<string, string | null>()
  await db.transaction('rw', db.assets, db.blobs, async () => {
    const rows = await db.blobs.where('assetId').anyOf(ids).toArray()
    const assets = await db.assets.where('id').anyOf(ids).toArray()
    for (const a of assets) paths.set(a.id, a.storagePath)
    freed = rows.reduce((s, r) => s + r.size, 0)
    await db.blobs.where('assetId').anyOf(ids).delete()
    await db.assets.where('id').anyOf(ids).delete()
  })
  for (const id of ids) {
    await db.tombstones.put({
      id: `attachment:${id}`,
      kind: 'attachment',
      entityId: id,
      deletedAt: Date.now(),
      storagePath: paths.get(id) ?? null,
    })
  }
  releaseUrls(ids)
  return freed
}

/**
 * 保存正文时对齐引用：正文里已经不存在的图，立刻删文件。
 * 返回正文当前真正引用的 asset id 列表。
 */
export async function syncNoteAssets(_noteId: string, html: string, prevIds: string[]) {
  const next = extractAssetIds(html)
  const nextSet = new Set(next)
  const removed = prevIds.filter((id) => !nextSet.has(id))
  if (removed.length) await deleteAssets(removed)
  return next
}

/** 硬删一条便签的全部文件，等价于删掉整个目录 */
export async function deleteNoteFiles(noteId: string) {
  let freed = 0
  const ids: string[] = []
  const paths = new Map<string, string | null>()
  await db.transaction('rw', db.assets, db.blobs, async () => {
    const blobs = await db.blobs.where('noteId').equals(noteId).toArray()
    const assets = await db.assets.where('noteId').equals(noteId).toArray()
    freed = blobs.reduce((s, r) => s + r.size, 0)
    ids.push(...assets.map((a) => a.id))
    for (const a of assets) paths.set(a.id, a.storagePath)
    await db.blobs.where('noteId').equals(noteId).delete()
    await db.assets.where('noteId').equals(noteId).delete()
  })
  for (const id of ids) {
    await db.tombstones.put({
      id: `attachment:${id}`,
      kind: 'attachment',
      entityId: id,
      deletedAt: Date.now(),
      storagePath: paths.get(id) ?? null,
    })
  }
  releaseUrls(ids)
  return freed
}

/* ---------------- 孤儿清扫 ---------------- */

export interface SweepResult {
  orphanFiles: number
  orphanAssets: number
  freed: number
}

/**
 * 双向清扫：
 * 1. 文件存在但便签已被硬删 → 删文件（断电、崩溃后的残留）
 * 2. 资产记录存在但文件已丢 → 删记录
 */
export async function purgeOrphans(): Promise<SweepResult> {
  const result: SweepResult = { orphanFiles: 0, orphanAssets: 0, freed: 0 }

  const noteIds = new Set((await db.notes.toArray()).map((n) => n.id))
  const blobs = await db.blobs.toArray()
  const deadKeys: string[] = []
  for (const b of blobs) {
    if (!noteIds.has(b.noteId)) {
      deadKeys.push(b.key)
      result.freed += b.size
    }
  }
  if (deadKeys.length) {
    await db.blobs.bulkDelete(deadKeys)
    result.orphanFiles = deadKeys.length
  }

  const liveKeys = new Set((await db.blobs.toArray()).map((b) => b.key))
  const assets = await db.assets.toArray()
  const deadAssets: string[] = []
  for (const a of assets) {
    const hasOrig = liveKeys.has(`${a.noteId}/orig/${a.id}`)
    if (!hasOrig) deadAssets.push(a.id)
  }
  if (deadAssets.length) {
    await db.assets.bulkDelete(deadAssets)
    result.orphanAssets = deadAssets.length
  }

  return result
}

/* ---------------- 存储统计 ---------------- */

export interface StorageStats {
  origBytes: number
  thumbBytes: number
  totalBytes: number
  imageCount: number
  activeNotes: number
  trashNotes: number
  trashBytes: number
  trashExpiringSoon: number
}

export async function storageStats(): Promise<StorageStats> {
  const blobs = await db.blobs.toArray()
  const notes = await db.notes.toArray()
  const trashIds = new Set(notes.filter((n) => n.deletedAt).map((n) => n.id))

  let origBytes = 0
  let thumbBytes = 0
  let trashBytes = 0
  for (const b of blobs) {
    if (b.kind === 'orig') origBytes += b.size
    else thumbBytes += b.size
    if (trashIds.has(b.noteId)) trashBytes += b.size
  }

  const soon = Date.now() + 3 * 24 * 60 * 60 * 1000
  return {
    origBytes,
    thumbBytes,
    totalBytes: origBytes + thumbBytes,
    imageCount: await db.assets.count(),
    activeNotes: notes.filter((n) => !n.deletedAt).length,
    trashNotes: trashIds.size,
    trashBytes,
    trashExpiringSoon: notes.filter((n) => n.deletedAt && n.deletedAt + 30 * 86400000 < soon)
      .length,
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
