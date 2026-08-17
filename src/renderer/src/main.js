import './style.css'
import hljs from 'highlight.js'

let settings = {}
try {
  settings = JSON.parse(localStorage.getItem('cilamai-settings') || '{}')
  if (typeof settings !== 'object' || settings === null) settings = {}
} catch {
  settings = {}
}
const LANG_BASE = './lang/'

const DEFAULT_HOTKEYS = {
  newChat: 'Ctrl+N',
  settings: 'Ctrl+,',
  search: 'Ctrl+F',
  focusComposer: 'Ctrl+/',
  toggleModel: 'Ctrl+M',
  upload: 'Ctrl+U',
  clearChat: 'Ctrl+L',
  toggleThinking: 'Ctrl+T',
  send: 'Enter',
  stop: 'Escape'
}

const HOTKEY_ACTIONS = {
  newChat: { labelKey: 'hotkeyNewChat', run: () => resetChat() },
  settings: { labelKey: 'hotkeySettings', run: () => showSettings() },
  search: { labelKey: 'hotkeySearch', run: () => openSearchPage() },
  focusComposer: {
    labelKey: 'hotkeyFocusComposer',
    run: () => document.querySelector('.composer-input')?.focus()
  },
  toggleModel: {
    labelKey: 'hotkeyToggleModel',
    run: () => {
      showChat()
      document.querySelector('[data-model-toggle]')?.click()
    }
  },
  upload: { labelKey: 'hotkeyUpload', run: () => document.querySelector('[data-upload]')?.click() },
  clearChat: {
    labelKey: 'hotkeyClearChat',
    run: () => {
      resetChat()
      showNotification(tf('conversationCleared', 'Conversation cleared'), 'warning')
    }
  },
  toggleThinking: {
    labelKey: 'hotkeyToggleThinking',
    run: () => {
      showThinking = !showThinking
      settings.showThinking = showThinking
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      showNotification(showThinking ? 'Thinking shown' : 'Thinking hidden', 'warning')
    }
  },
  send: {
    labelKey: 'hotkeySend',
    run: () => {
      const form = document.querySelector('.composer')
      if (form) form.requestSubmit()
    }
  },
  stop: {
    labelKey: 'hotkeyStop',
    run: () => {
      const stopBtn = document.querySelector('.composer-btn.stop')
      if (stopBtn && !stopBtn.hidden) stopBtn.click()
    }
  }
}

let hotkeys = { ...DEFAULT_HOTKEYS, ...(settings.hotkeys || {}) }
settings.hotkeys = hotkeys

const normalizeKey = (e) => {
  const parts = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = e.key
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) parts.push(key)
  return parts.join('+')
}

const comboMatchesEvent = (combo, e) => {
  if (!combo) return false
  const parts = combo.split('+')
  const needCtrl = parts.includes('Ctrl')
  const needShift = parts.includes('Shift')
  const needAlt = parts.includes('Alt')
  const mainKey = parts[parts.length - 1]
  if (needCtrl !== (e.ctrlKey || e.metaKey)) return false
  if (needShift !== e.shiftKey) return false
  if (needAlt !== e.altKey) return false
  let k = e.key
  if (k === ' ') k = 'Space'
  else if (k.length === 1) k = k.toUpperCase()
  return k === mainKey
}
let localeData = {}
let currentLang = settings.language || 'en'
const t = (key) => localeData[key] ?? key
const tf = (key, fallback) => (localeData[key] != null ? localeData[key] : fallback)
const availableLangs = ['en', 'ko', 'tr', 'ru']
let isWin11 = false
window.electron?.getPlatformInfo?.().then((info) => {
  isWin11 = info?.isWindows11 || false
  document.documentElement.dataset.win11 = String(isWin11)
})
let provider = settings.provider || 'opencode'
let baseUrl = settings.url || ''
let openaiUrl = settings.openaiUrl || 'https://console.opencode.ai/inference/openai/v1'
let apiKey = settings.apiKey || ''
let opencodeApiKey = settings.opencodeApiKey || ''
let claudeApiKey = settings.claudeApiKey || ''
let grokApiKey = settings.grokApiKey || ''
let zaiApiKey = settings.zaiApiKey || ''
let showThinking = settings.showThinking !== false
let theme = settings.theme || 'dark'
let resolvedTheme = theme

let recognition = null
let recognizing = false
const stopRecognition = () => {
  if (recognition && recognizing) {
    try { recognition.stop() } catch {}
  }
  recognizing = false
  document.querySelector('[data-mic-toggle]')?.classList.remove('listening')
}
const applyTheme = (skipIpc = false) => {
  resolvedTheme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = resolvedTheme
  if (!skipIpc) window.electron?.setTheme?.(theme)
}
applyTheme()
const systemMedia = matchMedia('(prefers-color-scheme: dark)')
systemMedia.addEventListener('change', () => {
  if (theme === 'system') applyTheme()
})

window.electron?.onCustomColorsChange?.((colors) => {
  if (colors && colors.accent) {
    settings.accentColor = colors.accent
    settings.bgColor = colors.bg
    settings.fgColor = colors.fg
    localStorage.setItem('cilamai-settings', JSON.stringify(settings))
    applyCustomColorsVars()
  }
})

window.electron?.onThemeChange?.((t) => {
  if (!t || t === theme) return
  theme = t
  clearCustomColorsVars()
  settings.accentColor = null
  settings.bgColor = null
  settings.fgColor = null
  settings.customColorsActive = false
  applyTheme(true)
  settings.theme = t
  localStorage.setItem('cilamai-settings', JSON.stringify(settings))
  document.querySelectorAll('input[name="theme"]').forEach((r) => { r.checked = r.value === t })
})
const isOpenAI = () => provider === 'openai' || provider === 'opencode'
const OPENCODE_URL = 'https://console.opencode.ai/inference/openai/v1'
const GROK_URL = 'https://api.x.ai/v1'
const CUSTOM_MODEL_ROUTES = {
  'mimo-v2.5-free': { url: OPENCODE_URL, org: 'Xiaomi LLM Core Team' }
}
const getProviderApiKey = (model) => {
  const m = (model || '').toLowerCase()
  if (m.includes('claude')) return claudeApiKey || opencodeApiKey || apiKey
  if (m.includes('grok')) return grokApiKey || opencodeApiKey || apiKey
  if (m.includes('z.ai') || m.includes('zai')) return zaiApiKey || opencodeApiKey || apiKey
  return opencodeApiKey || apiKey
}


const CLAUDE_URL = 'https://api.anthropic.com/v1'
const GROK_FALLBACKS = {
  'grok-4.3': 'grok-2',
  'grok': 'grok-2'
}

const OPENCODE_MODELS = new Set([
  'deepseek-v3', 'deepseek-r1', 'qwen-2.5-72b', 'llama-3.3-70b',
  'claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus', 'claude',
  'zai-glm-4', 'zai-glm-4-flash'
])

const routeForModel = (model) => {
  const currentKey = getProviderApiKey(model)
  const m = (model || '').toLowerCase()
  if (model === 'auto') return { url: `${OPENCODE_URL}/chat/completions`, model: 'mimo-v2.5-free', provider: 'opencode', apiKey: currentKey, org: 'Xiaomi LLM Core Team' }
  if (m.includes('grok')) {
    const targetModel = GROK_FALLBACKS[model] || model
    return { url: `${GROK_URL}/chat/completions`, model: targetModel, provider: 'openai', apiKey: currentKey }
  }
  if (OPENCODE_MODELS.has(model) || m.includes('claude') || m.includes('deepseek') || m.includes('qwen') || m.includes('llama') || m.includes('zai') || m.includes('glm')) {
    return { url: `${OPENCODE_URL}/chat/completions`, model, provider: 'opencode', apiKey: currentKey }
  }
  const custom = CUSTOM_MODEL_ROUTES[model]
  if (custom) return { url: `${custom.url}/chat/completions`, model, provider: 'opencode', apiKey: currentKey, org: custom.org || '' }
  return { url: chatUrl(), model, provider: isOpenAI() ? 'opencode' : provider, apiKey: currentKey }
}
const chatUrl = () => (isOpenAI() ? `${openaiUrl}/chat/completions` : `${baseUrl}/api/chat`)
const tagsUrl = () => (isOpenAI() ? `${openaiUrl}/models` : `${baseUrl}/api/tags`)
const apiHeaders = () => {
  const currentKey = getProviderApiKey(settings.model || '') || opencodeApiKey || apiKey
  return currentKey ? { 'Content-Type': 'application/json', Authorization: `Bearer ${currentKey}` } : { 'Content-Type': 'application/json' }
}
const messages = []
const pendingImages = []
const inputHistory = []
let inputHistoryIdx = -1

function updateSendBtnState() {
  const input = document.querySelector('.composer-input')
  const sendBtn = document.querySelector('.composer-btn.send')
  if (!input || !sendBtn) return
  const text = input.value.trim()
  if (!text && pendingImages.length === 0) {
    sendBtn.classList.add('locked')
    sendBtn.disabled = true
  } else {
    sendBtn.classList.remove('locked')
    sendBtn.disabled = false
  }
}

const SESSIONS_KEY = 'cilamai-sessions'
let sessions = []
let currentSessionId = null
try {
  sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
  if (!Array.isArray(sessions)) sessions = []
} catch {
  sessions = []
}

async function loadSessionsFromDisk() {
  try {
    const data = await window.electron?.loadSessions()
    if (Array.isArray(data) && data.length >= sessions.length) {
      sessions = data
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)))
    } else if (sessions.length > 0 && (!data || data.length === 0)) {
      window.electron?.saveSessionsFile(sessions)
    }
  } catch { }
}

const saveSessions = () => {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)))
  } catch {
    try {
      sessions = sessions.slice(0, 20)
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
    } catch {
      const stripped = sessions.map((s) => ({
        ...s,
        messages: s.messages.map((m) => {
          const c = { ...m }
          delete c.savedImages
          if (Array.isArray(c.content)) c.content = c.content.filter((p) => p.type !== 'image_url')
          delete c.images
          return c
        })
      }))
      sessions = stripped.slice(0, 10)
      try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
      } catch {
        sessions = []
        localStorage.removeItem(SESSIONS_KEY)
      }
    }
  }
  window.electron?.saveSessionsFile(sessions)
}

const ensureSession = () => {
  if (currentSessionId && sessions.some((s) => s.id === currentSessionId)) return
  const s = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    title: '',
    createdAt: Date.now(),
    messages: []
  }
  sessions.unshift(s)
  currentSessionId = s.id
  return s
}

const saveSession = () => {
  if (!messages.length) return
  const s = sessions.find((x) => x.id === currentSessionId) || ensureSession()
  s.messages = messages.map((m) => ({ ...m }))
  const firstUser = messages.find((m) => m.role === 'user')
  const titleText = typeof firstUser?.content === 'string' ? firstUser.content : ''
  const clean = titleText.replace(/\[image: [^\]]+\]\s*/g, '').trim()
  if (clean) s.title = clean.slice(0, 60)
  s.updatedAt = Date.now()
  saveSessions()
}

const messageText = (m) => {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) return m.content.filter((p) => p.type === 'text').map((p) => p.text).join(' ')
  return ''
}

const isNearBottom = (chat, threshold = 200) => {
  return chat.scrollTop + chat.clientHeight >= chat.scrollHeight - threshold
}

const renderSessionMessages = () => {
  const chat = document.querySelector('.chat')
  const wasNearBottom = isNearBottom(chat)
  chat.innerHTML = ''
  messages.forEach((m, i) => {
    if (m.role !== 'user' && m.role !== 'assistant') return
    const text = messageText(m).replace(/\[image: [^\]]+\]\s*/g, '')
    const bubble = addMessage(m.role, text)
    bubble.dataset.idx = String(i)
    if (m.role === 'user') {
      const saved = Array.isArray(m.savedImages) ? m.savedImages : []
      const urls = Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url) : []
      const b64 = Array.isArray(m.images) ? m.images.map((b) => `data:image/png;base64,${b}`) : []
      const names = [...(messageText(m).matchAll(/\[image: ([^\]]+)\]/g) || [])].map((x) => x[1])
        ;[...saved.map((i) => `data:image/${i.ext === 'svg' ? 'svg+xml' : i.ext};base64,${i.data}`), ...urls, ...b64].forEach(
          (src, j) => {
            const el = document.createElement('img')
            el.className = 'chat-image'
            el.src = src
            el.alt = names[j] || `image-${j + 1}`
            bubble.append(el)
          }
        )
    }
  })
  if (wasNearBottom) {
    chat.scrollTop = chat.scrollHeight
    document.querySelector('.scroll-bottom-btn')?.classList.remove('visible')
  } else {
    document.querySelector('.scroll-bottom-btn')?.classList.add('visible')
  }
}

const flashBubble = (bubble) => {
  bubble.scrollIntoView({ behavior: 'smooth', block: 'center' })
  bubble.classList.remove('search-flash')
  void bubble.offsetWidth
  bubble.classList.add('search-flash')
  setTimeout(() => bubble.classList.remove('search-flash'), 2000)
}

let sessionLoadTimer = null
let sessionLoadTargetId = null

const openSession = (id, targetIdx) => {
  const s = sessions.find((x) => x.id === id)
  if (!s) return
  const isCurrent = id === currentSessionId
  const chat = document.querySelector('.chat')
  const loading = document.querySelector('.session-loading')

  const doOpen = () => {
    if (sessionLoadTargetId !== id) return
    sessionLoadTargetId = null
    sessionLoadTimer = null
    if (!isCurrent) {
      messages.length = 0
      messages.push(...(s.messages || []).map((m) => ({ ...m })))
      inputHistory.length = 0
      inputHistoryIdx = -1
      for (const m of messages) {
        if (m.role === 'user' && typeof m.content === 'string') {
          const text = m.content.replace(/\[image: [^\]]+\]/g, '').trim()
          if (text) inputHistory.push(text)
        }
      }
      renderSessionMessages()
      currentSessionId = id
      document.querySelector('.main').classList.add('has-chat')
    }
    const sPage = document.querySelector('.search-page')
    if (sPage) sPage.hidden = true
    showChat()
    window.electron?.stopStream?.()
    const cInput = document.querySelector('.composer-input')
    if (cInput) cInput.disabled = false
    const cSend = document.querySelector('.composer-btn.send')
    const cStop = document.querySelector('.composer-btn.stop')
    if (cSend) cSend.hidden = false
    updateSendBtnState()
    if (cStop) cStop.hidden = true
    if (targetIdx !== undefined) {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-idx="${targetIdx}"]`)
        if (el) flashBubble(el)
      })
    }
  }

  if (loading && !isCurrent) {
    const sPage = document.querySelector('.search-page')
    if (sPage) sPage.hidden = true
    document.querySelector('.settings-view').hidden = true
    document.querySelector('.composer').hidden = true
    document.querySelector('.welcome-text').hidden = true
    if (chat) chat.hidden = true
    sessionLoadTargetId = id
    sessionLoadTimer = setTimeout(() => {
      if (chat) chat.hidden = false
      doOpen()
    }, 350)
  } else {
    doOpen()
  }
}

function createAvatar(role) {
  const avatar = document.createElement('div')
  avatar.className = 'chat-avatar avatar'
  avatar.innerHTML =
    role === 'user'
      ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`
      : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/></svg>`
  return avatar
}

const NOTIF_ICONS = {
  error: `<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>`,
  warning: `<path d="M12 3l9 16H3Z"/><path d="M12 10v5"/><path d="M12 17.5v.5"/>`,
  info: `<path d="M20 6L9 17l-5-5"/>`
}

function showNotification(message, type = 'error') {
  const toast = document.querySelector('.notification')
  if (!toast) return
  const msgEl = toast.querySelector('.notification-msg')
  if (msgEl) msgEl.textContent = message
  else toast.textContent = message
  const icon = toast.querySelector('.notification-icon')
  if (icon) {
    const svg = NOTIF_ICONS[type]
    icon.hidden = !svg
    if (svg) {
      icon.innerHTML = svg
      icon.setAttribute('stroke', 'currentColor')
    }
  }
  toast.className = `notification ${type}`
  toast.hidden = false
  toast.classList.remove('notification-out')
  void toast.offsetWidth
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => {
    toast.classList.add('notification-out')
    setTimeout(() => {
      toast.hidden = true
    }, 250)
  }, 6000)
}

const showError = (message) => showNotification(message, 'error')
const showWarning = (message) => showNotification(message, 'warning')

async function checkInternet() {
  if (!window.electron?.checkInternet) return true
  try {
    const res = await window.electron.checkInternet()
    if (res && res.online === false) {
      showNotification(tf('offlineMessage', 'You appear to be offline. Please check your internet connection.'), 'error')
      return false
    }
    return true
  } catch {
    return true
  }
}

async function fetchJson(url, options) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = data?.error || data?.message || `HTTP ${res.status}`
      throw new Error(detail)
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function stripEmoji(text) {
  return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}]/gu, '')
}

function renderMarkdown(text) {
  text = stripEmoji(text)
  if (!text) return ''
  const escaped = escapeHtml(text)

  const lines = escaped.split('\n')
  const result = []
  let inCodeBlock = false
  let codeBlockContent = []
  let codeLang = 'plaintext'
  let paragraphLines = []

  const flushParagraph = () => {
    if (paragraphLines.length) {
      const text = paragraphLines.join('\n')
      result.push(`<p>${renderInline(text)}</p>`)
      paragraphLines = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      flushParagraph()
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockContent = []
        const m = line.match(/^```\s*([\w+-]+)?/)
        codeLang = (m && m[1]) ? m[1] : 'plaintext'
      } else {
        inCodeBlock = false
        const code = codeBlockContent.join('\n')
        result.push(`<pre><code class="language-${codeLang} hljs">${code}</code></pre>`)
        codeBlockContent = []
        codeLang = 'plaintext'
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent.push(line)
      continue
    }

    if (line.startsWith('|')) {
      flushParagraph()
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i])
        i++
      }
      i--
      result.push(renderTable(rows))
      continue
    }

    if (line.startsWith('#### ')) {
      flushParagraph()
      result.push(`<h4>${renderInline(line.slice(5).trim())}</h4>`)
      continue
    }
    if (line.startsWith('### ')) {
      flushParagraph()
      result.push(`<h3>${renderInline(line.slice(4))}</h3>`)
      continue
    }
    if (line.startsWith('## ')) {
      flushParagraph()
      result.push(`<h2>${renderInline(line.slice(3))}</h2>`)
      continue
    }
    if (line.startsWith('# ')) {
      flushParagraph()
      result.push(`<h1>${renderInline(line.slice(2))}</h1>`)
      continue
    }
    if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
      flushParagraph()
      result.push('<hr>')
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushParagraph()
      const listItems = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        listItems.push(lines[i])
        i++
      }
      i--
      result.push(`<ul>${listItems.map(item => `<li>${renderInline(item.slice(2))}</li>`).join('')}</ul>`)
      continue
    }
    if (/^\d+\.\s/.test(line)) {
      flushParagraph()
      const listItems = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(lines[i])
        i++
      }
      i--
      result.push(`<ol>${listItems.map(item => `<li>${renderInline(item.replace(/^\d+\.\s/, ''))}</li>`).join('')}</ol>`)
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      continue
    }

    paragraphLines.push(line)
  }

  flushParagraph()

  if (inCodeBlock && codeBlockContent.length) {
    const code = codeBlockContent.join('\n')
    result.push(`<pre><code class="language-${codeLang} hljs">${code}</code></pre>`)
  }

  return result.join('\n')
}

