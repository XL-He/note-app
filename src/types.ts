export interface Note {
  id: string
  title: string
  contentHtml: string
  plainText: string
  color: string
  pinned: number
  createdAt: number
  updatedAt: number
  /** null 表示正常；有值表示在回收站，值是删除时间 */
  deletedAt: number | null
  /** 正文当前引用的图片 id，用于引用计数 */
  assetIds: string[]
  rev: number
}

export interface Asset {
  id: string
  noteId: string
  mime: string
  size: number
  thumbSize: number
  width: number
  height: number
  createdAt: number
  /** 云端对象路径，null 表示还没上传 */
  storagePath: string | null
  updatedAt: number
}

/** 模拟文件系统：key = `${noteId}/${kind}/${assetId}` */
export interface BlobRecord {
  key: string
  noteId: string
  assetId: string
  kind: 'orig' | 'thumb'
  blob: Blob
  size: number
  createdAt: number
}

export interface TimeTrigger {
  kind: 'time'
  anchor: { type: 'now' } | { type: 'absolute'; at: number } | { type: 'due'; at: number }
  step: { amount: number; unit: 'minute' | 'hour' | 'day' | 'week' }
  window: { days: number[]; from: string; to: string } | null
  end: { type: 'count'; value: number } | { type: 'until'; at: number } | { type: 'manual' }
  escalate: { after: number; channel: 'local' | 'push' | 'email' }[]
  quiet: { from: string; to: string; mode: 'defer' | 'silent' } | null
  skipHolidays?: boolean
}

export interface Reminder {
  id: string
  noteId: string
  title: string
  trigger: TimeTrigger
  nextAt: number | null
  /** 上一次计划触发时刻，用来算下一次，避免间隔漂移 */
  lastFire: number | null
  firedCount: number
  state: 'active' | 'done' | 'expired'
  createdAt: number
  updatedAt: number
}

/** 硬删除标记，防止另一台设备把已删除的内容推回来 */
export interface Tombstone {
  /** `${kind}:${entityId}` */
  id: string
  kind: 'note' | 'reminder' | 'attachment'
  entityId: string
  deletedAt: number
  /** 附件删除时带上云端对象路径，好在同步时一并清掉 */
  storagePath?: string | null
}

