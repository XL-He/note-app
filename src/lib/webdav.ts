/**
 * 坚果云 WebDAV 客户端。
 *
 * 坚果云 WebDAV 端点：https://dav.jianguoyun.com/dav/
 * 账号 = 邮箱，密码 = 在「设置 → 安全选项 → 第三方应用管理」里生成的应用密码。
 *
 * 本模块只负责「往网盘读写字节」，不关心业务结构。
 *
 * 传输通道有三条，按环境自动选择：
 *   1. Electron 桌面版 → 主进程 IPC 代理（app:// 源发不出跨域请求）
 *   2. 安卓原生壳     → 自研原生插件（Capacitor 自带的不支持 MKCOL/PROPFIND）
 *   3. 浏览器         → 直接 fetch（仅开发调试用，会被坚果云的 CORS 拦住）
 */
import {
  base64ToText,
  nativeDavAvailable,
  nativeDavRequest,
  textToBase64,
} from './davClient'

export interface DavConfig {
  /** 形如 https://dav.jianguoyun.com/dav/ ，必须以 / 结尾 */
  endpoint: string
  username: string
  password: string
  /** 根目录名，所有同步文件放在这个目录下 */
  rootDir: string
}

/** 本机账号配置在 localStorage 里的键 */
const CONFIG_KEY = 'dav-config'

function basicAuth(cfg: DavConfig): string {
  return 'Basic ' + btoa(unescape(encodeURIComponent(`${cfg.username}:${cfg.password}`)))
}

function joinPath(cfg: DavConfig, rel: string): string {
  const base = cfg.endpoint.endsWith('/') ? cfg.endpoint : cfg.endpoint + '/'
  const root = cfg.rootDir.replace(/^\/+|\/+$/g, '')
  const clean = rel.replace(/^\/+/, '')
  return `${base}${root}/${clean}`
}

/**
 * 统一的底层请求。
 * 桌面端走主进程 IPC 代理（坚果云不返回 CORS 头，浏览器直发会被拦）；
 * 浏览器/开发环境直接 fetch（配合 Vite 代理或后端转发）。
 */
interface DavResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  bodyText: string
  bodyBase64: string | null
}

async function davFetch(
  cfg: DavConfig,
  method: string,
  rel: string,
  opts: { body?: BodyInit | null; rawUrl?: string; headers?: Record<string, string> } = {},
): Promise<DavResponse> {
  const url = opts.rawUrl ?? joinPath(cfg, rel)
  const auth = basicAuth(cfg)
  const contentType = opts.headers?.['Content-Type'] ?? (opts.body != null ? 'application/octet-stream' : undefined)

  if (typeof window !== 'undefined' && window.desktop?.davRequest) {
    // 桌面端：走主进程代理
    let bodyPayload: string | { base64: string } | undefined
    if (opts.body != null) {
      if (typeof opts.body === 'string') {
        bodyPayload = opts.body
      } else if (opts.body instanceof Blob) {
        const buf = new Uint8Array(await opts.body.arrayBuffer())
        let bin = ''
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
        bodyPayload = { base64: btoa(bin) }
      }
    }
    const res = await window.desktop.davRequest({
      method,
      url,
      headers: {
        Authorization: auth,
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(opts.headers ?? {}),
      },
      body: bodyPayload,
      responseType: 'base64',
    })
    if (!res.ok && res.status === 0 && res.error) {
      throw new Error(res.error)
    }
    // 桌面端 base64 响应需要还原成文本或二进制，这里只取文本；图片由上层用 bodyBase64 解码
    const text = res.bodyBase64
      ? decodeBase64(res.bodyBase64)
      : (res.bodyText ?? '')
    return {
      status: res.status,
      statusText: res.statusText ?? '',
      headers: res.headers ?? {},
      bodyText: text,
      bodyBase64: res.bodyBase64 ?? null,
    }
  }

  // 安卓原生壳：走自研插件，Capacitor 自带的不支持 MKCOL/PROPFIND
  if (nativeDavAvailable()) {
    let bodyBase64: string | undefined
    if (opts.body != null) {
      if (typeof opts.body === 'string') {
        bodyBase64 = textToBase64(opts.body)
      } else if (opts.body instanceof Blob) {
        bodyBase64 = await blobToBase64(opts.body)
      }
    }

    const res = await nativeDavRequest({
      url,
      method,
      headers: {
        Authorization: auth,
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(opts.headers ?? {}),
      },
      bodyBase64,
      contentType,
    })

    return {
      status: res.status,
      statusText: '',
      headers: res.headers ?? {},
      bodyText: base64ToText(res.bodyBase64),
      bodyBase64: res.bodyBase64 || null,
    }
  }

  // 浏览器直发
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body ?? undefined,
  })
  const buf = await r.arrayBuffer()
  let bodyText = ''
  let bodyBase64: string | null = null
  if (buf.byteLength) {
    bodyBase64 = base64FromBytes(new Uint8Array(buf))
    bodyText = new TextDecoder().decode(buf)
  }
  const headers: Record<string, string> = {}
  r.headers.forEach((v, k) => {
    headers[k] = v
  })
  return { status: r.status, statusText: r.statusText, headers, bodyText, bodyBase64 }
}

