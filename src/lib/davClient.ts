import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * 安卓原生 WebDAV 代理。
 *
 * 不能用 Capacitor 自带的 CapacitorHttp：它对 HTTP 方法做了白名单，
 * 不接受 WebDAV 的 MKCOL / PROPFIND，会直接报
 * "Expected one of [OPTIONS, GET, HEAD, POST, PUT, DELETE, TRACE, PATCH] but was MKCOL"。
 * 所以自己写了个原生插件（android/.../DavPlugin.java），用 OkHttp 发任意方法。
 */
export interface NativeDavResponse {
  status: number
  headers: Record<string, string>
  /** 响应体的 base64，二进制和文本都走这个字段 */
  bodyBase64: string
}

interface DavClientPlugin {
  request(opts: {
    url: string
    method: string
    headers?: Record<string, string>
    /** 请求体，二进制或文本统一编码成 base64 */
    bodyBase64?: string
    contentType?: string
  }): Promise<NativeDavResponse>
}

const DavClient = registerPlugin<DavClientPlugin>('DavClient')

/** 是否在能用的原生环境里（安卓壳内） */
export function nativeDavAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('DavClient')
  } catch {
    return false
  }
}

export function nativeDavRequest(opts: {
  url: string
  method: string
  headers?: Record<string, string>
  bodyBase64?: string
  contentType?: string
}): Promise<NativeDavResponse> {
  return DavClient.request(opts)
}

/** UTF-8 字符串 → base64（先把中文编成字节，不能直接 btoa） */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/** base64 → UTF-8 字符串 */
export function base64ToText(b64: string): string {
  if (!b64) return ''
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** base64 → Blob */
export function base64ToBlobNative(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
