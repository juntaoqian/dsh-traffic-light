/**
 * dsh-traffic-light — Host half: a loopback proxy for the public board.
 *
 * Why this exists: the renderer sometimes cannot reach
 * `traffic-light-control-*.app.workbuddy.host` at all — a `connect-src` CSP,
 * a non-`http(s)` document origin (which the board's CORS never answers) or a
 * renderer-level network policy all surface as an opaque `TypeError: Failed to
 * fetch`. The Host process has plain outbound network access, so the client
 * posts `{ url, headers }` to this same-origin route and Node performs the
 * real request.
 *
 * The proxy is deliberately narrow: loopback callers only, `https` targets under
 * `app.workbuddy.host` only, and only the two board headers are forwarded. It
 * cannot be used as a general relay. A second, read-only route (`/info`) reports
 * this machine's name so the client can label its channel by default.
 *
 * @module proxy
 */

import { hostname } from 'node:os'

/** Route registered on the DSH web server. */
export const PROXY_PATH = '/dsh-traffic-light/api/board'

/** Largest accepted JSON request body. */
const MAX_BODY_BYTES = 32 * 1024

/** Only the board deployment (and its per-channel subdomains) may be reached. */
const ALLOWED_HOST = /(^|\.)app\.workbuddy\.host$/i

/** Headers the client may forward; everything else is dropped. */
const FORWARD_HEADERS = ['x-control-key', 'x-control-code']

/** Upstream request timeout. */
const DEFAULT_TIMEOUT_MS = 15000

/**
 * @param {string|undefined} address socket remote address.
 * @returns {boolean} whether the caller is on this machine.
 */
function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Send one JSON response.
 * @param {import('node:http').ServerResponse} response response.
 * @param {number} status HTTP status.
 * @param {unknown} body JSON body.
 */
function sendJson(response, status, body) {
  if (response.writableEnded) return
  let text
  try {
    text = JSON.stringify(body)
  } catch {
    text = JSON.stringify({ ok: false, error: '响应无法序列化', status: 0 })
    status = 500
  }
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(text)
}

/**
 * Read a small JSON body.
 * @param {import('node:http').IncomingMessage} request request.
 * @returns {Promise<Record<string, unknown>>} parsed body.
 */
function readJson(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    request.on('error', reject)
  })
}

/**
 * Case-insensitive header lookup restricted to the forwarded allowlist.
 * @param {unknown} supplied headers from the request body.
 * @returns {Record<string, string>} headers to send upstream.
 */
function forwardHeaders(supplied) {
  /** @type {Record<string, string>} */
  const headers = {}
  if (supplied === null || typeof supplied !== 'object') return headers
  for (const [name, value] of Object.entries(/** @type {Record<string, unknown>} */ (supplied))) {
    const key = name.toLowerCase()
    if (!FORWARD_HEADERS.includes(key)) continue
    if (typeof value !== 'string' || value === '') continue
    headers[key] = value
  }
  return headers
}

/**
 * Build the request handler mounted on the DSH web server.
 * @param {{timeoutMs?: number}} [options] options.
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<void>} handler.
 */
export function createBoardProxy(options = {}) {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS

  return async function handleBoardProxy(request, response) {
    const url = new URL(request.url ?? '/', 'http://traffic-light.invalid')
    const suffix = url.pathname.startsWith(PROXY_PATH) ? url.pathname.slice(PROXY_PATH.length) : url.pathname

    if (!isLoopback(request.socket?.remoteAddress)) {
      sendJson(response, 403, { ok: false, error: '只允许本机访问', status: 0 })
      return
    }

    // `/info` publishes this machine's name so the client can label its board
    // channel without asking the user to invent one.
    if (suffix === '/info') {
      if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
        response.setHeader('allow', 'GET')
        sendJson(response, 405, { ok: false, error: '只支持 GET', status: 0 })
        return
      }
      sendJson(response, 200, { ok: true, hostname: hostname(), platform: process.platform })
      return
    }

    if (suffix !== '/report') {
      sendJson(response, 404, { ok: false, error: '接口不存在', status: 0 })
      return
    }
    if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
      response.setHeader('allow', 'POST')
      sendJson(response, 405, { ok: false, error: '只支持 POST', status: 0 })
      return
    }

    let payload
    try {
      payload = await readJson(request)
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: 0,
      })
      return
    }

    let target
    try {
      target = new URL(typeof payload.url === 'string' ? payload.url : '')
    } catch {
      sendJson(response, 400, { ok: false, error: '目标地址无效', status: 0 })
      return
    }
    if (target.protocol !== 'https:' || !ALLOWED_HOST.test(target.hostname)) {
      sendJson(response, 400, { ok: false, error: '只允许访问看板域名', status: 0 })
      return
    }

    try {
      const upstream = await fetch(target, {
        method: 'POST',
        headers: forwardHeaders(payload.headers),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const text = await upstream.text()
      /** @type {unknown} */
      let data = null
      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text.slice(0, 500) }
      }
      // A 4xx from the board is a real answer, not a transport failure: pass it
      // through with its status so the client can map 401/403/404/429.
      sendJson(response, 200, { ok: true, status: upstream.status, data })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      sendJson(response, 200, {
        ok: false,
        error: /timed out|aborted/i.test(detail) ? '看板响应超时' : `连接看板失败：${detail}`,
        status: 0,
      })
    }
  }
}
