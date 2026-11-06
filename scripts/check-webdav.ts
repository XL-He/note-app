/**
 * WebDAV 路径解析与同步算法的纯函数校验。
 * 运行：node --experimental-strip-types scripts/check-webdav.ts
 *
 * 重点验证 hrefToRelative：坚果云返回的 href 可能是绝对路径、
 * 完整 URL、或带百分号编码，三种都得能正确落到相对路径。
 */
import { hrefToRelative } from '../src/lib/webdav.ts'

let pass = 0
let fail = 0

function eq(actual: unknown, expect: unknown, label: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expect)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`✗ ${label}\n    期望 ${e}\n    实际 ${a}`)
  }
}

const ENDPOINT = 'https://dav.jianguoyun.com/dav/'
const ROOT = 'sticky-notes'

/* --- 1. 绝对路径形态（坚果云最常见） --- */
eq(
  hrefToRelative('/dav/sticky-notes/pc.json', ENDPOINT, ROOT),
  'pc.json',
  '绝对路径 → 根下文件',
)
eq(
  hrefToRelative('/dav/sticky-notes/files/abc.webp', ENDPOINT, ROOT),
  'files/abc.webp',
  '绝对路径 → 子目录文件',
)

/* --- 2. 完整 URL 形态 --- */
eq(
  hrefToRelative('https://dav.jianguoyun.com/dav/sticky-notes/phone.json', ENDPOINT, ROOT),
  'phone.json',
  '完整 URL → 根下文件',
)
eq(
  hrefToRelative('https://dav.jianguoyun.com/dav/sticky-notes/files/x.png', ENDPOINT, ROOT),
  'files/x.png',
  '完整 URL → 子目录文件',
)

/* --- 3. 百分号编码 --- */
eq(
  hrefToRelative('/dav/sticky-notes/%E4%BE%BF%E7%AD%BE.json', ENDPOINT, ROOT),
  '便签.json',
  '编码的中文文件名',
)

/* --- 4. 目录自身（应返回 null） --- */
eq(hrefToRelative('/dav/sticky-notes/', ENDPOINT, ROOT), null, '目录自身 → null')
eq(hrefToRelative('/dav/sticky-notes', ENDPOINT, ROOT), null, '目录自身无斜杠 → null')

/* --- 5. 不在同步目录下的条目 --- */
eq(hrefToRelative('/dav/other/file.json', ENDPOINT, ROOT), null, '别的目录 → null')
eq(hrefToRelative('/', ENDPOINT, ROOT), null, '根路径 → null')

/* --- 6. endpoint 不带结尾斜杠 --- */
eq(
  hrefToRelative('/dav/sticky-notes/pc.json', 'https://dav.jianguoyun.com/dav', ROOT),
  'pc.json',
  'endpoint 无尾斜杠也能解析',
)

/* --- 7. 自定义 endpoint（换服务商） --- */
eq(
  hrefToRelative('/remote.php/dav/files/me/notes/a.json', 'https://cloud.example.com/remote.php/dav/files/me/', 'notes'),
  'a.json',
  '自定义 endpoint 路径前缀',
)

/* --- 8. 大小写不同的 rootDir 前缀不应误判 --- */
eq(
  hrefToRelative('/dav/sticky-notes-backup/a.json', ENDPOINT, ROOT),
  null,
  '相似前缀不误判',
)

/* --- 9. 快照文件过滤逻辑（复现 sync.ts 里的判断） --- */
const files = [
  'pc.json',
  'phone.json',
  'files/a.webp',
  'files/b.png',
]
const snapshots = files.filter((f) => f.endsWith('.json') && !f.includes('/'))
eq(snapshots, ['pc.json', 'phone.json'], '快照过滤只收根目录 json')

const images = files.filter((f) => f.startsWith('files/'))
eq(images, ['files/a.webp', 'files/b.png'], '图片过滤只收 files/ 下')

/* --- 10. 快照合并 LWW：同 id 取 updated_at 大者 --- */
interface Row {
  id: string
  updated_at: number
}
function mergeLww(batches: Row[][]): Map<string, Row> {
  const map = new Map<string, Row>()
  for (const batch of batches) {
    for (const row of batch) {
      const cur = map.get(row.id)
      if (!cur || row.updated_at >= cur.updated_at) map.set(row.id, row)
    }
  }
  return map
}
const merged = mergeLww([
  [{ id: 'a', updated_at: 100 }, { id: 'b', updated_at: 200 }],
  [{ id: 'a', updated_at: 300 }],
])
eq(merged.get('a')?.updated_at, 300, 'LWW：后到的较新版本胜出')
eq(merged.get('b')?.updated_at, 200, 'LWW：只在一边存在的保留')
eq(merged.size, 2, 'LWW：不重复计数')

/* --- 11. 墓碑按 deleted_at 取大 --- */
function mergeTomb(batches: { id: string; deleted_at: number }[]) {
  const map = new Map<string, { id: string; deleted_at: number }>()
  for (const t of batches) {
    const cur = map.get(t.id)
    if (!cur || t.deleted_at >= cur.deleted_at) map.set(t.id, t)
  }
  return map
}
eq(
  mergeTomb([
    { id: 'note:x', deleted_at: 10 },
    { id: 'note:x', deleted_at: 50 },
  ]).get('note:x')?.deleted_at,
  50,
  '墓碑：取较晚的删除时间',
)

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
if (fail > 0) process.exit(1)
