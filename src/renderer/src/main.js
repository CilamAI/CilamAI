import './style.css'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

const settings = JSON.parse(localStorage.getItem('ollama-settings') || '{}')
let isWin11 = false
window.electron?.getPlatformInfo?.().then((info) => {
  isWin11 = info?.isWindows11 || false
  document.documentElement.dataset.win11 = String(isWin11)
})
let provider = settings.provider || 'ollama'
let baseUrl = settings.url || 'http://localhost:11434'
let openaiUrl = settings.openaiUrl || 'https://console.opencode.ai/inference/openai/v1'
let apiKey = settings.apiKey || ''
let theme = settings.theme || 'dark'
let resolvedTheme = theme
const applyTheme = () => {
  resolvedTheme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = resolvedTheme
}
applyTheme()
const systemMedia = matchMedia('(prefers-color-scheme: dark)')
systemMedia.addEventListener('change', () => {
  if (theme === 'system') applyTheme()
})
const isOpenAI = () => provider === 'openai'
const chatUrl = () => (isOpenAI() ? `${openaiUrl}/chat/completions` : `${baseUrl}/api/chat`)
const tagsUrl = () => (isOpenAI() ? `${openaiUrl}/models` : `${baseUrl}/api/tags`)
const apiHeaders = () =>
  isOpenAI() && apiKey ? { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } : { 'Content-Type': 'application/json' }
const messages = []

function createAvatar(role) {
  const avatar = document.createElement('div')
  avatar.className = 'chat-avatar avatar'
  avatar.innerHTML =
    role === 'user'
      ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`
      : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/></svg>`
  return avatar
}

function showNotification(message, type = 'error') {
  const toast = document.querySelector('.notification')
  if (!toast) return
  toast.textContent = message
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

async function fetchJson(url, options) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.error || data?.message || `HTTP ${res.status}`
    throw new Error(detail)
  }
  return data
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function renderMarkdown(text) {
  if (!text) return ''
  const escaped = escapeHtml(text)

  const lines = escaped.split('\n')
  const result = []
  let inCodeBlock = false
  let codeBlockContent = []
  let codeLang = 'plaintext'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
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
      result.push(`<h4>${renderInline(line.slice(5))}</h4>`)
      continue
    }
    if (line.startsWith('### ')) {
      result.push(`<h3>${renderInline(line.slice(4))}</h3>`)
      continue
    }
    if (line.startsWith('## ')) {
      result.push(`<h2>${renderInline(line.slice(3))}</h2>`)
      continue
    }
    if (line.startsWith('# ')) {
      result.push(`<h1>${renderInline(line.slice(2))}</h1>`)
      continue
    }
    if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
      result.push('<hr>')
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      result.push(`<li>${renderInline(line.slice(2))}</li>`)
      continue
    }
    if (/^\d+\.\s/.test(line)) {
      result.push(`<li>${renderInline(line.replace(/^\d+\.\s/, ''))}</li>`)
      continue
    }

    result.push(`<p>${renderInline(line)}</p>`)
  }

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

function highlightCodeBlocks(bubble) {
  bubble.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block)
  })
}

function renderInline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
}

function addMessage(role, content) {
  const main = document.querySelector('.main')
  const chat = document.querySelector('.chat')
  main.classList.add('has-chat')

  const row = document.createElement('div')
  row.className = `chat-row ${role}`

  const bubble = document.createElement('div')
  bubble.className = `chat-bubble ${role}`
  bubble.innerHTML = renderMarkdown(content)
  highlightCodeBlocks(bubble)
  row.append(bubble)
  chat.append(row)
  chat.scrollTop = chat.scrollHeight
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
  bubble.innerHTML = '<svg class="typing-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g fill="currentColor" stroke="currentColor" stroke-width="15"><rect width="30" height="30" x="125" y="45"><animateTransform attributeName="transform" type="translate" calcMode="spline" dur="2" values="0 0;0 80;0 80;0 80;-80 80;" keySplines=".5 0 .5 1;.5 0 .5 1;.5 0 .5 1;.5 0 .5 1" repeatCount="indefinite"></animateTransform></rect><rect width="30" height="30" x="45" y="45"><animateTransform attributeName="transform" type="translate" calcMode="spline" dur="2" values="0 0;0 0;80 0;80 0;80 0;" keySplines=".5 0 .5 1;.5 0 .5 1;.5 0 .5 1;.5 0 .5 1" repeatCount="indefinite"></animateTransform></rect><rect width="30" height="30" x="45" y="125"><animateTransform attributeName="transform" type="translate" calcMode="spline" dur="2" values="0 0;0 0 ;0 0;0 -80;0 -80;" keySplines=".5 0 .5 1;.5 0 .5 1;.5 0 .5 1;.5 0 .5 1" repeatCount="indefinite"></animateTransform></rect></g></svg>'
  row.append(bubble)
  chat.append(row)
  chat.scrollTop = chat.scrollHeight
  return bubble
}