function base64FromBytes(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/** Blob → base64。分块处理，避免大图片一次性展开把调用栈撑爆 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const chunk = 0x8000
  let bin = ''
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + chunk) as unknown as number[])
  }
  return btoa(bin)
}

function decodeBase64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** 把一个相对路径拆成「目录链」，用于逐级 MKCOL */
function parentsOf(rel: string): string[] {
  const segs = rel.split('/').filter(Boolean)
  // 去掉最后一个（文件名），剩下的都是目录
  segs.pop()
  const out: string[] = []
  let acc = ''
  for (const s of segs) {
    acc = acc ? `${acc}/${s}` : s
    out.push(acc)
  }
  return out
}

/**
 * 把 PROPFIND 响应里的 <d:href> 转成「相对于 rootDir 的路径」。
 *
 * 不同服务端给的形态不一样：
 *   - 完整 URL   https://dav.jianguoyun.com/dav/sticky-notes/pc.json
 *   - 绝对路径   /dav/sticky-notes/pc.json
 *   - 带编码     /dav/sticky-notes/%E4%BE%BF%E7%AD%BE.json
 * 统一按 pathname 处理，再减掉 endpoint 路径 + rootDir 前缀。
 * 返回 null 表示这一条不属于同步目录（比如目录自身）。
 */
export function hrefToRelative(href: string, endpoint: string, rootDir: string): string | null {
  let path = href.trim()
  if (!path) return null

  // 完整 URL → 只取 pathname
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname
    } catch {
      return null
    }
  }

  // 解码百分号编码，失败就按原样用
  try {
    path = decodeURIComponent(path)
  } catch {
    /* keep as is */
  }

  // endpoint 自身可能带路径前缀，如 /dav/
  let basePath = '/'
  try {
    basePath = new URL(endpoint).pathname
  } catch {
    basePath = '/'
  }
  basePath = basePath.replace(/\/+$/, '')

  const root = rootDir.replace(/^\/+|\/+$/g, '')
  const prefix = `${basePath}/${root}`.replace(/\/{2,}/g, '/')
  if (!path.startsWith(prefix)) return null

  const rest = path.slice(prefix.length)
  // 前缀之后必须紧跟 / 或已结束，否则是相似前缀（sticky-notes-backup）
  if (rest !== '' && !rest.startsWith('/')) return null

  const rel = rest.replace(/^\/+/, '').replace(/\/+$/, '')
  return rel || null
}

/** 确保同步根目录存在。MKCOL 已存在会返回 405，视为成功 */
export async function davEnsureRoot(cfg: DavConfig): Promise<void> {
  const base = cfg.endpoint.endsWith('/') ? cfg.endpoint : cfg.endpoint + '/'
  const root = cfg.rootDir.replace(/^\/+|\/+$/g, '')
  const r = await davFetch(cfg, 'MKCOL', '', { rawUrl: `${base}${root}` })
  // 201 新建成功；405 已存在；200/301 某些服务端的变体
  if (r.status !== 201 && r.status !== 405 && r.status !== 200 && r.status !== 301) {
    throw new Error(`创建同步目录失败 (${r.status})`)
  }
}

/** 确保某个文件的父目录存在（WebDAV 需要先 MKCOL） */
async function ensureParentDirs(cfg: DavConfig, rel: string): Promise<void> {
  await davEnsureRoot(cfg)
  for (const dir of parentsOf(rel)) {
    const r = await davFetch(cfg, 'MKCOL', dir)
    // 201 新建成功；405 表示已存在；其他都算失败
    if (r.status !== 201 && r.status !== 405) {
      throw new Error(`创建目录失败 (${r.status}): ${dir}`)
    }
  }
}

/** 上传文件，会自动建目录 */
export async function davPut(cfg: DavConfig, rel: string, data: Blob | string): Promise<void> {
  await ensureParentDirs(cfg, rel)
  const r = await davFetch(cfg, 'PUT', rel, { body: data })
  if (r.status !== 200 && r.status !== 201 && r.status !== 204) {
    throw new Error(`上传失败 (${r.status})`)
  }
}