function renderTable(rows) {
  const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim())
  const header = cells(rows[0])

  let thead = ''
  if (header.length) {
    thead = `<thead><tr>${header.map((h) => `<th>${renderInline(h)}</th>`).join('')}</tr></thead>`
  }

  const bodyRows = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (/^\|[\s:|-]+\|$/.test(row.trim())) continue
    const rowCells = cells(row)
    if (!rowCells.length) continue
    bodyRows.push(`<tr>${rowCells.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
  }

  return `<table>${thead}${bodyRows.length ? `<tbody>${bodyRows.join('')}</tbody>` : ''}</table>`
}

function detectLanguage(code) {
  const lower = code.toLowerCase()
  if (lower.includes('function') || lower.includes('const ') || lower.includes('let ') || lower.includes('=>') || lower.includes('console.log') || lower.includes('import ') || lower.includes('export ')) return 'javascript'
  if (lower.includes('<html') || lower.includes('<div') || lower.includes('<span') || lower.includes('</') || lower.includes('class=')) return 'html'
  if (lower.includes('{') && lower.includes('}') && (lower.includes(':') || lower.includes(';')) && (lower.includes('color') || lower.includes('margin') || lower.includes('padding') || lower.includes('display') || lower.includes('flex') || lower.includes('grid'))) return 'css'
  if (lower.startsWith('@echo off') || lower.includes('set ') || lower.includes('rem ') || lower.includes('echo ') || lower.includes('%') || lower.includes('.bat') || lower.includes('.cmd')) return 'bat'
  if (lower.includes('sudo ') || lower.includes('apt ') || lower.includes('yum ') || lower.includes('chmod ') || lower.includes('chown ') || lower.includes('ls ') || lower.includes('grep ') || lower.includes('cat ') || lower.includes('mkdir ')) return 'bash'
  if (lower.includes('select ') || lower.includes('from ') || lower.includes('where ') || lower.includes('insert ') || lower.includes('update ') || lower.includes('delete ')) return 'sql'
  if (lower.includes('import ') && (lower.includes('from ') || lower.includes('as '))) return 'python'
  return 'plaintext'
}

const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16V4h12"/></svg>'
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'

function highlightCodeBlocks(bubble) {
  bubble.querySelectorAll('pre code').forEach((block) => {
    try {
      hljs.highlightElement(block)
    } catch (e) {
      console.error('Error highlighting code block:', e, block)
      block.classList.add('hljs-error')
    }
  })
  bubble.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.copy-code-btn')) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'copy-code-btn'
    btn.innerHTML = COPY_ICON
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code')
      if (!code) return
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.innerHTML = CHECK_ICON
        setTimeout(() => { btn.innerHTML = COPY_ICON }, 2000)
      })
    })
    pre.style.position = 'relative'
    pre.appendChild(btn)
  })
}

function renderInline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

function addMessage(role, content) {
  const main = document.querySelector('.main')
  const chat = document.querySelector('.chat')
  main.classList.add('has-chat')

  const row = document.createElement('div')
  row.className = `chat-row ${role}`

  const bubble = document.createElement('div')
  bubble.className = `chat-bubble ${role}`
  if (content && content.trim()) {
    bubble.innerHTML = renderMarkdown(content)
  }
  highlightCodeBlocks(bubble)
  row.append(bubble)

  if (role === 'assistant') {
    const reactions = document.createElement('div')
    reactions.className = 'chat-reactions'
    reactions.innerHTML = `
      <button class="reaction-btn" data-reaction="refresh" aria-label="Refresh">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
      <button class="reaction-btn" data-reaction="copy" aria-label="Copy">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <button class="reaction-btn" data-reaction="like" aria-label="Like">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
      </button>
      <button class="reaction-btn" data-reaction="dislike" aria-label="Dislike">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 2.3l1.38 9a2 2 0 0 0 2 1.7zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
        </svg>
      </button>
    `
    row.append(reactions)
  }

  chat.append(row)
  if (isNearBottom(chat)) {
    chat.scrollTop = chat.scrollHeight
    document.querySelector('.scroll-bottom-btn')?.classList.remove('visible')
  }
  return bubble
}

function addTypingIndicator() {
  const main = document.querySelector('.main')
  const chat = document.querySelector('.chat')
  main.classList.add('has-chat')

  const row = document.createElement('div')
  row.className = 'chat-row assistant'

  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble assistant typing'
  bubble.innerHTML = '<svg class="md3-loader" viewBox="0 0 50 50" style="color: var(--text-dim);"><use href="#icon-15"></use></svg>'
  row.append(bubble)
  chat.append(row)
  if (isNearBottom(chat)) {
    chat.scrollTop = chat.scrollHeight
    document.querySelector('.scroll-bottom-btn')?.classList.remove('visible')
  }
  return bubble
}

function typewriterRender(bubble, text, done, thinkingEl) {
  if (!bubble.isConnected) {
    done?.()
    return
  }
  const caret = document.createElement('span')
  caret.className = 'type-caret'
  const chat = bubble.closest('.chat')
  const render = (txt) => {
    bubble.innerHTML = renderMarkdown(txt)
    if (thinkingEl) bubble.prepend(thinkingEl)
    bubble.prepend(caret)
    if (chat && isNearBottom(chat)) chat.scrollTop = chat.scrollHeight
  }
  const len = text.length
  let i = 0
  render('')
  const timer = setInterval(() => {
    if (!bubble.isConnected) {
      clearInterval(timer)
      caret.remove()
      return
    }
    i++
    if (i >= len) {
      clearInterval(timer)
      caret.remove()
      bubble.innerHTML = renderMarkdown(text)
      if (thinkingEl) bubble.prepend(thinkingEl)
      highlightCodeBlocks(bubble)
      if (chat && isNearBottom(chat)) chat.scrollTop = chat.scrollHeight
      done?.()
      return
    }
    render(text.slice(0, i))
  }, 18)
  return () => {
    clearInterval(timer)
    caret.remove()
    if (bubble.isConnected) {
      bubble.innerHTML = renderMarkdown(text)
      if (thinkingEl) bubble.prepend(thinkingEl)
      highlightCodeBlocks(bubble)
    }
  }
}

function compressImage(ext, data, maxDim = 1024, quality = 0.82) {
  if (ext === 'gif' || ext === 'svg') return Promise.resolve({ ext, data })
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h)
        const outExt = ext === 'png' || ext === 'webp' ? 'png' : 'jpeg'
        const out = canvas
          .toDataURL(outExt === 'png' ? 'image/png' : 'image/jpeg', outExt === 'png' ? undefined : quality)
          .split(',')[1]
        if (out) {
          resolve({ ext: outExt, data: out })
          return
        }
      }
      resolve({ ext, data })
    }
    img.onerror = () => resolve({ ext, data })
    img.src = `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${data}`
  })
}

const displayNames = {
  'mimo-v2.5-free': 'MiMo V2.5',
  'auto': 'Auto',
  'deepseek-v3': 'DeepSeek V3',
  'deepseek-r1': 'DeepSeek R1',
  'qwen-2.5-72b': 'Qwen 2.5 72B',
  'glm-4-9b': 'GLM-4 9B',
  'llama-3.3-70b': 'Llama 3.3 70B',
  'claude-3-7-sonnet': 'Claude 3.7 Sonnet',
  'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
  'claude-3-5-haiku': 'Claude 3.5 Haiku',
  'claude-3-opus': 'Claude 3 Opus',
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude': 'Claude',
  'grok-2': 'Grok 2',
  'grok-2-mini': 'Grok 2 Mini',
  'grok-4.5': 'Grok 4.5',
  'grok-4.3': 'Grok 4.3',
  'grok': 'Grok',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.0-flash-thinking': 'Gemini 2.0 Flash Thinking',
  'gemini-1.5-pro': 'Gemini 1.5 Pro',
  'gemini-1.5-flash': 'Gemini 1.5 Flash',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'gemini-3-flash': 'Gemini 3 Flash',
  'zai-glm-4': 'ZAI GLM-4',
  'zai-glm-4-flash': 'ZAI GLM-4 Flash'
}

const getDisplayName = (fullName) => displayNames[fullName] || fullName

async function loadModels() {
  const menu = document.querySelector('.model-menu')
  const options = document.querySelector('.model-options')
  const name = document.querySelector('.model-name')
  if (!menu || !options || !name) return
  const BLOCKED_MODELS = [
    'north-mini-code-free', 'nemotron-3-ultra-free', 'mimo-v2.5-free',
    'kimi-k2.7-code', 'minimax-m3', 'gpt-5.6-sol', 'gpt-5.6-terra',
    'gpt-5.6-luna', 'muse-spark-1.1', 'gemini-3.6-flash', 'gemini-3.5-flash-lite',
    'gemini-3.5-flash', 'gemini-3.1-pro', 'gemini-3-flash',
    'gemini-2.0-flash', 'gemini-2.0-flash-thinking', 'gemini-1.5-pro',
    'laguna-s-2.1-free', 'ling-3.0-flash-free', 'claude-opus-5', 'kimi-k3',
    'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
    'claude-opus-4-5', 'claude-opus-4-1', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'grok-4.5',
    'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini',
    'gpt-5.4-nano', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1',
    'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-5',
    'gpt-5-codex', 'gpt-5-nano', 'grok-build-0.1', 'deepseek-v4-pro',
    'deepseek-v4-flash', 'glm-5.2', 'glm-5.1', 'glm-5', 'minimax-m2.7',
    'minimax-m2.5', 'kimi-k2.6', 'kimi-k2.5', 'qwen3.6-plus', 'qwen3.5-plus',
    'big-pickle', 'deepseek-v4-flash-free', 'gemma4:26b', 'gemma4', 'ornith:latest'
  ]
  const customModels = [
    { fullName: 'auto', displayName: 'Auto' }
  ]
  if (opencodeApiKey || apiKey) {
    customModels.push(
      { fullName: 'deepseek-v3', displayName: 'DeepSeek V3' },
      { fullName: 'deepseek-r1', displayName: 'DeepSeek R1' },
      { fullName: 'qwen-2.5-72b', displayName: 'Qwen 2.5 72B' },
      { fullName: 'llama-3.3-70b', displayName: 'Llama 3.3 70B' }
    )
  }
  if (claudeApiKey) {
    customModels.push(
      { fullName: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet' },
      { fullName: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet' },
      { fullName: 'claude-3-5-haiku', displayName: 'Claude 3.5 Haiku' },
      { fullName: 'claude-3-opus', displayName: 'Claude 3 Opus' },
      { fullName: 'claude', displayName: 'Claude' }
    )
  }
  if (grokApiKey) {
    customModels.push(
      { fullName: 'grok-2', displayName: 'Grok 2' },
      { fullName: 'grok-2-mini', displayName: 'Grok 2 Mini' },
      { fullName: 'grok-4.3', displayName: 'Grok 4.3' },
      { fullName: 'grok', displayName: 'Grok' }
    )
  }
  if (zaiApiKey) {
    customModels.push(
      { fullName: 'zai-glm-4', displayName: 'ZAI GLM-4' },
      { fullName: 'zai-glm-4-flash', displayName: 'ZAI GLM-4 Flash' }
    )
  }
  let items = []
  try {
    const url = tagsUrl()
    if (url) {
      const data = await fetchJson(url, { headers: apiHeaders() })
      if (isOpenAI()) {
        items = (data.data || []).map((m) => {
          const fullName = m.id
          return { fullName, displayName: fullName }
        })
      } else {
        items = (data.models || []).map((m) => {
          const fullName = m.name.replace(/:cloud$/, '')
          return { fullName, displayName: fullName }
        })
      }
      items = items.filter((i) => !BLOCKED_MODELS.includes(i.fullName) && !BLOCKED_MODELS.includes(i.displayName))
    }
  } catch (err) {
  }
  items = [
    ...customModels,
    ...items.filter((i) => !customModels.some((cm) => cm.fullName === i.fullName || cm.displayName === i.displayName))
  ]
  items = items.map((i) => ({
    ...i,
    displayName: displayNames[i.fullName] || displayNames[i.displayName] || i.displayName
  }))
  if (items.length === 0) return

  const autoItems = items.filter((i) => i.fullName === 'auto')
  const modelItems = items.filter((i) => i.fullName !== 'auto')

  const renderFolder = (label, list) => {
    if (!list.length) return ''
    return `<div class="model-folder">
      ${label ? `<div class="model-folder-header">${label}</div>` : ''}
      ${list.map((item) => `<button type="button" class="model-option" data-model="${item.fullName}">${item.displayName}</button>`).join('')}
    </div>`
  }

  options.innerHTML =
    renderFolder('Auto', autoItems) +
    modelItems.map((item) => `<button type="button" class="model-option" data-model="${item.fullName}">${item.displayName}</button>`).join('')
  options.querySelectorAll('[data-model]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fullName = btn.dataset.model
      const displayName = getDisplayName(fullName)
      name.textContent = displayName
      name.dataset.fullModel = fullName
      settings.model = fullName
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      document.dispatchEvent(new CustomEvent('model-context-change', { detail: fullName }))
      menu.hidden = true
    })
  })
  const defaultItem =
    items.find((i) => i.fullName === settings.model || i.displayName === settings.model) ||
    items.find((i) => /-free$/.test(i.displayName)) ||
    items[0]
  name.textContent = defaultItem.displayName
  name.dataset.fullModel = defaultItem.fullName
  document.dispatchEvent(new CustomEvent('model-context-change', { detail: defaultItem.fullName }))
  const compInput = document.querySelector('.composer-input')
  if (compInput) compInput.setAttribute('placeholder', `Message ${defaultItem.displayName}`)
}

function showSettings() {
  const fv = document.querySelector('.feedback-view')
  if (fv) fv.hidden = true
  document.querySelector('.settings-view').hidden = false
  document.querySelector('.help-view').hidden = true
  document.querySelector('.release-notes-view').hidden = true
  document.querySelector('.welcome-text').hidden = true
  document.querySelector('.chat').hidden = true
  document.querySelector('.composer').hidden = true
  const sp = document.querySelector('.search-page')
  if (sp) sp.hidden = true
  document.querySelector('.main').classList.add('has-chat')
}

async function loadLocale(lang) {
  currentLang = lang
  settings.language = lang
  localStorage.setItem('cilamai-settings', JSON.stringify(settings))
  try {
    const res = await fetch(`${LANG_BASE}${lang}.json`)
    localeData = res.ok ? await res.json() : {}
  } catch {
    localeData = {}
  }
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')
    if (localeData[key]) el.textContent = localeData[key]
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder')
    if (localeData[key]) el.setAttribute('placeholder', localeData[key])
  })
  const langLabel = document.querySelector('#lang-select-label')
  if (langLabel && localeData.languages) langLabel.textContent = localeData.languages[lang] ?? lang
  const compInput = document.querySelector('.composer-input')
  if (compInput && localeData.placeholder) compInput.setAttribute('placeholder', localeData.placeholder)
  const searchInputEl = document.querySelector('.search-page-input')
  if (searchInputEl && localeData.searchPlaceholder) searchInputEl.setAttribute('placeholder', localeData.searchPlaceholder)
  const fontLabel = document.querySelector('#font-select-label')
  if (fontLabel) {
    const size = settings.fontSize || '14'
    const fontLabels = {
      13: localeData['fontSmall'] || 'Small (13px)',
      14: localeData['fontDefault'] || 'Default (14px)',
      15: localeData['fontLarge'] || 'Large (15px)',
      17: localeData['fontExtraLarge'] || 'Extra large (17px)'
    }
    fontLabel.textContent = fontLabels[size] || `${size}px`
  }
  document.querySelectorAll('.hotkey-row').forEach((row) => {
    const action = row.dataset.action
    const labelEl = row.querySelector('.hotkey-label')
    if (labelEl && action && HOTKEY_ACTIONS[action]) {
      const k = HOTKEY_ACTIONS[action].labelKey
      labelEl.textContent = localeData[k] || k
    }
    const input = row.querySelector('.hotkey-input')
    if (input && !input.classList.contains('recording') && input.classList.contains('empty')) {
      const emptyEl = input.querySelector('.hotkey-empty-text')
      if (emptyEl) emptyEl.textContent = localeData['hotkeyNotSet'] || 'Not set'
    }
  })
  if (window.electron?.setLanguage) window.electron.setLanguage(lang)
}

function showChat() {
  const fv = document.querySelector('.feedback-view')
  if (fv) fv.hidden = true
  document.querySelector('.settings-view').hidden = true
  document.querySelector('.help-view').hidden = true
  document.querySelector('.release-notes-view').hidden = true
  document.querySelector('.chat').hidden = false
  document.querySelector('.composer').hidden = false
  const sl = document.querySelector('.session-loading')
  if (sl) sl.hidden = true
  const sp = document.querySelector('.search-page')
  if (sp) sp.hidden = true
  const main = document.querySelector('.main')
  document.querySelector('.welcome-text').hidden = main.classList.contains('has-chat')
}

function showHelp() {
  const fv = document.querySelector('.feedback-view')
  if (fv) fv.hidden = true
  document.querySelector('.settings-view').hidden = true
  document.querySelector('.help-view').hidden = false
  document.querySelector('.release-notes-view').hidden = true
  document.querySelector('.chat').hidden = true
  document.querySelector('.composer').hidden = true
  document.querySelector('.welcome-text').hidden = true
  const sp = document.querySelector('.search-page')
  if (sp) sp.hidden = true
  document.querySelector('.main').classList.add('has-chat')
  const hv = document.querySelector('.help-view .help-version')
  if (hv && window.electron?.getAppVersion) {
    window.electron.getAppVersion().then((v) => {
      if (v) hv.textContent = `Version ${v}`
    })
  }
}

function showReleaseNotes() {
  const fv = document.querySelector('.feedback-view')
  if (fv) fv.hidden = true
  document.querySelector('.settings-view').hidden = true
  document.querySelector('.help-view').hidden = true
  const rn = document.querySelector('.release-notes-view')
  if (!rn) return
  rn.hidden = false
  rn.classList.add('loaded')
  const loading = rn.querySelector('.release-loading')
  if (loading) loading.hidden = true
  document.querySelector('.chat').hidden = true
  document.querySelector('.composer').hidden = true
  document.querySelector('.welcome-text').hidden = true
  const sp = document.querySelector('.search-page')
  if (sp) sp.hidden = true
  document.querySelector('.main').classList.add('has-chat')

  const activeItem = rn.querySelector('.release-date-item.active')
  const activeDate = activeItem?.dataset.date
  rn.querySelectorAll('.release-section').forEach((s) => {
    s.hidden = s.dataset.date !== activeDate
  })

  rn.querySelectorAll('.release-date-item').forEach((item) => {
    item.onclick = () => {
      rn.querySelectorAll('.release-date-item').forEach((d) => d.classList.remove('active'))
      item.classList.add('active')
      const date = item.dataset.date
      rn.querySelectorAll('.release-section').forEach((s) => {
        s.hidden = s.dataset.date !== date
      })
    }
  })
}

function showFeedback() {
  document.querySelector('.settings-view').hidden = true
  document.querySelector('.help-view').hidden = true
  document.querySelector('.release-notes-view').hidden = true
  document.querySelector('.chat').hidden = true
  document.querySelector('.composer').hidden = true
  document.querySelector('.welcome-text').hidden = true
  const sp = document.querySelector('.search-page')
  if (sp) sp.hidden = true
  document.querySelector('.main').classList.add('has-chat')
  const fv = document.querySelector('.feedback-view')
  if (fv) {
    fv.hidden = false
    setTimeout(() => {
      fv.querySelector('.feedback-textarea')?.focus()
    }, 50)
  }
}

function resetChat() {
  stopRecognition()
  if (messages.length) saveSession()
  currentSessionId = null
  clearTimeout(sessionLoadTimer)
  sessionLoadTimer = null
  sessionLoadTargetId = null
  messages.length = 0
  pendingImages.length = 0
  document.querySelector('.chat').innerHTML = ''
  document.querySelector('.main').classList.remove('has-chat')

  const input = document.querySelector('.composer-input')
  if (input) {
    input.value = ''
    input.disabled = false
  }
  const sendBtn = document.querySelector('.composer-btn.send')
  const stopBtn = document.querySelector('.composer-btn.stop')
  if (sendBtn) sendBtn.hidden = false
  updateSendBtnState()
  if (stopBtn) stopBtn.hidden = true
  const filesBox = document.querySelector('.composer-files')
  if (filesBox) {
    filesBox.innerHTML = ''
    filesBox.hidden = true
  }
  window.electron?.stopStream?.()

  const sInput = document.querySelector('.search-page-input')
  if (sInput) sInput.value = ''
  const sResults = document.querySelector('.search-page-results')
  if (sResults) sResults.innerHTML = ''
  const sCount = document.querySelector('.search-page-count')
  if (sCount) sCount.hidden = true
  const sEmpty = document.querySelector('.search-page-empty')
  if (sEmpty) sEmpty.hidden = true
  const sPage = document.querySelector('.search-page')
  if (sPage) sPage.hidden = true
  const sl = document.querySelector('.session-loading')
  if (sl) sl.hidden = true

  showChat()
}

function hideStartup() {
  const el = document.querySelector('.startup-loading')
  if (!el) return
  el.classList.add('fade-out')
  setTimeout(() => {
    el.hidden = true
  }, 300)
}

function startOnboarding() {
  const onboarding = document.querySelector('[data-onboarding]')
  if (!onboarding) return
  document.documentElement.classList.add('onboarding-active')
  const title = onboarding.querySelector('[data-onboarding-title]')
  const subtitle = onboarding.querySelector('[data-onboarding-subtitle]')
  const illustration = onboarding.querySelector('[data-onboarding-illustration]')
  const content = onboarding.querySelector('.onboarding-content')
  const next = onboarding.querySelector('[data-onboarding-next]')
  const back = onboarding.querySelector('[data-onboarding-back]')
  const dots = onboarding.querySelector('[data-onboarding-dots]')
  const steps = [
    ['Welcome to CilamAI', "A focused desktop workspace for chatting with AI. Let's get you set up in a few quick steps.", '<img src="https://file.garden/aPSLaf7myCkWreuK/Untitled_design__9_-removebg-preview.png" alt="CilamAI" />'],
    ['Choose your language', 'Select the language you want to use throughout the CilamAI interface. You can change this later from Settings.', '<svg viewBox="0 0 96 96"><circle cx="48" cy="48" r="27"/><path d="M21 48h54M48 21c8 8 12 17 12 27s-4 19-12 27c-8-8-12-17-12-27s4-19 12-27ZM27 31c12 6 30 6 42 0M27 65c12-6 30-6 42 0"/></svg>'],
    ['Pick a model', 'Choose the model that best fits your task. You can switch models at any time while working in a conversation.', '<svg viewBox="0 0 96 96"><path d="m48 19 27 15v28L48 77 21 62V34l27-15Z"/><path d="m21 34 27 15 27-15M48 49v28M36 27l27 15"/></svg>'],
    ['Customize your experience', 'Personalize CilamAI with your preferred theme, language, font size, startup behavior, and chat display options.', '<svg viewBox="0 0 96 96"><circle cx="48" cy="48" r="12"/><path d="M48 19v10M48 67v10M19 48h10M67 48h10M28 28l7 7M61 61l7 7M68 28l-7 7M35 61l-7 7"/><circle cx="48" cy="48" r="27"/></svg>'],
    ['You are ready', 'Start a new conversation, attach files or screenshots, search your sessions, and use the tools whenever you need them.', '<svg viewBox="0 0 96 96"><path d="M24 25h48v35H42L29 72V60h-5V25Z"/><path d="M35 42h26M35 50h17"/></svg>'],
    ['Enjoy CilamAI', 'Everything is ready. Click Finish to open your workspace and start getting useful answers from CilamAI.', '<svg viewBox="0 0 96 96"><path d="m48 18 7 20 21 1-16 13 5 21-17-12-17 12 5-21-16-13 21-1 7-20Z"/></svg>']
  ]
  let step = 0
  let changing = false
  const arrow = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
  const renderStep = () => {
    if (title) title.textContent = steps[step][0]
    if (subtitle) subtitle.textContent = steps[step][1]
    if (illustration) illustration.innerHTML = steps[step][2]
    if (back) back.hidden = step === 0
    if (next) next.innerHTML = step === steps.length - 1 ? `Finish ${arrow}` : step === 0 ? `Get Started ${arrow}` : `Next ${arrow}`
    dots?.querySelectorAll('.onboarding-dot').forEach((dot, index) => dot.classList.toggle('active', index === step))
  }
  if (illustration) illustration.innerHTML = steps[0][2]
  if (dots) {
    dots.innerHTML = steps.map((_, index) => `<span class="onboarding-dot${index === 0 ? ' active' : ''}"></span>`).join('')
  }
  renderStep()
  onboarding.hidden = false

  const onBackClick = () => {
    if (changing || step === 0) return
    changing = true
    step -= 1
    content?.classList.remove('step-changing')
    void content?.offsetWidth
    renderStep()
    content?.classList.add('step-changing')
    window.setTimeout(() => { changing = false }, 360)
  }

  const onNextClick = () => {
    if (changing) return
    step += 1
    if (step >= steps.length) {
      localStorage.setItem('cilamai-onboarding-complete', 'true')
      document.documentElement.classList.remove('onboarding-active')
      onboarding.hidden = true
      return
    }
    changing = true
    content?.classList.remove('step-changing')
    void content?.offsetWidth
    renderStep()
    content?.classList.add('step-changing')
    window.setTimeout(() => { changing = false }, 360)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowLeft' && !back?.hidden) {
      event.preventDefault()
      onBackClick()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onNextClick()
    }
  }

  back?.replaceWith(back.cloneNode(true))
  next?.replaceWith(next.cloneNode(true))
  const newBack = onboarding.querySelector('[data-onboarding-back]')
  const newNext = onboarding.querySelector('[data-onboarding-next]')
  const closeBtn = onboarding.querySelector('[data-onboarding-close]')
  newBack?.addEventListener('click', onBackClick)
  newNext?.addEventListener('click', onNextClick)
  closeBtn?.addEventListener('click', () => {
    localStorage.setItem('cilamai-onboarding-complete', 'true')
    document.documentElement.classList.remove('onboarding-active')
    onboarding.hidden = true
  })
  onboarding.onkeydown = onKeyDown
  onboarding.tabIndex = -1
  onboarding.focus()
}

async function init() {
  const onboarding = document.querySelector('[data-onboarding]')
  if (onboarding && localStorage.getItem('cilamai-onboarding-complete') !== 'true') {
    startOnboarding()
  }

  const input = document.querySelector('.composer-input')
  const form = document.querySelector('.composer')
  const modelMenu = document.querySelector('.model-menu')

  input?.addEventListener('input', updateSendBtnState)

  const pendingIpc = []
  window.electron?.onIpcTask?.((command) => {
    if (command) pendingIpc.push(command)
  })

  if (form && input) {
    const bottomBar = form.querySelector('.composer-bottom')
    const attachWrap = bottomBar?.querySelector('.attach-menu-wrap')
    const actions = bottomBar?.querySelector('.composer-actions')
    if (attachWrap && actions && bottomBar) {
      const inputRow = document.createElement('div')
      inputRow.className = 'composer-input-row'
      inputRow.append(attachWrap, input, actions)
      form.insertBefore(inputRow, bottomBar)
      bottomBar.remove()
    }
  }

  checkInternet()

  const sendBtn = document.querySelector('.composer-btn.send')
  const stopBtn = document.querySelector('.composer-btn.stop')
  if (input) input.disabled = false
  if (sendBtn) sendBtn.hidden = false
  updateSendBtnState()
  if (stopBtn) stopBtn.hidden = true
  const filesBox = document.querySelector('.composer-files')
  if (filesBox) {
    filesBox.innerHTML = ''
    filesBox.hidden = true
  }
  const sPage = document.querySelector('.search-page')
  if (sPage) sPage.hidden = true

  window.addEventListener('beforeunload', () => {
    if (messages.length) saveSession()
    window.electron?.flushCredits?.({ used: creditUsed, limit: creditLimit, resetAt: creditResetAt, spent: creditSpent })
    if (currentUser) window.electron?.setUserSync?.(currentUser)
  })

  const chat = document.querySelector('.chat')
  const scrollBtn = document.querySelector('.scroll-bottom-btn')
  if (chat && scrollBtn) {
    chat.addEventListener('scroll', () => {
      const atBottom = chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 200
      scrollBtn.classList.toggle('visible', !atBottom)
    })
    scrollBtn.addEventListener('click', () => {
      chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' })
    })
  }

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'settings') {
        showSettings()
      } else if (btn.dataset.view === 'feedback') {
        if (window.electron?.openFeedbackWindow) {
          window.electron.openFeedbackWindow()
        } else {
          showFeedback()
        }
      } else {
        if (btn.dataset.reset === 'true') resetChat()
        else showChat()
      }
    })
  })
  document.querySelectorAll('input[name="theme"]').forEach((radio) => {
    if (radio.value === theme) radio.checked = true
    radio.addEventListener('change', () => {
      if (!radio.checked) return
      theme = radio.value
      clearCustomColorsVars()
      settings.accentColor = null
      settings.bgColor = null
      settings.fgColor = null
      settings.customColorsActive = false
      applyCustomColors()
      applyTheme()
      settings.theme = radio.value
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
    })
  })

  function initDropdownToggle(btn, menu) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const wasOpen = menu.classList.contains('open')
      document.querySelectorAll('.lang-select-menu.open, .font-select-menu.open').forEach((m) => m.classList.remove('open'))
      if (!wasOpen) {
        menu.classList.add('open')
        const rect = btn.getBoundingClientRect()
        const menuHeight = menu.offsetHeight || 200
        const menuWidth = menu.offsetWidth || 180
        const openUp = rect.bottom + menuHeight > window.innerHeight - 8
        menu.classList.toggle('open-up', openUp)
        const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth))
        menu.style.left = `${left}px`
        if (openUp) {
          menu.style.top = 'auto'
          menu.style.bottom = `${window.innerHeight - rect.top + 6}px`
        } else {
          menu.style.top = `${rect.bottom + 6}px`
          menu.style.bottom = 'auto'
        }
      } else {
        menu.classList.remove('open')
      }
    })
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.lang-select-wrap') && !e.target.closest('.theme-preset-wrap')) menu.classList.remove('open')
    })
  }

  const themePresets = {
    GitHub: { accent: '#0969DA', bg: '#FFFFFF', fg: '#1F2328' },
    Dark: { accent: '#58a6ff', bg: '#0d1117', fg: '#e6edf3' },
    Midnight: { accent: '#7c72ff', bg: '#161b22', fg: '#c9d1d9' },
    Ocean: { accent: '#3bc9db', bg: '#0a1929', fg: '#d0e7ff' },
    Forest: { accent: '#3fb950', bg: '#0d1f12', fg: '#b4e6b4' },
    Sunset: { accent: '#f78166', bg: '#1c1210', fg: '#f0d9c8' }
  }
  const uiFonts = ['System default', 'Inter', 'Segoe UI', 'Roboto', 'JetBrains Mono', 'Fira Code', 'Cascadia Code']
  const fontWeights = ['Regular', 'Medium', 'Semi Bold', 'Bold']

  if (settings.uiFont === 'SF Pro' || (settings.uiFont && !uiFonts.includes(settings.uiFont))) {
    settings.uiFont = 'System default'
    localStorage.setItem('cilamai-settings', JSON.stringify(settings))
  }
  document.documentElement.style.setProperty('--ui-font', settings.uiFont && settings.uiFont !== 'System default' ? `'${settings.uiFont}', sans-serif` : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif')
  if (settings.fontWeight) {
    document.documentElement.style.setProperty('--ui-font-weight', settings.fontWeight.toLowerCase().replace(' ', ''))
  }

  function addChevronSvg(btn) {
    const existing = btn.querySelector('svg')
    if (existing) existing.remove()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '12')
    svg.setAttribute('height', '12')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2.5')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.innerHTML = '<polyline points="6 9 12 15 18 9"/>'
    btn.appendChild(svg)
  }

  function initAppearanceMenus() {
    const presetMenu = document.getElementById('theme-preset-menu')
    const presetBtn = document.getElementById('theme-preset-btn')
    if (presetMenu && presetBtn) {
      presetMenu.innerHTML = ''
      Object.keys(themePresets).forEach((name) => {
        const opt = document.createElement('button')
        opt.type = 'button'
        opt.className = 'lang-option'
        opt.textContent = name
        if (name === (settings.themePreset || 'GitHub')) opt.classList.add('selected')
        opt.addEventListener('click', () => {
          const preset = themePresets[name]
          if (!preset) return
          settings.themePreset = name
          settings.accentColor = preset.accent
          settings.bgColor = preset.bg
          settings.fgColor = preset.fg
          settings.customColorsActive = true
          localStorage.setItem('cilamai-settings', JSON.stringify(settings))
          applyCustomColors()
          presetBtn.textContent = name
          addChevronSvg(presetBtn)
          presetMenu.classList.remove('open')
          presetMenu.querySelectorAll('.lang-option').forEach((o) => o.classList.remove('selected'))
          opt.classList.add('selected')
        })
        presetMenu.appendChild(opt)
      })
      presetBtn.textContent = settings.themePreset || 'GitHub'
      addChevronSvg(presetBtn)
      initDropdownToggle(presetBtn, presetMenu)
    }

    const fontMenu = document.getElementById('theme-ui-font-menu')
    const fontBtn = document.getElementById('theme-ui-font-btn')
    if (fontMenu && fontBtn) {
      fontMenu.innerHTML = ''
      uiFonts.forEach((name) => {
        const opt = document.createElement('button')
        opt.type = 'button'
        opt.className = 'lang-option'
        opt.textContent = name
        if (name === (settings.uiFont || 'System default')) opt.classList.add('selected')
        opt.addEventListener('click', () => {
          settings.uiFont = name
          localStorage.setItem('cilamai-settings', JSON.stringify(settings))
          document.documentElement.style.setProperty('--ui-font', name === 'System default' ? 'system-ui, sans-serif' : `'${name}', sans-serif`)
          if (window.electron?.setUiFont) window.electron.setUiFont(name)
          fontBtn.textContent = name
          addChevronSvg(fontBtn)
          fontMenu.classList.remove('open')
          fontMenu.querySelectorAll('.lang-option').forEach((o) => o.classList.remove('selected'))
          opt.classList.add('selected')
        })
        fontMenu.appendChild(opt)
      })
      fontBtn.textContent = settings.uiFont || 'System default'
      addChevronSvg(fontBtn)
      initDropdownToggle(fontBtn, fontMenu)
    }

    const weightMenu = document.getElementById('theme-font-weight-menu')
    const weightBtn = document.getElementById('theme-font-weight-btn')
    if (weightMenu && weightBtn) {
      weightMenu.innerHTML = ''
      fontWeights.forEach((name) => {
        const opt = document.createElement('button')
        opt.type = 'button'
        opt.className = 'lang-option'
        opt.textContent = name
        if (name === (settings.fontWeight || 'Regular')) opt.classList.add('selected')
        opt.addEventListener('click', () => {
          settings.fontWeight = name
          localStorage.setItem('cilamai-settings', JSON.stringify(settings))
          document.documentElement.style.setProperty('--ui-font-weight', name.toLowerCase().replace(' ', ''))
          weightBtn.textContent = name
          addChevronSvg(weightBtn)
          weightMenu.classList.remove('open')
          weightMenu.querySelectorAll('.lang-option').forEach((o) => o.classList.remove('selected'))
          opt.classList.add('selected')
        })
        weightMenu.appendChild(opt)
      })
      weightBtn.textContent = settings.fontWeight || 'Regular'
      addChevronSvg(weightBtn)
      initDropdownToggle(weightBtn, weightMenu)
    }
  }

  function applyCustomColors() {
    const accentInput = document.getElementById('theme-accent-color')
    const bgInput = document.getElementById('theme-bg-color')
    const fgInput = document.getElementById('theme-fg-color')
    const accentHex = document.getElementById('theme-accent-hex')
    const bgHex = document.getElementById('theme-bg-hex')
    const fgHex = document.getElementById('theme-fg-hex')
    const accent = settings.accentColor || '#0969DA'
    const bg = settings.bgColor || '#FFFFFF'
    const fg = settings.fgColor || '#1F2328'
    if (accentInput) accentInput.value = accent
    if (bgInput) bgInput.value = bg
    if (fgInput) fgInput.value = fg
    if (accentHex) accentHex.textContent = accent
    if (bgHex) bgHex.textContent = bg
    if (fgHex) fgHex.textContent = fg
    if (settings.customColorsActive) applyCustomColorsVars()
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!m) return null
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')
  }

  function isColorDark(hex) {
    const c = hexToRgb(hex)
    if (!c) return false
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 < 0.5
  }

  function lighten(hex, amt) {
    const c = hexToRgb(hex)
    if (!c) return hex
    return rgbToHex(c.r + (255 - c.r) * amt, c.g + (255 - c.g) * amt, c.b + (255 - c.b) * amt)
  }

  function darken(hex, amt) {
    const c = hexToRgb(hex)
    if (!c) return hex
    return rgbToHex(c.r * (1 - amt), c.g * (1 - amt), c.b * (1 - amt))
  }

  function applyCustomColorsVars() {
    const accent = settings.accentColor || '#0969DA'
    const bg = settings.bgColor || '#FFFFFF'
    const fg = settings.fgColor || '#1F2328'
    const root = document.documentElement
    const dark = isColorDark(bg)
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--bg', bg)
    root.style.setProperty('--text', fg)
    root.style.setProperty('--surface', dark ? lighten(bg, 0.08) : darken(bg, 0.03))
    root.style.setProperty('--surface-2', dark ? lighten(bg, 0.14) : darken(bg, 0.06))
    root.style.setProperty('--border', dark ? lighten(bg, 0.22) : darken(bg, 0.1))
    root.style.setProperty('--hover', dark ? lighten(bg, 0.18) : darken(bg, 0.08))
    root.style.setProperty('--text-dim', dark ? lighten(fg, 0.45) : darken(fg, 0.4))
    root.style.setProperty('--border-focus', accent)
    root.style.setProperty('--accent-text', isColorDark(accent) ? '#fff' : '#000')
    root.style.setProperty('--bubble-user', dark ? lighten(bg, 0.16) : darken(bg, 0.07))
    root.style.setProperty('--scrollbar-thumb', dark ? lighten(bg, 0.3) : darken(bg, 0.15))
    window.electron?.setCustomColors?.({ accent, bg, fg })
  }

  function clearCustomColorsVars() {
    const root = document.documentElement
    const vars = ['--accent', '--bg', '--text', '--surface', '--surface-2', '--border', '--hover', '--text-dim', '--border-focus', '--accent-text', '--bubble-user', '--scrollbar-thumb']
    vars.forEach((v) => root.style.removeProperty(v))
    window.electron?.setCustomColors?.({ accent: null, bg: null, fg: null })
  }

  function initAppearanceColorInputs() {
    const accentInput = document.getElementById('theme-accent-color')
    const bgInput = document.getElementById('theme-bg-color')
    const fgInput = document.getElementById('theme-fg-color')
    const accentHex = document.getElementById('theme-accent-hex')
    const bgHex = document.getElementById('theme-bg-hex')
    const fgHex = document.getElementById('theme-fg-hex')

    function handleAccent(e) {
      settings.accentColor = e.target.value
      settings.customColorsActive = true
      if (accentHex) accentHex.textContent = e.target.value
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      applyCustomColorsVars()
    }
    function handleBg(e) {
      settings.bgColor = e.target.value
      settings.customColorsActive = true
      if (bgHex) bgHex.textContent = e.target.value
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      applyCustomColorsVars()
    }
    function handleFg(e) {
      settings.fgColor = e.target.value
      settings.customColorsActive = true
      if (fgHex) fgHex.textContent = e.target.value
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      applyCustomColorsVars()
    }

    if (accentInput) accentInput.addEventListener('input', handleAccent)
    if (bgInput) bgInput.addEventListener('input', handleBg)
    if (fgInput) fgInput.addEventListener('input', handleFg)
    applyCustomColors()
  }

  initAppearanceMenus()
  initAppearanceColorInputs()

  const importBtn = document.getElementById('theme-import-btn')
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.addEventListener('change', (e) => {
        const file = e.target.files[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
          try {
            const imported = JSON.parse(ev.target.result)
            if (imported.accentColor) settings.accentColor = imported.accentColor
            if (imported.bgColor) settings.bgColor = imported.bgColor
            if (imported.fgColor) settings.fgColor = imported.fgColor
            if (imported.uiFont) settings.uiFont = imported.uiFont
            if (imported.fontWeight) settings.fontWeight = imported.fontWeight
            if (imported.themePreset) settings.themePreset = imported.themePreset
            settings.customColorsActive = true
            localStorage.setItem('cilamai-settings', JSON.stringify(settings))
            applyCustomColors()
            initAppearanceMenus()
            window.electron?.showNotification?.('Theme imported successfully', 'success')
          } catch { window.electron?.showNotification?.('Invalid theme file', 'error') }
        }
        reader.readAsText(file)
      })
      input.click()
    })
  }

  const copyBtn = document.getElementById('theme-copy-btn')
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const data = JSON.stringify({
        accentColor: settings.accentColor,
        bgColor: settings.bgColor,
        fgColor: settings.fgColor,
        uiFont: settings.uiFont,
        fontWeight: settings.fontWeight,
        themePreset: settings.themePreset
      }, null, 2)
      navigator.clipboard.writeText(data).then(() => {
        window.electron?.showNotification?.('Theme copied to clipboard', 'success')
      }).catch(() => {
        window.electron?.showNotification?.('Failed to copy theme', 'error')
      })
    })
  }

  document.querySelectorAll('input[name="provider"]').forEach((radio) => {
    if (radio.value === provider) radio.checked = true
    radio.addEventListener('change', () => {
      if (!radio.checked) return
      provider = radio.value
      settings.provider = provider
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      loadModels()
    })
  })

  const urlInput = document.querySelector('#api-url')
  if (urlInput) {
    urlInput.value = isOpenAI() ? openaiUrl : baseUrl
    urlInput.addEventListener('change', () => {
      const value = urlInput.value.trim()
      if (!value) return
      if (isOpenAI()) {
        openaiUrl = value
        settings.openaiUrl = value
      } else {
        baseUrl = value
        settings.url = value
      }
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      loadModels()
    })
  }

  const keyInput = document.querySelector('#api-key')
  if (keyInput) {
    keyInput.value = apiKey
    keyInput.addEventListener('change', () => {
      apiKey = keyInput.value.trim()
      settings.apiKey = apiKey
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
    })
  }

  const orgInput = document.querySelector('#org-id')
  if (orgInput) {
    orgInput.value = orgId
    orgInput.addEventListener('change', () => {
      orgId = orgInput.value.trim()
      settings.orgId = orgId
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
    })
  }

  document.querySelector('#refresh-models')?.addEventListener('click', async () => {
    await loadModels()
    showNotification(tf('modelsRefreshed', 'Models refreshed'), 'warning')
  })

  const fontToggle = document.querySelector('#font-select-toggle')
  const fontMenu = document.querySelector('.font-select-menu')
  const fontLabel = document.querySelector('#font-select-label')
  const fontLabelFallbacks = {
    13: 'Small (13px)',
    14: 'Default (14px)',
    15: 'Large (15px)',
    17: 'Extra large (17px)'
  }
  const getFontLabels = () => ({
    13: localeData['fontSmall'] || fontLabelFallbacks[13],
    14: localeData['fontDefault'] || fontLabelFallbacks[14],
    15: localeData['fontLarge'] || fontLabelFallbacks[15],
    17: localeData['fontExtraLarge'] || fontLabelFallbacks[17]
  })
  if (fontToggle && fontMenu) {
    const applyFont = (size) => {
      document.documentElement.style.setProperty('--chat-font-size', `${size}px`)
      if (fontLabel) {
        const labels = getFontLabels()
        fontLabel.textContent = labels[size] || `${size}px`
      }
    }
    fontToggle.addEventListener('click', (e) => {
      e.stopPropagation()
      fontMenu.hidden = !fontMenu.hidden
      if (!fontMenu.hidden) {
        const rect = fontToggle.getBoundingClientRect()
        const menuHeight = fontMenu.offsetHeight
        const openUp = rect.bottom + menuHeight > window.innerHeight - 8
        fontMenu.classList.toggle('open-up', openUp)
        if (openUp) {
          fontMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - fontMenu.offsetWidth - 8, rect.right - fontMenu.offsetWidth))}px`
          fontMenu.style.top = 'auto'
          fontMenu.style.bottom = `${window.innerHeight - rect.top + 6}px`
        } else {
          fontMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - fontMenu.offsetWidth - 8, rect.right - fontMenu.offsetWidth))}px`
          fontMenu.style.top = `${rect.bottom + 6}px`
          fontMenu.style.bottom = 'auto'
        }
      }
    })
    fontMenu.querySelectorAll('.font-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        const size = opt.dataset.fontSize
        settings.fontSize = size
        localStorage.setItem('cilamai-settings', JSON.stringify(settings))
        applyFont(size)
        fontMenu.hidden = true
      })
    })
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.font-select')) fontMenu.hidden = true
    })
    applyFont(settings.fontSize || '14')
  }

  const langToggle = document.querySelector('#lang-select-toggle')
  const langMenu = document.querySelector('.lang-select-menu')
  if (langToggle && langMenu) {
    langToggle.addEventListener('click', (e) => {
      e.stopPropagation()
      langMenu.hidden = !langMenu.hidden
      if (!langMenu.hidden) {
        const rect = langToggle.getBoundingClientRect()
        const menuHeight = langMenu.offsetHeight
        const openUp = rect.bottom + menuHeight > window.innerHeight - 8
        langMenu.classList.toggle('open-up', openUp)
        if (openUp) {
          langMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - langMenu.offsetWidth - 8, rect.right - langMenu.offsetWidth))}px`
          langMenu.style.top = 'auto'
          langMenu.style.bottom = `${window.innerHeight - rect.top + 6}px`
        } else {
          langMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - langMenu.offsetWidth - 8, rect.right - langMenu.offsetWidth))}px`
          langMenu.style.top = `${rect.bottom + 6}px`
          langMenu.style.bottom = 'auto'
        }
      }
    })
    langMenu.querySelectorAll('.lang-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        loadLocale(opt.dataset.lang)
        langMenu.hidden = true
      })
    })
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.lang-select')) langMenu.hidden = true
    })
  }

  if (currentLang) loadLocale(currentLang)

  if (window.electron?.onLanguageChange) {
    window.electron.onLanguageChange((payload) => {
      if (payload && payload.lang && payload.data) {
        localeData = payload.data
        document.querySelectorAll('[data-i18n]').forEach((el) => {
          const key = el.getAttribute('data-i18n')
          if (localeData[key]) el.textContent = localeData[key]
        })
        const langLabel = document.querySelector('#lang-select-label')
        if (langLabel && localeData.languages) langLabel.textContent = localeData.languages[payload.lang] ?? payload.lang
        const compInput = document.querySelector('.composer-input')
        if (compInput && localeData.placeholder) compInput.setAttribute('placeholder', localeData.placeholder)
        const searchInputEl = document.querySelector('.search-page-input')
        if (searchInputEl && localeData.searchPlaceholder) searchInputEl.setAttribute('placeholder', localeData.searchPlaceholder)
        const fontLabel = document.querySelector('#font-select-label')
        if (fontLabel) {
          const size = settings.fontSize || '14'
          const labels = {
            13: payload.data['fontSmall'] || 'Small (13px)',
            14: payload.data['fontDefault'] || 'Default (14px)',
            15: payload.data['fontLarge'] || 'Large (15px)',
            17: payload.data['fontExtraLarge'] || 'Extra large (17px)'
          }
          fontLabel.textContent = labels[size] || `${size}px`
        }
        document.querySelectorAll('.hotkey-row').forEach((row) => {
          const action = row.dataset.action
          const labelEl = row.querySelector('.hotkey-label')
          if (labelEl && action && HOTKEY_ACTIONS[action]) {
            const k = HOTKEY_ACTIONS[action].labelKey
            labelEl.textContent = payload.data[k] || k
          }
          const input = row.querySelector('.hotkey-input')
          if (input && !input.classList.contains('recording') && input.classList.contains('empty')) {
            input.textContent = payload.data['hotkeyNotSet'] || 'Not set'
          }
        })
      }
    })
  }

  const launchCheck = document.querySelector('#startup-launch')
  if (launchCheck) {
    window.electron?.getStartup?.().then((r) => {
      if (r?.ok) launchCheck.checked = r.enabled
    })
    launchCheck.addEventListener('change', async () => {
      const r = await window.electron?.setStartup?.(launchCheck.checked)
      if (r && !r.ok) showError(`Startup failed: ${r.error}`)
    })
  }

  const shimmerCheck = document.querySelector('#shimmer-effect')
  if (shimmerCheck) {
    if (settings.shimmerEffect === undefined) settings.shimmerEffect = true
    shimmerCheck.checked = settings.shimmerEffect
    if (settings.shimmerEffect) document.body.classList.add('shimmer-enabled')
    else document.body.classList.remove('shimmer-enabled')

    shimmerCheck.addEventListener('change', () => {
      settings.shimmerEffect = shimmerCheck.checked
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      if (settings.shimmerEffect) document.body.classList.add('shimmer-enabled')
      else document.body.classList.remove('shimmer-enabled')
    })
  }

  document.querySelectorAll('.setting-segmented').forEach((group) => {
    const key = group.querySelector('.segmented-btn')?.dataset.segmented
    if (key) {
      const saved = settings[key]
      if (saved) {
        group.querySelectorAll('.segmented-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.value === saved)
        })
      }
    }
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.segmented-btn')
      if (!btn) return
      group.querySelectorAll('.segmented-btn').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      const prefKey = btn.dataset.segmented
      if (prefKey) {
        settings[prefKey] = btn.dataset.value
        localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      }
    })
  })

  const prefPointerCursors = document.querySelector('#pref-pointer-cursors')
  if (prefPointerCursors) {
    prefPointerCursors.checked = settings.pointerCursors !== false
    if (settings.pointerCursors !== false) document.body.classList.add('pointer-cursors')
    prefPointerCursors.addEventListener('change', () => {
      settings.pointerCursors = prefPointerCursors.checked
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      document.body.classList.toggle('pointer-cursors', prefPointerCursors.checked)
    })
  }

  const prefUiFontSize = document.querySelector('#pref-ui-font-size')
  if (prefUiFontSize) {
    if (settings.uiFontSize) prefUiFontSize.value = settings.uiFontSize
    prefUiFontSize.addEventListener('change', () => {
      settings.uiFontSize = prefUiFontSize.value
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      document.documentElement.style.setProperty('--ui-font-scale', `${prefUiFontSize.value / 16}`)
    })
  }

  const selectModel = (fullName) => {
    const name = document.querySelector('.model-name')
    if (!name) return
    const displayName = getDisplayName(fullName)
    name.textContent = displayName
    name.dataset.fullModel = fullName
    settings.model = fullName
    localStorage.setItem('cilamai-settings', JSON.stringify(settings))
    const compInput = document.querySelector('.composer-input')
    if (compInput) compInput.setAttribute('placeholder', `Message ${displayName}`)
    showNotification(`Model set to ${displayName}`, 'info')
  }

  const syncModelSubmenu = () => {
    const sub = document.querySelector('.tb-submenu-menu')
    if (!sub) return
    const current = document.querySelector('.model-name')?.dataset.fullModel
    sub.innerHTML = ''
    document.querySelectorAll('.model-option').forEach((opt) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = getDisplayName(opt.dataset.model)
      btn.className = 'tb-submenu-option'
      if (opt.dataset.model === current) btn.classList.add('selected')
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        selectModel(opt.dataset.model)
        document.querySelectorAll('.tb-menu-item').forEach((i) => i.classList.remove('open'))
        showChat()
      })
      sub.append(btn)
    })
  }

  document.querySelectorAll('.tb-menu-item').forEach((item) => {
    const toggle = item.querySelector(':scope > span')
    const close = () => item.classList.remove('open')
    toggle?.addEventListener('click', (e) => {
      e.stopPropagation()
      document.querySelectorAll('.tb-menu-item').forEach((i) => i !== item && i.classList.remove('open'))
      item.classList.toggle('open')
      if (item.classList.contains('open')) syncModelSubmenu()
    })
    item.querySelector('.tb-submenu-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      item.querySelector('.tb-submenu')?.classList.toggle('sub-open')
    })
    item.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action
        if (action === 'welcome') startOnboarding()
        if (action === 'new-chat') resetChat()
        if (action === 'settings') showSettings()
        if (action === 'help') showHelp()
        if (action === 'release-notes') showReleaseNotes()
        if (action === 'check-updates') {
          window.electron?.checkUpdates?.().then((result) => {
            if (!result?.ok) throw new Error(result?.error || 'Update check failed')
            if (result.latest && result.latest !== result.current) {
              const fileUrl = result.downloadUrl || result.url
              showNotification(`Downloading CilamAI v${result.latest}...`, 'info')
              window.electron?.downloadAndInstall?.(fileUrl).then(() => {
                showNotification('Installing update...', 'info')
              }).catch(e => {
                showNotification(`Download failed: ${e.message}`, 'error')
              })
              return
            }
            showNotification(`You're up to date (v${result.current}).`, 'info')
          }).catch((err) => showNotification(err.message || 'Unable to check for updates.', 'error'))
        }
        if (action === 'feedback') {
          if (window.electron?.openFeedbackWindow) {
            window.electron.openFeedbackWindow()
          } else {
            showFeedback()
          }
        }
        if (action === 'search') openSearchPage()
        if (action === 'close') window.electron?.closeWindow?.()
        if (action === 'refresh-models') loadModels()
        if (action === 'clear-chat') resetChat()
        if (action === 'minimize') window.electron?.minimize?.()
        if (action === 'maximize') window.electron?.maximize?.()
        if (action === 'restore') window.electron?.toggleMaximize?.()
        if (action === 'model') {
          showChat()
          document.querySelector('[data-model-toggle]')?.click()
        }
        if (action === 'upload') document.querySelector('[data-upload]')?.click()
        if (action === 'screenshot') document.querySelector('[data-screenshot]')?.click()
        close()
      })
    })
  })
  document.addEventListener('click', () => {
    document.querySelectorAll('.tb-menu-item').forEach((i) => i.classList.remove('open'))
  })

  window.electron?.onNewChatTask?.(resetChat)
  window.electron?.onShowSettingsTask?.(showSettings)
  window.electron?.onShowModelMenuTask?.(() => {
    showChat()
    document.querySelector('[data-model-toggle]')?.click()
  })
  window.electron?.onShowReleaseNotesTask?.(showReleaseNotes)
  const saveApiKey = (rawKey, providerHint = '') => {
    let raw = (rawKey || '').trim()
    let prov = (providerHint || '').trim().toLowerCase()

    if (!prov && raw.includes(':') && !raw.startsWith('sk-') && !raw.startsWith('AIza')) {
      const idx = raw.indexOf(':')
      const p = raw.slice(0, idx).toLowerCase()
      if (['gemini', 'claude', 'grok', 'opencode', 'openai', 'zai'].includes(p)) {
        prov = p
        raw = raw.slice(idx + 1).trim()
      }
    } else if (!prov && raw.includes('=') && !raw.startsWith('sk-') && !raw.startsWith('AIza')) {
      const idx = raw.indexOf('=')
      const p = raw.slice(0, idx).toLowerCase()
      if (['gemini', 'claude', 'grok', 'opencode', 'openai', 'zai'].includes(p)) {
        prov = p
        raw = raw.slice(idx + 1).trim()
      }
    }

    if (prov === 'claude' || prov.includes('claude') || raw.startsWith('sk-ant-')) {
      claudeApiKey = raw
      settings.claudeApiKey = raw
    } else if (prov === 'grok' || prov.includes('grok') || raw.startsWith('xai-')) {
      grokApiKey = raw
      settings.grokApiKey = raw
    } else if (prov === 'zai' || prov.includes('zai')) {
      zaiApiKey = raw
      settings.zaiApiKey = raw
    } else if (prov === 'opencode' || prov === 'openai' || raw.startsWith('sk-')) {
      opencodeApiKey = raw
      settings.opencodeApiKey = raw
      apiKey = raw
      settings.apiKey = raw
    } else {
      apiKey = raw
      settings.apiKey = raw
      const curModel = (settings.model || '').toLowerCase()
      if (curModel.includes('claude')) {
        claudeApiKey = raw
        settings.claudeApiKey = raw
      } else if (curModel.includes('grok')) {
        grokApiKey = raw
        settings.grokApiKey = raw
      } else if (curModel.includes('zai')) {
        zaiApiKey = raw
        settings.zaiApiKey = raw
      }
    }

    localStorage.setItem('cilamai-settings', JSON.stringify(settings))
    const keyInput = document.querySelector('#api-key')
    if (keyInput) keyInput.value = apiKey
    const opencodeInput = document.getElementById('opencode-api-key')
    if (opencodeInput && opencodeApiKey) opencodeInput.value = opencodeApiKey
    const claudeInput = document.getElementById('claude-api-key')
    if (claudeInput && claudeApiKey) claudeInput.value = claudeApiKey
    const grokInput = document.getElementById('grok-api-key')
    if (grokInput && grokApiKey) grokInput.value = grokApiKey
    const zaiInput = document.getElementById('zai-api-key')
    if (zaiInput && zaiApiKey) zaiInput.value = zaiApiKey
    showNotification(raw ? 'API Keys saved successfully' : 'API key cleared', 'info')
    loadModels()
  }
  window.electron?.onSetApiKeyTask?.((key) => saveApiKey(key))
  window.electron?.getPendingApiKey?.().then((res) => {
    if (res?.key) saveApiKey(res.key)
  })
  window.electron?.getEnvConfig?.().then((cfg) => {
    let changed = false
    if (cfg?.opencodeApiKey && !opencodeApiKey) {
      opencodeApiKey = cfg.opencodeApiKey
      settings.opencodeApiKey = opencodeApiKey
      if (!apiKey) {
        apiKey = opencodeApiKey
        settings.apiKey = apiKey
      }
      changed = true
    }
    if (cfg?.claudeApiKey && !claudeApiKey) {
      claudeApiKey = cfg.claudeApiKey
      settings.claudeApiKey = claudeApiKey
      changed = true
    }
    if (cfg?.grokApiKey && !grokApiKey) {
      grokApiKey = cfg.grokApiKey
      settings.grokApiKey = grokApiKey
      changed = true
    }
    if (cfg?.zaiApiKey && !zaiApiKey) {
      zaiApiKey = cfg.zaiApiKey
      settings.zaiApiKey = zaiApiKey
      changed = true
    }
    if (changed) {
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      loadModels()
    }
  })
  const runIpcCommand = (command) => {
    if (!command) return
    const [name, ...args] = command.split(':')
    const cmds = {
      'new-chat': () => resetChat(),
      'settings': () => showSettings(),
      'search': () => {
        const toggle = document.querySelector('[data-search-toggle]')
        if (toggle) toggle.click()
      },
      'api-key': () => saveApiKey(args.join(':')),
      'apikey': () => saveApiKey(args.join(':')),
      'set-apikey': () => saveApiKey(args.join(':')),
      'claude-api-key': () => saveApiKey(args.join(':'), 'claude'),
      'claude-apikey': () => saveApiKey(args.join(':'), 'claude'),
      'grok-api-key': () => saveApiKey(args.join(':'), 'grok'),
      'grok-apikey': () => saveApiKey(args.join(':'), 'grok'),
      'opencode-api-key': () => saveApiKey(args.join(':'), 'opencode'),
      'opencode-apikey': () => saveApiKey(args.join(':'), 'opencode'),
      'load-model': () => loadModels(),
      'load-models': () => loadModels(),
      'refresh-models': () => loadModels(),
      'models': () => {
        showChat()
        document.querySelector('[data-model-toggle]')?.click()
      },
      'model': async () => {
        showChat()
        if (args[0]) {
          const target = args[0]
          if (args[1]) {
            saveApiKey(args.slice(1).join(':'), target)
          }
          settings.model = target
          localStorage.setItem('cilamai-settings', JSON.stringify(settings))
          await loadModels()
          const opt = document.querySelector(`.model-option[data-model="${target}"]`)
          if (opt) {
            opt.click()
            return
          }
          const nameEl = document.querySelector('.model-name')
          if (nameEl) {
            const dispName = getDisplayName(target)
            nameEl.textContent = dispName
            nameEl.dataset.fullModel = target
            document.dispatchEvent(new CustomEvent('model-context-change', { detail: target }))
            const compInput = document.querySelector('.composer-input')
            if (compInput) compInput.setAttribute('placeholder', `Message ${dispName}`)
          }
          return
        }
        document.querySelector('[data-model-toggle]')?.click()
      },
      'clear-chat': () => resetChat(),
      'credits': () => {
        const limit = parseInt(args[0], 10)
        const used = parseInt(args[1], 10)
        creditLimit = Number.isFinite(limit) && limit > 0 ? limit : 100
        creditUsed = Number.isFinite(used) && used >= 0 ? Math.min(used, creditLimit) : Math.min(creditUsed, creditLimit)
        creditResetAt = Date.now() + RESET_INTERVAL
        ipcCreditsApplied = true
        saveCreditState()
        renderCreditMenu()
        if (limitedBanner) limitedBanner.hidden = true
        showNotification(`${tf('credits', 'Credits')}: ${creditUsed}/${creditLimit}`, 'warning')
      },
      'speed': () => {
        const value = parseInt(args[0], 10)
        creditSpeed = Number.isFinite(value) && value > 0 ? value : 2
        renderCreditMenu()
        showNotification(`Speed: ${creditSpeed}x`, 'warning')
      },
      'spent': () => {
        const value = parseInt(args[0], 10)
        creditSpent = Number.isFinite(value) && value >= 0 ? value : creditSpent
        ipcCreditsApplied = true
        saveCreditState()
        renderCreditMenu()
      },
      'screenshot': () => {
        const cap = document.querySelector('[data-action="capture"]')
        if (cap) cap.click()
      },
      'thinking': () => {
        const mode = args[0]
        if (mode === 'on') showThinking = true
        else if (mode === 'off') showThinking = false
        else if (mode === 'toggle' || !mode) showThinking = !showThinking
        settings.showThinking = showThinking
        localStorage.setItem('cilamai-settings', JSON.stringify(settings))
        showNotification(showThinking ? 'Thinking shown' : 'Thinking hidden', 'warning')
      },
      'thought': () => {
        const mode = args[0]
        if (mode === 'on') showThinking = true
        else if (mode === 'off') showThinking = false
        else if (mode === 'toggle' || !mode) showThinking = !showThinking
        settings.showThinking = showThinking
        localStorage.setItem('cilamai-settings', JSON.stringify(settings))
        showNotification(showThinking ? 'Thinking shown' : 'Thinking hidden', 'warning')
      },
      'context-window-boost': () => {
        const mode = args[0]
        const enabled = mode === 'on' || mode === 'enable'
        window.electron?.contextWindowBoost?.(enabled).then((res) => {
          if (res?.ok) {
            contextWindowBoostEnabled = res.enabled
            const multiplier = res.speedMultiplier || 1
            showNotification(`${res.message}`, 'info')
          }
        }).catch(() => {
          showNotification('Context Window Boost unavailable', 'error')
        })
      },
      'context-window': () => {
        const value = args[0]
        if (value) {
          const model = args[1]
          if (model) window.electron?.getContextWindowInfo?.(model)
          const contextEl = document.querySelector('[data-context-count]')
          if (contextEl) contextEl.textContent = value
        }
      },
      'context-window-info': () => {
        const used = args[0] || '0'
        const model = args[2]
        if (model) window.electron?.getContextWindowInfo?.(model)
        const contextEl = document.querySelector('[data-context-count]')
        if (contextEl) contextEl.textContent = `${used}`
      },
      'reserved': () => {
        const value = args[0] || 'Reserved for response'
        const reservedEl = document.querySelector('[data-context-reserved]')
        if (reservedEl) reservedEl.textContent = value
        showNotification(`Reserved: ${value}`, 'info')
      },
      'loading': () => {
        const mode = args[0]
        const form = document.querySelector('.composer')
        const sendBtn = document.querySelector('.composer-btn.send')
        const stopBtn = document.querySelector('.composer-btn.stop')
        const input = document.querySelector('.composer-input')
        const isOn = mode === 'on' || mode === 'start'
        const isOff = mode === 'off' || mode === 'stop'
        const active = isOn ? true : isOff ? false : form?.classList.contains('loading') !== true
        form?.classList.toggle('loading', active)
        if (sendBtn) sendBtn.hidden = active
        if (stopBtn) stopBtn.hidden = !active
        if (input) input.disabled = active
        renderCreditMenu()
      },
      'signin': () => {
        window.electron?.signIn?.('google')
      },
      'user': () => {
        const val = args.join(':')
        let name = ''
        let email = ''
        let picture = null
        if (val.includes(':')) {
          const parts = val.split(':')
          name = parts[0] || ''
          email = parts[1] || ''
          picture = parts.slice(2).join(':') || null
        } else if (val.includes('@')) {
          email = val
          name = val.split('@')[0]
        } else {
          name = val
        }
        picture = picture || (currentUser?.picture || null)
        currentUser = { name, email, picture, provider: 'ipc' }
        localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
        window.electron?.setUser?.(currentUser)
        updateUserUI()
        loadCredits()
        showNotification(`User updated: ${name || email}`, 'info')
      },
      'username': () => {
        const name = args.join(' ')
        if (!currentUser) {
          currentUser = { name, email: '', picture: null, provider: 'ipc' }
        } else {
          currentUser.name = name
        }
        localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
        window.electron?.setUser?.(currentUser)
        updateUserUI()
        loadCredits()
        showNotification(`Username set to: ${name}`, 'info')
      },
      'name': () => {
        const name = args.join(' ')
        if (!currentUser) {
          currentUser = { name, email: '', picture: null, provider: 'ipc' }
        } else {
          currentUser.name = name
        }
        localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
        window.electron?.setUser?.(currentUser)
        updateUserUI()
        loadCredits()
        showNotification(`Name set to: ${name}`, 'info')
      },
      'email': () => {
        const email = args[0] || ''
        if (!currentUser) {
          currentUser = { name: email.split('@')[0] || '', email, picture: null, provider: 'ipc' }
        } else {
          currentUser.email = email
          if (!currentUser.name) currentUser.name = email.split('@')[0] || ''
        }
        localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
        window.electron?.setUser?.(currentUser)
        updateUserUI()
        loadCredits()
        showNotification(`Email set to: ${email}`, 'info')
      },
      'user-email': () => {
        const email = args[0] || ''
        if (!currentUser) {
          currentUser = { name: email.split('@')[0] || '', email, picture: null, provider: 'ipc' }
        } else {
          currentUser.email = email
          if (!currentUser.name) currentUser.name = email.split('@')[0] || ''
        }
        localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
        window.electron?.setUser?.(currentUser)
        updateUserUI()
        loadCredits()
        showNotification(`Email set to: ${email}`, 'info')
      },
      'avatar': () => {
        const pic = args.join(':')
        if (currentUser) {
          currentUser.picture = pic
        } else {
          currentUser = { name: 'User', email: '', picture: pic, provider: 'ipc' }
        }
        localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
        window.electron?.setUser?.(currentUser)
        window.electron?.setAvatar?.(pic)
        updateUserUI()
        showNotification('Avatar updated', 'info')
      },
      'user-avatar': () => {
        const pic = args.join(':')
        if (currentUser) {
          currentUser.picture = pic
        } else {
          currentUser = { name: 'User', email: '', picture: pic, provider: 'ipc' }
        }
        localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
        window.electron?.setUser?.(currentUser)
        window.electron?.setAvatar?.(pic)
        updateUserUI()
        showNotification('Avatar updated', 'info')
      },
    }
    if (cmds[name]) cmds[name]()
    else if (name === 'set-apikey' && args[0]) saveApiKey(args[0])
    if (cmds[name] || name === 'set-apikey') {
    }
  }
  window.electron?.onViewLogsTask?.(() => window.electron?.openDevTools?.())

  const setMaxIcon = (maximized) => {
    const maxBtn = document.querySelector('[data-win-max]')
    if (!maxBtn) return
    maxBtn.querySelector('.tb-max').hidden = maximized
    maxBtn.querySelector('.tb-restore').hidden = !maximized
  }
  document.querySelector('[data-win-min]')?.addEventListener('click', () => window.electron?.minimize?.())
  document.querySelector('[data-win-max]')?.addEventListener('click', async () => {
    const r = await window.electron?.toggleMaximize?.()
    setMaxIcon(!!r?.maximized)
  })
  document.querySelector('[data-win-close]')?.addEventListener('click', () => window.electron?.closeWindow?.())
  window.electron?.isMaximized?.().then(setMaxIcon)
  window.electron?.onMaximizeChange?.(setMaxIcon)

  const searchPage = document.querySelector('.search-page')
  const searchPageInput = document.querySelector('.search-page-input')
  const searchPageCount = document.querySelector('.search-page-count')
  const searchPageResults = document.querySelector('.search-page-results')
  const searchPageEmpty = document.querySelector('.search-page-empty')
  const searchPageClear = document.querySelector('[data-search-clear]')
  let searchPageLoading = false

  const ctxMenu = document.querySelector('.ctx-menu')
  let ctxSessionId = null
  const closeCtxMenu = () => {
    if (ctxMenu) ctxMenu.hidden = true
    ctxSessionId = null
  }
  const confirmOverlay = document.querySelector('.confirm-overlay')
  let confirmAction = null
  const closeConfirm = () => {
    confirmAction = null
    if (!confirmOverlay || confirmOverlay.hidden) return
    const dlg = confirmOverlay.querySelector('.confirm-dialog')
    confirmOverlay.classList.add('closing')
    dlg?.classList.add('closing')
    setTimeout(() => {
      confirmOverlay.hidden = true
      confirmOverlay.classList.remove('closing')
      dlg?.classList.remove('closing')
    }, 200)
  }
  const showConfirm = (action, opts = {}) => {
    confirmAction = action
    if (!confirmOverlay) return
    const textEl = confirmOverlay.querySelector('.confirm-text')
    const okEl = confirmOverlay.querySelector('[data-confirm-ok]')
    if (textEl && opts.message) textEl.textContent = opts.message
    if (okEl && opts.confirmLabel) okEl.textContent = opts.confirmLabel
    confirmOverlay.hidden = false
  }
  document.querySelector('[data-confirm-ok]')?.addEventListener('click', () => {
    const fn = confirmAction
    closeConfirm()
    if (fn) fn()
  })
  document.querySelector('[data-confirm-cancel]')?.addEventListener('click', closeConfirm)
  confirmOverlay?.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) closeConfirm()
  })
  ctxMenu?.querySelector('[data-ctx-delete]')?.addEventListener('click', () => {
    if (!ctxSessionId) return
    const id = ctxSessionId
    closeCtxMenu()
    showConfirm(
      () => {
        sessions = sessions.filter((s) => s.id !== id)
        if (currentSessionId === id) currentSessionId = null
        saveSessions()
        renderSearchPage()
      },
      {
        message: tf('deleteConfirm', 'Are you sure you want to delete this session?'),
        confirmLabel: tf('delete', 'Delete')
      }
    )
  })
  document.addEventListener('click', (e) => {
    if (ctxMenu && !e.target.closest('.ctx-menu')) closeCtxMenu()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (confirmOverlay && !confirmOverlay.hidden) closeConfirm()
      else closeCtxMenu()
    }
  })

  const renderSearchPage = () => {
    if (searchPageLoading) return
    const query = searchPageInput ? searchPageInput.value.trim().toLowerCase() : ''
    if (searchPageEmpty) searchPageEmpty.hidden = true
    if (searchPageCount) searchPageCount.hidden = true
    if (!searchPageResults) return
    searchPageResults.innerHTML = ''

    const attachCtx = (card, sessionId) => {
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        ctxSessionId = sessionId
        if (!ctxMenu) return
        ctxMenu.hidden = false
        const x = Math.min(e.clientX, window.innerWidth - ctxMenu.offsetWidth - 8)
        const y = Math.min(e.clientY, window.innerHeight - ctxMenu.offsetHeight - 8)
        ctxMenu.style.left = `${Math.max(0, x)}px`
        ctxMenu.style.top = `${Math.max(0, y)}px`
      })
    }

    if (!query) {
      const sorted = [...sessions].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      if (searchPageCount) {
        searchPageCount.textContent = `${tf('sessions', 'Sessions')} (${sorted.length})`
        searchPageCount.hidden = false
      }
      if (searchPageClear) searchPageClear.hidden = sorted.length === 0
      if (sorted.length === 0) {
        if (searchPageEmpty) {
          searchPageEmpty.textContent = tf('sessionsEmpty', 'No sessions yet')
          searchPageEmpty.hidden = false
        }
        return
      }
      sorted.forEach((s) => {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'search-page-card session-item'
        const title = document.createElement('span')
        title.className = 'session-title'
        title.textContent = s.title || tf('newChat', 'New chat')
        const meta = document.createElement('span')
        meta.className = 'session-meta'
        const count = s.messages.length
        const date = new Date(s.updatedAt || s.createdAt).toLocaleString()
        meta.textContent = `${tf('messages', 'messages')}: ${count} - ${date}`
        card.append(title, meta)
        card.addEventListener('click', () => openSession(s.id))
        attachCtx(card, s.id)
        searchPageResults.append(card)
      })
      return
    }

    const results = []
    sessions.forEach((s) => {
      const title = s.title || ''
      const parts = []
      let running = title.length ? title + '\n' : ''
      s.messages.forEach((m) => {
        parts.push({ msg: m, offset: running.length })
        running += messageText(m) + '\n'
      })
      const text = running
      const lower = text.toLowerCase()
      let idx = lower.indexOf(query)
      while (idx !== -1 && results.length < 100) {
        let msgIdx = -1
        for (let k = parts.length - 1; k >= 0; k--) {
          if (parts[k].offset <= idx) {
            msgIdx = k
            break
          }
        }
        if (msgIdx !== -1) {
          const start = Math.max(0, idx - 45)
          const end = Math.min(text.length, idx + query.length + 45)
          results.push({
            session: s,
            msgIdx,
            isUser: parts[msgIdx].msg.role === 'user',
            snippet: (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
          })
        }
        idx = lower.indexOf(query, idx + query.length)
      }
    })

    if (searchPageCount) {
      searchPageCount.textContent = `${tf('searchResultsFor', 'Results for')} "${searchPageInput.value.trim()}" (${results.length})`
      searchPageCount.hidden = false
    }
    if (searchPageEmpty) searchPageEmpty.hidden = results.length > 0
    results.forEach((r) => {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'search-page-card'
      const role = document.createElement('span')
      role.className = `card-role ${r.isUser ? 'card-role-user' : 'card-role-assistant'}`
      role.textContent = r.isUser ? tf('user', 'User') : tf('assistant', 'Assistant')
      const head = document.createElement('span')
      head.className = 'session-meta'
      head.textContent = r.session.title || tf('newChat', 'New chat')
      const text = document.createElement('span')
      text.className = 'card-text'
      text.textContent = r.snippet
      card.append(role, head, text)
      card.addEventListener('click', () => openSession(r.session.id, r.msgIdx))
      attachCtx(card, r.session.id)
      searchPageResults.append(card)
    })
  }

  const openSearchPage = () => {
    if (!searchPage) return
    document.querySelector('.settings-view').hidden = true
    document.querySelector('.help-view').hidden = true
    document.querySelector('.release-notes-view').hidden = true
    document.querySelector('.welcome-text').hidden = true
    document.querySelector('.chat').hidden = true
    document.querySelector('.composer').hidden = true
    const banner = document.querySelector('.limited-banner')
    if (banner) banner.hidden = true
    searchPage.hidden = false
    runSearchWithLoading(350)
    searchPageInput?.focus()
  }

  const closeSearchPage = () => {
    if (searchPage) searchPage.hidden = true
    showChat()
    if (limitedBanner) limitedBanner.hidden = true
  }

  const searchLoadingEl = () => document.querySelector('.search-page-loading')
  let searchDebounce = null
  const runSearchWithLoading = (delay) => {
    clearTimeout(searchDebounce)
    const loading = searchLoadingEl()
    if (!loading) {
      renderSearchPage()
      return
    }
    searchPageLoading = true
    loading.hidden = false
    if (searchPageResults) searchPageResults.innerHTML = ''
    if (searchPageCount) searchPageCount.hidden = true
    if (searchPageEmpty) searchPageEmpty.hidden = true
    searchDebounce = setTimeout(() => {
      searchPageLoading = false
      loading.hidden = true
      try {
        renderSearchPage()
      } catch (err) {
        showError(`Search error: ${err.message}`)
      }
    }, delay)
  }

  searchPageInput?.addEventListener('input', () => runSearchWithLoading(250))
  searchPageInput?.addEventListener('focus', () => {
    if (searchPageInput.value.trim()) renderSearchPage()
  })
  searchPageClear?.addEventListener('click', () => {
    showConfirm(
      () => {
        resetChat()
        sessions = []
        currentSessionId = null
        saveSessions()
        document.querySelector('.settings-view').hidden = true
        document.querySelector('.help-view').hidden = true
        document.querySelector('.release-notes-view').hidden = true
        document.querySelector('.welcome-text').hidden = true
        document.querySelector('.chat').hidden = true
        document.querySelector('.composer').hidden = true
        if (searchPage) searchPage.hidden = false
        renderSearchPage()
        searchPageInput?.focus()
        showNotification(tf('allSessionsCleared', 'All sessions cleared'), 'warning')
      },
      {
        message: tf('clearAllConfirm', 'Are you sure you want to clear all sessions?'),
        confirmLabel: tf('clearAll', 'Clear all')
      }
    )
  })
  document.querySelector('[data-search-toggle]')?.addEventListener('click', openSearchPage)
  document.querySelector('#github-btn')?.addEventListener('click', () => {
    window.electron?.openExternal?.('https://github.com/CilamAI/CilamAI')
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchPage && !searchPage.hidden) {
      if (searchPageInput?.value) {
        searchPageInput.value = ''
        runSearchWithLoading(250)
      } else {
        closeSearchPage()
      }
    }
  })

  const attachMenu = document.querySelector('.attach-menu')
  document.querySelector('[data-attach-toggle]')?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!attachMenu) return
    const wasHidden = attachMenu.hidden
    attachMenu.hidden = !wasHidden
    if (!wasHidden) return
    attachMenu.classList.remove('open-up', 'open-down')
    const rect = attachMenu.getBoundingClientRect()
    const openUp = rect.bottom > window.innerHeight - 8
    attachMenu.classList.add(openUp ? 'open-up' : 'open-down')
  })
  document.addEventListener('click', (e) => {
    if (attachMenu && !attachMenu.hidden && !attachMenu.contains(e.target) && !e.target.closest('[data-attach-toggle]')) {
      attachMenu.hidden = true
    }
  })

  // Voice input via Web Speech API
  const micBtn = document.querySelector('[data-mic-toggle]')
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (micBtn) {
    if (!SpeechRecognitionCtor) {
      micBtn.hidden = true
    } else {
      const speechLangFor = () => {
        if (currentLang === 'zh' || currentLang === 'zh-TW') return currentLang === 'zh-TW' ? 'zh-TW' : 'zh-CN'
        return (localeData && localeData.speechLang) || currentLang || 'en-US'
      }
      recognition = new SpeechRecognitionCtor()
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = speechLangFor()

      recognition.onresult = (event) => {
        const input = document.querySelector('.composer-input')
        if (!input) return
        let finalText = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i]
          if (res.isFinal) finalText += res[0].transcript
        }
        if (finalText) {
          const start = input.selectionStart ?? input.value.length
          const end = input.selectionEnd ?? input.value.length
          const merged = (input.value.slice(0, start) + finalText + input.value.slice(end)).replace(/\s{2,}/g, ' ')
          input.value = merged
          const pos = start + finalText.length
          input.setSelectionRange(pos, pos)
          input.dispatchEvent(new Event('input'))
        }
      }
      recognition.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          showWarning(tf('micPermission', 'Microphone access was denied.'))
        } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
          showWarning(tf('micError', 'Voice input stopped.'))
        }
        stopRecognition()
      }
      recognition.onend = () => stopRecognition()

      micBtn.addEventListener('click', () => {
        const input = document.querySelector('.composer-input')
        if (recognizing) {
          stopRecognition()
          return
        }
        if (input) input.focus()
        try {
          recognition.lang = speechLangFor()
          recognition.start()
          recognizing = true
          micBtn.classList.add('listening')
        } catch {
          stopRecognition()
        }
      })
    }
  }

  const CREDIT_USED_KEY = 'ai-credits-used'
  const CREDIT_LIMIT_KEY = 'ai-credits-limit'
  const CREDIT_RESET_KEY = 'ai-credits-reset'
  const RESET_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours
  let creditUsed = 0
  let creditLimit = 100
  let creditSpeed = 2
  let creditResetAt = Date.now() + RESET_INTERVAL
  let creditSpent = 0
  let ipcCreditsApplied = false
  const loadCredits = async () => {
    if (ipcCreditsApplied) {
      ipcCreditsApplied = false
      renderCreditMenu()
      return
    }
    try {
      const res = await window.electron?.getCredits?.()
      if (res?.ok && res.credits) {
        creditUsed = Math.max(0, Number(res.credits.used ?? 0))
        creditLimit = Math.max(1, Number(res.credits.limit ?? 100))
        creditResetAt = Number(res.credits.resetAt || (Date.now() + RESET_INTERVAL))
        creditSpent = Math.max(0, Number(res.credits.spent ?? 0))
        localStorage.setItem('ai-credits-used', String(creditUsed))
        localStorage.setItem('ai-credits-limit', String(creditLimit))
        localStorage.setItem('ai-credits-reset', String(creditResetAt))
        localStorage.setItem('ai-credits-spent', String(creditSpent))
      } else if (res?.ok) {
        creditUsed = 0
        creditLimit = 100
        creditResetAt = Date.now() + RESET_INTERVAL
        creditSpent = 0
      } else {
        creditUsed = Math.max(0, Number(localStorage.getItem('ai-credits-used') || 0))
        creditLimit = Math.max(1, Number(localStorage.getItem('ai-credits-limit') || 100))
        creditResetAt = Number(localStorage.getItem('ai-credits-reset') || (Date.now() + RESET_INTERVAL))
        creditSpent = Math.max(0, Number(localStorage.getItem('ai-credits-spent') || 0))
      }
    } catch {
      creditUsed = Math.max(0, Number(localStorage.getItem('ai-credits-used') || 0))
      creditLimit = Math.max(1, Number(localStorage.getItem('ai-credits-limit') || 100))
      creditResetAt = Number(localStorage.getItem('ai-credits-reset') || (Date.now() + RESET_INTERVAL))
      creditSpent = Math.max(0, Number(localStorage.getItem('ai-credits-spent') || 0))
    }
    const userEmail = (currentUser?.email || '').toLowerCase().trim()
    const isYearlyUser = userEmail === 'kevccx@gmail.com'
    const userInterval = isYearlyUser ? (365 * 24 * 60 * 60 * 1000) : RESET_INTERVAL
    if (isYearlyUser) {
      if (creditLimit < 100000) creditLimit = 100000
    } else if (creditLimit >= 1000000) {
      creditLimit = 100
    }
    if (!creditResetAt || (!isYearlyUser && creditResetAt > Date.now() + RESET_INTERVAL + 60000) || (isYearlyUser && creditResetAt < Date.now() + 300 * 24 * 60 * 60 * 1000) || Date.now() > creditResetAt) {
      creditResetAt = Date.now() + userInterval
      if (Date.now() > creditResetAt) creditUsed = 0
    }
    saveCreditState()
    renderCreditMenu()
  }
  const saveCreditState = () => {
    try {
      localStorage.setItem('ai-credits-used', String(creditUsed))
      localStorage.setItem('ai-credits-limit', String(creditLimit))
      localStorage.setItem('ai-credits-reset', String(creditResetAt))
      localStorage.setItem('ai-credits-spent', String(creditSpent))
      window.electron?.saveCredits?.({ used: creditUsed, limit: creditLimit, resetAt: creditResetAt, spent: creditSpent }).catch?.(() => { })
    } catch { }
  }
  const formatTimeLeft = (ms) => {
    if (ms <= 0) return '00:00:00'
    const date = new Date(Date.now() + ms)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    return `${day}/${month}/${year} ${h}:${m}`
  }
  let contextWindowMax = 200000
  let creditWarningShown = false
  const formatCreditNumber = (n) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
    if (n >= 999500) return '1M'
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
    return String(n)
  }
  const renderCreditMenu = () => {
    const usedEl = document.querySelector('[data-credit-used]')
    const limitEl = document.querySelector('[data-credit-limit]')
    const balanceEl = document.querySelector('[data-credit-balance]')
    const barEl = document.querySelector('[data-credit-bar]')
    const warningEl = document.querySelector('[data-credit-warning]')
    const timeEl = document.querySelector('[data-credit-time]')
    const spentEl = document.querySelector('[data-credit-spent]')
    const contextEl = document.querySelector('[data-context-count]')
    if (usedEl) usedEl.textContent = formatCreditNumber(creditUsed)
    if (limitEl) limitEl.textContent = formatCreditNumber(creditLimit)
    const spentRow = spentEl?.closest('.credit-menu-spent')
    if (spentRow) {
      spentRow.hidden = false
    }
    if (spentEl) {
      const amount = Number(creditSpent * 0.02) || 0
      spentEl.textContent = `${amount.toFixed(2)}$`
    }
    const pct = Math.min(100, Math.round((creditUsed / creditLimit) * 100))
    if (warningEl) warningEl.hidden = pct < 75
    if (barEl) {
      barEl.style.width = `${pct}%`
      barEl.classList.toggle('low', pct >= 75 && pct < 100)
      barEl.classList.toggle('empty', pct >= 100)
    }
    if (timeEl) timeEl.textContent = formatTimeLeft(creditResetAt - Date.now())
    if (contextEl) {
      contextEl.textContent = String(messages.length)
    }
    if (pct < 75) creditWarningShown = false
    if (pct >= 75 && !creditWarningShown) {
      creditWarningShown = true
      showNotification('Credits usage reached 75%.', 'warning')
    }
  }
  const creditMenu = document.querySelector('.credit-menu')
  let userMenuCloseTimer = null
  let creditMenuCloseTimer = null
  const closeCreditMenu = () => {
    if (!creditMenu || creditMenu.hidden) return
    clearTimeout(creditMenuCloseTimer)
    creditMenu.classList.add('closing')
    creditMenuCloseTimer = setTimeout(() => {
      creditMenu.hidden = true
      creditMenu.classList.remove('closing')
    }, 140)
  }

  const closeUserMenu = () => {
    if (!userMenu || userMenu.hidden) return
    clearTimeout(userMenuCloseTimer)
    userMenu.classList.add('closing')
    userMenuCloseTimer = setTimeout(() => {
      userMenu.hidden = true
      userMenu.classList.remove('closing')
    }, 150)
  }

  document.querySelector('[data-credit-toggle]')?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!creditMenu) return
    if (!creditMenu.hidden) {
      closeCreditMenu()
      return
    }
    clearTimeout(creditMenuCloseTimer)
    creditMenu.classList.remove('closing')
    creditMenu.hidden = false
    renderCreditMenu()
  })

  document.addEventListener('click', (e) => {
    if (creditMenu && !creditMenu.hidden && !creditMenu.contains(e.target) && !e.target.closest('[data-credit-toggle]')) {
      closeCreditMenu()
    }
  })

  renderCreditMenu()

  // User Account & OAuth 2.0 State
  const userMenu = document.querySelector('.user-menu')
  const userRailBtn = document.querySelector('[data-user-menu-toggle]')
  const authDialog = document.querySelector('.auth-dialog-overlay')
  let currentUser = JSON.parse(localStorage.getItem('cilamai-user') || 'null')

  const updateUserUI = () => {
    const nameEl = document.querySelector('[data-user-name]')
    const statusEl = document.querySelector('[data-user-status]')
    const avatarEl = document.querySelector('.user-menu-avatar')
    const userHeader = document.querySelector('.user-menu-header')
    const userDivider = document.querySelector('.user-menu-divider')
    const signinBtn = document.querySelector('[data-action="oauth-signin"]')
    const changeAvatarBtn = document.querySelector('[data-action="change-avatar"]')
    const signoutBtn = document.querySelector('[data-action="signout"]')
    const creditToggle = document.querySelector('[data-credit-toggle]')

    const renderFallback = (container, sizeStr) => {
      const initial = (currentUser?.name || currentUser?.email || 'U').charAt(0).toUpperCase()
      container.innerHTML = `<div class="user-avatar-initial" style="width:${sizeStr};height:${sizeStr};border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:600;display:flex;align-items:center;justify-content:center;font-size:${parseInt(sizeStr) > 24 ? '14px' : '11px'};">${initial}</div>`
    }

    const renderAvatarImg = (container, sizePx) => {
      if (!container) return
      container.innerHTML = ''
      const sizeStr = typeof sizePx === 'number' ? `${sizePx}px` : sizePx
      if (currentUser && currentUser.picture) {
        const img = document.createElement('img')
        img.src = currentUser.picture
        img.referrerPolicy = 'no-referrer'
        img.style.width = sizeStr
        img.style.height = sizeStr
        img.style.borderRadius = '50%'
        img.style.objectFit = 'cover'
        img.onerror = () => {
          renderFallback(container, sizeStr)
        }
        container.appendChild(img)
      } else {
        renderFallback(container, sizeStr)
      }
    }

    if (currentUser && (currentUser.name || currentUser.email)) {
      const displayName = currentUser.name || currentUser.email.split('@')[0]
      if (nameEl) nameEl.textContent = displayName
      if (statusEl) statusEl.textContent = currentUser.email || ''

      if (userHeader) userHeader.hidden = false
      if (userDivider) userDivider.hidden = false

      renderAvatarImg(avatarEl, '100%')
      renderAvatarImg(userRailBtn, 22)

      if (signinBtn) signinBtn.hidden = true
      if (changeAvatarBtn) changeAvatarBtn.hidden = false
      if (signoutBtn) signoutBtn.hidden = false
      if (creditToggle) creditToggle.hidden = false
      userRailBtn?.classList.add('logged-in')
    } else {
      if (userHeader) userHeader.hidden = true
      if (userDivider) userDivider.hidden = true
      if (userRailBtn) {
        userRailBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-user"></use></svg>`
      }
      if (signinBtn) signinBtn.hidden = false
      if (changeAvatarBtn) changeAvatarBtn.hidden = true
      if (signoutBtn) signoutBtn.hidden = true
      if (creditToggle) creditToggle.hidden = false
      userRailBtn?.classList.remove('logged-in')
    }
  }
  updateUserUI()

  const avatarFileInput = document.getElementById('avatar-file-input')

  const openAvatarFile = async () => {
    // 1. Try Native Electron file dialog first
    if (window.electron?.uploadAvatar) {
      try {
        const res = await window.electron.uploadAvatar()
        if (res?.ok && res.picture) {
          if (!currentUser) currentUser = { name: 'XDev', email: '', picture: res.picture, provider: 'custom' }
          else currentUser.picture = res.picture
          localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
          updateUserUI()
          showNotification('Avatar updated successfully', 'info')
          return
        }
        if (res?.canceled) return
      } catch (err) {
        console.warn('Native avatar dialog fallback:', err)
      }
    }

    // 2. Fallback to HTML input file picker
    if (avatarFileInput) {
      avatarFileInput.value = ''
      avatarFileInput.click()
    }
  }

  avatarFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      if (!currentUser) {
        currentUser = { name: 'XDev', email: '', picture: dataUrl, provider: 'custom' }
      } else {
        currentUser.picture = dataUrl
      }
      localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
      window.electron?.setUser?.(currentUser)
      window.electron?.setAvatar?.(dataUrl)
      updateUserUI()
      showNotification('Avatar updated successfully', 'info')
    }
    reader.readAsDataURL(file)
  })

  document.querySelector('[data-action="change-avatar"]')?.addEventListener('click', openAvatarFile)

  document.querySelector('.user-menu-avatar')?.addEventListener('click', () => {
    if (currentUser) {
      openAvatarFile()
    }
  })

  // Sync stored user from main process
  window.electron?.getUser?.().then((storedUser) => {
    if (storedUser && (storedUser.name || storedUser.email)) {
      currentUser = storedUser
      localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
      updateUserUI()
      loadCredits()
    } else if (currentUser) {
      window.electron?.setUser?.(currentUser)
    }
  })

  userRailBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!userMenu) return
    if (userMenu.classList.contains('closing')) {
      clearTimeout(userMenuCloseTimer)
      userMenu.classList.remove('closing')
      userMenu.hidden = false
    } else {
      userMenu.hidden = !userMenu.hidden
    }
    if (!userMenu.hidden && creditMenu) closeCreditMenu()
  })

  document.addEventListener('click', (e) => {
    if (userMenu && !userMenu.hidden && !userMenu.contains(e.target) && !e.target.closest('[data-user-menu-toggle]')) {
      closeUserMenu()
    }
  })

  document.querySelector('[data-action="oauth-signin"]')?.addEventListener('click', () => {
    closeUserMenu()
    window.electron?.openSigninWindow?.()
  })

  document.querySelector('[data-auth-close]')?.addEventListener('click', () => {
    if (authDialog) authDialog.hidden = true
  })

  authDialog?.addEventListener('click', (e) => {
    if (e.target === authDialog) authDialog.hidden = true
  })

  document.querySelectorAll('.auth-provider-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const provider = btn.dataset.provider || 'oauth'

      if (authDialog) authDialog.hidden = true
      if (provider === 'google' && window.electron?.signIn) {
        showNotification('Opening Google Sign-In in browser...', 'info')
        try {
          const res = await window.electron.signIn('google')
          if (res?.user) {
            currentUser = res.user
            localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
            updateUserUI()
            loadCredits()
            showNotification(`Signed in as ${currentUser.name || currentUser.email}`, 'info')
          }
        } catch (err) {
          console.error('OAuth error:', err)
        }
      }
    })
  })

  const handleUserUpdate = (user) => {
    if (user && typeof user === 'string') {
      let name = user
      let email = ''
      if (user.includes('@')) {
        email = user
        name = user.split('@')[0]
      }
      currentUser = {
        name,
        email,
        picture: null,
        provider: 'google'
      }
      localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
      updateUserUI()
      loadCredits()
      showNotification(`Signed in as ${name || email}`, 'info')
    } else if (user && typeof user === 'object') {
      currentUser = {
        name: user.name || '',
        email: user.email || '',
        picture: user.picture || null,
        provider: user.provider || 'google'
      }
      localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
      updateUserUI()
      loadCredits()
      if (currentUser.name || currentUser.email) {
        showNotification(`Signed in as ${currentUser.name || currentUser.email}`, 'info')
      }
    } else if (!user) {
      currentUser = null
      localStorage.removeItem('cilamai-user')
      updateUserUI()
      loadCredits()
    }
  }

  window.electron?.on?.('auth:user', handleUserUpdate)
  window.electron?.onUser?.(handleUserUpdate)

  const handleAvatarUpdate = (picture) => {
    if (picture && typeof picture === 'string') {
      if (!currentUser) {
        currentUser = { name: 'User', email: '', picture, provider: 'ipc' }
      } else {
        currentUser.picture = picture
      }
      localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
      window.electron?.setUser?.(currentUser)
      updateUserUI()
      showNotification('Avatar image updated', 'info')
    }
  }

  window.electron?.on?.('auth:avatar', handleAvatarUpdate)
  window.electron?.onAvatar?.(handleAvatarUpdate)

  window.electron?.onIpcTask?.((command) => {
    if (!command) return
    if (command.startsWith('user:')) {
      const val = command.slice(5)
      let name = ''
      let email = ''
      let pic = null
      if (val.includes(':')) {
        const parts = val.split(':')
        name = parts[0] || ''
        email = parts[1] || ''
        pic = parts.slice(2).join(':') || null
      } else if (val.includes('@')) {
        email = val
        name = val.split('@')[0]
      } else {
        name = val
      }
      currentUser = { name, email, picture: pic || (currentUser?.picture || null), provider: 'ipc' }
      localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
      window.electron?.setUser?.(currentUser)
      updateUserUI()
      loadCredits()
      showNotification(`Profile updated via IPC`, 'info')
    } else if (command.startsWith('name:')) {
      const name = command.slice(5)
      if (!currentUser) currentUser = { name: '', email: '', picture: null, provider: 'ipc' }
      currentUser.name = name
      localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
      window.electron?.setUser?.(currentUser)
      updateUserUI()
    } else if (command.startsWith('email:')) {
      const email = command.slice(6)
      if (!currentUser) currentUser = { name: '', email: '', picture: null, provider: 'ipc' }
      currentUser.email = email
      if (!currentUser.name) currentUser.name = email.split('@')[0]
      localStorage.setItem('cilamai-user', JSON.stringify(currentUser))
      window.electron?.setUser?.(currentUser)
      updateUserUI()
      loadCredits()
    } else if (command.startsWith('spent:')) {
      const val = parseFloat(command.slice(6))
      if (Number.isFinite(val) && val >= 0) {
        creditSpent = val
        ipcCreditsApplied = true
        saveCreditState()
        renderCreditMenu()
      }
    } else if (command.startsWith('avatar:')) {
      handleAvatarUpdate(command.slice(7))
    }
  })



  document.querySelector('[data-action="signout"]')?.addEventListener('click', () => {
    showConfirm(async () => {
      saveCreditState()
      currentUser = null
      localStorage.removeItem('cilamai-user')
      window.electron?.stopStream?.()
      await window.electron?.signOut?.()
      window.location.href = './signin.html'
    }, {
      message: 'Are you sure you want to sign out?',
      confirmLabel: 'Sign Out'
    })
  })

  // Initialize Context Window Speed Boost
  let contextWindowBoostEnabled = false
  const updateContextWindow = (model) => window.electron?.getContextWindowInfo?.(model).then((info) => {
    if (info?.ok) {
      contextWindowMax = info.maxTokens || 200000
      contextWindowBoostEnabled = false
    }
  })
  updateContextWindow(settings.model || 'auto')
  document.addEventListener('model-context-change', (event) => updateContextWindow(event.detail))
  const limitedBanner = document.querySelector('.limited-banner')
  if (limitedBanner) limitedBanner.hidden = true
  setInterval(() => {
    if (Date.now() > creditResetAt) {
      creditResetAt = Date.now() + RESET_INTERVAL
      creditUsed = 0
      saveCreditState()
      if (limitedBanner) limitedBanner.hidden = true
    }
    if (creditMenu && !creditMenu.hidden) renderCreditMenu()
  }, 1000)

  while (pendingIpc.length) runIpcCommand(pendingIpc.shift())
  setInterval(() => {
    while (pendingIpc.length) runIpcCommand(pendingIpc.shift())
  }, 200)


  document.querySelector('[data-upload]')?.addEventListener('click', async () => {
    if (attachMenu) attachMenu.hidden = true
    const result = await window.electron?.uploadFile?.()
    if (!result?.ok) return
    const filesBox = document.querySelector('.composer-files')
    if (!filesBox) return
    const input = document.querySelector('.composer-input')
    const ext = (result.name || '').split('.').pop().toLowerCase()
    const BLOCKED_EXTS = ['mp4', 'mp3', 'mkv', 'mov', 'avi', 'wav', 'flac', 'ogg', 'm4a', 'webm', 'exe', 'msi', 'bmp']
    if (BLOCKED_EXTS.includes(ext)) {
      showWarning(`.${ext} files are not supported`)
      return
    }
    const MAX_IMAGE_MB = 10
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'].includes(ext)) {
      if (result.size > MAX_IMAGE_MB * 1024 * 1024) {
        showWarning(`Image too large: ${(result.size / 1024 / 1024).toFixed(1)} MB (max ${MAX_IMAGE_MB} MB)`)
        return
      }
      const chip = document.createElement('div')
      chip.className = 'file-chip'
      chip.innerHTML = `
        <img class="file-chip-thumb" src="data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${result.data}" alt="" />
        <span class="file-chip-info">
          <span class="file-chip-name">${result.name}</span>
          <span class="file-chip-size">${(result.size / 1024).toFixed(1)} KB</span>
        </span>
        <button type="button" class="file-chip-remove" aria-label="Remove">&times;</button>`
      chip.querySelector('.file-chip-remove').addEventListener('click', () => {
        chip.remove()
        const idx = pendingImages.indexOf(file)
        if (idx !== -1) pendingImages.splice(idx, 1)
        filesBox.hidden = pendingImages.length === 0
        updateSendBtnState()
      })
      const file = { name: result.name, data: result.data, ext }
      pendingImages.push(file)
      filesBox.append(chip)
      filesBox.hidden = false
      updateSendBtnState()
    } else {
      input.value = (input.value ? input.value + ' ' : '') + `[file: ${result.name}]`
      updateSendBtnState()
    }
    input.focus()
  })

  document.querySelector('[data-screenshot]')?.addEventListener('click', async (e) => {
    const svg = e.currentTarget.querySelector('svg')
    if (svg) {
      svg.classList.remove('shimmer')
      void svg.offsetWidth
      svg.classList.add('shimmer')
      svg.addEventListener('animationend', () => svg.classList.remove('shimmer'), { once: true })
    }
    if (attachMenu) attachMenu.hidden = true
    const result = await window.electron?.captureScreenshot?.()
    if (!result?.ok) {
      if (result?.error) showError(`Screenshot failed: ${result.error}`)
      return
    }
    const filesBox = document.querySelector('.composer-files')
    if (!filesBox) return
    const name = result.path.split(/[\\/]/).pop() || 'screenshot.png'
    const chip = document.createElement('div')
    chip.className = 'file-chip'
    chip.innerHTML = `
      <img class="file-chip-thumb" src="data:image/png;base64,${result.data}" alt="" />
      <span class="file-chip-info">
        <span class="file-chip-name">${name}</span>
        <span class="file-chip-size">Screenshot</span>
      </span>
      <button type="button" class="file-chip-remove" aria-label="Remove">&times;</button>`
    chip.querySelector('.file-chip-remove').addEventListener('click', () => {
      chip.remove()
      const idx = pendingImages.indexOf(file)
      if (idx !== -1) pendingImages.splice(idx, 1)
      filesBox.hidden = pendingImages.length === 0
      updateSendBtnState()
    })
    const file = { name, data: result.data, ext: 'png' }
    pendingImages.push(file)
    filesBox.append(chip)
    filesBox.hidden = false
    updateSendBtnState()
  })

  document.querySelector('[data-model-toggle]')?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!modelMenu) return
    modelMenu.hidden = !modelMenu.hidden
    if (!modelMenu.hidden) {
      modelMenu.style.top = 'auto'
      modelMenu.style.bottom = 'auto'
      const btnRect = e.currentTarget.getBoundingClientRect()
      const menuHeight = modelMenu.getBoundingClientRect().height
      const openUp = btnRect.bottom + menuHeight > window.innerHeight - 8
      if (openUp) {
        modelMenu.style.bottom = 'calc(100% + 6px)'
      } else {
        modelMenu.style.top = 'calc(100% + 6px)'
      }
      const search = modelMenu.querySelector('.model-search')
      if (search) {
        search.value = ''
        search.dispatchEvent(new Event('input'))
        search.focus()
      }
    }
  })

  document.querySelector('.model-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase()
    document.querySelectorAll('.model-option').forEach((btn) => {
      btn.hidden = q.length > 0 && !btn.dataset.model.toLowerCase().includes(q)
    })
  })

  document.addEventListener('click', (e) => {
    if (modelMenu && !modelMenu.hidden && !modelMenu.contains(e.target)) {
      modelMenu.hidden = true
    }
  })



  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modelMenu) modelMenu.hidden = true
    if (e.key === 'Escape' && commandsMenu) commandsMenu.hidden = true
  })

  const commandsMenu = document.querySelector('.commands-menu')
  const commandItems = commandsMenu?.querySelectorAll('.command-item')
  let activeCommandIdx = -1

  const showCommandsMenu = () => {
    if (!commandsMenu) {
      console.error('commandsMenu element not found')
      return
    }
    if (!commandItems || commandItems.length === 0) {
      console.error('commandItems not found or empty, length:', commandItems?.length)
      return
    }
    console.log('Showing commands menu with', commandItems.length, 'items')
    commandsMenu.hidden = false
    commandsMenu.style.height = 'auto'
    activeCommandIdx = -1
    commandItems.forEach((c) => c.classList.remove('active'))
  }

  const hideCommandsMenu = () => {
    if (commandsMenu) commandsMenu.hidden = true
    activeCommandIdx = -1
  }

  const executeCommand = (cmd) => {
    hideCommandsMenu()
    if (input) input.value = ''
    if (cmd === '/clear') {
      resetChat()
      showNotification(tf('conversationCleared', 'Conversation cleared'), 'warning')
    } else if (cmd === '/model') {
      showChat()
      document.querySelector('[data-model-toggle]')?.click()
    } else if (cmd === '/settings') {
      showSettings()
    } else if (cmd === '/search') {
      openSearchPage()
    }
  }

  input?.addEventListener('input', () => {
    const val = input.value
    if (val === '/') {
      showCommandsMenu()
    } else if (val.startsWith('/') && commandsMenu && !commandsMenu.hidden) {
      const query = val.toLowerCase()
      let anyVisible = false
      commandItems.forEach((item) => {
        const match = item.dataset.command.toLowerCase().includes(query)
        item.hidden = !match
        if (match) anyVisible = true
      })
      if (!anyVisible) hideCommandsMenu()
    } else {
      hideCommandsMenu()
    }
  })

  input?.addEventListener('keydown', (e) => {
    if (!commandsMenu || commandsMenu.hidden) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (!inputHistory.length) return
        if (inputHistoryIdx < 0) {
          inputHistoryIdx = inputHistory.length - 1
        } else {
          inputHistoryIdx = Math.max(0, inputHistoryIdx - 1)
        }
        input.value = inputHistory[inputHistoryIdx] || ''
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (inputHistoryIdx < 0) return
        const next = inputHistoryIdx + 1
        if (next >= inputHistory.length) {
          inputHistoryIdx = -1
          input.value = ''
        } else {
          inputHistoryIdx = next
          input.value = inputHistory[inputHistoryIdx] || ''
        }
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeCommandIdx = Math.min(activeCommandIdx + 1, commandItems.length - 1)
      commandItems.forEach((c, i) => c.classList.toggle('active', i === activeCommandIdx))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeCommandIdx = Math.max(activeCommandIdx - 1, 0)
      commandItems.forEach((c, i) => c.classList.toggle('active', i === activeCommandIdx))
    } else if (e.key === 'Enter' && activeCommandIdx >= 0) {
      e.preventDefault()
      executeCommand(commandItems[activeCommandIdx].dataset.command)
    }
  })

  commandItems?.forEach((item) => {
    item.addEventListener('click', () => {
      executeCommand(item.dataset.command)
    })
  })

  const hotkeysList = document.querySelector('#hotkeys-list')

  const renderComboKeys = (container, combo) => {
    if (!container) return
    container.innerHTML = ''
    if (!combo) {
      const empty = document.createElement('span')
      empty.className = 'hotkey-empty-text'
      empty.textContent = tf('hotkeyNotSet', 'Not set')
      container.append(empty)
      return
    }
    combo.split('+').forEach((part, i) => {
      if (i > 0) {
        const sep = document.createElement('span')
        sep.className = 'hotkey-key-sep'
        sep.textContent = '+'
        container.append(sep)
      }
      const key = document.createElement('span')
      key.className = 'hotkey-key'
      key.textContent = part
      container.append(key)
    })
  }

  const renderHotkeys = () => {
    if (!hotkeysList) return
    hotkeysList.innerHTML = ''
    Object.keys(HOTKEY_ACTIONS).forEach((action) => {
      const labelKey = HOTKEY_ACTIONS[action].labelKey
      const labelText = localeData[labelKey] || labelKey
      const combo = hotkeys[action] || ''
      const row = document.createElement('div')
      row.className = 'hotkey-row'
      row.dataset.action = action
      const label = document.createElement('span')
      label.className = 'hotkey-label'
      label.textContent = labelText
      const inputWrap = document.createElement('div')
      inputWrap.className = 'hotkey-input-wrap'
      const input = document.createElement('div')
      input.className = 'hotkey-input'
      input.tabIndex = 0
      input.dataset.action = action
      if (!combo) input.classList.add('empty')
      const keys = document.createElement('span')
      keys.className = 'hotkey-keys'
      input.append(keys)
      renderComboKeys(keys, combo)
      const reset = document.createElement('button')
      reset.type = 'button'
      reset.className = 'hotkey-reset'
      reset.title = tf('resetToDefaults', 'Reset to defaults')
      reset.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'
      inputWrap.append(input, reset)
      row.append(label, inputWrap)
      hotkeysList.append(row)
    })
    checkHotkeyConflicts()
  }

  const checkHotkeyConflicts = () => {
    const counts = {}
    Object.entries(hotkeys).forEach(([action, combo]) => {
      if (!combo) return
      counts[combo] = (counts[combo] || 0) + 1
    })
    document.querySelectorAll('.hotkey-row').forEach((row) => {
      const action = row.dataset.action
      const combo = hotkeys[action]
      const input = row.querySelector('.hotkey-input')
      const hasConflict = combo && counts[combo] > 1
      row.classList.toggle('conflict', !!hasConflict)
      if (input) input.title = hasConflict ? tf('hotkeyConflict', 'This shortcut conflicts with another action') : ''
    })
  }

  const startRecording = (input) => {
    const action = input.dataset.action
    document.querySelectorAll('.hotkey-input.recording').forEach((el) => {
      if (el !== input) stopRecording(el)
    })
    input.classList.add('recording')
    input.classList.remove('empty')
    const keys = input.querySelector('.hotkey-keys')
    if (keys) keys.innerHTML = ''
    const onKeyDown = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        const prev = hotkeys[action]
        renderComboKeys(input.querySelector('.hotkey-keys'), prev || '')
        if (!prev) input.classList.add('empty')
        stopRecording(input)
        return
      }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
      const combo = normalizeKey(e)
      hotkeys[action] = combo
      settings.hotkeys = { ...hotkeys }
      localStorage.setItem('cilamai-settings', JSON.stringify(settings))
      renderComboKeys(input.querySelector('.hotkey-keys'), combo)
      input.classList.remove('empty')
      stopRecording(input)
      checkHotkeyConflicts()
      showNotification(tf('hotkeySaved', 'Hotkey saved'), 'warning')
    }
    input._recorder = onKeyDown
    input.addEventListener('keydown', onKeyDown, true)
    input.focus()
  }

  const stopRecording = (input) => {
    input.classList.remove('recording')
    if (input._recorder) {
      input.removeEventListener('keydown', input._recorder, true)
      input._recorder = null
    }
  }

  hotkeysList?.addEventListener('click', (e) => {
    const resetBtn = e.target.closest('.hotkey-reset')
    if (resetBtn) {
      const row = resetBtn.closest('.hotkey-row')
      const action = row?.dataset.action
      if (action && DEFAULT_HOTKEYS[action]) {
        hotkeys[action] = DEFAULT_HOTKEYS[action]
        settings.hotkeys = { ...hotkeys }
        localStorage.setItem('cilamai-settings', JSON.stringify(settings))
        const input = row.querySelector('.hotkey-input')
        if (input) {
          renderComboKeys(input.querySelector('.hotkey-keys'), hotkeys[action])
          input.classList.remove('empty')
        }
        checkHotkeyConflicts()
      }
      return
    }
    const input = e.target.closest('.hotkey-input')
    if (input) startRecording(input)
  })

  document.querySelector('#reset-hotkeys')?.addEventListener('click', () => {
    hotkeys = { ...DEFAULT_HOTKEYS }
    settings.hotkeys = { ...hotkeys }
    localStorage.setItem('cilamai-settings', JSON.stringify(settings))
    renderHotkeys()
    showNotification(tf('hotkeysReset', 'Hotkeys reset to defaults'), 'warning')
  })

  renderHotkeys()


  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.hotkey-input.recording')) return
    const target = e.target
    const isInputField =
      target &&
      ((target.tagName === 'INPUT' && target.type !== 'checkbox' && target.type !== 'radio') ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    if (isInputField) return
    for (const [action, combo] of Object.entries(hotkeys)) {
      if (!combo) continue
      if (comboMatchesEvent(combo, e)) {
        const handler = HOTKEY_ACTIONS[action]
        if (handler?.run) {
          e.preventDefault()
          handler.run()
          return
        }
      }
    }
  })

  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    hideCommandsMenu()
    stopRecognition()
    const text = input?.value.trim()
    if (!text && pendingImages.length === 0) return

    if (!currentUser) {
      if (authDialog) authDialog.hidden = false
      return
    }

    const filesBox = document.querySelector('.composer-files')
    const images = pendingImages.slice()
    const savedImages = await Promise.all(images.map((img) => compressImage(img.ext, img.data)))
    if (input) input.value = ''
    updateSendBtnState()
    if (filesBox) {
      filesBox.innerHTML = ''
      filesBox.hidden = true
    }
    const imageMentions = pendingImages.map((f) => `[image: ${f.name}]`).join(' ')
    const fullText = imageMentions ? (text ? `${imageMentions} ${text}` : imageMentions) : text
    pendingImages.length = 0

    const userBubble = addMessage('user', text || '')
    for (let i = 0; i < images.length; i++) {
      const img = savedImages[i]
      const el = document.createElement('img')
      el.className = 'chat-image'
      el.src = `data:image/${img.ext === 'svg' ? 'svg+xml' : img.ext};base64,${img.data}`
      el.alt = images[i].name
      userBubble.append(el)
    }
    messages.push({ role: 'user', content: fullText, savedImages })
    if (creditUsed >= creditLimit) {
      limitedBanner.hidden = true
      addMessage('assistant', tf('limitedOutput', 'Credits limit reached.'))
      saveSessions()
      renderSearchPage()
      return
    }
    const textForHistory = fullText.replace(/\[image: [^\]]+\]/g, '').trim()
    if (textForHistory) {
      inputHistory.push(textForHistory)
      inputHistoryIdx = -1
    }
    const userMsg = messages[messages.length - 1]
    userBubble.dataset.idx = String(messages.length - 1)
    const payloadMessages = messages.map(({ role, content, images }) => ({ role, content, images }))
    const lastUser = payloadMessages[payloadMessages.length - 1]
    if (images.length > 0 && isOpenAI()) {
      const parts = [
        ...(text ? [{ type: 'text', text }] : []),
        ...savedImages.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:image/${img.ext === 'svg' ? 'svg+xml' : img.ext};base64,${img.data}` }
        }))
      ]
      lastUser.content = parts
    } else if (images.length > 0 && !isOpenAI()) {
      lastUser.images = savedImages.map((img) => img.data)
    }

    const modelEl = document.querySelector('.model-name')
    const model = modelEl?.dataset?.fullModel || modelEl?.textContent.trim() || 'llama3.2'
    const bubble = addTypingIndicator()
    const chat = document.querySelector('.chat')
    const sendBtn = document.querySelector('.composer-btn.send')
    const stopBtn = document.querySelector('.composer-btn.stop')
    let stopped = false
    let finishTypewriter = null
    const setStreaming = (on) => {
      if (sendBtn) sendBtn.hidden = on
      if (stopBtn) stopBtn.hidden = !on
      if (input) input.disabled = on
      form.classList.toggle('loading', on)
      if (!on) updateSendBtnState()
    }
    setStreaming(true)
    if (!(await checkInternet())) {
      setStreaming(false)
      return
    }
    stopBtn?.addEventListener('click', () => {
      stopped = true
      finishTypewriter?.()
      window.electron?.stopStream?.()
    })

    try {
      let result
      let streamedContent = ''
      let renderTimer = null
      let thinkingEl = null
      let reasoningContent = ''
      let thinkingStartedAt = 0
      let thinkingTicker = null
      let responseCompleted = false
      let creditSettled = false
      const updateThinkingTime = () => {
        if (!thinkingEl) return
        const elapsed = ((Date.now() - thinkingStartedAt) / 1000).toFixed(1)
        const textSpan = thinkingEl.querySelector('.thinking-text')
        if (textSpan) {
          textSpan.textContent = `${tf('thought', 'Thought: ')}${elapsed}s`
        }
      }

      const wasStreaming = settings.stream !== false && window.electron?.sendStream
      thinkingStartedAt = Date.now()
      if (false) {
        streamedContent = ''
        const ensureThinking = () => {
          if (thinkingEl) return thinkingEl
          thinkingEl = document.createElement('details')
          thinkingEl.className = 'thinking active'
          thinkingEl.setAttribute('open', '')
          const summary = document.createElement('summary')
          const textSpan = document.createElement('span')
          textSpan.className = 'thinking-text'
          textSpan.textContent = `${tf('thought', 'Thought: ')}0.0s`
          summary.appendChild(textSpan)
          const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          chevron.setAttribute('class', 'thinking-chevron')
          chevron.setAttribute('width', '12')
          chevron.setAttribute('height', '12')
          chevron.setAttribute('viewBox', '0 0 24 24')
          chevron.setAttribute('fill', 'none')
          chevron.setAttribute('stroke', 'currentColor')
          chevron.setAttribute('stroke-width', '3')
          chevron.setAttribute('stroke-linecap', 'round')
          chevron.setAttribute('stroke-linejoin', 'round')
          chevron.innerHTML = '<polyline points="9 18 15 12 9 6"/>'
          summary.appendChild(chevron)
          const body = document.createElement('div')
          body.className = 'thinking-body'
          thinkingEl.append(summary, body)
          bubble.prepend(thinkingEl)
          return thinkingEl
        }
        let lastRenderedLength = 0
        const scheduleRender = () => {
          if (renderTimer) return
          renderTimer = setTimeout(() => {
            renderTimer = null
            if (bubble.classList.contains('typing')) {
              bubble.className = 'chat-bubble assistant'
              bubble.innerHTML = ''
            }
            if (thinkingEl) {
              const tb = thinkingEl.querySelector('.thinking-body')
              if (tb) tb.textContent = reasoningContent
            }
            if (streamedContent.length > lastRenderedLength) {
              bubble.innerHTML = renderMarkdown(streamedContent)
              lastRenderedLength = streamedContent.length
              if (thinkingEl) bubble.prepend(thinkingEl)
              if (thinkingEl) {
                const tb = thinkingEl.querySelector('.thinking-body')
                if (tb) tb.scrollTop = tb.scrollHeight
              }
              if (isNearBottom(chat)) chat.scrollTop = chat.scrollHeight
            } else if (thinkingEl) {
              bubble.prepend(thinkingEl)
              const tb = thinkingEl.querySelector('.thinking-body')
              if (tb) tb.scrollTop = tb.scrollHeight
              if (isNearBottom(chat)) chat.scrollTop = chat.scrollHeight
            }
          }, 30)
        }
        const ipcMethod = isDeepResearch ? 'deepResearchStream' : 'webSearchStream'
        const route = routeForModel(model)
        const payload = isDeepResearch
          ? { url: route.url, model, topic: researchQuery, provider: route.provider, apiKey: route.apiKey }
          : { url: route.url, model, query: researchQuery, provider: route.provider, apiKey: route.apiKey }
        result = await window.electron[ipcMethod](payload,
          (chunk) => { streamedContent += chunk; scheduleRender() },
          (reasoning) => { if (!showThinking) return; reasoningContent += reasoning; ensureThinking(); scheduleRender() }
        )
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null }
        if (thinkingEl) {
          const tb = thinkingEl.querySelector('.thinking-body')
          if (tb) {
            tb.textContent = reasoningContent
            tb.scrollTop = tb.scrollHeight
          }
        }
      } else if (wasStreaming) {
        streamedContent = ''
        const ensureThinking = () => {
          if (thinkingEl) return thinkingEl
          thinkingEl = document.createElement('details')
          thinkingEl.className = 'thinking active'
          thinkingEl.setAttribute('open', '')
          const summary = document.createElement('summary')
          const textSpan = document.createElement('span')
          textSpan.className = 'thinking-text'
          textSpan.textContent = `${tf('thought', 'Thought: ')}0.0s`
          summary.appendChild(textSpan)
          const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          chevron.setAttribute('class', 'thinking-chevron')
          chevron.setAttribute('width', '12')
          chevron.setAttribute('height', '12')
          chevron.setAttribute('viewBox', '0 0 24 24')
          chevron.setAttribute('fill', 'none')
          chevron.setAttribute('stroke', 'currentColor')
          chevron.setAttribute('stroke-width', '3')
          chevron.setAttribute('stroke-linecap', 'round')
          chevron.setAttribute('stroke-linejoin', 'round')
          chevron.innerHTML = '<polyline points="9 18 15 12 9 6"/>'
          summary.appendChild(chevron)
          const body = document.createElement('div')
          body.className = 'thinking-body'
          thinkingEl.append(summary, body)
          bubble.prepend(thinkingEl)
          if (!thinkingTicker) thinkingTicker = setInterval(updateThinkingTime, 100)
          return thinkingEl
        }
        let lastRenderedLength = 0
        const scheduleRender = () => {
          if (renderTimer) return
          renderTimer = setTimeout(() => {
            renderTimer = null
            if (bubble.classList.contains('typing')) {
              bubble.className = 'chat-bubble assistant'
              bubble.innerHTML = ''
            }
            if (thinkingEl) {
              const tb = thinkingEl.querySelector('.thinking-body')
              if (tb) tb.textContent = reasoningContent
            }
            if (streamedContent.length > lastRenderedLength) {
              bubble.innerHTML = renderMarkdown(streamedContent)
              lastRenderedLength = streamedContent.length
              if (thinkingEl) bubble.prepend(thinkingEl)
              if (thinkingEl) {
                const tb = thinkingEl.querySelector('.thinking-body')
                if (tb) tb.scrollTop = tb.scrollHeight
              }
              if (isNearBottom(chat)) chat.scrollTop = chat.scrollHeight
            } else if (thinkingEl) {
              bubble.prepend(thinkingEl)
              const tb = thinkingEl.querySelector('.thinking-body')
              if (tb) tb.scrollTop = tb.scrollHeight
              if (isNearBottom(chat)) chat.scrollTop = chat.scrollHeight
            }
          }, 30)
        }
        result = await window.electron.sendStream(
          { ...routeForModel(model), messages: payloadMessages },
          (chunk) => { streamedContent += chunk; scheduleRender() },
          (reasoning) => {
            if (!showThinking) return
            reasoningContent += reasoning
            ensureThinking()
            scheduleRender()
          }
        )
        if (renderTimer) {
          clearTimeout(renderTimer)
          renderTimer = null
        }
        if (thinkingTicker) {
          clearInterval(thinkingTicker)
          thinkingTicker = null
        }
        if (thinkingEl) {
          const tb = thinkingEl.querySelector('.thinking-body')
          if (tb) {
            tb.textContent = reasoningContent
            tb.scrollTop = tb.scrollHeight
          }
          updateThinkingTime()
        }
      } else if (window.electron?.sendMessage) {
        result = await window.electron.sendMessage({ ...routeForModel(model), messages: payloadMessages })
      } else {
        const route = routeForModel(model)
        const data = await fetchJson(route.url, {
          method: 'POST',
          headers: apiHeaders(),
          body: route.provider === 'openai' || route.provider === 'opencode'
            ? JSON.stringify({ model, messages, stream: false })
            : JSON.stringify({ model, messages, stream: false })
        })
        const content = route.provider === 'openai' || route.provider === 'opencode' ? data?.choices?.[0]?.message?.content : data?.message?.content
        result = { ok: true, data: { message: { content } } }
      }
      if (!result.ok) throw new Error(result.error)
      if (result.aborted) stopped = true
      responseCompleted = !result.aborted
      if (responseCompleted && !creditSettled) {
        creditSettled = true
        creditUsed = Math.min(creditUsed + creditSpeed, creditLimit)
        creditSpent += creditSpeed
        saveCreditState()
        renderCreditMenu()
        if (creditUsed >= creditLimit) {
          addMessage('assistant', tf('limitedOutput', 'Credits limit reached.'))
          saveSession()
        }
      }
      if (!wasStreaming && showThinking && result.data?.reasoning) {
        thinkingEl = document.createElement('details')
        thinkingEl.className = 'thinking active'
        thinkingEl.setAttribute('open', '')
        const summary = document.createElement('summary')
        const elapsed = ((Date.now() - thinkingStartedAt) / 1000).toFixed(1)
        const textSpan = document.createElement('span')
        textSpan.className = 'thinking-text'
        textSpan.textContent = `${tf('thought', 'Thought: ')}${elapsed}s`
        summary.appendChild(textSpan)
        const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        chevron.setAttribute('class', 'thinking-chevron')
        chevron.setAttribute('width', '12')
        chevron.setAttribute('height', '12')
        chevron.setAttribute('viewBox', '0 0 24 24')
        chevron.setAttribute('fill', 'none')
        chevron.setAttribute('stroke', 'currentColor')
        chevron.setAttribute('stroke-width', '3')
        chevron.setAttribute('stroke-linecap', 'round')
        chevron.setAttribute('stroke-linejoin', 'round')
        chevron.innerHTML = '<polyline points="9 18 15 12 9 6"/>'
        summary.appendChild(chevron)
        const body = document.createElement('div')
        body.className = 'thinking-body'
        body.textContent = result.data.reasoning
        thinkingEl.append(summary, body)
        bubble.prepend(thinkingEl)
      }
      const reply =
        bubble.classList.contains('typing')
          ? (result.data?.message?.content?.trim() || '')
          : (streamedContent?.trim() || bubble.textContent.trim() || '')
      bubble.className = 'chat-bubble assistant'
      if (wasStreaming) {
        bubble.innerHTML = renderMarkdown(reply)
        if (thinkingEl) bubble.prepend(thinkingEl)
        highlightCodeBlocks(bubble)
      } else if (!stopped && reply) {
        finishTypewriter = typewriterRender(bubble, reply, null, thinkingEl)
      } else {
        bubble.innerHTML = renderMarkdown(reply)
        if (thinkingEl) bubble.prepend(thinkingEl)
        highlightCodeBlocks(bubble)
      }
      if (messages.includes(userMsg)) {
        messages.push({ role: 'assistant', content: reply })
        bubble.dataset.idx = String(messages.length - 1)
      }
    } catch (err) {
      const raw = err.message || ''
      const msg = raw.toLowerCase().includes('temporarily unavailable')
        ? 'Inference is temporarily unavailable. Please try again in a moment.'
        : raw
      bubble.className = 'chat-bubble assistant'
      bubble.textContent = `Error: ${msg}`
      showError(tf('failedReplyWarning', 'Failed to get a reply from {{model}}').replace('{{model}}', getDisplayName(model) || model) + (msg ? `: ${msg}` : ''))
    } finally {
      setStreaming(false)
      if (responseCompleted && !creditSettled) {
        creditSettled = true
        creditUsed = Math.min(creditUsed + creditSpeed, creditLimit)
        creditSpent += creditSpeed
        saveCreditState()
        renderCreditMenu()
      }
      if (messages.includes(userMsg)) saveSession()
    }
  })

  const started = Date.now()
  const savedUser = JSON.parse(localStorage.getItem('cilamai-user') || 'null')
  currentUser = savedUser && (savedUser.name || savedUser.email) ? savedUser : null
  updateUserUI()
  loadCredits()
  await loadSessionsFromDisk()
  loadModels()
  const remaining = Math.max(0, 5000 - (Date.now() - started))
  setTimeout(() => {
    hideStartup()
  }, remaining)

  const MAX_STARTUP_TIMEOUT = 8000
  setTimeout(hideStartup, MAX_STARTUP_TIMEOUT)

  resetChat()
  ensureSession()
  saveSessions()

  initFeedback()

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.reaction-btn')
    if (!btn) return
    const reaction = btn.dataset.reaction
    if (reaction === 'copy') {
      const bubble = btn.closest('.chat-row')?.querySelector('.chat-bubble')
      if (bubble) {
        navigator.clipboard.writeText(bubble.textContent || '')
        const originalSVG = btn.innerHTML
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
        setTimeout(() => { btn.innerHTML = originalSVG }, 1500)
      }
    } else if (reaction === 'refresh') {
      showNotification('Refresh', 'info')
    } else {
      const active = btn.classList.toggle('active')
      console.log(`Reaction: ${reaction} ${active ? 'added' : 'removed'}`)
    }
  })
}

function initFeedback() {
  const fv = document.querySelector('.feedback-view')
  if (!fv) return

  const typeRadios = fv.querySelectorAll('input[name="feedback-type"]')
  const stepsGroup = fv.querySelector('#feedback-steps-group')
  const msgInput = fv.querySelector('#feedback-message')
  const attachTrigger = fv.querySelector('#feedback-attach-trigger')
  const fileInput = fv.querySelector('#feedback-file-input')
  const filePreview = fv.querySelector('#feedback-file-preview')
  const removeFileBtn = fv.querySelector('#feedback-file-remove')
  const previewFilename = fv.querySelector('.preview-filename')

  typeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.value === 'bug') {
        if (stepsGroup) stepsGroup.hidden = false
        if (msgInput) msgInput.placeholder = localeData?.feedbackDescPlaceholder || 'Describe the bug you encountered...'
      } else if (radio.value === 'feature') {
        if (stepsGroup) stepsGroup.hidden = true
        if (msgInput) msgInput.placeholder = 'Describe the feature you would like to see...'
      } else if (radio.value === 'auth-billing') {
        if (stepsGroup) stepsGroup.hidden = true
        if (msgInput) msgInput.placeholder = 'Describe the authentication or billing issue...'
      } else {
        if (stepsGroup) stepsGroup.hidden = true
        if (msgInput) msgInput.placeholder = 'Share your thoughts, suggestions, or experience...'
      }
    })
  })

  if (attachTrigger && fileInput) {
    attachTrigger.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (file && filePreview && previewFilename) {
        previewFilename.textContent = file.name
        filePreview.hidden = false
        attachTrigger.hidden = true
      }
    })
  }

  if (removeFileBtn && fileInput && filePreview && attachTrigger) {
    removeFileBtn.addEventListener('click', () => {
      fileInput.value = ''
      filePreview.hidden = true
      attachTrigger.hidden = false
    })
  }

  fv.querySelectorAll('[data-action="close-feedback"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.location.hash === '#feedback') {
        window.close()
      } else {
        showChat()
      }
    })
  })

  fv.querySelector('[data-action="open-github-issues"]')?.addEventListener('click', () => {
    window.electron?.openExternal?.('https://github.com/CilamAI/CilamAI/issues/new/choose')
  })

  const form = fv.querySelector('#feedback-form')
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const msg = msgInput?.value?.trim()
      if (!msg) return
      showNotification(localeData?.feedbackSent || 'Thank you for your feedback!', 'success')
      form.reset()
      if (fileInput) fileInput.value = ''
      if (filePreview) filePreview.hidden = true
      if (attachTrigger) attachTrigger.hidden = false
      if (stepsGroup) stepsGroup.hidden = false
      if (window.location.hash === '#feedback') {
        setTimeout(() => window.close(), 1000)
      } else {
        showChat()
      }
    })
  }
}

if (window.location.hash === '#feedback') {
  document.addEventListener('DOMContentLoaded', () => {
    const tb = document.querySelector('.titlebar')
    const sb = document.querySelector('.sidebar')
    const chat = document.querySelector('.chat')
    const comp = document.querySelector('.composer')
    const wt = document.querySelector('.welcome-text')
    if (tb) tb.style.display = 'none'
    if (sb) sb.style.display = 'none'
    if (chat) chat.style.display = 'none'
    if (comp) comp.style.display = 'none'
    if (wt) wt.style.display = 'none'
    showFeedback()
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error('init failed:', err)
      hideStartup()
    })
  })
} else {
  init().catch((err) => {
    console.error('init failed:', err)
    hideStartup()
  })
}
