/**
 * Browser half of the traffic-light bundle.
 *
 * Three seats:
 *  - `sidebar.footer.action` (bottom-left of the window, beside Settings) draws
 *    the red/amber/green lamp summarizing every session's state.
 *  - `settings.section` renders one Settings page that edits the persisted
 *    options; the footer control subscribes to the same store, so a change is
 *    live without a reload.
 *  - `shell.overlay` holds two headless components: the beeper and the board
 *    reporter, both of which must keep working while the foot is hidden.
 *
 * Session state comes only from the standard slot hooks the host passes in
 * (`useSessionStatus` / `useSessions`); the plugin never subscribes to session
 * events itself. Colors come from `--dsw-alias-*` theme tokens, so the control
 * follows light/dark themes.
 *
 * The same verdict is optionally pushed to a public status board: the browser
 * asks this plugin's Host half (same-origin route) to perform the write, so a
 * `connect-src` CSP or a `dsh-app://` document origin cannot block it.
 *
 * Plain JavaScript for the lazy factory form: `window.__ModuleLoader__.load`
 * registers the factory, and the module body runs at materialization.
 */

/**
 * Register the bundle factory at most once per document.
 *
 * DSH inlines `immediately` bundles into the boot payload and can execute the
 * same file again later (an HMR revision replay, or a batch vs. one-resource
 * URL overlap). `client-modules` rejects the second `load()` for one id with
 * "duplicate factory registration", and that throw takes the whole plugin row
 * down — the lamp and the settings page simply disappear.
 *
 * A `try`/`catch` is not enough: when `__ModuleLoader__` is not ready yet,
 * `load()` only queues the registration and the loader replays the queue
 * itself, where the duplicate throws outside this file. So the second
 * execution must not call `load()` at all. The cost is that a hot reload of
 * this bundle is ignored until the page is reloaded, which is fine: DSH's own
 * loader states that a bundle must not execute twice without an invalidate.
 *
 * @param {{id: string, factory: Function}} definition bundle definition.
 * @returns {void}
 */
function registerModule(definition) {
  const REGISTERED_FLAG = '__dshTrafficLightModuleRegistered'

  if (window[REGISTERED_FLAG] === true) return
  window[REGISTERED_FLAG] = true
  try {
    window.__ModuleLoader__.load(definition)
  } catch (error) {
    // Already registered by the earlier execution: nothing to do.
  }
}

