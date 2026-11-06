export function formatWhen(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mm = `${d.getMinutes()}`.padStart(2, '0')

  if (sameDay) return `${hh}:${mm}`

  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const isYest =
    d.getFullYear() === yest.getFullYear() &&
    d.getMonth() === yest.getMonth() &&
    d.getDate() === yest.getDate()
  if (isYest) return '昨天'

  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

export function noteColor(key: string): string {
  switch (key) {
    case 'yellow':
      return '#FFF8E1'
    case 'green':
      return '#EAF6EC'
    case 'blue':
      return '#EAF2FC'
    case 'pink':
      return '#FCEDF2'
    case 'gray':
      return '#F4F4F2'
    default:
      return '#FFFFFF'
  }
}
