import type { Reminder, TimeTrigger } from '../types'
import { nextFireAt } from '../lib/schedule'
import { db, uid } from './index'

export async function createReminder(
  noteId: string,
  title: string,
  trigger: TimeTrigger,
): Promise<Reminder> {
  const now = Date.now()
  const nextAt = nextFireAt(trigger, null, 0, now)
  const reminder: Reminder = {
    id: uid(),
    noteId,
    title,
    trigger,
    nextAt,
    lastFire: null,
    firedCount: 0,
    state: nextAt ? 'active' : 'done',
    createdAt: now,
    updatedAt: now,
  }
  await db.reminders.add(reminder)
  return reminder
}

export async function listByNote(noteId: string): Promise<Reminder[]> {
  const rows = await db.reminders.where('noteId').equals(noteId).toArray()
  return rows.sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity))
}

export async function listActive(): Promise<Reminder[]> {
  const rows = await db.reminders.where('nextAt').above(0).toArray()
  return rows
    .filter((r) => r.state === 'active' && r.nextAt !== null)
    .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))
}

/** 每条便签只取最近的一条提醒，用于列表角标 */
export async function nearestByNote(): Promise<Map<string, Reminder>> {
  const rows = await db.reminders.toArray()
  const map = new Map<string, Reminder>()
  for (const r of rows) {
    if (r.state !== 'active' || r.nextAt === null) continue
    const cur = map.get(r.noteId)
    if (!cur || (cur.nextAt ?? 0) > r.nextAt) map.set(r.noteId, r)
  }
  return map
}

export async function removeReminder(id: string) {
  await db.reminders.delete(id)
  await db.tombstones.put({
    id: `reminder:${id}`,
    kind: 'reminder',
    entityId: id,
    deletedAt: Date.now(),
  })
}

export async function removeByNote(noteId: string) {
  const rows = await db.reminders.where('noteId').equals(noteId).toArray()
  await db.reminders.where('noteId').equals(noteId).delete()
  for (const r of rows) {
    await db.tombstones.put({
      id: `reminder:${r.id}`,
      kind: 'reminder',
      entityId: r.id,
      deletedAt: Date.now(),
    })
  }
}

export async function replaceTrigger(id: string, trigger: TimeTrigger) {
  const r = await db.reminders.get(id)
  if (!r) return
  const nextAt = nextFireAt(trigger, null, 0, Date.now())
  await db.reminders.put({
    ...r,
    trigger,
    nextAt,
    lastFire: null,
    firedCount: 0,
    state: nextAt ? 'active' : 'done',
    updatedAt: Date.now(),
  })
}

/** 到点未触发的提醒 */
export async function dueReminders(now = Date.now()): Promise<Reminder[]> {
  const rows = await db.reminders.where('nextAt').belowOrEqual(now).toArray()
  return rows.filter((r) => r.state === 'active' && r.nextAt !== null)
}

/**
 * 记一次触发：累加次数，按规则算下一次。
 * scheduledAt 用计划时刻而非实际时刻，否则应用关一夜后间隔会整体漂移。
 */
export async function fireReminder(r: Reminder, scheduledAt: number): Promise<Reminder> {
  const firedCount = r.firedCount + 1
  const nextAt = nextFireAt(r.trigger, scheduledAt, firedCount, r.createdAt)
  const next: Reminder = {
    ...r,
    firedCount,
    lastFire: scheduledAt,
    nextAt,
    state: nextAt ? 'active' : 'done',
    updatedAt: Date.now(),
  }
  await db.reminders.put(next)
  return next
}

/** 推后 N 分钟再响，不改动规则的节奏 */
export async function snoozeReminder(id: string, minutes: number): Promise<Reminder | null> {
  const r = await db.reminders.get(id)
  if (!r) return null
  const next: Reminder = {
    ...r,
    nextAt: Date.now() + minutes * 60_000,
    state: 'active',
    updatedAt: Date.now(),
  }
  await db.reminders.put(next)
  return next
}

export async function stopReminder(id: string) {
  const r = await db.reminders.get(id)
  if (!r) return
  await db.reminders.put({ ...r, state: 'done', nextAt: null, updatedAt: Date.now() })
}
