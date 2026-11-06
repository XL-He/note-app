/**
 * 端到端同步验证：两台虚拟设备通过本地 mock WebDAV 交换数据。
 *
 * 运行：
 *   node --import tsx scripts/check-sync.mjs          浏览器 fetch 分支
 *   node --import tsx scripts/check-sync.mjs --ipc    桌面版 IPC 代理分支
 *   node --import tsx scripts/check-sync.mjs --both   两套都跑
 *
 * 覆盖：新建→上传、对端拉取、双向合并、硬删除传播（不复活）、
 *      无变化时不重复上传（流量门控）。
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer } from './mock-webdav.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

let pass = 0
let fail = 0

function check(ok, label, detail) {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`)
  }
}

function eq(actual, expect, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expect)
  check(a === e, label, a === e ? '' : `期望 ${e} / 实际 ${a}`)
}

async function runSuite(useIpc) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'))
  const server = await startServer(0)
  const mode = useIpc ? 'IPC 代理' : '浏览器 fetch'
  console.log(`\n=== ${mode} ===`)
  console.log(`mock WebDAV: ${server.endpoint}`)

  const device = (name, cmd, arg) =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', 'scripts/sync-device.mjs', cmd, arg ?? ''],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            DAV_ENDPOINT: server.endpoint,
            DEVICE_ID: name,
            NOTE_DB_NAME: `test-${name}`,
            STATE_FILE: path.join(TMP, `${name}.state.json`),
            USE_IPC: useIpc ? '1' : '0',
          },
          maxBuffer: 8 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`${name} ${cmd} 失败:\n${stderr || stdout || err.message}`))
            return
          }
          const lines = stdout.trim().split('\n').filter(Boolean)
          try {
            resolve(JSON.parse(lines[lines.length - 1]))
          } catch {
            reject(new Error(`${name} ${cmd} 输出无法解析: ${stdout}`))
          }
        },
      )
    })

  try {
    /* --- 1. A 新建并同步 --- */
    const seeded = await device('A', 'seed', '买菜清单')
    check(typeof seeded.seeded === 'string', 'A 新建了一条便签')

    const aSync1 = await device('A', 'sync')
    eq(aSync1.pushed, 1, 'A 首次同步上传了快照')
    check(server.listFiles().includes('/dav/sticky-notes/A.json'), '网盘上出现 A 的快照')

    /* --- 2. B 拉取 --- */
    const bSync1 = await device('B', 'sync')
    eq(bSync1.pulled, 1, 'B 首次同步拉到 1 条便签')

    const bList1 = await device('B', 'list')
    eq(bList1.map((n) => n.title), ['买菜清单'], 'B 看到的是 A 写的便签')

    /* --- 3. B 新建并同步，A 拉取 --- */
    await device('B', 'seed', '会议纪要')
    await device('B', 'sync')
    const aSync2 = await device('A', 'sync')
    eq(aSync2.pulled, 1, 'A 拉到 B 新增的 1 条')

    const aList2 = await device('A', 'list')
    eq(
      [...aList2.map((n) => n.title)].sort(),
      ['会议纪要', '买菜清单'].sort(),
      'A 与 B 的便签集合一致',
    )

    /* --- 4. A 硬删，自己和 B 都不能复活 --- */
    const shopping = aList2.find((n) => n.title === '买菜清单')
    await device('A', 'harddel', shopping.id)
    await device('A', 'sync')

    // 这一条是最容易漏的：删完自己又同步，会从对端的旧快照里把删掉的行拉回来。
    // 之前的测试只查了 B，所以没发现这个问题。
    const aAfterDel = await device('A', 'list')
    eq(
      [...aAfterDel.map((n) => n.title)].sort(),
      ['会议纪要'],
      '删除方自己不会复活（关键）',
    )

    const bSync2 = await device('B', 'sync')
    check(bSync2.deleted >= 1, 'B 同步时执行了删除', `deleted=${bSync2.deleted}`)

    const bList2 = await device('B', 'list')
    eq([...bList2.map((n) => n.title)].sort(), ['会议纪要'], '删除传播到 B，且没有复活')

    /* --- 4b. 软删（进回收站）也要传到对端 --- */
    const meeting = aAfterDel.find((n) => n.title === '会议纪要')
    await device('B', 'softdel', meeting.id)
    await device('B', 'sync')
    await device('A', 'sync')

    const aSoft = await device('A', 'list')
    const meetingInA = aSoft.find((n) => n.title === '会议纪要')
    check(
      meetingInA != null && meetingInA.deletedAt != null,
      '软删传播到 A（A 侧也进了回收站）',
      meetingInA ? `deletedAt=${meetingInA.deletedAt}` : 'A 侧找不到这条',
    )

    // 回收站里的东西不该算「活跃便签」，但仍要留在库中等着恢复
    const bSoft = await device('B', 'list')
    check(
      bSoft.some((n) => n.id === meeting.id && n.deletedAt != null),
      'B 侧仍保留这条（可恢复），只是标记为已删',
    )

    /* --- 5. 无变化时不重复上传（流量门控） --- */
    await device('A', 'sync')
    const aSync3 = await device('A', 'sync')
    eq(aSync3.pushed, 0, '数据没变时不再上传快照（省流量）')

    /* --- 6. 网盘文件结构 --- */
    const files = server.listFiles()
    check(files.includes('/dav/sticky-notes/A.json'), 'A 快照在网盘上')
    check(files.includes('/dav/sticky-notes/B.json'), 'B 快照在网盘上')

    /* --- 7. 快照内容可解析且结构正确 --- */
    const snapA = JSON.parse(server.readFile('/dav/sticky-notes/A.json'))
    eq(snapA.version, 1, '快照版本号正确')
    check(Array.isArray(snapA.notes), '快照含 notes 数组')
    check(snapA.notes.length === 1, 'A 的快照里只剩 1 条（删掉的那条已移除）')
  } catch (e) {
    fail++
    console.log(`  ✗ 测试中断: ${e.message}`)
  } finally {
    await server.close()
    fs.rmSync(TMP, { recursive: true, force: true })
  }
}

const both = process.argv.includes('--both')
const ipcOnly = process.argv.includes('--ipc')

if (ipcOnly) {
  await runSuite(true)
} else if (both) {
  await runSuite(false)
  await runSuite(true)
} else {
  await runSuite(false)
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail > 0 ? 1 : 0)
