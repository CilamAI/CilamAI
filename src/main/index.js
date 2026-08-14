import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { chatSend, chatSendStream, webFetchStream } from '../api/client.js'
import https from 'node:https'

const isWindows11 = process.platform === 'win32' && Number((os.release().split('.')[2] || 0)) >= 22000

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
  const idx = argv.indexOf('--set-apikey')
  if (idx === -1) return null
  const rest = argv.slice(idx)
  const direct = rest[1]
  if (direct && !direct.startsWith('--') && direct.includes('sk-')) return direct
  return rest.find((a) => a.startsWith('sk-') && a.length > 3) || null
}

function extractIpcCommand(argv) {
  const idx = argv.indexOf('--ipc')
  if (idx === -1) return null
  const rest = argv.slice(idx)
  const direct = rest[1]
  if (direct && !direct.startsWith('--')) return direct
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
  const fallbackReleaseUrl = `https://github.com/CilamAI/CilamAI/releases/tag/v${fallbackVersion}`
  const fallbackDownloadUrl = `https://github.com/CilamAI/CilamAI/releases/download/v${fallbackVersion}/CilamAI-Setup.exe`
  const tagFromUrl = (url) => {
    const match = String(url || '').match(/\/releases\/tag\/([^/?#]+)/i)
    return match ? decodeURIComponent(match[1]) : ''
  }
  try {
    const getRelease = (path) => new Promise((resolve, reject) => {
      const request = https.get(`https://api.github.com${path}`, {
        headers: { 'User-Agent': 'CilamAI', Accept: 'application/vnd.github+json' }
      }, (response) => {
        let body = ''
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => {
          if (response.statusCode !== 200) return reject(new Error(`GitHub HTTP ${response.statusCode}`))
          try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid update response')) }
        })
      })
      request.on('error', reject)
    })
    let release
    try {
      const releases = await getRelease('/repos/CilamAI/CilamAI/tags')
      release = Array.isArray(releases) && releases.length > 0 ? releases[0] : null
      if (!release) throw new Error('No releases found')
    } catch {
      release = await new Promise((resolve, reject) => {
        const request = https.get('https://github.com/CilamAI/CilamAI/tags.atom', {
          headers: { 'User-Agent': 'CilamAI' }
        }, (response) => {
          let body = ''
          response.on('data', (chunk) => { body += chunk })
          response.on('end', () => {
            if (response.statusCode !== 200) return reject(new Error(`GitHub feed HTTP ${response.statusCode}`))
            const entry = body.match(/<entry>[\s\S]*?<\/entry>/i)?.[0]
            const title = entry?.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
            const link = entry?.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1]
            if (!title || !link) {
              return resolve({ name: fallbackVersion, html_url: fallbackReleaseUrl, download_url: fallbackDownloadUrl })
            }
            resolve({ name: title, tag_name: tagFromUrl(link), html_url: link })
          })
        })
        request.on('error', reject)
      })
    }
    const releaseTag = release.tag_name || (release.commit ? release.name : null) || tagFromUrl(release.html_url) || fallbackVersion
    const latest = String(releaseTag || release.name || fallbackVersion)
      .replace(/^CilamAI\s+v?/i, '')
      .replace(/^v/i, '')
      .trim() || fallbackVersion
    const generatedHtmlUrl = `https://github.com/CilamAI/CilamAI/releases/tag/${encodeURIComponent(releaseTag)}`
    const downloadUrl = release.assets?.find((asset) => /CilamAI-Setup\.exe$/i.test(asset.name || ''))?.browser_download_url || release.download_url || `https://github.com/CilamAI/CilamAI/releases/download/${encodeURIComponent(releaseTag)}/CilamAI-Setup.exe`
    return { ok: true, current: app.getVersion(), latest, url: release.html_url || generatedHtmlUrl, downloadUrl }
  } catch (err) {
    return { ok: false, error: err.message || 'Update check failed' }
  }
})

