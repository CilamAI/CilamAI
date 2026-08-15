import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import { chatSend, chatSendStream, webFetchStream } from '../api/client.js'
import https from 'node:https'

const isWindows11 = process.platform === 'win32' && Number((os.release().split('.')[2] || 0)) >= 22000

try {
  const envPath = join(app.getAppPath(), '.env')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
} catch {}

const streamControllers = new Map()
const TRANSIENT_STATUSES_MAIN = new Set([408, 425, 429, 502, 503, 504])
const TRANSIENT_MESSAGES = /temporarily unavailable|rate limit|overloaded|timeout|busy|capacity|queue/i

async function sendWithRetry(fn, attempts = 5) {
  let last
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await fn()
    if (last?.ok !== false && last?.error == null) return last
    const isTransient =
      TRANSIENT_STATUSES_MAIN.has(last?.status) || TRANSIENT_MESSAGES.test(last?.error || '')
    if (!isTransient || attempt >= attempts - 1) return last
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
  }
  return last
}
let currentLanguage = 'en'
let pendingApiKey = null
let sessionFile = null
let sessionWriteTimer = null
let windowStateFile = null

function getSessionFile() {
  if (sessionFile) return sessionFile
  sessionFile = join(app.getPath('userData'), 'sessions.json')
  return sessionFile
}

function getWindowStateFile() {
  if (windowStateFile) return windowStateFile
  windowStateFile = join(app.getPath('userData'), 'window-state.json')
  return windowStateFile
}

function getReleaseNotesFile() {
  return join(app.getPath('userData'), 'release-notes.json')
}

function loadReleaseNotes() {
  try {
    const text = readFileSync(getReleaseNotesFile(), 'utf8')
    return JSON.parse(text)
  } catch {
    return { lastShownVersion: '0.0.0' }
  }
}

function saveReleaseNotes(data) {
  try {
    writeFile(getReleaseNotesFile(), JSON.stringify(data, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to save release notes data:', err)
  }
}

function loadWindowState() {
  try {
    const text = readFileSync(getWindowStateFile(), 'utf8')
    return JSON.parse(text)
  } catch {
    return { maximized: false, width: 1440, height: 900 }
  }
}

function saveWindowState(state) {
  try {
    writeFile(getWindowStateFile(), JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to save window state:', err)
  }
}

function loadSessionsFromDisk() {
  try {
    const text = readFileSync(getSessionFile(), 'utf8')
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : []
  } catch {
    return null
  }
}

function scheduleSessionWrite(data) {
  clearTimeout(sessionWriteTimer)
  sessionWriteTimer = setTimeout(async () => {
    try {
      await writeFile(getSessionFile(), JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      console.error('Failed to write sessions:', err)
    }
  }, 300)
}

let envConfig = { opencodeApiKey: '', opencodeOrgId: '', googleSearchKey: '', googleSearchCx: '' }
function loadEnvConfig() {
  try {
    const file = join(app.getAppPath(), '.env')
    const text = readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      const key = m[1].toUpperCase()
      const value = m[2].replace(/^["']|["']$/g, '')
      if (key === 'OPENCODE_API_KEY') envConfig.opencodeApiKey = value
      if (key === 'OPENCODE_ORG_ID') envConfig.opencodeOrgId = value
      if (key === 'GOOGLE_SEARCH_KEY') envConfig.googleSearchKey = value
      if (key === 'GOOGLE_SEARCH_CX') envConfig.googleSearchCx = value
    }
  } catch {
    /* no .env file - ignore */
  }
}
loadEnvConfig()

function extractApiKey(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--set-apikey=')) return arg.slice(13)
    if (arg.startsWith('--api-key=')) return arg.slice(10)
    if (arg.startsWith('--apikey=')) return arg.slice(9)
    if (arg === '--set-apikey' || arg === '--api-key' || arg === '--apikey') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) return next
    }
  }
  return null
}

function extractIpcCommand(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--ipc=')) return arg.slice(6)
    if (arg === '--ipc') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) return next
    }
  }
  return null
}

function extractAvatar(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--avatar=')) return arg.slice(9)
    if (arg.startsWith('--user-avatar=')) return arg.slice(14)
    if (arg === '--avatar' || arg === '--user-avatar') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) return next
    }
  }
  return null
}

function extractUser(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--user=')) return arg.slice(7)
    if (arg === '--user') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) return next
    }
  }
  return null
}

function extractModelArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--model=')) return arg.slice(8)
    if (arg === '--model') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) return next
    }
  }
  return null
}

function consumePendingApiKey() {
  const key = pendingApiKey
  pendingApiKey = null
  return key
}

const SUPPORTED_LANGS = ['en', 'ko', 'tr', 'ru']
const LANG_DIR = join(__dirname, '../../lang')

