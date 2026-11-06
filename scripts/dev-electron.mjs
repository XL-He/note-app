import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

const URL = 'http://127.0.0.1:5188'
const isWin = process.platform === 'win32'

const vite = spawn(isWin ? 'npx.cmd' : 'npx', ['vite'], {
  stdio: 'inherit',
  shell: true,
})

let exited = false
function shutdown(code = 0) {
  if (exited) return
  exited = true
  try {
    vite.kill()
  } catch {
    /* ignore */
  }
  process.exit(code)
}

async function waitServer(timeoutMs = 90_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(URL)
      if (r.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

if (!(await waitServer())) {
  console.error('Vite 没有在预期时间内启动，已中止')
  shutdown(1)
}

console.log('桌面版启动中…')

// 有些终端环境会带 ELECTRON_RUN_AS_NODE，那会让 Electron 退化成纯 Node，必须去掉
const env = { ...process.env, ELECTRON_START_URL: URL }
delete env.ELECTRON_RUN_AS_NODE

const el = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})

el.on('exit', (code) => shutdown(code ?? 0))
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
