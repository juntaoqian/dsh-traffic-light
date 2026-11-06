/**
 * Host half of the traffic-light bundle.
 *
 * The UI and the status logic live in the browser half (`client.js`). This half
 * exists for one reason: the renderer cannot reach the public status board
 * directly (it runs on the `dsh-app://` scheme, whose origin the board's CORS
 * never answers), while the Host process can. It mounts a narrow loopback proxy
 * on the DSH web server so the client can write to the board through the origin
 * it was loaded from.
 *
 * Deliberately **no `inject` declaration**: a loader row that is still waiting
 * for a service when the client graph is composed contributes no client entry,
 * which makes the whole UI (lamp + settings page) disappear. The web server is
 * therefore resolved lazily and the proxy is mounted as soon as it exists.
 *
 * No files are written, no other Host capability is used.
 */

import { PROXY_PATH, createBoardProxy } from './proxy.js'

/** Stable cordis plugin name. */
export const name = 'traffic-light'

/**
 * Mount the board proxy once the web server exists.
 *
 * @param {any} ctx cordis host context.
 * @returns {void}
 */
export function apply(ctx) {
  const warn = (message) => {
    try {
      ctx?.logger?.warn?.(message)
    } catch {
      // Logging is best effort.
    }
  }
  const info = (message) => {
    try {
      ctx?.logger?.info?.(message)
    } catch {
      // Logging is best effort.
    }
  }

  /** Resolve the web server service whether or not it was injected. */
  const webServer = () => {
    try {
      if (typeof ctx?.get === 'function') return ctx.get('webServer')
    } catch {
      // Fall through to the property form.
    }
    return ctx?.webServer
  }

  const handler = createBoardProxy()
  let mounted = false

  const mount = () => {
    if (mounted) return true
    const server = webServer()
    if (server === undefined || server === null || typeof server.register !== 'function') {
      return false
    }
    try {
      server.register({
        kind: 'prefix',
        path: PROXY_PATH,
        handler: (request, response) => {
          void handler(request, response)
        },
      })
      mounted = true
      info(`traffic-light: 看板代理已挂载 ${PROXY_PATH}（仅本机）`)
      return true
    } catch (error) {
      warn(
        `traffic-light: 看板代理挂载失败：${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  }

  if (mount()) return

  // The web server may still be starting; retry briefly instead of injecting the
  // service, then give up quietly so this plugin never blocks the page.
  let attempts = 0
  const timer = setInterval(() => {
    attempts += 1
    if (mount() || attempts >= 120) clearInterval(timer)
  }, 250)

  const stop = () => clearInterval(timer)
  if (typeof ctx?.effect === 'function') ctx.effect(() => stop, 'traffic-light: proxy retry')
}
