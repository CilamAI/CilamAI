import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'

const isWindows11 = process.platform === 'win32' && Number((os.release().split('.')[2] || 0)) >= 22000

const streamControllers = new Map()

ipcMain.handle('app:platform-info', () => ({
  platform: process.platform,
  isWindows11
}))

ipcMain.handle('file:upload', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false, error: 'No window' }
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a file',
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
  const filePath = result.filePaths[0]
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

ipcMain.handle('startup:set', (_event, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled })
    return { ok: true, enabled: !!enabled }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('startup:get', () => ({
  ok: true,
  enabled: app.getLoginItemSettings().openAtLogin
}))

ipcMain.handle('app:capture', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'No window to capture' }
    const image = await win.webContents.capturePage()
    const stamp = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .slice(0, 19)
    const file = join(app.getPath('pictures'), `chat-${stamp}.png`)
    await writeFile(file, image.toPNG())
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('chat:send', async (_event, { url, model, messages, provider, apiKey }) => {
  try {
    const isOpenAI = provider === 'openai'
    const headers = { 'Content-Type': 'application/json' }
    if (isOpenAI && apiKey) headers.Authorization = `Bearer ${apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, stream: false })
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || data?.error || `HTTP ${res.status}` }
    }
    const content = isOpenAI ? data?.choices?.[0]?.message?.content : data?.message?.content
    return { ok: true, data: { message: { content } } }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('chat:send-stream', async (event, { url, model, messages, provider, apiKey }) => {
  const controller = new AbortController()
  streamControllers.set(event.sender.id, controller)
  try {
    const isOpenAI = provider === 'openai'
    const headers = { 'Content-Type': 'application/json' }
    if (isOpenAI && apiKey) headers.Authorization = `Bearer ${apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ model, messages, stream: true })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      return { ok: false, error: data?.error?.message || data?.error || `HTTP ${res.status}` }
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const sendChunk = (text) => {
      if (text) event.sender.send('chat:stream-chunk', text)
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf(isOpenAI ? '\n\n' : '\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + (isOpenAI ? 2 : 1))
        if (!block.trim()) continue
        if (isOpenAI) {
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            let chunk
            try {
              chunk = JSON.parse(payload)
            } catch {
              continue
            }
            const delta = chunk.choices?.[0]?.delta
            const reasoning = delta?.reasoning_content || delta?.reasoning || ''
            if (reasoning) event.sender.send('chat:stream-reasoning', reasoning)
            sendChunk(delta?.content ?? '')
          }
        } else {
          let chunk
          try {
            chunk = JSON.parse(block)
          } catch {
            continue
          }
          sendChunk(chunk.message?.content ?? '')
        }
      }
    }
    return { ok: true }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: true, aborted: true }
    return { ok: false, error: err.message }
  } finally {
    streamControllers.delete(event.sender.id)
  }
})

ipcMain.on('chat:stop-stream', (event) => {
  streamControllers.get(event.sender.id)?.abort()
})

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  win?.maximize()
  return { maximized: win?.isMaximized() ?? false }
})

ipcMain.handle('window:maximize-toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { maximized: false }
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return { maximized: win.isMaximized() }
})

ipcMain.handle('window:is-maximized', (event) =>
  BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
)

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

function createWindow() {
  const win = new BrowserWindow({
    title: 'OlinaAI',
    icon: join(app.getAppPath(), 'resources/icon.ico'),
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())
  if (isWindows11 && typeof win.setBackgroundMaterial === 'function') {
    win.setBackgroundMaterial('mica')
  }
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))

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

function setTaskbarTasks() {
  const iconPath = join(app.getAppPath(), 'resources/icon.ico')
  app.setUserTasks([
    {
      program: process.execPath,
      arguments: `"${app.getAppPath()}" --new-chat`,
      title: 'New Chat',
      description: 'Start a new conversation',
      iconPath,
      iconIndex: 0
    },
    {
      program: process.execPath,
      arguments: `"${app.getAppPath()}"`,
      title: 'Open OlinaAI',
      description: 'Open the app',
      iconPath,
      iconIndex: 0
    }
  ])
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
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setPath('userData', join(app.getPath('appData'), 'Ollama 2'))
    app.setAppUserModelId('com.ollama2.app')
    Menu.setApplicationMenu(null)
    createWindow()
    setTaskbarTasks()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
