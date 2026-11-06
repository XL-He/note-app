/**
 * WebDAV 请求代理的执行体。
 *
 * 坚果云 WebDAV 不返回 CORS 头，渲染进程直接 fetch 会被浏览器拦掉，
 * 所以由主进程用 Node 原生 fetch 转发。这里只做「发请求 + 打包响应」，
 * 不做业务判断，方便单测直接调用。
 *
 * 入参：{ method, url, headers, body?, responseType? }
 *   body 为字符串时直接当请求体；为 { base64 } 时解码成二进制。
 * 出参：{ ok, status, statusText, headers, bodyText? | bodyBase64?, error? }
 */
async function davProxy(opts) {
  const { method = 'GET', url, headers = {}, body, responseType = 'text' } = opts || {}
  if (!url || typeof url !== 'string') {
    return { ok: false, status: 0, error: '缺少 url' }
  }

  try {
    let reqBody
    if (body != null) {
      if (typeof body === 'string') {
        reqBody = body
      } else if (typeof body === 'object' && typeof body.base64 === 'string') {
        reqBody = Buffer.from(body.base64, 'base64')
      }
    }

    const res = await fetch(url, { method, headers, body: reqBody, redirect: 'follow' })

    const outHeaders = {}
    res.headers.forEach((v, k) => {
      outHeaders[k] = v
    })

    const payload = {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
    }

    if (responseType === 'base64') {
      payload.bodyBase64 = Buffer.from(await res.arrayBuffer()).toString('base64')
    } else {
      payload.bodyText = await res.text()
    }
    return payload
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err && err.message ? err.message : String(err),
    }
  }
}

module.exports = { davProxy }