async function loadModels() {
  const menu = document.querySelector('.model-menu')
  const options = document.querySelector('.model-options')
  const name = document.querySelector('.model-name')
  if (!menu || !options || !name) return
  try {
    const data = await fetchJson(tagsUrl(), { headers: apiHeaders() })
    let items = []
    if (isOpenAI()) {
      items = (data.data || []).map((m) => {
        const fullName = m.id
        return { fullName, displayName: fullName }
      })
    } else {
      items = (data.models || []).map((m) => {
        const fullName = m.name
        const displayName = fullName.replace(/:cloud$/, '')
        return { fullName, displayName }
      })
    }
    if (items.length === 0) return
    options.innerHTML = items
      .map((item) => `<button type="button" class="model-option" data-model="${item.fullName}">${item.displayName}</button>`)
      .join('')
    options.querySelectorAll('[data-model]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fullName = btn.dataset.model
        const displayName = fullName.replace(/:cloud$/, '')
        name.textContent = displayName
        name.dataset.fullModel = fullName
        menu.hidden = true
      })
    })
    const defaultItem = items.find((i) => i.displayName === 'gemma4:26b') || items[0]
    name.textContent = defaultItem.displayName
    name.dataset.fullModel = defaultItem.fullName
  } catch (err) {
    showWarning(`Cannot load models: ${err.message}`)
  }
}

function showSettings() {
  document.querySelector('.settings-view').hidden = false
  document.querySelector('.welcome-text').hidden = true
  document.querySelector('.chat').hidden = true
  document.querySelector('.composer').hidden = true
}

function showChat() {
  document.querySelector('.settings-view').hidden = true
  document.querySelector('.chat').hidden = false
  document.querySelector('.composer').hidden = false
  const main = document.querySelector('.main')
  document.querySelector('.welcome-text').hidden = main.classList.contains('has-chat')
}

