/**
 * Browser half of the traffic-light bundle.
 *
 * Two seats:
 *  - `sidebar.footer.action` (bottom-left of the window, beside Settings) draws
 *    the red/amber/green lamp summarizing every session's state.
 *  - `settings.section` renders one Settings page that edits the persisted
 *    options; the footer control subscribes to the same store, so a change is
 *    live without a reload.
 *
 * Session state comes only from the standard slot hooks the host passes in
 * (`useSessionStatus` / `useSessions`); the plugin never subscribes to session
 * events itself. Colors come from `--dsw-alias-*` theme tokens, so the control
 * follows light/dark themes.
 *
 * Plain JavaScript for the lazy factory form: `window.__ModuleLoader__.load`
 * registers the factory, and the module body runs at materialization.
 */
window.__ModuleLoader__.load({
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
    // Session state folding
    // ---------------------------------------------------------------------

    /**
     * Fold the page-wide session status map into one traffic-light state.
     * Each entry is `{ running, pendingInteraction, completionUnread }`.
     */
    function summarizeStatuses(statuses, greenMode) {
      let total = 0
      let running = 0
      let waiting = 0
      if (statuses && typeof statuses.forEach === 'function') {
        statuses.forEach((status) => {
          if (status === undefined || status === null) return
          total += 1
          if (status.running === true) running += 1
          if (status.pendingInteraction !== undefined && status.pendingInteraction !== null) {
            waiting += 1
          }
        })
      }
      let state = 'yellow'
      if (waiting > 0) state = 'red'
      else if (greenMode === 'all') state = total > 0 && running === total ? 'green' : 'yellow'
      else state = running > 0 ? 'green' : 'yellow'
      return { state, total, running, waiting }
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

      if (!options.enabled) return null

      const stateLabel = t(`state.${summary.state}`)
      const tooltip = t('tooltip', {
        running: summary.running,
        waiting: summary.waiting,
        total: summary.total,
      })
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
      const [resetDone, setResetDone] = React.useState(false)

      React.useEffect(() => {
        if (!resetDone) return undefined
        const timer = window.setTimeout(() => setResetDone(false), 2000)
        return () => window.clearTimeout(timer)
      }, [resetDone])

      const stateLabel = t(`state.${summary.state}`)

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
