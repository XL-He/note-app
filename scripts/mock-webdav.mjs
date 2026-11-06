/**
 * 极简 WebDAV 服务器，只用于本地验证同步逻辑。
 * 响应的 href 故意用「绝对路径」形态，和坚果云真实返回一致，
 * 这样能真正测到 hrefToRelative 的解析。
 *
 * 单独运行：node scripts/mock-webdav.mjs [port]
 * 被测试脚本通过 startServer(port) 复用。
 */
import http from 'node:http'

export const DAV_USER = 'test@example.com'
export const DAV_PASS = 'app-password'
export const DAV_PREFIX = '/dav'

const EXPECTED_AUTH = 'Basic ' + Buffer.from(`${DAV_USER}:${DAV_PASS}`).toString('base64')

function normalize(p) {
  let s = '/' + p.replace(/\/{2,}/g, '/').replace(/^\/+/, '')
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
  return s
}

function parentOf(p) {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function startServer(port = 0) {
  /** path -> { data: Buffer, mtime: Date } */
  const files = new Map()
  /** 目录集合，/dav 预置 */
  const dirs = new Set([DAV_PREFIX])

  const server = http.createServer((req, res) => {
    if ((req.headers.authorization || '') !== EXPECTED_AUTH) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dav"' })
      res.end('unauthorized')
      return
    }

    const url = new URL(req.url, 'http://127.0.0.1')
    let rawPath
    try {
      rawPath = decodeURIComponent(url.pathname)
    } catch {
      rawPath = url.pathname
    }
    const p = normalize(rawPath)

    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)

      /* 请求体可能是空的，PROPFIND 才需要 */
      if (req.method === 'MKCOL') {
        if (dirs.has(p) || files.has(p)) {
          res.writeHead(405)
          res.end()
          return
        }
        if (!dirs.has(parentOf(p))) {
          res.writeHead(409)
          res.end()
          return
        }
        dirs.add(p)
        res.writeHead(201)
        res.end()
        return
      }

      if (req.method === 'PUT') {
        if (!dirs.has(parentOf(p))) {
          res.writeHead(409)
          res.end()
          return
        }
        const existed = files.has(p)
        files.set(p, { data: body, mtime: new Date() })
        res.writeHead(existed ? 204 : 201)
        res.end()
        return
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        const f = files.get(p)
        if (!f) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': f.data.length,
        })
        res.end(req.method === 'HEAD' ? undefined : f.data)
        return
      }

      if (req.method === 'DELETE') {
        if (files.delete(p) || dirs.delete(p)) {
          res.writeHead(204)
          res.end()
          return
        }
        res.writeHead(404)
        res.end()
        return
      }

      if (req.method === 'PROPFIND') {
        if (!dirs.has(p) && !files.has(p)) {
          res.writeHead(404)
          res.end()
          return
        }
        const depth = String(req.headers.depth ?? '0')
        const items = [{ path: p, isDir: dirs.has(p), file: files.get(p) }]

        if (depth !== '0') {
          const prefix = p === '/' ? '/' : p + '/'
          for (const [fp, f] of files) {
            if (fp.startsWith(prefix) && !fp.slice(prefix.length).includes('/')) {
              items.push({ path: fp, isDir: false, file: f })
            }
          }
          for (const d of dirs) {
            if (d !== p && d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) {
              items.push({ path: d, isDir: true, file: undefined })
            }
          }
        }

        /* 关键：href 用绝对路径，与坚果云一致 */
        const parts = items.map((it) => {
          const href = encodeURI(it.path) + (it.isDir && !it.path.endsWith('/') ? '/' : '')
          const props = [
            it.isDir
              ? '<d:resourcetype><d:collection/></d:resourcetype>'
              : '<d:resourcetype/>',
            it.file ? `<d:getlastmodified>${it.file.mtime.toUTCString()}</d:getlastmodified>` : '',
            it.file ? `<d:getcontentlength>${it.file.data.length}</d:getcontentlength>` : '',
          ]
            .filter(Boolean)
            .join('\n        ')
          return `  <d:response>
    <d:href>${xmlEscape(href)}</d:href>
    <d:propstat>
      <d:prop>
        ${props}
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`
        })

        const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
${parts.join('\n')}
</d:multistatus>`
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
        res.end(xml)
        return
      }

      res.writeHead(405)
      res.end()
    })
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port
      resolve({
        port: actual,
        endpoint: `http://127.0.0.1:${actual}${DAV_PREFIX}/`,
        close: () => new Promise((r) => server.close(r)),
        /** 测试断言用：直接看服务器上有什么文件 */
        listFiles: () => [...files.keys()].sort(),
        readFile: (p) => files.get(p)?.data.toString('utf8') ?? null,
        reset: () => {
          files.clear()
          dirs.clear()
          dirs.add(DAV_PREFIX)
        },
      })
    })
  })
}

/* 直接执行时起一个常驻服务，方便手工用 curl 试 */
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.argv[2] || 8899)
  const s = await startServer(port)
  console.log(`mock WebDAV: ${s.endpoint}`)
  console.log(`  账号 ${DAV_USER} / 密码 ${DAV_PASS}`)
}