registerModule({
  id: '@local/dsh-traffic-light',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'trafficLight'
    /** Plugin id, used for the injected stylesheet tag. */
    const PLUGIN_ID = '@local/dsh-traffic-light'
    /** Where the options live in this browser profile. */
    const STORAGE_KEY = 'dsh.traffic-light.options.v1'
    /** Where the board credentials live (device secret included, options excluded). */
    const REMOTE_KEY = 'dsh.traffic-light.board.v1'

    /** Public AI status board this plugin reports to; see the integration doc. */
    const BOARD_BASE = 'https://traffic-light-control-97708.app.workbuddy.host'
    const BOARD_SHARECODE = '3R6XRRCJN6'
    const BOARD_KEY = ''

    /** Board endpoints. */
    const API_REGISTER = '/api/device/register'
    const API_RECOVER = '/api/device/recover'
    const API_CLAIM = '/api/claim'
    const API_SET = '/api/set'
    const API_ALIAS = '/api/alias'

    /** Same-origin route the Host half mounts to perform the real request. */
    const BOARD_PROXY = '/dsh-traffic-light/api/board/report'
    /** Same-origin route that reports this machine's name, used as the default label. */
    const BOARD_INFO = '/dsh-traffic-light/api/board/info'

    /** Selectable alert timbres; the first one is the fallback. */
    const SOUND_KEYS = ['classic', 'chime', 'ping', 'alert', 'deep', 'rise']

    const DEFAULT_OPTIONS = Object.freeze({
      enabled: true,
      beep: true,
      beepIdle: true,
      sound: 'classic',
      volume: 0.6,
      durationMs: 160,
      beeps: 1,
      greenMode: 'any',
      showLabel: true,
      showCount: true,
      boardEnabled: false,
      boardBase: BOARD_BASE,
      boardSharecode: BOARD_SHARECODE,
      boardKey: BOARD_KEY,
      boardName: '',
      boardText: true,
    })

    // ---------------------------------------------------------------------
    // Options store (localStorage-backed, shared by both seats in this page)
    // ---------------------------------------------------------------------

    let cachedOptions = null
    const optionListeners = new Set()

    function clampNumber(value, min, max, fallback) {
      const parsed = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(parsed)) return fallback
      return Math.min(max, Math.max(min, parsed))
    }

    /** Trimmed, length-capped string option; an empty value falls back. */
    function textOption(value, fallback, maxLength) {
      if (typeof value !== 'string') return fallback
      const trimmed = value.trim()
      if (trimmed === '') return fallback
      return trimmed.slice(0, maxLength)
    }

    /** Trimmed, length-capped string option where empty is a meaningful value. */
    function optionalText(value, maxLength) {
      if (typeof value !== 'string') return ''
      return value.trim().slice(0, maxLength)
    }

    function normalizeOptions(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        enabled: source.enabled !== false,
        beep: source.beep !== false,
        beepIdle: source.beepIdle !== false,
        sound: SOUND_KEYS.includes(source.sound) ? source.sound : DEFAULT_OPTIONS.sound,
        volume: clampNumber(source.volume, 0, 1, DEFAULT_OPTIONS.volume),
        durationMs: Math.round(
          clampNumber(source.durationMs, 40, 1200, DEFAULT_OPTIONS.durationMs),
        ),
        beeps: Math.round(clampNumber(source.beeps, 1, 5, DEFAULT_OPTIONS.beeps)),
        greenMode: source.greenMode === 'all' ? 'all' : 'any',
        showLabel: source.showLabel !== false,
        showCount: source.showCount !== false,
        boardEnabled: source.boardEnabled === true,
        boardBase: textOption(source.boardBase, DEFAULT_OPTIONS.boardBase, 300),
        boardSharecode: textOption(source.boardSharecode, DEFAULT_OPTIONS.boardSharecode, 64),
        boardKey: textOption(source.boardKey, DEFAULT_OPTIONS.boardKey, 128),
        boardName: optionalText(source.boardName, 24),
        boardText: source.boardText !== false,
      }
    }

    function readOptions() {
      if (cachedOptions !== null) return cachedOptions
      let raw = null
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY)
        if (stored) raw = JSON.parse(stored)
      } catch (error) {
        // A private-mode or corrupted value must not blank the control.
        raw = null
      }
      cachedOptions = normalizeOptions(raw)
      return cachedOptions
    }

    function notifyOptions() {
      for (const listener of [...optionListeners]) {
        try {
          listener()
        } catch (error) {
          // One bad subscriber must not stop the others.
        }
      }
    }

    function writeOptions(patch) {
      const previous = readOptions()
      const next = normalizeOptions({ ...previous, ...patch })
      let changed = false
      for (const key of Object.keys(next)) {
        if (next[key] !== previous[key]) changed = true
      }
      if (!changed) return
      cachedOptions = next
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch (error) {
        // Persisting is best effort; the in-memory value still applies.
      }
      notifyOptions()
    }

    function subscribeOptions(listener) {
      optionListeners.add(listener)
      return () => {
        optionListeners.delete(listener)
      }
    }

    function useOptions() {
      return React.useSyncExternalStore(subscribeOptions, readOptions, readOptions)
    }

    // ---------------------------------------------------------------------
    // Beep: a short Web Audio tone, so no extra process or permission is used
    // ---------------------------------------------------------------------

    let audioContext = null

    function getAudioContext() {
      if (audioContext !== null) return audioContext
      try {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext
        if (typeof AudioContextCtor !== 'function') return null
        audioContext = new AudioContextCtor()
      } catch (error) {
        audioContext = null
      }
      return audioContext
    }

    /** Chromium starts a context suspended until a user gesture; unlock it. */
    function resumeAudio() {
      const context = getAudioContext()
      if (context === null || context.state !== 'suspended') return
      try {
        const resumed = context.resume()
        if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {})
      } catch (error) {
        // Autoplay policy refused; the next gesture tries again.
      }
    }

    /** Schedule one oscillator note with a short attack and an exponential decay. */
    function playTone(context, at, frequency, length, type, level) {
      let oscillator
      let gain
      try {
        oscillator = context.createOscillator()
        gain = context.createGain()
      } catch (error) {
        return
      }
      oscillator.type = type
      oscillator.frequency.setValueAtTime(frequency, at)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.onended = () => {
        try {
          oscillator.disconnect()
          gain.disconnect()
        } catch (error) {
          // Already torn down.
        }
      }
      oscillator.start(at)
      oscillator.stop(at + length + 0.03)
    }

    /**
     * Alert timbres. Each preset schedules its notes relative to `start` and
     * scales them to the configured length, so one duration setting means the
     * same thing for every sound.
     *
     * `play(at, frequency, length, type, factor)` is the shared note scheduler;
     * `factor` is a weight on the configured volume (sub-harmonics and grace
     * notes sit below 1).
     */
    const SOUND_PRESETS = {
      classic(start, length, play) {
        play(start, 880, length, 'sine', 1)
      },
      chime(start, length, play) {
        play(start, 1318.5, length * 0.55, 'sine', 1)
        play(start + length * 0.28, 1760, length * 0.72, 'sine', 0.55)
      },
      ping(start, length, play) {
        play(start, 1046.5, length * 0.5, 'triangle', 1)
        play(start + length * 0.1, 2093, length * 0.28, 'sine', 0.3)
      },
      alert(start, length, play) {
        play(start, 980, length * 0.42, 'triangle', 1)
        play(start + length * 0.5, 735, length * 0.42, 'triangle', 0.85)
      },
      deep(start, length, play) {
        play(start, 440, length, 'sine', 1)
        play(start, 220, length * 1.1, 'sine', 0.5)
      },
      rise(start, length, play) {
        const step = length * 0.26
        play(start, 523.25, length * 0.5, 'sine', 0.85)
        play(start + step, 659.25, length * 0.5, 'sine', 0.8)
        play(start + step * 2, 783.99, length * 0.55, 'sine', 0.75)
      },
    }

    /**
     * Play the configured alert. `beeps` repeats the whole pattern with a short
     * gap; a volume of 0 is silent.
     */
    function playBeep(options) {
      const volume = clampNumber(options.volume, 0, 1, DEFAULT_OPTIONS.volume)
      if (volume <= 0) return
      const context = getAudioContext()
      if (context === null) return
      resumeAudio()
      const length = clampNumber(options.durationMs, 40, 1200, DEFAULT_OPTIONS.durationMs) / 1000
      const count = Math.round(clampNumber(options.beeps, 1, 5, DEFAULT_OPTIONS.beeps))
      const preset = SOUND_PRESETS[options.sound] || SOUND_PRESETS.classic
      const base = volume * 0.35
      const play = (at, frequency, noteLength, type, factor) =>
        playTone(context, at, frequency, noteLength, type, base * (factor === undefined ? 1 : factor))
      const start = context.currentTime + 0.03
      for (let index = 0; index < count; index += 1) {
        preset(start + index * (length + 0.09), length, play)
      }
    }

    // ---------------------------------------------------------------------
    // Board sync: push the same red/amber/green verdict to the public board
    //
    // The board API needs two proofs per write: the shared control key (an
    // operator password) and a per-device control code (`code`). Neither is
    // known up front, so the first write registers a device, keeps the secret
    // it returns, claims a channel for that code, and stores all four values
    // in `localStorage`. Every later write reuses them; a lost code can be
    // recovered from `deviceId + secret` without resetting the device.
    // ---------------------------------------------------------------------

    function loadBoardInfo() {
      let raw = null
      try {
        const stored = window.localStorage.getItem(REMOTE_KEY)
        if (stored) raw = JSON.parse(stored)
      } catch (error) {
        raw = null
      }
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const channel = typeof source.channel === 'string' ? source.channel : ''
      return {
        deviceId: typeof source.deviceId === 'string' ? source.deviceId : '',
        secret: typeof source.secret === 'string' ? source.secret : '',
        code: typeof source.code === 'string' ? source.code : '',
        channel,
        /** Alias the channel currently carries on the board. */
        alias: typeof source.alias === 'string' ? source.alias : '',
        /** This machine's name, reported by the Host half; the default label. */
        hostLabel: typeof source.hostLabel === 'string' ? source.hostLabel : '',
        status: channel === '' ? 'idle' : 'ready',
        message: '',
        at: 0,
      }
    }

    function persistBoardInfo(info) {
      try {
        window.localStorage.setItem(
          REMOTE_KEY,
          JSON.stringify({
            deviceId: info.deviceId,
            secret: info.secret,
            code: info.code,
            channel: info.channel,
            alias: info.alias,
            hostLabel: info.hostLabel,
          }),
        )
      } catch (error) {
        // A private-mode profile cannot persist; the session still reports.
      }
    }

    let boardInfo = loadBoardInfo()
    const boardListeners = new Set()

    function setBoardInfo(patch) {
      boardInfo = { ...boardInfo, ...patch, at: Date.now() }
      persistBoardInfo(boardInfo)
      for (const listener of [...boardListeners]) {
        try {
          listener()
        } catch (error) {
          // One bad subscriber must not stop the others.
        }
      }
    }

    function subscribeBoard(listener) {
      boardListeners.add(listener)
      return () => {
        boardListeners.delete(listener)
      }
    }

    function readBoardInfo() {
      return boardInfo
    }

    function useBoardInfo() {
      return React.useSyncExternalStore(subscribeBoard, readBoardInfo, readBoardInfo)
    }

    /** `dsh-` plus 12 hex chars: ≥6 chars, lowercase a-z/0-9, stable per browser. */
    function newDeviceId() {
      const bytes = new Uint8Array(6)
      const cryptoApi = window.crypto
      if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        cryptoApi.getRandomValues(bytes)
      } else {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = Math.floor(Math.random() * 256)
        }
      }
      let hex = ''
      for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
      return `dsh-${hex}`
    }

    function readBoardName(options) {
      const explicit = typeof options.boardName === 'string' ? options.boardName.trim() : ''
      const name = explicit !== '' ? explicit : boardInfo.hostLabel
      return (name === '' ? 'DSH' : name).slice(0, 24)
    }

    /** Ask the Host half for this machine's name; it becomes the default label. */
    async function loadHostLabel() {
      if (boardInfo.hostLabel !== '') return
      try {
        const response = await fetch(BOARD_INFO, { method: 'GET' })
        if (!response.ok) return
        const data = await response.json()
        const name =
          data !== null && typeof data === 'object' && typeof data.hostname === 'string'
            ? data.hostname.trim().slice(0, 24)
            : ''
        if (name === '' || name === boardInfo.hostLabel) return
        setBoardInfo({ hostLabel: name })
      } catch (error) {
        // The Host route is optional: the literal default label still works.
      }
    }

    /** Build one API URL; `sharecode` rides on every request and is never omitted. */
    function boardUrl(options, path, query) {
      const base = String(options.boardBase || '').replace(/\/+$/, '')
      const url = new URL(base + path)
      url.searchParams.set('sharecode', options.boardSharecode)
      const params = query === undefined ? {} : query
      for (const name of Object.keys(params)) {
        const value = params[name]
        if (value === undefined || value === null || value === '') continue
        url.searchParams.set(name, String(value))
      }
      return url.toString()
    }

    /** Parse one board reply, turning a non-2xx or `{ok:false}` into an Error. */
    async function boardResponse(response) {
      let data = null
      try {
        data = await response.json()
      } catch (error) {
        data = null
      }
      if (!response.ok || (data !== null && data.ok === false)) {
        const detail =
          data !== null && typeof data === 'object' && (data.error || data.message)
            ? String(data.error || data.message)
            : `HTTP ${response.status}`
        const failure = new Error(detail)
        failure.status = response.status
        throw failure
      }
      return data !== null && typeof data === 'object' ? data : {}
    }

    /** Why the last Host-proxy attempt gave up, for the error line in Settings. */
    let lastProxyFailure = ''

    /**
     * Perform the write through this plugin's Host half.
     *
     * The Host process reaches the board even when the renderer cannot (CSP
     * `connect-src`, a `file:`/custom document origin the board's CORS never
     * answers, or a renderer network policy). Returns `null` when the route is
     * not mounted, so the caller falls back to a direct `fetch`.
     */
    async function boardRequestViaHost(url, init) {
      let response
      try {
        response = await fetch(BOARD_PROXY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            method: (init && init.method) || 'POST',
            headers: (init && init.headers) || {},
          }),
        })
      } catch (error) {
        lastProxyFailure = error && error.message ? String(error.message) : '无法访问代理路由'
        return null
      }
      if (!response.ok) {
        lastProxyFailure = `代理路由 HTTP ${response.status}`
        return null
      }
      let envelope = null
      try {
        envelope = await response.json()
      } catch (error) {
        lastProxyFailure = '代理返回的不是 JSON'
        return null
      }
      if (envelope === null || typeof envelope !== 'object') {
        lastProxyFailure = '代理返回格式异常'
        return null
      }
      if (envelope.ok !== true) {
        const failure = new Error(
          typeof envelope.error === 'string' ? envelope.error : '看板代理请求失败',
        )
        failure.status = typeof envelope.status === 'number' ? envelope.status : 0
        throw failure
      }
      lastProxyFailure = ''
      const status = typeof envelope.status === 'number' ? envelope.status : 0
      const data = envelope.data
      if (
        status >= 200 &&
        status < 300 &&
        !(data !== null && typeof data === 'object' && data.ok === false)
      ) {
        return data !== null && typeof data === 'object' ? data : {}
      }
      const detail =
        data !== null && typeof data === 'object' && (data.error || data.message)
          ? String(data.error || data.message)
          : `HTTP ${status}`
      const failure = new Error(detail)
      failure.status = status
      throw failure
    }

    /** One board call: Host proxy first, browser `fetch` as the fallback. */
    async function boardRequest(url, init) {
      const proxied = await boardRequestViaHost(url, init)
      if (proxied !== null) return proxied
      return boardResponse(await fetch(url, init))
    }

    function describeBoardFailure(error) {
      const status = error && typeof error.status === 'number' ? error.status : 0
      const detail = error && error.message ? String(error.message) : ''
      const proxyHint = lastProxyFailure === '' ? '' : `；代理失败：${lastProxyFailure}`
      if (status === 0) {
        // `fetch` reports CORS and offline with the same opaque TypeError.
        return detail === '' || /failed to fetch|networkerror|load failed/i.test(detail)
          ? `网络不可达，或被浏览器跨域策略拦截${proxyHint}`
          : `${detail}${proxyHint}`
      }
      return `${detail === '' ? '请求失败' : detail}（HTTP ${status}）${proxyHint}`
    }

    let claimPromise = null

    /** Register (once), recover the code if needed, then claim a channel. */
    async function claimBoard(options) {
      if (boardInfo.channel !== '' && boardInfo.code !== '') return
      if (claimPromise !== null) return claimPromise
      setBoardInfo({ status: 'connecting', message: '' })
      claimPromise = (async () => {
        const deviceId = boardInfo.deviceId === '' ? newDeviceId() : boardInfo.deviceId
        const name = readBoardName(options)
        let secret = boardInfo.secret
        let code = boardInfo.code
        let channel = ''
        let alias = ''

        if (code === '' || secret === '') {
          const registered = await boardRequest(
            boardUrl(options, API_REGISTER, { deviceId, name }),
            { method: 'POST' },
          )
          if (typeof registered.code === 'string' && registered.code !== '') {
            code = registered.code
            secret = typeof registered.secret === 'string' ? registered.secret : ''
            channel = typeof registered.channel === 'string' ? registered.channel : ''
          } else if (registered.exists === true || registered.created === false) {
            if (secret === '') {
              throw new Error('该设备 ID 已被注册且本机没有 secret，换一个设备名后重试')
            }
            const recovered = await boardRequest(
              boardUrl(options, API_RECOVER, { deviceId, secret }),
              { method: 'POST' },
            )
            code = typeof recovered.code === 'string' ? recovered.code : ''
            channel = typeof recovered.channel === 'string' ? recovered.channel : ''
            alias = typeof recovered.alias === 'string' ? recovered.alias : ''
          }
          if (code === '') throw new Error('注册设备没有返回控制码')
        }

        if (channel === '') {
          const claimed = await boardRequest(
            boardUrl(options, API_CLAIM, { code, alias: name }),
            { method: 'POST' },
          )
          channel = typeof claimed.channel === 'string' ? claimed.channel : ''
          alias = typeof claimed.alias === 'string' ? claimed.alias : ''
        }
        if (channel === '') throw new Error('认领通道没有返回通道 ID')

        setBoardInfo({ deviceId, code, secret, channel, alias, status: 'ready', message: '' })
      })()
      try {
        await claimPromise
      } catch (error) {
        setBoardInfo({ status: 'error', message: describeBoardFailure(error) })
        throw error
      } finally {
        claimPromise = null
      }
    }

    /**
     * Keep the channel alias in step with the configured device name.
     *
     * The alias is fixed when the channel is claimed, so renaming the machine
     * (or leaving the name empty so the hostname applies) would otherwise leave
     * the old label on the board forever. A refused rename — duplicate alias,
     * quota, wrong key — must never block the status write.
     *
     * @param {any} options current options.
     * @returns {Promise<void>} resolves either way.
     */
    async function syncAlias(options) {
      if (boardInfo.channel === '' || boardInfo.code === '') return
      const alias = readBoardName(options)
      if (alias === boardInfo.alias) return
      try {
        await boardRequest(
          boardUrl(options, API_ALIAS, { channel: boardInfo.channel, alias }),
          {
            method: 'POST',
            headers: {
              'X-Control-Key': options.boardKey,
              'X-Control-Code': boardInfo.code,
            },
          },
        )
        setBoardInfo({ alias })
      } catch (error) {
        // Ignored on purpose: the lamp colour matters more than the label.
      }
    }

    /** The board is a Chinese-only product, so its captions are built here. */
    const BOARD_KINDS = Object.freeze({
      approval: '审批',
      question: '回答',
      plan: '确认计划',
      other: '操作',
    })

    /** `刚刚` / `已等 3 分钟` / `已等 1 小时 5 分钟`, for the public caption. */
    function formatWaitZh(ms) {
      const minutes = Math.floor(ms / 60000)
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `已等 ${minutes} 分钟`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0 ? `已等 ${hours} 小时` : `已等 ${hours} 小时 ${rest} 分钟`
    }

    /** `审批 / 回答` style list of the waiting kinds. */
    function boardKindText(kinds) {
      if (kinds === undefined || kinds.size === 0) return ''
      return ['approval', 'question', 'plan', 'other']
        .filter((kind) => kinds.has(kind))
        .map((kind) => BOARD_KINDS[kind])
        .join(' / ')
    }

    /**
     * Map the local verdict onto the board's semantic vocabulary.
     * `action` is "waiting for a human" (red, beeping, blinking) and `ok` is
     * "running", which is exactly what the sidebar lamps mean here.
     *
     * The caption never carries session titles or paths: the board is public.
     * Saying *why* it waits (approval / question / plan review) and for how long
     * is what a remote reader actually needs.
     */
    function boardState(options, summary) {
      const name = readBoardName(options)
      if (summary.state === 'red') {
        const kind = boardKindText(summary.kinds)
        const waited = redSince === 0 ? '' : `（${formatWaitZh(Date.now() - redSince)}）`
        const text =
          summary.waiting > 1
            ? `${name}：${summary.waiting} 个会话等你处理${kind === '' ? '' : `（${kind}）`}${waited}`
            : `${name}：等你${kind === '' ? BOARD_KINDS.other : kind}${waited}`
        return {
          status: 'action',
          label: `${name}：需要你操作`.slice(0, 40),
          text,
        }
      }
      if (summary.state === 'green') {
        return {
          status: 'ok',
          label: `${name}：运行中`.slice(0, 40),
          text:
            summary.running > 1
              ? `${name}：${summary.running} 个会话运行中`
              : `${name}：会话正在运行`,
        }
      }
      return {
        status: 'idle',
        label: `${name}：空闲`.slice(0, 40),
        text: `${name}：没有会话在运行`,
      }
    }

    /**
     * Write one state to the board.
     *
     * Every parameter rides in the query string: the deployed service silently
     * ignores JSON and form bodies (`applied` comes back empty and the write
     * lands on `default`), so the documented body form is unusable here. The
     * key and the code still travel as headers, keeping them out of access logs.
     */
    async function postBoardState(options, state) {
      const send = () =>
        boardRequest(
          boardUrl(options, API_SET, {
            channel: boardInfo.channel,
            status: state.status,
            label: state.label,
            duration: 0,
            text: options.boardText ? state.text : '',
          }),
          {
            method: 'POST',
            headers: {
              'X-Control-Key': options.boardKey,
              'X-Control-Code': boardInfo.code,
            },
          },
        )
      try {
        return await send()
      } catch (error) {
        if (!error || error.status !== 404) throw error
        // The channel vanished server-side: keep the secret, recover the code,
        // claim a fresh channel, and retry once.
        setBoardInfo({ channel: '', code: '', status: 'idle', message: '' })
        await claimBoard(options)
        return await send()
      }
    }

    /** Last payload actually accepted, so re-renders never re-post. */
    let lastBoardState = ''
    let reportPromise = null
    let pendingBoardReport = null

    /** Serialized writer: a state that arrives mid-flight is sent right after. */
    async function drainBoardReports() {
      try {
        while (pendingBoardReport !== null) {
          const job = pendingBoardReport
          pendingBoardReport = null
          if (job.key === lastBoardState) continue
          await claimBoard(job.options)
          await syncAlias(job.options)
          await postBoardState(job.options, job.state)
          lastBoardState = job.key
          setBoardInfo({ status: 'ready', message: '' })
        }
      } catch (error) {
        pendingBoardReport = null
        setBoardInfo({ status: 'error', message: describeBoardFailure(error) })
      } finally {
        reportPromise = null
      }
    }

    function reportBoard(options, summary) {
      if (!options.boardEnabled) return Promise.resolve()
      const state = boardState(options, summary)
      const key = JSON.stringify(state)
      if (key === lastBoardState) return Promise.resolve()
      pendingBoardReport = { options, state, key }
      if (reportPromise === null) reportPromise = drainBoardReports()
      return reportPromise
    }

    /** Drop local credentials; the next report registers a brand-new device. */
    function forgetBoard() {
      lastBoardState = ''
      setBoardInfo({
        deviceId: '',
        secret: '',
        code: '',
        channel: '',
        status: 'idle',
        message: '',
      })
    }

    function boardPageUrl(options) {
      const base = String(options.boardBase || '').replace(/\/+$/, '')
      return `${base}/?sharecode=${encodeURIComponent(options.boardSharecode)}`
    }

    // ---------------------------------------------------------------------
    // Session state folding
    // ---------------------------------------------------------------------

    /**
     * Fold the page-wide session status map into one traffic-light state.
     * Each entry is `{ running, pendingInteraction, completionUnread }`.
     *
     * Besides the verdict this keeps three things the caption uses: which kind
     * of choice is blocking (`kinds`), how many sessions finished since you last
     * looked (`completed`), and whether anything is still going (`running`).
     */
    function summarizeStatuses(statuses, greenMode) {
      let total = 0
      let running = 0
      let waiting = 0
      let completed = 0
      /** @type {Map<string, number>} */
      const kinds = new Map()
      /** Session ids that are waiting for a choice, in map order. */
      const waitingIds = []
      if (statuses && typeof statuses.forEach === 'function') {
        statuses.forEach((status, id) => {
          if (status === undefined || status === null) return
          total += 1
          if (status.running === true) running += 1
          if (status.completionUnread === true) completed += 1
          const interaction = status.pendingInteraction
          if (interaction !== undefined && interaction !== null) {
            waiting += 1
            if (typeof id === 'string') waitingIds.push(id)
            const kind = interactionKind(interaction)
            kinds.set(kind, (kinds.get(kind) || 0) + 1)
          }
        })
      }
      let state = 'yellow'
      if (waiting > 0) state = 'red'
      else if (greenMode === 'all') state = total > 0 && running === total ? 'green' : 'yellow'
      else state = running > 0 ? 'green' : 'yellow'
      return { state, total, running, waiting, completed, kinds, waitingIds }
    }

    /** The name a session shows in the sidebar: its title, else its id. */
    function sessionTitle(sessions, id) {
      if (sessions === null || sessions === undefined || sessions.byId === undefined) return ''
      const row = sessions.byId[id]
      if (row === null || row === undefined) return ''
      const title =
        typeof row.displayTitle === 'string' && row.displayTitle !== ''
          ? row.displayTitle
          : typeof row.title === 'string'
            ? row.title
            : ''
      return title.trim()
    }

    /** `等待：修登录超时、升级依赖 等 3 个` — local-only, never sent to the board. */
    function waitingTitlesText(waitingIds, sessions, t) {
      const MAX_TITLES = 2
      const titles = []
      for (const id of waitingIds) {
        const title = sessionTitle(sessions, id)
        if (title === '') continue
        titles.push(title.length > 18 ? `${title.slice(0, 18)}…` : title)
        if (titles.length >= MAX_TITLES) break
      }
      if (titles.length === 0) return ''
      const joined = titles.join('、')
      return waitingIds.length > titles.length
        ? t('tooltip.titlesMore', { titles: joined, count: waitingIds.length })
        : t('tooltip.titles', { titles: joined })
    }

    /**
     * Classify a pending interaction. DSH reports interaction objects from
     * several domains; the kind is read defensively (the property name has
     * varied) so an unknown shape still yields a usable label instead of "undefined".
     *
     * @param {unknown} interaction the pending interaction object.
     * @returns {'approval'|'question'|'plan'|'other'} label key.
     */
    function interactionKind(interaction) {
      const source =
        interaction !== null && typeof interaction === 'object'
          ? /** @type {Record<string, unknown>} */ (interaction)
          : {}
      const raw = [source.kind, source.type, source.name]
        .filter((value) => typeof value === 'string' && value !== '')
        .join(' ')
        .toLowerCase()
      if (raw === '') return 'other'
      if (/plan/.test(raw)) return 'plan'
      if (/question|ask|input|answer|choice/.test(raw)) return 'question'
      if (/approval|approve|permission|confirm|tool/.test(raw)) return 'approval'
      return 'other'
    }

    /** Short "审批 / 提问 / 计划确认" summary of the waiting kinds, most common first. */
    function kindsSummary(kinds, t) {
      if (kinds === undefined || kinds.size === 0) return ''
      const order = { approval: 0, question: 1, plan: 2, other: 3 }
      return [...kinds.keys()]
        .sort((left, right) => (order[left] ?? 9) - (order[right] ?? 9))
        .map((kind) => t(`kind.${kind}`))
        .join(' / ')
    }

    /** `3 分钟` / `1 小时 5 分钟`; empty under a minute so the caption stays short. */
    function formatDuration(ms, t) {
      if (typeof ms !== 'number' || ms < 60000) return ''
      const minutes = Math.floor(ms / 60000)
      if (minutes < 60) return t('duration.minutes', { count: minutes })
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0
        ? t('duration.hours', { count: hours })
        : t('duration.hoursMinutes', { hours, minutes: rest })
    }

    /** When the panel entered red, so the caption can show how long it has waited. */
    let redSince = 0

    function noteRedSince(state) {
      if (state === 'red') {
        if (redSince === 0) redSince = Date.now()
      } else {
        redSince = 0
      }
    }

    /** Re-render every 15 s while red so the elapsed text stays honest. */
    function useRedElapsed(state) {
      const [, bump] = React.useState(0)
      const active = state === 'red'
      React.useEffect(() => {
        if (!active) return undefined
        const timer = window.setInterval(() => bump((value) => value + 1), 15000)
        return () => window.clearInterval(timer)
      }, [active])
      if (!active || redSince === 0) return 0
      return Date.now() - redSince
    }

    const LAMP_ORDER = ['red', 'amber', 'green']
    const LAMP_STATE = { red: 'red', amber: 'yellow', green: 'green' }

    function useSummary(useSessionStatus) {
      const usable = typeof useSessionStatus === 'function'
      const options = useOptions()
      // The hook is stable for a given component instance, so this conditional
      // call never changes hook order between renders.
      const statuses = usable ? useSessionStatus((value) => value) : null
      const summary = React.useMemo(
        () => summarizeStatuses(statuses, options.greenMode),
        [statuses, options.greenMode],
      )
      return { options, summary }
    }

    function safeTranslate(t) {
      if (typeof t === 'function') return t
      return (key) => key
    }

    // ---------------------------------------------------------------------
    // Presentational pieces
    // ---------------------------------------------------------------------

    function Lamp(props) {
      const { color, lit, size } = props
      return h('span', {
        className: `dsh-traffic-light__lamp dsh-traffic-light__lamp--${color}`,
        'data-lit': lit ? 'true' : 'false',
        style: size === undefined ? undefined : { width: size, height: size },
        'aria-hidden': 'true',
      })
    }

    function LampRow(props) {
      const { state, size } = props
      return h(
        'span',
        { className: 'dsh-traffic-light__lamps' },
        LAMP_ORDER.map((color) =>
          h(Lamp, {
            key: color,
            color,
            lit: LAMP_STATE[color] === state,
            size,
          }),
        ),
      )
    }

    /** The control in the sidebar foot: three lamps, optional text and count. */
    function FooterControl(props) {
      const t = safeTranslate(props.t)
      const { options, summary } = useSummary(props.useSessionStatus)
      const elapsed = useRedElapsed(summary.state)
      const sessions =
        typeof props.useSessions === 'function' ? props.useSessions((state) => state) : null

      React.useEffect(() => {
        noteRedSince(summary.state)
      }, [summary.state])

      if (!options.enabled) return null

      const stateLabel = t(`state.${summary.state}`)
      const parts = [
        t('tooltip', {
          running: summary.running,
          waiting: summary.waiting,
          total: summary.total,
        }),
      ]
      const titles = waitingTitlesText(summary.waitingIds, sessions, t)
      if (titles !== '') parts.push(titles)
      const kinds = kindsSummary(summary.kinds, t)
      const waited = formatDuration(elapsed, t)
      if (summary.waiting > 0 && waited !== '') {
        parts.push(t('tooltip.waited', { time: waited }))
      }
      if (kinds !== '') parts.push(t('tooltip.kinds', { kinds }))
      if (summary.completed > 0) {
        parts.push(t('tooltip.completed', { count: summary.completed }))
      }
      const tooltip = parts.join(' · ')
      const children = [h(LampRow, { key: 'lamps', state: summary.state })]
      if (options.showLabel && props.wide === true) {
        children.push(
          h('span', { key: 'label', className: 'dsh-traffic-light__label' }, stateLabel),
        )
      }
      if (options.showCount && summary.waiting > 0) {
        children.push(
          h(
            'span',
            { key: 'badge', className: 'dsh-traffic-light__badge' },
            String(summary.waiting),
          ),
        )
      }
      return h(
        'div',
        {
          className: 'dsh-traffic-light',
          'data-state': summary.state,
          title: tooltip,
          role: 'img',
          'aria-label': `${t('title')}: ${stateLabel}. ${tooltip}`,
        },
        children,
      )
    }

    /**
     * Headless beeper in the frame-wide overlay.
     *
     * It stays mounted where the sidebar foot may not be — the collapsed rail,
     * the Windows title-bar foot area it hides — so the alert never depends on
     * the lamp being visible. It beeps on a state change, never on every render:
     *  - red    when a session starts waiting for you (or another one joins),
     *  - yellow when every session stopped, if `beepIdle` is on.
     * A state that merely persists across renders or option edits is silent.
     */
    function StatusWatcher(props) {
      const { options, summary } = useSummary(props.useSessionStatus)
      const previous = React.useRef(null)

      React.useEffect(() => {
        noteRedSince(summary.state)
        const last = previous.current
        previous.current = { state: summary.state, waiting: summary.waiting }
        if (last === null || !options.beep) return
        const enteredRed = summary.state === 'red' && last.state !== 'red'
        const moreWaiting = summary.waiting > last.waiting
        if (enteredRed || moreWaiting) {
          playBeep(options)
          return
        }
        if (summary.state === 'yellow' && last.state !== 'yellow' && options.beepIdle) {
          playBeep(options)
        }
      }, [
        summary.state,
        summary.waiting,
        options.beep,
        options.beepIdle,
        options.volume,
        options.durationMs,
        options.beeps,
      ])

      return null
    }

    /**
     * Headless reporter in the frame-wide overlay.
     *
     * It has no markup of its own, so the board keeps hearing from the page
     * even when the sidebar foot (and the lamps) are hidden. The 400 ms delay
     * collapses a burst of status changes into one write.
     */
    function BoardReporter(props) {
      const { options, summary } = useSummary(props.useSessionStatus)
      const board = useBoardInfo()
      const enabled = options.boardEnabled

      React.useEffect(() => {
        if (!enabled) return undefined
        const timer = window.setTimeout(() => {
          reportBoard(readOptions(), summary)
        }, 400)
        return () => window.clearTimeout(timer)
      }, [
        enabled,
        board.hostLabel,
        summary.state,
        summary.running,
        summary.waiting,
        summary.completed,
        options.boardBase,
        options.boardSharecode,
        options.boardKey,
        options.boardName,
        options.boardText,
      ])

      return null
    }

    function Switch(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label,
          className: 'dsh-traffic-light-switch',
          onClick: () => props.onChange(!props.checked),
        },
        h('span', { className: 'dsh-traffic-light-switch__knob', 'aria-hidden': 'true' }),
      )
    }

    function Row(props) {
      return h(
        'div',
        { className: 'dsh-traffic-light-row' },
        h(
          'div',
          { className: 'dsh-traffic-light-row__text' },
          h('span', { className: 'dsh-traffic-light-row__label' }, props.label),
          props.hint === undefined
            ? null
            : h('span', { className: 'dsh-traffic-light-row__hint' }, props.hint),
        ),
        h('div', { className: 'dsh-traffic-light-row__control' }, props.children),
      )
    }

    function Segmented(props) {
      const options = props.options
      return h(
        'div',
        { className: 'dsh-traffic-light-segmented', role: 'radiogroup', 'aria-label': props.label },
        options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              role: 'radio',
              'aria-checked': props.value === option.value ? 'true' : 'false',
              'data-active': props.value === option.value ? 'true' : 'false',
              className: 'dsh-traffic-light-segmented__item',
              onClick: () => props.onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    function Range(props) {
      return h('input', {
        type: 'range',
        className: 'dsh-traffic-light-range',
        'aria-label': props.label,
        min: props.min,
        max: props.max,
        step: props.step,
        value: props.value,
        onChange: (event) => props.onChange(Number(event.target.value)),
      })
    }

    function SelectControl(props) {
      return h(
        'select',
        {
          className: 'dsh-traffic-light-select',
          'aria-label': props.label,
          value: props.value,
          onChange: (event) => props.onChange(event.target.value),
        },
        props.options.map((option) =>
          h('option', { key: option.value, value: option.value }, option.label),
        ),
      )
    }

    function NumberField(props) {
      return h('input', {
        type: 'number',
        className: 'dsh-traffic-light-number',
        'aria-label': props.label,
        min: props.min,
        max: props.max,
        step: props.step,
        value: props.value,
        onChange: (event) => {
          const parsed = Number(event.target.value)
          if (!Number.isFinite(parsed)) return
          props.onChange(Math.min(props.max, Math.max(props.min, parsed)))
        },
      })
    }

    /** A text input that commits on blur/Enter, so typing never re-renders the page. */
    function TextField(props) {
      const external = props.value
      const [draft, setDraft] = React.useState(external)

      React.useEffect(() => {
        setDraft(external)
      }, [external])

      const commit = () => {
        const next = draft.trim()
        if (next !== external) props.onChange(next)
      }

      return h('input', {
        type: props.type === undefined ? 'text' : props.type,
        className: 'dsh-traffic-light-text',
        'aria-label': props.label,
        value: draft,
        placeholder: props.placeholder,
        spellCheck: false,
        autoComplete: 'off',
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commit()
          event.currentTarget.blur()
        },
      })
    }

    function Button(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-traffic-light-button',
          onClick: props.onClick,
        },
        props.label,
      )
    }

    /** The Settings page: live preview plus every option. */
    function SettingsPage(props) {
      const t = safeTranslate(props.t)
      const { options, summary } = useSummary(props.useSessionStatus)
      const board = useBoardInfo()
      const [resetDone, setResetDone] = React.useState(false)

      React.useEffect(() => {
        if (!resetDone) return undefined
        const timer = window.setTimeout(() => setResetDone(false), 2000)
        return () => window.clearTimeout(timer)
      }, [resetDone])

      const stateLabel = t(`state.${summary.state}`)
      const elapsed = useRedElapsed(summary.state)
      const sessions =
        typeof props.useSessions === 'function' ? props.useSessions((state) => state) : null
      const waitingKinds = kindsSummary(summary.kinds, t)
      const previewParts = []
      const previewTitles = waitingTitlesText(summary.waitingIds, sessions, t)
      if (previewTitles !== '') previewParts.push(previewTitles)
      const waitedText = formatDuration(elapsed, t)
      if (summary.waiting > 0 && waitedText !== '') {
        previewParts.push(t('tooltip.waited', { time: waitedText }))
      }
      if (waitingKinds !== '') previewParts.push(t('tooltip.kinds', { kinds: waitingKinds }))
      if (summary.completed > 0) {
        previewParts.push(t('tooltip.completed', { count: summary.completed }))
      }
      const previewDetail = previewParts.join(' · ')
      const boardStatus = !options.boardEnabled
        ? t('board.disabled')
        : board.status === 'connecting'
          ? t('board.connecting')
          : board.status === 'error'
            ? t('board.error', { message: board.message })
            : board.channel !== ''
              ? t('board.connected', { channel: board.channel })
              : t('board.idle')

      const connectBoard = () => {
        writeOptions({ boardEnabled: true })
        lastBoardState = ''
        claimBoard(readOptions())
          .then(() => reportBoard(readOptions(), summary))
          .catch(() => {})
      }

      const submitBoard = () => {
        lastBoardState = ''
        reportBoard(readOptions(), summary).catch(() => {})
      }

      return h(
        'div',
        { className: 'dsh-traffic-light-page' },
        h('h2', { className: 'dsh-traffic-light-page__title' }, t('title')),
        h('p', { className: 'dsh-traffic-light-page__intro' }, t('intro')),
        h(
          'div',
          { className: 'dsh-traffic-light-preview' },
          h(
            'div',
            { className: 'dsh-traffic-light-preview__lights' },
            LAMP_ORDER.map((color) =>
              h(Lamp, {
                key: color,
                color,
                lit: LAMP_STATE[color] === summary.state,
                size: 16,
              }),
            ),
          ),
          h(
            'div',
            { className: 'dsh-traffic-light-preview__meta' },
            h(
              'strong',
              { className: 'dsh-traffic-light-preview__state' },
              `${t('preview.title')} · ${stateLabel}`,
            ),
            h(
              'span',
              { className: 'dsh-traffic-light-preview__counts' },
              t('preview.counts', {
                running: summary.running,
                waiting: summary.waiting,
                total: summary.total,
              }),
            ),
            previewDetail === ''
              ? null
              : h(
                  'span',
                  { className: 'dsh-traffic-light-preview__counts' },
                  previewDetail,
                ),
          ),
        ),
        h(
          'ul',
          { className: 'dsh-traffic-light-legend' },
          h('li', null, t('legend.green')),
          h('li', null, t('legend.red')),
          h('li', null, t('legend.yellow')),
        ),
        h(
          'div',
          { className: 'dsh-traffic-light-rows' },
          h(
            Row,
            { label: t('option.enabled'), hint: t('option.enabled.hint') },
            h(Switch, {
              checked: options.enabled,
              label: t('option.enabled'),
              onChange: (value) => writeOptions({ enabled: value }),
            }),
          ),
          h(
            Row,
            { label: t('option.beep'), hint: t('option.beep.hint') },
            h(Switch, {
              checked: options.beep,
              label: t('option.beep'),
              onChange: (value) => {
                writeOptions({ beep: value })
                if (value) playBeep({ ...readOptions(), beep: true })
              },
            }),
          ),
          h(
            Row,
            { label: t('option.beepIdle'), hint: t('option.beepIdle.hint') },
            h(Switch, {
              checked: options.beepIdle,
              label: t('option.beepIdle'),
              onChange: (value) => {
                writeOptions({ beepIdle: value })
                if (value) playBeep({ ...readOptions(), beepIdle: true })
              },
            }),
          ),
          h(
            Row,
            { label: t('option.sound'), hint: t('option.sound.hint') },
            h(SelectControl, {
              label: t('option.sound'),
              value: options.sound,
              options: SOUND_KEYS.map((key) => ({ value: key, label: t(`sound.${key}`) })),
              onChange: (value) => {
                writeOptions({ sound: value })
                playBeep(readOptions())
              },
            }),
          ),
          h(
            Row,
            { label: t('option.volume'), hint: t('option.volume.hint') },
            h(
              'div',
              { className: 'dsh-traffic-light-inline' },
              h(Range, {
                label: t('option.volume'),
                min: 0,
                max: 100,
                step: 5,
                value: Math.round(options.volume * 100),
                onChange: (value) => writeOptions({ volume: value / 100 }),
              }),
              h(
                'span',
                { className: 'dsh-traffic-light-value' },
                `${Math.round(options.volume * 100)}%`,
              ),
            ),
          ),
          h(
            Row,
            { label: t('option.duration'), hint: t('option.duration.hint') },
            h(
              'div',
              { className: 'dsh-traffic-light-inline' },
              h(NumberField, {
                label: t('option.duration'),
                min: 40,
                max: 1200,
                step: 20,
                value: options.durationMs,
                onChange: (value) => writeOptions({ durationMs: value }),
              }),
              h('span', { className: 'dsh-traffic-light-value' }, t('unit.ms')),
            ),
          ),
          h(
            Row,
            { label: t('option.beeps'), hint: t('option.beeps.hint') },
            h(
              'div',
              { className: 'dsh-traffic-light-inline' },
              h(NumberField, {
                label: t('option.beeps'),
                min: 1,
                max: 5,
                step: 1,
                value: options.beeps,
                onChange: (value) => writeOptions({ beeps: value }),
              }),
              h('span', { className: 'dsh-traffic-light-value' }, t('unit.times')),
            ),
          ),
          h(
            Row,
            { label: t('option.greenMode'), hint: t('option.greenMode.hint') },
            h(Segmented, {
              label: t('option.greenMode'),
              value: options.greenMode,
              options: [
                { value: 'any', label: t('option.greenMode.any') },
                { value: 'all', label: t('option.greenMode.all') },
              ],
              onChange: (value) => writeOptions({ greenMode: value }),
            }),
          ),
          h(
            Row,
            { label: t('option.showLabel'), hint: t('option.showLabel.hint') },
            h(Switch, {
              checked: options.showLabel,
              label: t('option.showLabel'),
              onChange: (value) => writeOptions({ showLabel: value }),
            }),
          ),
          h(
            Row,
            { label: t('option.showCount'), hint: t('option.showCount.hint') },
            h(Switch, {
              checked: options.showCount,
              label: t('option.showCount'),
              onChange: (value) => writeOptions({ showCount: value }),
            }),
          ),
          h('div', { className: 'dsh-traffic-light-group' }, t('group.board')),
          h(
            Row,
            { label: t('option.board'), hint: t('option.board.hint') },
            h(Switch, {
              checked: options.boardEnabled,
              label: t('option.board'),
              onChange: (value) => {
                writeOptions({ boardEnabled: value })
                if (value) submitBoard()
              },
            }),
          ),
          h(
            Row,
            { label: t('option.boardName'), hint: t('option.boardName.hint') },
            h(TextField, {
              label: t('option.boardName'),
              value: options.boardName,
              placeholder: t('option.boardName.auto', {
                name: board.hostLabel === '' ? 'DSH' : board.hostLabel,
              }),
              onChange: (value) => writeOptions({ boardName: value }),
            }),
          ),
          h(
            Row,
            { label: t('option.boardBase'), hint: t('option.boardBase.hint') },
            h(TextField, {
              label: t('option.boardBase'),
              value: options.boardBase,
              onChange: (value) => writeOptions({ boardBase: value }),
            }),
          ),
          h(
            Row,
            { label: t('option.boardSharecode'), hint: t('option.boardSharecode.hint') },
            h(TextField, {
              label: t('option.boardSharecode'),
              value: options.boardSharecode,
              onChange: (value) => writeOptions({ boardSharecode: value }),
            }),
          ),
          h(
            Row,
            { label: t('option.boardKey'), hint: t('option.boardKey.hint') },
            h(TextField, {
              label: t('option.boardKey'),
              type: 'password',
              value: options.boardKey,
              onChange: (value) => writeOptions({ boardKey: value }),
            }),
          ),
          h(
            Row,
            { label: t('option.boardText'), hint: t('option.boardText.hint') },
            h(Switch, {
              checked: options.boardText,
              label: t('option.boardText'),
              onChange: (value) => {
                writeOptions({ boardText: value })
                submitBoard()
              },
            }),
          ),
          h(
            Row,
            { label: t('board.state'), hint: boardStatus },
            h(
              'div',
              { className: 'dsh-traffic-light-inline' },
              h(Button, { label: t('action.board.connect'), onClick: connectBoard }),
              h(Button, { label: t('action.board.report'), onClick: submitBoard }),
              h(Button, {
                label: t('action.board.forget'),
                onClick: () => {
                  forgetBoard()
                  writeOptions({ boardEnabled: false })
                },
              }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dsh-traffic-light-actions' },
          h(Button, {
            label: t('action.testBeep'),
            onClick: () => playBeep(readOptions()),
          }),
          h(Button, {
            label: t('action.reset'),
            onClick: () => {
              writeOptions({ ...DEFAULT_OPTIONS })
              setResetDone(true)
            },
          }),
          resetDone
            ? h('span', { className: 'dsh-traffic-light-reset' }, t('action.reset.done'))
            : null,
          h(
            'a',
            {
              className: 'dsh-traffic-light-link',
              href: boardPageUrl(options),
              target: '_blank',
              rel: 'noreferrer noopener',
            },
            t('action.board.open'),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Styles: theme tokens only, namespaced under this plugin's prefix
    // ---------------------------------------------------------------------

    const CSS = `
.dsh-traffic-light{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;box-sizing:border-box;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:default;user-select:none}
.dsh-traffic-light:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-traffic-light__lamps{display:inline-flex;align-items:center;gap:4px}
.dsh-traffic-light__lamp{display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;opacity:.2;transition:opacity .18s ease,box-shadow .18s ease}
.dsh-traffic-light__lamp[data-lit="true"]{opacity:1;box-shadow:0 0 5px 1px currentColor}
.dsh-traffic-light__lamp--red{color:var(--dsw-alias-state-error-primary)}
.dsh-traffic-light__lamp--amber{color:var(--dsw-alias-state-warn-primary)}
.dsh-traffic-light__lamp--green{color:var(--dsw-alias-state-success-primary)}
.dsh-traffic-light__lamp--red[data-lit="true"]{animation:dsh-traffic-light-pulse 1.6s ease-in-out infinite}
.dsh-traffic-light__label{white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dsh-traffic-light__badge{min-width:14px;height:14px;padding:0 4px;box-sizing:border-box;border-radius:7px;background:var(--dsw-alias-state-error-primary);color:#fff;font-size:10px;line-height:14px;text-align:center;font-variant-numeric:tabular-nums}
@keyframes dsh-traffic-light-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.dsh-traffic-light-page{display:flex;flex-direction:column;gap:14px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsh-traffic-light-page__title{margin:0;font-size:18px;font-weight:600;line-height:26px}
.dsh-traffic-light-page__intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsh-traffic-light-preview{display:flex;align-items:center;gap:14px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dsh-traffic-light-preview__lights{display:flex;flex-direction:column;gap:6px;padding:6px 8px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.dsh-traffic-light-preview__lights .dsh-traffic-light__lamp{width:16px;height:16px}
.dsh-traffic-light-preview__meta{display:flex;flex-direction:column;gap:4px;font-size:13px;line-height:20px}
.dsh-traffic-light-preview__state{font-weight:600}
.dsh-traffic-light-preview__counts{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-traffic-light-legend{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-traffic-light-legend li::before{content:"";display:inline-block;width:6px;height:6px;margin-right:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);vertical-align:middle}
.dsh-traffic-light-legend li:nth-child(1)::before{background:var(--dsw-alias-state-success-primary)}
.dsh-traffic-light-legend li:nth-child(2)::before{background:var(--dsw-alias-state-error-primary)}
.dsh-traffic-light-legend li:nth-child(3)::before{background:var(--dsw-alias-state-warn-primary)}
.dsh-traffic-light-rows{display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-traffic-light-row{display:flex;align-items:center;gap:16px;padding:10px 2px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsh-traffic-light-row__text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.dsh-traffic-light-row__label{font-size:13px;line-height:20px}
.dsh-traffic-light-row__hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-traffic-light-row__control{display:flex;align-items:center;flex:none}
.dsh-traffic-light-inline{display:flex;align-items:center;gap:8px}
.dsh-traffic-light-value{min-width:38px;font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-traffic-light-switch{position:relative;flex:none;width:34px;height:20px;padding:0;border:0;border-radius:10px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .16s ease}
.dsh-traffic-light-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dsh-traffic-light-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-traffic-light-switch__knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .16s ease}
.dsh-traffic-light-switch[aria-checked="true"] .dsh-traffic-light-switch__knob{transform:translateX(14px)}
.dsh-traffic-light-segmented{display:inline-flex;padding:2px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.dsh-traffic-light-segmented__item{font:inherit;font-size:12px;line-height:18px;height:24px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-traffic-light-segmented__item[data-active="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsh-traffic-light-segmented__item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-traffic-light-range{width:150px;accent-color:var(--dsw-alias-brand-primary)}
.dsh-traffic-light-select{height:28px;min-width:132px;padding:0 8px;box-sizing:border-box;border-radius:7px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dsh-traffic-light-select:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-traffic-light-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-traffic-light-number{width:76px;height:26px;padding:0 8px;box-sizing:border-box;border-radius:6px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsh-traffic-light-button{font:inherit;font-size:13px;line-height:20px;height:28px;padding:0 12px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-traffic-light-button:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-traffic-light-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-traffic-light-actions{display:flex;align-items:center;gap:10px;padding-top:2px}
.dsh-traffic-light-reset{font-size:12px;color:var(--dsw-alias-state-success-primary)}
.dsh-traffic-light-group{margin:18px 0 2px;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-traffic-light-text{width:240px;height:26px;padding:0 8px;box-sizing:border-box;border-radius:6px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsh-traffic-light-text:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-traffic-light-text:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-traffic-light-link{font-size:12px;line-height:20px;color:var(--dsw-alias-brand-primary);text-decoration:none}
.dsh-traffic-light-link:hover{text-decoration:underline}
@media (prefers-reduced-motion:reduce){.dsh-traffic-light__lamp--red[data-lit="true"]{animation:none}}
`

    // ---------------------------------------------------------------------
    // Dictionaries
    // ---------------------------------------------------------------------

    const ZH = {
      nav: '红绿灯',
      title: '左下角红绿灯',
      intro:
        '在侧边栏左下角用红黄绿灯汇总所有会话的状态：绿灯表示会话正在运行，红灯表示有会话在等待你选择（审批 / 提问 / 计划确认），黄灯表示当前没有会话运行。',
      'state.green': '运行中',
      'state.red': '等待选择',
      'state.yellow': '空闲',
      tooltip: '运行中 {running} · 等待选择 {waiting} · 会话共 {total}',
      'tooltip.waited': '已等 {time}',
      'tooltip.kinds': '等待{kinds}',
      'tooltip.completed': '刚完成 {count} 个',
      'tooltip.titles': '等待：{titles}',
      'tooltip.titlesMore': '等待：{titles} 等 {count} 个',
      'kind.approval': '审批',
      'kind.question': '提问',
      'kind.plan': '计划确认',
      'kind.other': '操作',
      'duration.justNow': '刚刚',
      'duration.minutes': '{count} 分钟',
      'duration.hours': '{count} 小时',
      'duration.hoursMinutes': '{hours} 小时 {minutes} 分钟',
      'preview.title': '当前状态',
      'preview.counts': '运行中 {running} · 等待选择 {waiting} · 会话共 {total}',
      'legend.green': '绿色：会话正在运行',
      'legend.red': '红色：有会话在等待你选择，并会蜂鸣提醒',
      'legend.yellow': '黄色：当前没有会话在运行',
      'option.enabled': '显示红绿灯控件',
      'option.enabled.hint': '关闭后侧边栏左下角不再显示状态灯，其余设置会保留。',
      'option.beep': '蜂鸣提醒',
      'option.beep.hint': '状态切换到红灯或黄灯时播放提示音。',
      'option.beepIdle': '回到空闲时也蜂鸣',
      'option.beepIdle.hint': '所有会话都停下来（切换到黄灯）时也播放提示音。',
      'option.sound': '音效',
      'option.sound.hint': '选择提示音音色，切换时会立即试听。',
      'sound.classic': '经典蜂鸣',
      'sound.chime': '清脆铃音',
      'sound.ping': '短促提示',
      'sound.alert': '警报双响',
      'sound.deep': '低沉提示',
      'sound.rise': '上升三连音',
      'option.volume': '蜂鸣音量',
      'option.volume.hint': '提示音音量，0 为静音。',
      'option.duration': '蜂鸣时长',
      'option.duration.hint': '单次提示音的持续时间。',
      'option.beeps': '蜂鸣次数',
      'option.beeps.hint': '每次触发时连续播放的次数。',
      'option.greenMode': '绿灯判定',
      'option.greenMode.hint': '决定多少会话在运行时才亮绿灯。',
      'option.greenMode.any': '任一会话运行',
      'option.greenMode.all': '全部会话运行',
      'option.showLabel': '显示状态文字',
      'option.showLabel.hint': '侧边栏展开时，在灯珠旁显示当前状态文字。',
      'option.showCount': '显示等待数量',
      'option.showCount.hint': '有会话等待时，在灯珠旁显示数字角标。',
      'action.testBeep': '试听音效',
      'action.reset': '恢复默认',
      'action.reset.done': '已恢复默认设置',
      'group.board': '公网看板（AI 运行状态）',
      'option.board': '上报状态到看板',
      'option.board.hint':
        '把左下角的灯色同步到公网看板：绿=运行中、黄=空闲、红=等你操作。第一次开启会自动注册本机设备并认领通道。',
      'option.boardName': '看板设备名',
      'option.boardName.hint':
        '看板上显示的名字，也是注册设备时用的名字，最多 24 字；留空则用本机名。',
      'option.boardName.auto': '留空用本机名（{name}）',
      'option.boardBase': '看板地址',
      'option.boardBase.hint': '接口根地址，一般保持默认。',
      'option.boardSharecode': 'sharecode',
      'option.boardSharecode.hint': '平台链接校验参数，漏了所有请求都会 403。',
      'option.boardKey': '写权限 key',
      'option.boardKey.hint': '全局写权限密码，等于密码，不要外传。',
      'option.boardText': '同步提示词文本',
      'option.boardText.hint':
        '连"几个会话在跑"这类文案一起上报；看板文案公开可读，别放敏感内容。',
      'board.state': '连接状态',
      'board.disabled': '未开启上报',
      'board.idle': '尚未连接看板，点「连接看板」自动注册并认领通道',
      'board.connecting': '正在连接看板…',
      'board.connected': '已连接，通道 {channel}',
      'board.error': '上报失败：{message}',
      'action.board.connect': '连接看板',
      'action.board.report': '立即上报',
      'action.board.forget': '清除凭据',
      'action.board.open': '打开看板',
      'unit.ms': '毫秒',
      'unit.times': '次',
    }

    const EN = {
      nav: 'Traffic light',
      title: 'Traffic light status',
      intro:
        'Summarizes every session at the sidebar foot: green means sessions are running, red means a session is waiting for you to choose (approval, question, or plan review), yellow means nothing is running.',
      'state.green': 'Running',
      'state.red': 'Waiting',
      'state.yellow': 'Idle',
      tooltip: 'Running {running} · Waiting {waiting} · Sessions {total}',
      'tooltip.waited': 'waiting {time}',
      'tooltip.kinds': 'waiting for {kinds}',
      'tooltip.completed': '{count} just finished',
      'tooltip.titles': 'waiting: {titles}',
      'tooltip.titlesMore': 'waiting: {titles} +{count}',
      'kind.approval': 'approval',
      'kind.question': 'a question',
      'kind.plan': 'plan review',
      'kind.other': 'you',
      'duration.justNow': 'a moment',
      'duration.minutes': '{count} min',
      'duration.hours': '{count} h',
      'duration.hoursMinutes': '{hours} h {minutes} min',
      'preview.title': 'Current state',
      'preview.counts': 'Running {running} · Waiting {waiting} · Sessions {total}',
      'legend.green': 'Green: sessions are running',
      'legend.red': 'Red: a session is waiting for your choice, with a beep',
      'legend.yellow': 'Yellow: no session is running',
      'option.enabled': 'Show the traffic light',
      'option.enabled.hint':
        'Hides the control at the sidebar foot; the other options are kept.',
      'option.beep': 'Beep alerts',
      'option.beep.hint': 'Plays a tone when the state switches to red or yellow.',
      'option.beepIdle': 'Beep when idle too',
      'option.beepIdle.hint':
        'Also plays a tone when every session stops (state switches to yellow).',
      'option.sound': 'Sound',
      'option.sound.hint': 'Pick the alert timbre; changing it plays a preview right away.',
      'sound.classic': 'Classic beep',
      'sound.chime': 'Chime',
      'sound.ping': 'Ping',
      'sound.alert': 'Two-tone alert',
      'sound.deep': 'Deep tone',
      'sound.rise': 'Rising triad',
      'option.volume': 'Beep volume',
      'option.volume.hint': 'Tone volume; 0 is silent.',
      'option.duration': 'Beep length',
      'option.duration.hint': 'How long one tone lasts.',
      'option.beeps': 'Beep count',
      'option.beeps.hint': 'How many tones play per trigger.',
      'option.greenMode': 'Green rule',
      'option.greenMode.hint': 'How many sessions must run before the light turns green.',
      'option.greenMode.any': 'Any session running',
      'option.greenMode.all': 'All sessions running',
      'option.showLabel': 'Show state text',
      'option.showLabel.hint': 'Shows the state word beside the lamps in the expanded sidebar.',
      'option.showCount': 'Show waiting count',
      'option.showCount.hint': 'Shows a numeric badge beside the lamps while sessions wait.',
      'action.testBeep': 'Preview sound',
      'action.reset': 'Restore defaults',
      'action.reset.done': 'Defaults restored',
      'group.board': 'Public board (AI status)',
      'option.board': 'Report status to the board',
      'option.board.hint':
        'Mirrors the lamps to the public board: green = running, amber = idle, red = waiting for you. Turning it on registers this machine and claims a channel once.',
      'option.boardName': 'Board device name',
      'option.boardName.hint':
        'Shown on the board and used when registering the device, up to 24 characters; leave empty to use this machine’s name.',
      'option.boardName.auto': 'Empty uses this machine ({name})',
      'option.boardBase': 'Board URL',
      'option.boardBase.hint': 'API root; the default is usually right.',
      'option.boardSharecode': 'sharecode',
      'option.boardSharecode.hint': 'Link validation token; every request 403s without it.',
      'option.boardKey': 'Control key',
      'option.boardKey.hint': 'Deployment-wide write password — treat it as a secret.',
      'option.boardText': 'Sync the caption',
      'option.boardText.hint':
        'Also sends "how many sessions are running". The board is public: never put secrets there.',
      'board.state': 'Connection',
      'board.disabled': 'Reporting is off',
      'board.idle': 'Not connected yet — press "Connect" to register and claim a channel',
      'board.connecting': 'Connecting to the board…',
      'board.connected': 'Connected, channel {channel}',
      'board.error': 'Report failed: {message}',
      'action.board.connect': 'Connect',
      'action.board.report': 'Report now',
      'action.board.forget': 'Forget credentials',
      'action.board.open': 'Open the board',
      'unit.ms': 'ms',
      'unit.times': 'x',
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    function apply(ctx) {
      const t = ctx.locale.bind(NS)

      ctx.effect(
        () => ctx.locale.register(NS, { zh: ZH, en: EN }),
        'traffic-light: dictionaries',
      )

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', PLUGIN_ID)
        style.textContent = CSS
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, 'traffic-light: styles')

      ctx.effect(() => {
        const onStorage = (event) => {
          if (event.key !== null && event.key !== STORAGE_KEY) return
          cachedOptions = null
          notifyOptions()
        }
        const unlockAudio = () => resumeAudio()
        window.addEventListener('storage', onStorage)
        window.addEventListener('pointerdown', unlockAudio, true)
        window.addEventListener('keydown', unlockAudio, true)
        return () => {
          window.removeEventListener('storage', onStorage)
          window.removeEventListener('pointerdown', unlockAudio, true)
          window.removeEventListener('keydown', unlockAudio, true)
        }
      }, 'traffic-light: window listeners')

      ctx.effect(() => {
        void loadHostLabel()
      }, 'traffic-light: host label')

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'traffic-light-watch',
            order: 800,
          },
          StatusWatcher,
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'traffic-light-board',
            order: 810,
          },
          BoardReporter,
        ),
      )

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'traffic-light',
            order: 31,
            label: () => t('nav'),
            locale: NS,
          },
          FooterControl,
        ),
      )

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'traffic-light',
            order: 26,
            label: () => t('nav'),
            locale: NS,
          },
          SettingsPage,
        ),
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