/** 下载文件，不存在返回 null */
export async function davGet(cfg: DavConfig, rel: string): Promise<Blob | null> {
  const r = await davFetch(cfg, 'GET', rel)
  if (r.status === 404) return null
  if (r.status < 200 || r.status >= 300) throw new Error(`下载失败 (${r.status})`)
  const mime = (r.headers['content-type'] || '').split(';')[0] || 'application/octet-stream'
  if (r.bodyBase64 != null) return base64ToBlob(r.bodyBase64, mime)
  return new Blob([r.bodyText], { type: mime })
}

/** 删除文件，不存在也算成功 */
export async function davDelete(cfg: DavConfig, rel: string): Promise<void> {
  const r = await davFetch(cfg, 'DELETE', rel)
  if (r.status !== 200 && r.status !== 204 && r.status !== 404) {
    throw new Error(`删除失败 (${r.status})`)
  }
}

export interface DavEntry {
  /** 相对于 rootDir 的路径 */
  path: string
  /** 服务端最后修改时间，用于判断是否需要重新下载 */
  lastModified: string
  size: number
}

/**
 * 列出某个目录下的文件及其元信息（浅列，Depth: 1）。
 * 只用 Depth: 1 是因为部分服务端拒绝 Depth: infinity，而我们的结构只有两层。
 */
export async function davListEntries(cfg: DavConfig, rel: string): Promise<DavEntry[]> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getlastmodified/>
    <d:getcontentlength/>
  </d:prop>
</d:propfind>`
  const r = await davFetch(cfg, 'PROPFIND', rel, {
    body,
    rawUrl: joinPath(cfg, rel),
    headers: { 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
  })
  // 目录还不存在时，服务端会 404；当作「空目录」处理
  if (r.status === 404) return []
  if (r.status < 200 || r.status >= 300) throw new Error(`列目录失败 (${r.status})`)

  const out: DavEntry[] = []
  const respRe = /<d:response>([\s\S]*?)<\/d:response>/g
  let resp: RegExpExecArray | null
  while ((resp = respRe.exec(r.bodyText))) {
    const block = resp[1]
    const hrefM = /<d:href>([^<]+)<\/d:href>/.exec(block)
    if (!hrefM) continue
    // 目录项（含 <d:collection/>）跳过，只收文件
    const isCol =
      /<d:collection\s*\/>/.test(block) || /<d:collection>\s*<\/d:collection>/.test(block)
    if (isCol) continue
    const path = hrefToRelative(hrefM[1], cfg.endpoint, cfg.rootDir)
    if (!path) continue
    const modM = /<d:getlastmodified>([^<]+)<\/d:getlastmodified>/.exec(block)
    const sizeM = /<d:getcontentlength>([^<]+)<\/d:getcontentlength>/.exec(block)
    out.push({
      path,
      lastModified: modM ? modM[1] : '',
      size: sizeM ? Number(sizeM[1]) : 0,
    })
  }
  return out
}

/** 只要路径列表时用这个 */
export async function davListFiles(cfg: DavConfig, rel: string): Promise<string[]> {
  const entries = await davListEntries(cfg, rel)
  return entries.map((e) => e.path)
}

/* ---------------- 账号配置持久化 ---------------- */

export function loadDavConfig(): DavConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    return JSON.parse(raw) as DavConfig
  } catch {
    return null
  }
}

export function saveDavConfig(cfg: DavConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

export function clearDavConfig(): void {
  localStorage.removeItem(CONFIG_KEY)
}

/** 是否已配置同步账号 */
export function isConfigured(): boolean {
  return loadDavConfig() !== null
}

/** 连通性测试：建目录 → 写探测文件 → 读回 → 删掉 */
export async function davTest(cfg: DavConfig): Promise<{ ok: boolean; message: string }> {
  try {
    await davEnsureRoot(cfg)
    const probe = `.probe-${Date.now()}`
    await davPut(cfg, probe, 'ok')
    const back = await davGet(cfg, probe)
    await davDelete(cfg, probe)
    if (!back) return { ok: false, message: '写入成功但读不回来，请检查目录权限' }
    return { ok: true, message: '连接成功' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '连接失败'
    if (/40[13]/.test(msg)) {
      return { ok: false, message: '账号或应用密码不正确，也可能是应用密码已被删除' }
    }
    return { ok: false, message: msg }
  }
}