function resetChat() {
  messages.length = 0
  document.querySelector('.chat').innerHTML = ''
  document.querySelector('.main').classList.remove('has-chat')
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

async function init() {
  const input = document.querySelector('.composer-input')
  const form = document.querySelector('.composer')
  const modelMenu = document.querySelector('.model-menu')

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'settings') {
        showSettings()
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
      applyTheme()
      settings.theme = radio.value
      localStorage.setItem('ollama-settings', JSON.stringify(settings))
    })
  })

  document.querySelectorAll('input[name="provider"]').forEach((radio) => {
    if (radio.value === provider) radio.checked = true
    radio.addEventListener('change', () => {
      if (!radio.checked) return
      provider = radio.value
      settings.provider = provider
      localStorage.setItem('ollama-settings', JSON.stringify(settings))
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
      localStorage.setItem('ollama-settings', JSON.stringify(settings))
      loadModels()
    })
  }

  const keyInput = document.querySelector('#api-key')
  if (keyInput) {
    keyInput.value = apiKey
    keyInput.addEventListener('change', () => {
      apiKey = keyInput.value.trim()
      settings.apiKey = apiKey
      localStorage.setItem('ollama-settings', JSON.stringify(settings))
    })
  }

  document.querySelector('#refresh-models')?.addEventListener('click', async () => {
    await loadModels()
    showNotification('Models refreshed', 'warning')
  })

  const fontToggle = document.querySelector('#font-select-toggle')
  const fontMenu = document.querySelector('.font-select-menu')
  const fontLabel = document.querySelector('#font-select-label')
  if (fontToggle && fontMenu) {
    const labels = { 13: 'Small (13px)', 14: 'Default (14px)', 15: 'Large (15px)', 17: 'Extra large (17px)' }
    const applyFont = (size) => {
      document.documentElement.style.setProperty('--chat-font-size', `${size}px`)
      if (fontLabel) fontLabel.textContent = labels[size] || `${size}px`
    }
    fontToggle.addEventListener('click', (e) => {
      e.stopPropagation()
      const rect = fontMenu.parentElement.getBoundingClientRect()
      fontMenu.classList.toggle('open-up', rect.bottom + fontMenu.offsetHeight > window.innerHeight)
      fontMenu.hidden = !fontMenu.hidden
    })
    fontMenu.querySelectorAll('.font-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        const size = opt.dataset.fontSize
        settings.fontSize = size
        localStorage.setItem('ollama-settings', JSON.stringify(settings))
        applyFont(size)
        fontMenu.hidden = true
      })
    })
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.font-select')) fontMenu.hidden = true
    })
    applyFont(settings.fontSize || '14')
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

  const streamCheck = document.querySelector('#chat-stream')
  if (streamCheck) {
    streamCheck.checked = settings.stream !== false
    streamCheck.addEventListener('change', () => {
      settings.stream = streamCheck.checked
      localStorage.setItem('ollama-settings', JSON.stringify(settings))
    })
  }

  document.querySelector('#clear-chat')?.addEventListener('click', () => {
    resetChat()
    showNotification('Conversation cleared', 'warning')
  })

  const selectModel = (fullName) => {
    const name = document.querySelector('.model-name')
    if (!name) return
    name.textContent = fullName.replace(/:cloud$/, '')
    name.dataset.fullModel = fullName
  }

  const syncModelSubmenu = () => {
    const sub = document.querySelector('.tb-submenu-menu')
    if (!sub) return
    const current = document.querySelector('.model-name')?.dataset.fullModel
    sub.innerHTML = ''
    document.querySelectorAll('.model-option').forEach((opt) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = opt.dataset.model.replace(/:cloud$/, '')
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
        if (action === 'new-chat') resetChat()
        if (action === 'settings') showSettings()
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
        close()
      })
    })
  })
  document.addEventListener('click', () => {
    document.querySelectorAll('.tb-menu-item').forEach((i) => i.classList.remove('open'))
  })

  window.electron?.onNewChatTask?.(resetChat)

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
  window.electron?.maximize?.()

  const pendingImages = []
  document.querySelector('[data-upload]')?.addEventListener('click', async () => {
    const result = await window.electron?.uploadFile?.()
    if (!result?.ok) return
    const input = document.querySelector('.composer-input')
    const ext = (result.name || '').split('.').pop().toLowerCase()
    const BLOCKED_EXTS = ['mp4', 'mp3', 'mkv', 'mov', 'avi', 'wav', 'flac', 'ogg', 'm4a', 'webm']
    if (BLOCKED_EXTS.includes(ext)) {
      showWarning(`.${ext} files are not supported`)
      return
    }
    const MAX_IMAGE_MB = 10
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) {
      if (result.size > MAX_IMAGE_MB * 1024 * 1024) {
        showWarning(`Image too large: ${(result.size / 1024 / 1024).toFixed(1)} MB (max ${MAX_IMAGE_MB} MB)`)
        return
      }
      const filesBox = document.querySelector('.composer-files')
      if (!filesBox) return
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
      })
      const file = { name: result.name, data: result.data, ext }
      pendingImages.push(file)
      filesBox.append(chip)
      filesBox.hidden = false
    } else {
      input.value = (input.value ? input.value + ' ' : '') + `[file: ${result.name}]`
    }
    input.focus()
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
  })

  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = input?.value.trim()
    if (!text && pendingImages.length === 0) return
    if (input) input.value = ''
    const filesBox = document.querySelector('.composer-files')
    if (filesBox) {
      filesBox.innerHTML = ''
      filesBox.hidden = true
    }
    const imageMentions = pendingImages.map((f) => `[image: ${f.name}]`).join(' ')
    const fullText = imageMentions ? (text ? `${imageMentions} ${text}` : imageMentions) : text
    const images = pendingImages.slice()
    pendingImages.length = 0

    const userBubble = addMessage('user', text || '')
    for (const img of images) {
      const el = document.createElement('img')
      el.className = 'chat-image'
      el.src = `data:image/${img.ext === 'svg' ? 'svg+xml' : img.ext};base64,${img.data}`
      el.alt = img.name
      userBubble.append(el)
    }
    messages.push({ role: 'user', content: fullText })
    const payloadMessages = messages.map((m) => ({ ...m }))
    const lastUser = payloadMessages[payloadMessages.length - 1]
    if (images.length > 0 && isOpenAI()) {
      const parts = [
        ...(text ? [{ type: 'text', text }] : []),
        ...images.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:image/${img.ext === 'svg' ? 'svg+xml' : img.ext};base64,${img.data}` }
        }))
      ]
      lastUser.content = parts
    } else if (images.length > 0 && !isOpenAI()) {
      lastUser.images = images.map((img) => img.data)
    }

    const modelEl = document.querySelector('.model-name')
    const model = modelEl?.dataset?.fullModel || modelEl?.textContent.trim() || 'gemma4:26b'
    const bubble = addTypingIndicator()
    const chat = document.querySelector('.chat')
    const sendBtn = document.querySelector('.composer-btn.send')
    const stopBtn = document.querySelector('.composer-btn.stop')
    let stopped = false
    const setStreaming = (on) => {
      if (sendBtn) sendBtn.hidden = on
      if (stopBtn) stopBtn.hidden = !on
      if (input) input.disabled = on
    }
    setStreaming(true)
    stopBtn?.addEventListener('click', () => {
      stopped = true
      window.electron?.stopStream?.()
    })

    try {
      let result
      let streamedContent = ''
      let renderTimer = null
      if (settings.stream !== false && window.electron?.sendStream) {
        streamedContent = ''
        let reasoningContent = ''
        let thinkingEl = null
        const ensureThinking = () => {
          if (thinkingEl) return thinkingEl
          thinkingEl = document.createElement('details')
          thinkingEl.className = 'thinking'
          const summary = document.createElement('summary')
          summary.textContent = 'Thinking'
          const body = document.createElement('div')
          body.className = 'thinking-body'
          thinkingEl.append(summary, body)
          bubble.prepend(thinkingEl)
          return thinkingEl
        }
        const scheduleRender = () => {
          if (renderTimer) return
          renderTimer = setTimeout(() => {
            renderTimer = null
            if (bubble.classList.contains('typing')) {
              bubble.className = 'chat-bubble assistant'
              bubble.innerHTML = ''
            }
            if (thinkingEl) {
              thinkingEl.querySelector('.thinking-body').textContent = reasoningContent
            }
            bubble.innerHTML = renderMarkdown(streamedContent)
            if (thinkingEl) bubble.prepend(thinkingEl)
            highlightCodeBlocks(bubble)
            chat.scrollTop = chat.scrollHeight
          }, 30)
        }
        result = await window.electron.sendStream(
          { url: chatUrl(), model, messages: payloadMessages, provider, apiKey },
          (chunk) => {
            streamedContent += chunk
            scheduleRender()
          },
          (reasoning) => {
            reasoningContent += reasoning
            ensureThinking()
            scheduleRender()
          }
        )
        if (renderTimer) {
          clearTimeout(renderTimer)
          renderTimer = null
        }
        if (thinkingEl) {
          thinkingEl.querySelector('.thinking-body').textContent = reasoningContent
        }
      } else if (window.electron?.sendMessage) {
        result = await window.electron.sendMessage({ url: chatUrl(), model, messages: payloadMessages, provider, apiKey })
      } else {
        const data = await fetchJson(chatUrl(), {
          method: 'POST',
          headers: apiHeaders(),
          body: isOpenAI()
            ? JSON.stringify({ model, messages, stream: false })
            : JSON.stringify({ model, messages, stream: false })
        })
        const content = isOpenAI() ? data?.choices?.[0]?.message?.content : data?.message?.content
        result = { ok: true, data: { message: { content } } }
      }
      if (!result.ok) throw new Error(result.error)
      if (result.aborted) stopped = true
      const reply =
        bubble.classList.contains('typing')
          ? (result.data?.message?.content?.trim() || '(empty response)')
          : (streamedContent?.trim() || bubble.textContent.trim() || '(empty response)')
      bubble.className = 'chat-bubble assistant'
      bubble.innerHTML = renderMarkdown(reply)
      if (thinkingEl) bubble.prepend(thinkingEl)
      highlightCodeBlocks(bubble)
      messages.push({ role: 'assistant', content: reply })
      if (stopped) {
        const note = document.createElement('div')
        note.className = 'stream-stopped'
        note.textContent = 'Generation stopped'
        bubble.append(note)
      } else if (reply === '(empty response)') {
        showWarning(`Model ${model} returned an empty response`)
      }
    } catch (err) {
      bubble.className = 'chat-bubble assistant'
      bubble.textContent = `Error: ${err.message}`
      showError(`Failed to get a reply from ${model}: ${err.message}`)
    } finally {
      setStreaming(false)
    }
  })

  const started = Date.now()
  await loadModels()
  const remaining = Math.max(0, 5000 - (Date.now() - started))
  setTimeout(hideStartup, remaining)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