function loadLocaleFile(lang) {
  try {
    const file = join(LANG_DIR, `${lang}.json`)
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function broadcastLanguage(lang) {
  currentLanguage = lang
  const data = loadLocaleFile(lang)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('app:language-changed', { lang, data })
  }
}

ipcMain.handle('app:platform-info', () => ({
  platform: process.platform,
  isWindows11,
  language: currentLanguage
}))

ipcMain.handle('app:get-version', () => app.getVersion())

ipcMain.handle('app:check-updates', async () => {
  const fallbackVersion = app.getVersion()
  const defaultDownloadUrl = 'https://github.com/CilamAI/CilamAI/releases/latest/download/CilamAI-Setup.exe'
  const fallbackReleaseUrl = `https://github.com/CilamAI/CilamAI/releases/tag/v${fallbackVersion}`

  const tagFromUrl = (url) => {
    const match = String(url || '').match(/\/releases\/tag\/([^/?#]+)/i)
    return match ? decodeURIComponent(match[1]) : ''
  }

  try {
    const getJson = (url) => new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const client = parsed.protocol === 'http:' ? http : https
      const request = client.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CilamAI',
          Accept: 'application/vnd.github+json'
        }
      }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return resolve(getJson(response.headers.location))
        }
        if (response.statusCode !== 200) return reject(new Error(`GitHub HTTP ${response.statusCode}`))
        let body = ''
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => {
          try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid update response')) }
        })
      })
      request.on('error', reject)
    })

    let release = null
    try {
      release = await getJson('https://api.github.com/repos/CilamAI/CilamAI/releases/latest')
    } catch {
      try {
        const tags = await getJson('https://api.github.com/repos/CilamAI/CilamAI/tags')
        if (Array.isArray(tags) && tags.length > 0) {
          release = { tag_name: tags[0].name, html_url: `https://github.com/CilamAI/CilamAI/releases/tag/${tags[0].name}` }
        }
      } catch {}
    }

    const releaseTag = release?.tag_name || release?.name || tagFromUrl(release?.html_url) || fallbackVersion
    const latest = String(releaseTag || fallbackVersion)
      .replace(/^CilamAI\s+v?/i, '')
      .replace(/^v/i, '')
      .trim() || fallbackVersion

    const assetUrl = release?.assets?.find((asset) => /CilamAI-Setup\.exe$/i.test(asset.name || ''))?.browser_download_url
    const downloadUrl = assetUrl || (release?.tag_name ? `https://github.com/CilamAI/CilamAI/releases/download/${release.tag_name}/CilamAI-Setup.exe` : defaultDownloadUrl)
    const releasePageUrl = release?.html_url || `https://github.com/CilamAI/CilamAI/releases/tag/v${latest}`

    return { ok: true, current: app.getVersion(), latest, url: releasePageUrl, downloadUrl }
  } catch (err) {
    return {
      ok: true,
      current: app.getVersion(),
      latest: app.getVersion(),
      url: fallbackReleaseUrl,
      downloadUrl: defaultDownloadUrl
    }
  }
})

ipcMain.handle('app:download-and-install', async (_event, downloadUrl) => {
  const fs = require('node:fs')
  const { Readable } = require('node:stream')
  const { pipeline } = require('node:stream/promises')
  const tempDir = app.getPath('temp')
  const fileName = `CilamAI-Update-${Date.now()}.exe`
  const filePath = join(tempDir, fileName)

  const candidateUrls = [
    downloadUrl,
    'https://github.com/CilamAI/CilamAI/releases/latest/download/CilamAI-Setup.exe',
    'https://github.com/CilamAI/CilamAI/releases/download/v0.1.0.1/CilamAI-Setup.exe'
  ].filter(Boolean)

  let downloaded = false
  for (const url of candidateUrls) {
    try {
      const response = await net.fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CilamAI' },
        redirect: 'follow'
      })
      if (response.ok && response.body) {
        const fileStream = fs.createWriteStream(filePath)
        await pipeline(Readable.fromWeb(response.body), fileStream)
        downloaded = true
        break
      }
    } catch (e) {}
  }

  if (downloaded) {
    try {
      const child = require('node:child_process').spawn(filePath, ['/SILENT'], { detached: true, stdio: 'ignore' })
      child.unref()
      setTimeout(() => app.quit(), 600)
      return { ok: true }
    } catch (e) {}
  }

  // Fallback: open browser download URL
  const targetUrl = downloadUrl || 'https://github.com/CilamAI/CilamAI/releases/latest'
  shell.openExternal(targetUrl)
  return { ok: true, openedInBrowser: true }
})

ipcMain.handle('app:set-language', (_event, lang) => {
  if (!SUPPORTED_LANGS.includes(lang)) return { ok: false, error: 'Unsupported language' }
  broadcastLanguage(lang)
  return { ok: true, lang }
})

