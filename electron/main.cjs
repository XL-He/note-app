const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  net,
  protocol,
  shell,
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { davProxy } = require('./dav-proxy.cjs')

const DEV_URL = process.env.ELECTRON_START_URL
const IS_DEV = !!DEV_URL
const ICON_DIR = path.join(__dirname, 'assets')
const DIST_DIR = path.join(__dirname, '..', 'dist')

let logPath = null
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`
  if (IS_DEV) console.log(line)
  try {
    if (!logPath) logPath = path.join(app.getPath('userData'), 'startup.log')
    fs.appendFileSync(logPath, line + '\n')
  } catch {
    /* 日志失败不影响主流程 */
  }
}

process.on('uncaughtException', (err) => {
  log('uncaughtException', err && err.stack ? err.stack : String(err))
})
process.on('unhandledRejection', (err) => {
  log('unhandledRejection', err && err.stack ? err.stack : String(err))
})

let win = null
let tray = null
let quitting = false
let nextReminderText = ''

app.setAppUserModelId('com.sticky.notes')

// 用自定义协议而不是 file://：file:// 是不透明源，IndexedDB 会被拒绝
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

const gotLock = app.requestSingleInstanceLock()
log('boot', 'electron=' + process.versions.electron, 'lock=' + gotLock, 'argv=' + process.argv.join(' '))
if (!gotLock) {
  app.quit()
}

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(ICON_DIR, 'icon-32.png'))
  return img.isEmpty() ? nativeImage.createFromPath(path.join(ICON_DIR, 'icon.png')) : img
}

function createWindow() {
  log('createWindow')
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 680,
    minHeight: 460,
    show: false,
    backgroundColor: '#f7f7f4',
    title: '便签',
    icon: path.join(ICON_DIR, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 关键：窗口收进托盘后定时器不能被降频，否则提醒会迟到
      backgroundThrottling: false,
      spellcheck: false,
    },
  })

  if (IS_DEV) {
    win.loadURL(DEV_URL)
  } else {
    win.loadURL('app://local/index.html')
  }

  win.once('ready-to-show', () => win.show())

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    win = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('console-message', (...args) => {
    const detail = args[1]
    if (detail && typeof detail === 'object' && 'message' in detail) {
      console.log('[renderer]', detail.message)
    } else {
      console.log('[renderer]', args[2])
    }
  })

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('页面加载失败', code, desc, url)
    log('did-fail-load', code, desc, url)
  })

  win.webContents.on('did-finish-load', () => {
    console.log('窗口已加载:', win.webContents.getURL())
    log('did-finish-load', win.webContents.getURL())
  })
}

function showWindow() {
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function toggleWindow() {
  if (win && win.isVisible() && win.isFocused()) win.hide()
  else showWindow()
}

function quickNew() {
  showWindow()
  if (win) win.webContents.send('quick-new')
}

function rebuildTrayMenu() {
  if (!tray) return
  const template = []

  if (nextReminderText) {
    template.push({ label: `下一条提醒：${nextReminderText}`, enabled: false })
    template.push({ type: 'separator' })
  }

  template.push(
    { label: '显示便签', click: showWindow },
    { label: '新建便签', accelerator: 'Ctrl+Alt+N', click: quickNew },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  )

  tray.setContextMenu(Menu.buildFromTemplate(template))
  tray.setToolTip(nextReminderText ? `便签 · 下一条 ${nextReminderText}` : '便签 · Ctrl+Alt+N 新建')
}

function createTray() {
  tray = new Tray(trayIcon())
  rebuildTrayMenu()
  tray.on('click', toggleWindow)
  tray.on('double-click', showWindow)
}

app.whenReady().then(() => {
  log('ready', 'isDev=' + IS_DEV)

  if (!IS_DEV) {
    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url)
      const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
      const filePath = path.normalize(path.join(DIST_DIR, rel))
      if (!filePath.startsWith(DIST_DIR)) {
        return new Response('forbidden', { status: 403 })
      }
      return net.fetch(pathToFileURL(filePath).toString())
    })
  }

  createWindow()
  createTray()

  const ok = globalShortcut.register('Control+Alt+N', quickNew)
  if (!ok) console.warn('全局快捷键 Ctrl+Alt+N 注册失败，可能被其他程序占用')

  // 开机自启时静默进托盘，不弹窗口
  if (process.argv.includes('--hidden') && win) win.hide()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

app.on('second-instance', () => showWindow())

app.on('window-all-closed', () => {
  // 桌面版常驻托盘，不随窗口关闭退出
})

app.on('before-quit', () => {
  quitting = true
  globalShortcut.unregisterAll()
})

app.on('quit', () => log('quit'))

ipcMain.on('reminder:next', (_e, text) => {
  nextReminderText = typeof text === 'string' ? text : ''
  rebuildTrayMenu()
})

ipcMain.handle('app:hide', () => {
  win?.hide()
})

ipcMain.handle('app:quit', () => {
  quitting = true
  app.quit()
})

/**
 * WebDAV 请求代理：坚果云 WebDAV 不返回 CORS 头，渲染进程直接发会被拦，
 * 所以由主进程用 Node 原生 fetch 转发，绕过同源策略。
 * 执行体在 dav-proxy.cjs，单独抽出来是为了能直接单测。
 */
ipcMain.handle('dav:request', (_e, opts) => davProxy(opts))
