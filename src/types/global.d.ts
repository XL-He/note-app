export {}

interface DavProxyResponse {
  ok: boolean
  status: number
  statusText?: string
  headers?: Record<string, string>
  bodyText?: string
  bodyBase64?: string
  error?: string
}

interface DavProxyRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string | { base64: string }
  responseType?: 'text' | 'base64'
}

declare global {
  interface Window {
    desktop?: {
      isDesktop: boolean
      platform: string
      version: string
      onQuickNew: (cb: () => void) => () => void
      setNextReminder: (text: string) => void
      hide: () => Promise<void>
      quit: () => Promise<void>
      davRequest: (opts: DavProxyRequest) => Promise<DavProxyResponse>
    }
  }
}
