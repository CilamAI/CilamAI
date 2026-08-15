import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  getPlatformInfo: () => ipcRenderer.invoke('app:platform-info'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  consoleLog: (msg) => ipcRenderer.send('app:console-log', msg),
  consoleInfo: (msg) => ipcRenderer.send('app:console-info', msg),
  consoleError: (msg) => ipcRenderer.send('app:console-error', msg),
  consoleWarn: (msg) => ipcRenderer.send('app:console-warn', msg),
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
  downloadAndInstall: (url) => ipcRenderer.invoke('app:download-and-install', url),
  openFeedbackWindow: () => ipcRenderer.invoke('app:open-feedback-window'),
  checkInternet: () => ipcRenderer.invoke('app:check-internet'),
  sendMessage: (payload) => ipcRenderer.invoke('chat:send', payload),
  sendStream: (payload, onChunk, onReasoning) =>
    new Promise((resolve) => {
      const channel = 'chat:stream-chunk'
      const reasonChannel = 'chat:stream-reasoning'
      const handler = (_event, chunk) => onChunk(chunk)
      const reasonHandler = (_event, chunk) => { if (onReasoning) onReasoning(chunk) }
      ipcRenderer.on(channel, handler)
      ipcRenderer.on(reasonChannel, reasonHandler)
      ipcRenderer
        .invoke('chat:send-stream', payload)
        .finally(() => {
          ipcRenderer.removeListener(channel, handler)
          ipcRenderer.removeListener(reasonChannel, reasonHandler)
        })
        .then(resolve)
    }),
  stopStream: () => ipcRenderer.send('chat:stop-stream'),
  fetchStream: (url, onChunk, onReasoning) =>
    new Promise((resolve) => {
      const chunkChannel = 'chat:stream-chunk'
      const reasonChannel = 'chat:stream-reasoning'
      const chunkHandler = (_event, chunk) => onChunk(chunk)
      const reasonHandler = (_event, chunk) => onReasoning?.(chunk)
      ipcRenderer.on(chunkChannel, chunkHandler)
      ipcRenderer.on(reasonChannel, reasonHandler)
      ipcRenderer.invoke('web:fetch-stream', { url }).finally(() => {
        ipcRenderer.removeListener(chunkChannel, chunkHandler)
        ipcRenderer.removeListener(reasonChannel, reasonHandler)
      }).then(resolve)
    }),
  uploadFile: () => ipcRenderer.invoke('file:upload'),
  captureScreenshot: () => ipcRenderer.invoke('app:capture'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize-toggle'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  saveWindowState: (state) => ipcRenderer.invoke('window:save-state', state),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onMaximizeChange: (cb) => ipcRenderer.on('window:maximized', (_event, maximized) => cb(maximized)),
  onNewChatTask: (cb) => ipcRenderer.on('task:new-chat', () => cb()),
  onShowSettingsTask: (cb) => ipcRenderer.on('task:show-settings', () => cb()),
  onShowModelMenuTask: (cb) => ipcRenderer.on('task:show-model-menu', () => cb()),
  onShowReleaseNotesTask: (cb) => ipcRenderer.on('task:show-release-notes', () => cb()),
  onSetApiKeyTask: (cb) => ipcRenderer.on('task:set-apikey', (_event, key) => cb(key)),
  onIpcTask: (cb) => ipcRenderer.on('task:ipc', (_event, command) => cb(command)),
  onViewLogsTask: (cb) => ipcRenderer.on('task:view-logs', () => cb()),
  openDevTools: () => ipcRenderer.invoke('window:open-devtools'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),
  getStartup: () => ipcRenderer.invoke('startup:get'),
  setLanguage: (lang) => ipcRenderer.invoke('app:set-language', lang),
  getLanguage: () => ipcRenderer.invoke('app:get-language'),
  setTheme: (theme) => ipcRenderer.invoke('app:set-theme', theme),
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  onThemeChange: (cb) => ipcRenderer.on('app:theme-changed', (_event, theme) => cb(theme)),
  getPendingApiKey: () => ipcRenderer.invoke('app:get-pending-apikey'),
  getEnvConfig: () => ipcRenderer.invoke('app:get-env-config'),
  contextWindowBoost: (enabled) => ipcRenderer.invoke('app:context-window-boost', enabled),
  getContextWindowInfo: (model) => ipcRenderer.invoke('app:get-context-window-info', model),
  onLanguageChange: (cb) => ipcRenderer.on('app:language-changed', (_event, payload) => cb(payload)),
  loadSessions: () => ipcRenderer.invoke('sessions:load'),
  saveSessionsFile: (sessions) => ipcRenderer.invoke('sessions:save', sessions),
  saveSessionsImmediate: (sessions) => ipcRenderer.invoke('sessions:save-immediate', sessions),
  getCredits: () => ipcRenderer.invoke('credits:get'),
  saveCredits: (credits) => ipcRenderer.invoke('credits:set', credits),
  flushCredits: (credits) => ipcRenderer.sendSync('credits:set-sync', credits),
  getUser: () => ipcRenderer.invoke('auth:get-user'),
  signIn: (provider) => ipcRenderer.invoke('auth:sign-in', provider),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  setUser: (user) => ipcRenderer.send('auth:set-user', user),
  setAvatar: (picture) => ipcRenderer.invoke('auth:set-avatar', picture),
  uploadAvatar: () => ipcRenderer.invoke('auth:upload-avatar'),
  onAvatar: (cb) => ipcRenderer.on('auth:avatar', (_event, picture) => cb(picture)),
  onUser: (cb) => ipcRenderer.on('auth:user', (_event, user) => cb(user)),
  on: (channel, cb) => ipcRenderer.on(channel, (_event, ...args) => cb(...args))
})
