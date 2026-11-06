import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.sticky.notes',
  appName: '便签',
  webDir: 'dist',
  // 安卓端本地资源通过 https://localhost 提供，不能用 http（会被当不安全来源）
  android: {
    allowMixedContent: false,
  },
  plugins: {
    /**
     * 注意：这里刻意不开 CapacitorHttp。
     *
     * 原本想用它绕过坚果云的 CORS，但实测它对 HTTP 方法做了白名单，
     * 只允许 OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/PATCH，
     * WebDAV 的 MKCOL 和 PROPFIND 会被直接拒绝：
     *   "Expected one of [...] but was MKCOL"
     *
     * 所以改成了自研原生插件 DavClient（android/.../DavPlugin.java），
     * 用 OkHttp 发任意方法，二进制请求体也一并支持。
     * webdav.ts 会优先走这条通道，不再依赖 fetch。
     */
    CapacitorHttp: {
      enabled: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#2f6b4f',
    },
  },
}

export default config
