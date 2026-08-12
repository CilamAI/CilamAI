import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  getPlatformInfo: () => ipcRenderer.invoke('app:platform-info'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
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
  getPendingApiKey: () => ipcRenderer.invoke('app:get-pending-apikey'),
  getEnvConfig: () => ipcRenderer.invoke('app:get-env-config'),
  contextWindowBoost: (enabled) => ipcRenderer.invoke('app:context-window-boost', enabled),
  getContextWindowInfo: () => ipcRenderer.invoke('app:get-context-window-info'),
  onLanguageChange: (cb) => ipcRenderer.on('app:language-changed', (_event, payload) => cb(payload)),
  loadSessions: () => ipcRenderer.invoke('sessions:load'),
  saveSessionsFile: (sessions) => ipcRenderer.invoke('sessions:save', sessions),
  saveSessionsImmediate: (sessions) => ipcRenderer.invoke('sessions:save-immediate', sessions),
  signIn: (provider) => ipcRenderer.invoke('auth:sign-in', provider),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  setUser: (name) => ipcRenderer.send('auth:set-user', name),
  on: (channel, cb) => ipcRenderer.on(channel, (_event, ...args) => cb(...args))
})