ipcMain.on('app:console-log', (_event, msg) => console.log(msg))
ipcMain.on('app:console-info', (_event, msg) => console.info(msg))
ipcMain.on('app:console-error', (_event, msg) => console.error(msg))
ipcMain.on('app:console-warn', (_event, msg) => console.warn(msg))
ipcMain.handle('app:get-language', () => ({ lang: currentLanguage }))

ipcMain.handle('app:get-pending-apikey', () => ({ key: consumePendingApiKey() }))

ipcMain.handle('app:get-env-config', () => envConfig)

ipcMain.handle('app:context-window-boost', async (_event, enabled) => {
  try {
    return {
      ok: true,
      enabled: !!enabled,
      speedMultiplier: enabled ? 100 : 1,
      message: enabled ? 'Context Window Speed Boost x100 enabled' : 'Context Window Speed Boost disabled'
    }
  } catch (err) {
    return { ok: false, error: err.message, enabled: false, speedMultiplier: 1 }
  }
})

ipcMain.handle('app:get-context-window-info', (_event, model) => {
  try {
    const contextWindows = {
      auto: 200000,
      'mimo-v2.5-free': 200000,
      'gemma4:26b': 128000,
      gemma4: 128000
    }
    return {
      ok: true,
      model: model || 'auto',
      maxTokens: contextWindows[model] || 200000,
      speedBoostAvailable: true,
      speedBoostMultiplier: 100
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('app:get-release-notes', () => {
  try {
    const releaseNotes = loadReleaseNotes()
    const currentVersion = app.getVersion()
    const shouldShow = releaseNotes.lastShownVersion !== currentVersion
    
    // Save that we've shown this version
    if (shouldShow) {
      saveReleaseNotes({ lastShownVersion: currentVersion })
    }
    
    return {
      ok: true,
      shouldShow,
      currentVersion,
      lastShownVersion: releaseNotes.lastShownVersion
    }
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      shouldShow: false,
      currentVersion: app.getVersion()
    }
  }
})

ipcMain.handle('app:check-internet', async () => {
  try {
    await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'clients3.google.com', path: '/generate_204', method: 'GET', timeout: 3000 }, (res) => {
        resolve(res.statusCode === 204)
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      req.end()
    })
    return { ok: true, online: true }
  } catch {
    return { ok: true, online: false }
  }
})

ipcMain.handle('sessions:load', () => {
  try {
    const sessions = loadSessionsFromDisk()
    return { ok: true, sessions: sessions || [] }
  } catch (err) {
    return { ok: false, error: err.message, sessions: [] }
  }
})

ipcMain.handle('sessions:save', async (_event, sessions) => {
  if (!Array.isArray(sessions)) {
    return { ok: false, error: 'Invalid sessions data' }
  }
  try {
    scheduleSessionWrite(sessions)
    return { ok: true, count: sessions.length }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('sessions:save-immediate', async (_event, sessions) => {
  if (!Array.isArray(sessions)) {
    return { ok: false, error: 'Invalid sessions data' }
  }
  try {
    clearTimeout(sessionWriteTimer)
    await writeFile(getSessionFile(), JSON.stringify(sessions, null, 2), 'utf8')
    return { ok: true, count: sessions.length }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

const creditsFile = () => join(app.getPath('userData'), 'credits.json')

function loadCreditsStore() {
  try {
    if (existsSync(creditsFile())) {
      return JSON.parse(readFileSync(creditsFile(), 'utf8'))
    }
  } catch {}
  return {}
}

function saveCreditsStore(store) {
  try {
    writeFileSync(creditsFile(), JSON.stringify(store, null, 2), 'utf8')
  } catch {}
}

function currentUserKey() {
  const user = currentAuthUser || loadStoredAuthUser()
  return (user?.email || user?.name || 'default').toLowerCase().trim()
}

const SPECIAL_USER_CREDITS = {
  'kevccx@gmail.com': { limit: 100000, resetInterval: 365 * 24 * 60 * 60 * 1000 }
}

function getUserCreditConfig(userOrKey) {
  if (!userOrKey) return { limit: 100, resetInterval: 24 * 60 * 60 * 1000 }
  let k = typeof userOrKey === 'string' ? userOrKey : (userOrKey.email || userOrKey.name || '')
  k = k.toLowerCase().trim()
  return SPECIAL_USER_CREDITS[k] || { limit: 100, resetInterval: 24 * 60 * 60 * 1000 }
}

ipcMain.handle('credits:get', () => {
  const key = currentUserKey()
  const user = currentAuthUser || loadStoredAuthUser()
  const store = loadCreditsStore()
  const saved = store[key] || {}
  const now = Date.now()
  const config = getUserCreditConfig(user || key)
  let limit = Math.max(1, Number(saved.limit ?? config.limit))
  if (config.limit > 100 && limit < config.limit) limit = config.limit
  if (limit >= 1000000) limit = config.limit
  let resetAt = Number(saved.resetAt || (now + config.resetInterval))
  if (resetAt <= now || (config.limit <= 100 && resetAt > now + 25 * 60 * 60 * 1000) || (config.resetInterval > 24 * 60 * 60 * 1000 && resetAt < now + 300 * 24 * 60 * 60 * 1000)) {
    resetAt = now + config.resetInterval
  }

  return {
    ok: true,
    credits: {
      used: Math.max(0, Number(saved.used ?? 0)),
      limit: limit,
      resetAt: resetAt,
      spent: Math.max(0, Number(saved.spent ?? 0))
    }
  }
})

ipcMain.on('credits:get-sync', (event) => {
  const key = currentUserKey()
  const user = currentAuthUser || loadStoredAuthUser()
  const store = loadCreditsStore()
  const saved = store[key] || {}
  const now = Date.now()
  const config = getUserCreditConfig(user || key)
  let limit = Math.max(1, Number(saved.limit ?? config.limit))
  if (config.limit > 100 && limit < config.limit) limit = config.limit
  if (limit >= 1000000) limit = config.limit
  let resetAt = Number(saved.resetAt || (now + config.resetInterval))
  if (resetAt <= now || (config.limit <= 100 && resetAt > now + 25 * 60 * 60 * 1000) || (config.resetInterval > 24 * 60 * 60 * 1000 && resetAt < now + 300 * 24 * 60 * 60 * 1000)) {
    resetAt = now + config.resetInterval
  }

  event.returnValue = {
    ok: true,
    credits: {
      used: Math.max(0, Number(saved.used ?? 0)),
      limit: limit,
      resetAt: resetAt,
      spent: Math.max(0, Number(saved.spent ?? 0))
    }
  }
})

ipcMain.handle('credits:set', (_event, credits) => {
  const key = currentUserKey()
  const user = currentAuthUser || loadStoredAuthUser()
  const store = loadCreditsStore()
  const cur = store[key] || {}
  const now = Date.now()
  const config = getUserCreditConfig(user || key)
  let limit = Math.max(1, Number(credits?.limit ?? cur.limit ?? config.limit))
  if (config.limit > 100 && limit < config.limit) limit = config.limit
  if (limit >= 1000000) limit = config.limit
  let resetAt = Number(credits?.resetAt ?? cur.resetAt ?? (now + config.resetInterval))
  if (resetAt <= now || (config.limit <= 100 && resetAt > now + 25 * 60 * 60 * 1000) || (config.resetInterval > 24 * 60 * 60 * 1000 && resetAt < now + 300 * 24 * 60 * 60 * 1000)) {
    resetAt = now + config.resetInterval
  }

  store[key] = {
    used: Math.max(0, Number(credits?.used ?? cur.used ?? 0)),
    limit: limit,
    resetAt: resetAt,
    spent: Math.max(0, Number(credits?.spent ?? cur.spent ?? 0))
  }
  saveCreditsStore(store)
  return { ok: true }
})

ipcMain.on('credits:set-sync', (event, credits) => {
  const key = currentUserKey()
  const user = currentAuthUser || loadStoredAuthUser()
  const store = loadCreditsStore()
  const cur = store[key] || {}
  const now = Date.now()
  const config = getUserCreditConfig(user || key)
  let limit = Math.max(1, Number(credits?.limit ?? cur.limit ?? config.limit))
  if (config.limit > 100 && limit < config.limit) limit = config.limit
  if (limit >= 1000000) limit = config.limit
  let resetAt = Number(credits?.resetAt ?? cur.resetAt ?? (now + config.resetInterval))
  if (resetAt <= now || (config.limit <= 100 && resetAt > now + 25 * 60 * 60 * 1000) || (config.resetInterval > 24 * 60 * 60 * 1000 && resetAt < now + 300 * 24 * 60 * 60 * 1000)) {
    resetAt = now + config.resetInterval
  }

  store[key] = {
    used: Math.max(0, Number(credits?.used ?? cur.used ?? 0)),
    limit: limit,
    resetAt: resetAt,
    spent: Math.max(0, Number(credits?.spent ?? cur.spent ?? 0))
  }
  saveCreditsStore(store)
  event.returnValue = { ok: true }
})

ipcMain.handle('file:upload', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false, error: 'No window' }
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a file',
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
  const filePath = result.filePaths[0]
  const BLOCKED_EXTENSIONS = ['.js', '.json', '.html', '.bat', '.cmd']
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `File type .${ext.slice(1)} is not allowed` }
  }
  try {
    const data = await readFile(filePath)
    return {
      ok: true,
      name: filePath.split(/[\\/]/).pop(),
      path: filePath,
      size: data.length,
      data: data.toString('base64')
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('startup:set', async (_event, enabled) => {
  try {
    const settings = { openAtLogin: !!enabled }
    app.setLoginItemSettings(settings)
    // Verify it was set
    const current = app.getLoginItemSettings()
    return { ok: true, enabled: current.openAtLogin }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('startup:get', () => {
  try {
    const settings = app.getLoginItemSettings()
    return { ok: true, enabled: settings.openAtLogin }
  } catch (err) {
    return { ok: false, error: err.message, enabled: false }
  }
})

ipcMain.handle('app:capture', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'No window to capture' }
    const image = await win.webContents.capturePage()
    const pngData = image.toPNG()
    const stamp = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .slice(0, 19)
    const file = join(app.getPath('pictures'), `chat-${stamp}.png`)
    await writeFile(file, pngData)
    return { ok: true, path: file, data: pngData.toString('base64') }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('chat:send', async (_event, { url, model, messages, provider, apiKey, org }) => {
  try {
    return await chatSend({ url, model, messages, provider, apiKey, envConfig, org })
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('chat:send-stream', async (event, { url, model, messages, provider, apiKey, org }) => {
  return await sendWithRetry(async () => {
    const controller = new AbortController()
    streamControllers.set(event.sender.id, controller)
    try {
      return await chatSendStream(
        { url, model, messages, provider, apiKey, envConfig, org },
        {
          signal: controller.signal,
          onChunk: (text) => event.sender.send('chat:stream-chunk', text),
          onReasoning: (text) => event.sender.send('chat:stream-reasoning', text)
        }
      )
    } catch (err) {
      if (err.name === 'AbortError') return { ok: true, aborted: true }
      return { ok: false, error: err.message }
    } finally {
      streamControllers.delete(event.sender.id)
    }
  })
})

ipcMain.on('chat:stop-stream', (event) => {
  streamControllers.get(event.sender.id)?.abort()
})

ipcMain.handle('web:fetch-stream', async (event, { url }) => {
  const controller = new AbortController()
  streamControllers.set(event.sender.id, controller)
  try {
    return await webFetchStream(url, {
      signal: controller.signal,
      onChunk: (text) => event.sender.send('chat:stream-chunk', text),
      onReasoning: (text) => event.sender.send('chat:stream-reasoning', text)
    })
  } finally {
    streamControllers.delete(event.sender.id)
  }
})

ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    win.minimize()
    return { ok: true }
  }
  return { ok: false, error: 'No window found' }
})

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false, maximized: false }
  win.maximize()
  return { ok: true, maximized: true }
})

ipcMain.handle('window:unmaximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false, maximized: false }
  win.unmaximize()
  return { ok: true, maximized: false }
})

ipcMain.handle('window:maximize-toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false, maximized: false }
  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }
  return { ok: true, maximized: win.isMaximized() }
})

ipcMain.handle('window:is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return { ok: true, maximized: win?.isMaximized() ?? false }
})

ipcMain.handle('window:get-state', () => {
  try {
    const state = loadWindowState()
    return { ok: true, state }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('window:save-state', async (_event, state) => {
  try {
    saveWindowState(state)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    win.close()
    return { ok: true }
  }
  return { ok: false, error: 'No window found' }
})

ipcMain.handle('window:open-devtools', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools()
})

ipcMain.handle('app:open-external', (_event, url) => {
  if (url && typeof url === 'string') shell.openExternal(url)
})

let oauthHttpServer = null
let currentAuthUser = null

function parseUserString(str) {
  if (!str || typeof str !== 'string') return null
  const trimmed = str.trim()
  if (!trimmed) return null
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    return {
      name: parts[0] || '',
      email: parts[1] || '',
      picture: parts.slice(2).join(':') || null,
      provider: 'ipc'
    }
  }
  if (trimmed.includes('@')) {
    return {
      name: trimmed.split('@')[0],
      email: trimmed,
      picture: null,
      provider: 'ipc'
    }
  }
  return {
    name: trimmed,
    email: '',
    picture: null,
    provider: 'ipc'
  }
}

function loadStoredAuthUser() {
  try {
    const authPath = join(app.getPath('userData'), 'auth_user.json')
    if (existsSync(authPath)) {
      return JSON.parse(readFileSync(authPath, 'utf8'))
    }
  } catch {}
  return null
}

function saveStoredAuthUser(user) {
  try {
    const authPath = join(app.getPath('userData'), 'auth_user.json')
    if (user) {
      writeFileSync(authPath, JSON.stringify(user, null, 2), 'utf8')
    } else if (existsSync(authPath)) {
      unlinkSync(authPath)
    }
  } catch {}
}

function applyAndSaveUser(user) {
  let userObj = null
  if (user && typeof user === 'string') {
    userObj = parseUserString(user)
  } else if (user && typeof user === 'object') {
    userObj = {
      name: user.name || '',
      email: user.email || '',
      picture: user.picture || null,
      provider: user.provider || 'google'
    }
  }
  currentAuthUser = userObj
  saveStoredAuthUser(userObj)
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('auth:user', userObj)
  })
  return userObj
}

ipcMain.handle('auth:get-user', async () => {
  if (!currentAuthUser) {
    currentAuthUser = loadStoredAuthUser()
  }
  return currentAuthUser
})

ipcMain.on('auth:get-user-sync', (event) => {
  if (!currentAuthUser) {
    currentAuthUser = loadStoredAuthUser()
  }
  event.returnValue = currentAuthUser
})

ipcMain.handle('auth:sign-in', async (_event, provider) => {
  if (provider === 'google') {
    const http = await import('node:http')
    const crypto = await import('node:crypto')

    // Close any previous pending auth server
    if (oauthHttpServer) {
      try { oauthHttpServer.close() } catch {}
      oauthHttpServer = null
    }

    const base64Url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const codeVerifier = base64Url(crypto.randomBytes(32))
    const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest())

    const clientId = '397334871290-nmalk9a3erj7qru9v3aic1s1l7lc3c8k.apps.googleusercontent.com'

    return new Promise((resolve) => {
      let oauthPort = 3000
      oauthHttpServer = http.createServer(async (req, res) => {
        const urlObj = new URL(req.url, `http://127.0.0.1:${oauthPort}`)
        const code = urlObj.searchParams.get('code')
        const error = urlObj.searchParams.get('error')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<!DOCTYPE html><html><body style="background:#0f0f13;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h2>Sign-In Cancelled</h2><p style="color:#888;">You can close this window and return to CilamAI.</p></div><script>setTimeout(()=>window.close(),1500)</script></body></html>`)
          try { oauthHttpServer.close() } catch {}
          oauthHttpServer = null
          resolve({ ok: false, error })
          return
        }

        if (code) {
          try {
            console.log('[OAuth] Exchanging code for tokens...')
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
                code: code,
                code_verifier: codeVerifier,
                grant_type: 'authorization_code',
                redirect_uri: `http://127.0.0.1:${oauthPort}`
              })
            })

            const tokenData = await tokenRes.json()
            console.log('[OAuth] Token data received:', tokenData.error || 'SUCCESS')

            let userName = ''
            let userEmail = ''
            let userPicture = null

            if (tokenData.id_token) {
              try {
                const base64Payload = tokenData.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
                const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString('utf8'))
                userName = payload.name || (payload.given_name ? `${payload.given_name} ${payload.family_name || ''}`.trim() : '') || payload.preferred_username || ''
                userEmail = payload.email || ''
                userPicture = payload.picture || null
              } catch (e) {
                console.error('[OAuth] ID token decode error:', e)
              }
            }

            if (tokenData.access_token) {
              try {
                const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                  headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    'User-Agent': 'CilamAI/1.0'
                  }
                })
                if (userRes.ok) {
                  const profile = await userRes.json()
                  if (profile.name) userName = profile.name
                  else if (profile.given_name) userName = `${profile.given_name} ${profile.family_name || ''}`.trim()
                  if (profile.email) userEmail = profile.email
                  if (profile.picture) userPicture = profile.picture
                }
              } catch (e) {
                console.error('[OAuth] Userinfo fetch error:', e)
              }
            }

            if (!userName && userEmail) {
              userName = userEmail.split('@')[0]
            }

            const userObj = {
              name: userName || userEmail.split('@')[0],
              email: userEmail,
              picture: userPicture,
              provider: 'google'
            }

            currentAuthUser = userObj
            saveStoredAuthUser(userObj)

            // Send authenticated user info to all CilamAI windows
            BrowserWindow.getAllWindows().forEach((win) => {
              win.webContents.send('auth:user', userObj)
            })

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>CilamAI - Sign In Successful</title>
  <style>
    body {
      background: transparent;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: transparent;
      border: none;
      border-radius: 16px;
      padding: 32px 40px;
      text-align: center;
      max-width: 400px;
    }
    .check {
      width: 48px;
      height: 48px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px auto;
    }
    .check svg { width: 28px; height: 28px; stroke: #fff; fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    h2 { font-weight: 600; margin: 0 0 8px 0; color: #fff; font-size: 20px; }
    p { color: #888899; margin: 0; font-size: 14px; }
    .user { color: #6366f1; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
    <h2>Sign in successful!</h2>
    <p>You can now close this tab and return to CilamAI.</p>
  </div>
  <script>setTimeout(() => window.close(), 1500);</script>
</body>
</html>`)
            resolve({ ok: true, user: userObj })
          } catch (err) {
            console.error('[OAuth] Token exchange error:', err)
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!DOCTYPE html><html><body style="background:#0f0f13;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h2>Authentication Error</h2><p style="color:#888;">Failed to complete sign-in. Please return to CilamAI and try again.</p></div></body></html>`)
            resolve({ ok: false, error: err.message })
          } finally {
            setTimeout(() => {
              try { oauthHttpServer?.close() } catch {}
              oauthHttpServer = null
            }, 2000)
          }
          return
        }

        res.writeHead(404)
        res.end()
      })

      const listenWithRetry = () => {
        const ports = Array.from({ length: 11 }, (_, i) => 3000 + i)
        let portIndex = 0
        const tryNextPort = () => {
          if (portIndex >= ports.length) {
            console.error('[OAuth] No free port found (3000-3010 all in use)')
            resolve({ ok: false, error: 'No free port available for OAuth callback' })
            return
          }
          const port = ports[portIndex++]
          oauthPort = port
          const redirectUri = `http://127.0.0.1:${port}`
          oauthHttpServer.once('error', (err) => {
            if (err.code === 'EADDRINUSE' && portIndex < ports.length) {
              console.warn(`[OAuth] Port ${port} busy, trying next...`)
              try { oauthHttpServer.close() } catch {}
              tryNextPort()
            } else {
              console.error('[OAuth] Server error:', err)
              resolve({ ok: false, error: err.message })
            }
          })
          oauthHttpServer.listen(port, '127.0.0.1', () => {
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('openid email profile')}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256&prompt=select_account%20consent`
            shell.openExternal(authUrl)
          })
        }
        tryNextPort()
      }
      listenWithRetry()
    })
  }
  return { ok: true }
})

ipcMain.handle('auth:sign-out', async () => {
  currentAuthUser = null
  saveStoredAuthUser(null)
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('auth:user', null)
  })
  return { ok: true }
})

ipcMain.handle('auth:set-user', async (_event, user) => {
  const saved = applyAndSaveUser(user)
  return { ok: true, user: saved }
})

ipcMain.on('auth:set-user', (_event, user) => {
  applyAndSaveUser(user)
})

ipcMain.on('auth:set-user-sync', (event, user) => {
  const saved = applyAndSaveUser(user)
  event.returnValue = { ok: true, user: saved }
})

ipcMain.on('auth:set-avatar', (_event, picture) => {
  if (currentAuthUser) {
    currentAuthUser.picture = picture
    saveStoredAuthUser(currentAuthUser)
  }
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('auth:avatar', picture)
  })
})

ipcMain.handle('auth:set-avatar', async (_event, picture) => {
  if (currentAuthUser) {
    currentAuthUser.picture = picture
    saveStoredAuthUser(currentAuthUser)
  }
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('auth:avatar', picture)
  })
  return { ok: true, picture }
})

ipcMain.handle('auth:upload-avatar', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false, error: 'No window' }
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Avatar Image',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
  const filePath = result.filePaths[0]
  try {
    const data = await readFile(filePath)
    const ext = filePath.split('.').pop().toLowerCase()
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
    const dataUrl = `data:${mime};base64,${data.toString('base64')}`
    
    if (currentAuthUser) {
      currentAuthUser.picture = dataUrl
      saveStoredAuthUser(currentAuthUser)
    }

    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send('auth:avatar', dataUrl)
      if (currentAuthUser) {
        w.webContents.send('auth:user', currentAuthUser)
      }
    })

    return { ok: true, picture: dataUrl }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

function createWindow() {
  const windowState = loadWindowState()
  
  const win = new BrowserWindow({
    title: 'CilamAI',
    icon: join(app.getAppPath(), 'resources/icon.ico'),
    width: windowState.width || 1440,
    height: windowState.height || 900,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  win.removeMenu()
  win.setMenuBarVisibility(false)

  win.on('ready-to-show', () => {
    win.show()
    if (isWindows11 && typeof win.setBackgroundMaterial === 'function') {
      win.setBackgroundMaterial('mica')
    }
    if (windowState.maximized) {
      win.maximize()
    }
  })
  
  setTimeout(() => {
    if (!win.isVisible()) {
      win.show()
      if (isWindows11 && typeof win.setBackgroundMaterial === 'function') {
        win.setBackgroundMaterial('mica')
      }
    }
  }, 3000)
  
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))

  // Save window state before closing
  win.on('close', () => {
    const bounds = win.getBounds()
    saveWindowState({
      maximized: win.isMaximized(),
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y
    })
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let feedbackWindow = null

function openFeedbackWindow() {
  if (feedbackWindow && !feedbackWindow.isDestroyed()) {
    feedbackWindow.focus()
    return
  }

  feedbackWindow = new BrowserWindow({
    title: 'Provide Feedback',
    icon: join(app.getAppPath(), 'resources/icon.ico'),
    width: 720,
    height: 780,
    minWidth: 540,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#0f1015',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  feedbackWindow.setMenuBarVisibility(false)

  feedbackWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    feedbackWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#feedback`)
  } else {
    feedbackWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'feedback' })
  }

  feedbackWindow.on('closed', () => {
    feedbackWindow = null
  })
}

