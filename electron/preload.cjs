const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.env.npm_package_version || '1.0.0',

  /** 全局快捷键触发的新建便签 */
  onQuickNew(cb) {
    const handler = () => cb()
    ipcRenderer.on('quick-new', handler)
    return () => ipcRenderer.removeListener('quick-new', handler)
  },

  /** 把下一条提醒同步到托盘菜单 */
  setNextReminder(text) {
    ipcRenderer.send('reminder:next', text)
  },

  hide() {
    return ipcRenderer.invoke('app:hide')
  },

  quit() {
    return ipcRenderer.invoke('app:quit')
  },

  /** 通过主进程代理发 WebDAV 请求，绕开 CORS */
  davRequest(opts) {
    return ipcRenderer.invoke('dav:request', opts)
  },
})
