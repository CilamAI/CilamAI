import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  getPlatformInfo: () => ipcRenderer.invoke('app:platform-info'),
  sendMessage: (payload) => ipcRenderer.invoke('chat:send', payload),
  sendStream: (payload, onChunk, onReasoning) =>
    new Promise((resolve) => {
      const channel = 'chat:stream-chunk'
      const reasonChannel = 'chat:stream-reasoning'
      const handler = (_event, chunk) => onChunk(chunk)
      const reasonHandler = onReasoning ? (_event, chunk) => onReasoning(chunk) : null
      ipcRenderer.on(channel, handler)
      if (reasonHandler) ipcRenderer.on(reasonChannel, reasonHandler)
      ipcRenderer
        .invoke('chat:send-stream', payload)
        .finally(() => {
          ipcRenderer.removeListener(channel, handler)
          if (reasonHandler) ipcRenderer.removeListener(reasonChannel, reasonHandler)
        })
        .then(resolve)
    }),
  stopStream: () => ipcRenderer.send('chat:stop-stream'),
  uploadFile: () => ipcRenderer.invoke('file:upload'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize-toggle'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onMaximizeChange: (cb) => ipcRenderer.on('window:maximized', (_event, maximized) => cb(maximized)),
  onNewChatTask: (cb) => ipcRenderer.on('task:new-chat', () => cb()),
  setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),
  getStartup: () => ipcRenderer.invoke('startup:get')
})