ipcMain.handle('app:download-and-install', async (_event, downloadUrl) => {
  return new Promise((resolve, reject) => {
    const tempDir = app.getPath('temp')
    const fileName = `CilamAI-Update-${Date.now()}.exe`
    const filePath = join(tempDir, fileName)
    const fs = require('node:fs')
    const file = fs.createWriteStream(filePath)
    
    const download = (url) => {
      https.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return download(response.headers.location)
        }
        if (response.statusCode !== 200) {
          file.destroy()
          fs.unlink(filePath, () => {})
          return reject(new Error(`Download failed: ${response.statusCode}`))
        }
        response.pipe(file)
        file.on('finish', () => {
          file.close(() => {
            try {
              const child = require('node:child_process').spawn(filePath, ['/SILENT'], { detached: true, stdio: 'ignore' })
              child.on('error', (err) => reject(err))
              child.unref()
              resolve({ ok: true })
              setTimeout(() => app.quit(), 500)
            } catch(e) { reject(e) }
          })
        })
      }).on('error', (err) => {
        file.destroy()
        fs.unlink(filePath, () => {})
        reject(err)
      })
    }
    download(downloadUrl)
  })
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

ipcMain.handle('auth:sign-in', async (_event, provider) => {
  if (provider === 'google') {
    const http = await import('node:http')
    const https = await import('node:https')
    
    const server = http.createServer(async (req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
      const code = parsedUrl.searchParams.get('code')
      
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CilamAI - Sign In</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f23;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card { text-align: center; }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #fff; }
    p { color: #8892a4; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign in successful!</h1>
    <p>You can close this window and return to CilamAI.</p>
  </div>
</body>
</html>`)
        server.close()

        try {
          const postData = new URLSearchParams({
            code,
            client_id: '397334871290-nmalk9a3erj7qru9v3aic1s1l7lc3c8k.apps.googleusercontent.com',
            client_secret: 'GOCSPX-placeholder',
            redirect_uri: 'http://127.0.0.1:3000',
            grant_type: 'authorization_code'
          }).toString()

          const tokenRes = await new Promise((resolve, reject) => {
            const r = https.request('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
            }, (res) => {
              let body = ''
              res.on('data', d => body += d)
              res.on('end', () => { try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid token response')) } })
            })
            r.on('error', reject)
            r.write(postData)
            r.end()
          })

          if (tokenRes.access_token) {
            const userRes = await new Promise((resolve, reject) => {
              https.get('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokenRes.access_token}` }
              }, (res) => {
                let body = ''
                res.on('data', d => body += d)
                res.on('end', () => { try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid user response')) } })
              }).on('error', reject)
            })

            if (userRes.name && mainWindow) {
              mainWindow.webContents.send('auth:user', userRes.name)
            }
          }
        } catch {}

        return { ok: true, code }
      }
      
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end('<h1>No code received</h1>')
    })
    
    server.listen(3000, () => {
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=397334871290-nmalk9a3erj7qru9v3aic1s1l7lc3c8k.apps.googleusercontent.com&redirect_uri=http://127.0.0.1:3000&response_type=code&scope=openid%20email%20profile&access_type=offline`
      shell.openExternal(authUrl)
    })
  }
  return { ok: true }
})

ipcMain.handle('auth:sign-out', async () => {
  if (mainWindow) mainWindow.webContents.send('auth:user', '')
  return { ok: true }
})

ipcMain.on('auth:set-user', (_event, name) => {
  if (mainWindow) mainWindow.webContents.send('auth:user', name)
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
    const ipcCommand = extractIpcCommand(argv)
    if (ipcCommand) {
      win?.webContents.send('task:ipc', ipcCommand)
    }
    if (argv.includes('--settings')) {
      win?.webContents.send('task:show-settings')
    }
    const modelArg = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : null
    if (modelArg && !modelArg.startsWith('--')) {
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
        // Check for --whats-new flag first
        if (process.argv.includes('--whats-new')) {
          win.webContents.send('task:show-release-notes')
          return
        }
        
        // Check and show release notes for new version
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
        const ipcCommand = extractIpcCommand(process.argv)
        if (ipcCommand) {
          win.webContents.send('task:ipc', ipcCommand)
        }
        const modelArg = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : null
        if (modelArg && !modelArg.startsWith('--')) {
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