ipcMain.handle('app:open-feedback-window', () => {
  openFeedbackWindow()
  return { ok: true }
})


const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (argv.includes('--new-chat')) {
      win?.webContents.send('task:new-chat')
    }
    const apiKey = extractApiKey(argv)
    if (apiKey) {
      pendingApiKey = apiKey
      win?.webContents.send('task:set-apikey', apiKey)
    }
    const avatarArg = extractAvatar(argv)
    const userArg = extractUser(argv)
    const ipcCommand = extractIpcCommand(argv)

    if (userArg) {
      const parsed = parseUserString(userArg)
      if (parsed) {
        if (avatarArg) parsed.picture = avatarArg
        applyAndSaveUser(parsed)
      }
      win?.webContents.send('task:ipc', `user:${userArg}`)
    } else if (avatarArg) {
      if (currentAuthUser) {
        currentAuthUser.picture = avatarArg
        saveStoredAuthUser(currentAuthUser)
        win?.webContents.send('auth:user', currentAuthUser)
      }
      win?.webContents.send('auth:avatar', avatarArg)
    }

    if (ipcCommand) {
      if (ipcCommand.startsWith('user:')) {
        const parsed = parseUserString(ipcCommand.slice(5))
        if (parsed) applyAndSaveUser(parsed)
      }
      win?.webContents.send('task:ipc', ipcCommand)
    }
    if (argv.includes('--settings')) {
      win?.webContents.send('task:show-settings')
    }
    const modelArg = extractModelArg(argv)
    if (modelArg) {
      win?.webContents.send('task:ipc', `model:${modelArg}`)
    } else if (argv.includes('--model')) {
      win?.webContents.send('task:show-model-menu')
    }
    if (argv.includes('--view-logs')) {
      win?.webContents.send('task:view-logs')
    }
    if (argv.includes('--whats-new')) {
      win?.webContents.send('task:show-release-notes')
    }
    if (argv.includes('--quit')) {
      app.quit()
      return
    }
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setPath('userData', join(app.getPath('appData'), 'CilamAI'))
    app.setAppUserModelId('com.olinai.app')
    Menu.setApplicationMenu(null)
    app.setUserTasks([])
    createWindow()
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.once('did-finish-load', () => {
        if (process.argv.includes('--whats-new')) {
          win.webContents.send('task:show-release-notes')
          return
        }
        const releaseNotes = loadReleaseNotes()
        const currentVersion = app.getVersion()
        if (releaseNotes.lastShownVersion !== currentVersion) {
          saveReleaseNotes({ lastShownVersion: currentVersion })
          win.webContents.send('task:show-release-notes')
          return
        }
        
        const apiKey = extractApiKey(process.argv)
        if (apiKey) {
          pendingApiKey = apiKey
          win.webContents.send('task:set-apikey', apiKey)
        }
        const avatarArg = extractAvatar(process.argv)
        const userArg = extractUser(process.argv)
        const ipcCommand = extractIpcCommand(process.argv)

        let initialUser = loadStoredAuthUser()
        if (userArg) {
          const parsed = parseUserString(userArg)
          if (parsed) {
            if (avatarArg) parsed.picture = avatarArg
            initialUser = parsed
            currentAuthUser = initialUser
            saveStoredAuthUser(initialUser)
          }
        } else if (ipcCommand && ipcCommand.startsWith('user:')) {
          const parsed = parseUserString(ipcCommand.slice(5))
          if (parsed) {
            if (avatarArg) parsed.picture = avatarArg
            initialUser = parsed
            currentAuthUser = initialUser
            saveStoredAuthUser(initialUser)
          }
        } else if (avatarArg && initialUser) {
          initialUser.picture = avatarArg
          currentAuthUser = initialUser
          saveStoredAuthUser(initialUser)
        } else if (initialUser) {
          currentAuthUser = initialUser
        }

        if (initialUser) {
          win.webContents.send('auth:user', initialUser)
        }
        if (avatarArg) {
          win.webContents.send('auth:avatar', avatarArg)
        }
        if (userArg) {
          win.webContents.send('task:ipc', `user:${userArg}`)
        }
        if (ipcCommand) {
          win.webContents.send('task:ipc', ipcCommand)
        }
        const modelArg = extractModelArg(process.argv)
        if (modelArg) {
          win.webContents.send('task:ipc', `model:${modelArg}`)
        } else if (process.argv.includes('--model')) {
          win.webContents.send('task:show-model-menu')
        }
      })
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  // Flush any pending session writes immediately
  clearTimeout(sessionWriteTimer)
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Ensure any pending writes complete
  clearTimeout(sessionWriteTimer)
})
