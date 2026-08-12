import { ipcMain, app, BrowserWindow, dialog, shell, Menu } from "electron";
import { join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import https from "node:https";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
function isFreeModel(model) {
  return /-free$/.test(model || "");
}
const isOpenAiCompat = (provider) => provider === "openai" || provider === "opencode";
function buildHeaders({ model, apiKey, envConfig: envConfig2, org }) {
  const headers = { "Content-Type": "application/json" };
  const key = isFreeModel(model) ? "" : apiKey || envConfig2.opencodeApiKey;
  if (key) headers.Authorization = `Bearer ${key}`;
  const orgId = org || envConfig2.opencodeOrgId;
  if (orgId) headers["x-org-id"] = orgId;
  return headers;
}
const TRANSIENT_STATUSES = /* @__PURE__ */ new Set([408, 425, 429, 502, 503, 504]);
const TRANSIENT_PATTERNS = /temporarily unavailable|rate limit|overloaded|timeout|busy|capacity|queue|service unavailable/i;
function isTransientError(status, message) {
  if (TRANSIENT_STATUSES.has(status)) return true;
  return TRANSIENT_PATTERNS.test(message);
}
async function chatSend({ url, model, messages, provider, apiKey, envConfig: envConfig2 }) {
  const headers = buildHeaders({ model, apiKey, envConfig: envConfig2 });
  const isOpenAI = isOpenAiCompat(provider);
  let attempt = 0;
  const maxAttempts = 5;
  while (true) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, stream: false })
    });
    if (!res.ok) {
      const data2 = await res.json().catch(() => null);
      const error2 = data2?.error?.message || data2?.error || `HTTP ${res.status}`;
      if (attempt < maxAttempts - 1 && isTransientError(res.status, error2)) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      return { ok: false, error: error2, status: res.status };
    }
    const data = await res.json().catch(() => null);
    const error = data?.error?.message || data?.error || null;
    if (error && isTransientError(res.status, error) && attempt < maxAttempts - 1) {
      attempt += 1;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    const content = isOpenAI ? data?.choices?.[0]?.message?.content : data?.message?.content;
    const reasoning = data?.choices?.[0]?.message?.reasoning || "";
    return { ok: true, data: { message: { content }, reasoning } };
  }
}
async function chatSendStream({ url, model, messages, provider, apiKey, envConfig: envConfig2 }, { signal, onChunk, onReasoning }) {
  const headers = buildHeaders({ model, apiKey, envConfig: envConfig2 });
  const isOpenAI = isOpenAiCompat(provider);
  let attempt = 0;
  const maxAttempts = 5;
  let res;
  while (true) {
    res = await fetch(url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({ model, messages, stream: true })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const error = data?.error?.message || data?.error || `HTTP ${res.status}`;
      if (attempt < maxAttempts - 1 && isTransientError(res.status, error)) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      return { ok: false, error, status: res.status };
    }
    break;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inThinkTag = false;
  const routeContent = (text) => {
    if (!text) return;
    let remaining = text;
    while (remaining.length > 0) {
      if (inThinkTag) {
        const closeIdx = remaining.indexOf("</think>");
        if (closeIdx === -1) {
          onReasoning(remaining);
          return;
        }
        const inside = remaining.slice(0, closeIdx);
        if (inside) {
          onReasoning(inside);
        }
        inThinkTag = false;
        remaining = remaining.slice(closeIdx + "</think>".length);
      } else {
        const openIdx = remaining.indexOf("<think>");
        if (openIdx === -1) {
          onChunk(remaining);
          return;
        }
        if (openIdx > 0) {
          onChunk(remaining.slice(0, openIdx));
        }
        inThinkTag = true;
        remaining = remaining.slice(openIdx + "<think>".length);
      }
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf(isOpenAI ? "\n\n" : "\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + (isOpenAI ? 2 : 1));
      if (!block.trim()) continue;
      if (isOpenAI) {
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let chunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = chunk.choices?.[0]?.delta;
          const reasoning = delta?.reasoning_content || delta?.reasoning || "";
          if (reasoning) {
            onReasoning(reasoning);
          } else if (Array.isArray(delta?.reasoning_details)) {
            for (const d of delta.reasoning_details) {
              if (d.text) onReasoning(d.text);
            }
          }
          routeContent(delta?.content ?? "");
        }
      } else {
        let chunk;
        try {
          chunk = JSON.parse(block);
        } catch {
          continue;
        }
        const reasoning = chunk.message?.reasoning_content || chunk.message?.reasoning || "";
        if (reasoning) onReasoning(reasoning);
        if (Array.isArray(chunk.message?.reasoning_details)) {
          for (const d of chunk.message.reasoning_details) {
            if (d.text) onReasoning(d.text);
          }
        }
        routeContent(chunk.message?.content ?? "");
      }
    }
  }
  return { ok: true };
}
const isWindows11 = process.platform === "win32" && Number(os.release().split(".")[2] || 0) >= 22e3;
const streamControllers = /* @__PURE__ */ new Map();
const TRANSIENT_STATUSES_MAIN = /* @__PURE__ */ new Set([408, 425, 429, 502, 503, 504]);
const TRANSIENT_MESSAGES = /temporarily unavailable|rate limit|overloaded|timeout|busy|capacity|queue/i;
async function sendWithRetry(fn, attempts = 5) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await fn();
    if (last?.ok !== false && last?.error == null) return last;
    const isTransient = TRANSIENT_STATUSES_MAIN.has(last?.status) || TRANSIENT_MESSAGES.test(last?.error || "");
    if (!isTransient || attempt >= attempts - 1) return last;
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return last;
}
let currentLanguage = "en";
let pendingApiKey = null;
let sessionFile = null;
let sessionWriteTimer = null;
let windowStateFile = null;
function getSessionFile() {
  if (sessionFile) return sessionFile;
  sessionFile = join(app.getPath("userData"), "sessions.json");
  return sessionFile;
}
function getWindowStateFile() {
  if (windowStateFile) return windowStateFile;
  windowStateFile = join(app.getPath("userData"), "window-state.json");
  return windowStateFile;
}
function getReleaseNotesFile() {
  return join(app.getPath("userData"), "release-notes.json");
}
function loadReleaseNotes() {
  try {
    const text = readFileSync(getReleaseNotesFile(), "utf8");
    return JSON.parse(text);
  } catch {
    return { lastShownVersion: "0.0.0" };
  }
}
function saveReleaseNotes(data) {
  try {
    writeFile(getReleaseNotesFile(), JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save release notes data:", err);
  }
}
function loadWindowState() {
  try {
    const text = readFileSync(getWindowStateFile(), "utf8");
    return JSON.parse(text);
  } catch {
    return { maximized: false, width: 1440, height: 900 };
  }
}
function saveWindowState(state) {
  try {
    writeFile(getWindowStateFile(), JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save window state:", err);
  }
}
function loadSessionsFromDisk() {
  try {
    const text = readFileSync(getSessionFile(), "utf8");
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return null;
  }
}
function scheduleSessionWrite(data) {
  clearTimeout(sessionWriteTimer);
  sessionWriteTimer = setTimeout(async () => {
    try {
      await writeFile(getSessionFile(), JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to write sessions:", err);
    }
  }, 300);
}
let envConfig = { opencodeApiKey: "", opencodeOrgId: "", googleSearchKey: "", googleSearchCx: "" };
function loadEnvConfig() {
  try {
    const file = join(app.getAppPath(), ".env");
    const text = readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const value = m[2].replace(/^["']|["']$/g, "");
      if (key === "OPENCODE_API_KEY") envConfig.opencodeApiKey = value;
      if (key === "OPENCODE_ORG_ID") envConfig.opencodeOrgId = value;
      if (key === "GOOGLE_SEARCH_KEY") envConfig.googleSearchKey = value;
      if (key === "GOOGLE_SEARCH_CX") envConfig.googleSearchCx = value;
    }
  } catch {
  }
}
loadEnvConfig();
function extractApiKey(argv) {
  const idx = argv.indexOf("--set-apikey");
  if (idx === -1) return null;
  const rest = argv.slice(idx);
  const direct = rest[1];
  if (direct && !direct.startsWith("--") && direct.includes("sk-")) return direct;
  return rest.find((a) => a.startsWith("sk-") && a.length > 3) || null;
}
function extractIpcCommand(argv) {
  const idx = argv.indexOf("--ipc");
  if (idx === -1) return null;
  const rest = argv.slice(idx);
  const direct = rest[1];
  if (direct && !direct.startsWith("--")) return direct;
  return null;
}
function consumePendingApiKey() {
  const key = pendingApiKey;
  pendingApiKey = null;
  return key;
}
const SUPPORTED_LANGS = ["en", "ko", "tr", "ru"];
const LANG_DIR = join(__dirname, "../../lang");
function loadLocaleFile(lang) {
  try {
    const file = join(LANG_DIR, `${lang}.json`);
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
function broadcastLanguage(lang) {
  currentLanguage = lang;
  const data = loadLocaleFile(lang);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("app:language-changed", { lang, data });
  }
}
ipcMain.handle("app:platform-info", () => ({
  platform: process.platform,
  isWindows11,
  language: currentLanguage
}));
ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("app:set-language", (_event, lang) => {
  if (!SUPPORTED_LANGS.includes(lang)) return { ok: false, error: "Unsupported language" };
  broadcastLanguage(lang);
  return { ok: true, lang };
});
ipcMain.handle("app:get-language", () => ({ lang: currentLanguage }));
ipcMain.handle("app:get-pending-apikey", () => ({ key: consumePendingApiKey() }));
ipcMain.handle("app:get-env-config", () => envConfig);
ipcMain.handle("app:context-window-boost", async (_event, enabled) => {
  try {
    return {
      ok: true,
      enabled: !!enabled,
      speedMultiplier: enabled ? 100 : 1,
      message: enabled ? "Context Window Speed Boost x100 enabled" : "Context Window Speed Boost disabled"
    };
  } catch (err) {
    return { ok: false, error: err.message, enabled: false, speedMultiplier: 1 };
  }
});
ipcMain.handle("app:get-context-window-info", () => {
  try {
    return {
      ok: true,
      maxTokens: 2e5,
      speedBoostAvailable: true,
      speedBoostMultiplier: 100
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("app:get-release-notes", () => {
  try {
    const releaseNotes = loadReleaseNotes();
    const currentVersion = app.getVersion();
    const shouldShow = releaseNotes.lastShownVersion !== currentVersion;
    if (shouldShow) {
      saveReleaseNotes({ lastShownVersion: currentVersion });
    }
    return {
      ok: true,
      shouldShow,
      currentVersion,
      lastShownVersion: releaseNotes.lastShownVersion
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      shouldShow: false,
      currentVersion: app.getVersion()
    };
  }
});
ipcMain.handle("app:check-internet", async () => {
  try {
    await new Promise((resolve, reject) => {
      const req = https.request({ hostname: "clients3.google.com", path: "/generate_204", method: "GET", timeout: 3e3 }, (res) => {
        resolve(res.statusCode === 204);
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout"));
      });
      req.end();
    });
    return { ok: true, online: true };
  } catch {
    return { ok: true, online: false };
  }
});
ipcMain.handle("sessions:load", () => {
  try {
    const sessions = loadSessionsFromDisk();
    return { ok: true, sessions: sessions || [] };
  } catch (err) {
    return { ok: false, error: err.message, sessions: [] };
  }
});
ipcMain.handle("sessions:save", async (_event, sessions) => {
  if (!Array.isArray(sessions)) {
    return { ok: false, error: "Invalid sessions data" };
  }
  try {
    scheduleSessionWrite(sessions);
    return { ok: true, count: sessions.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("sessions:save-immediate", async (_event, sessions) => {
  if (!Array.isArray(sessions)) {
    return { ok: false, error: "Invalid sessions data" };
  }
  try {
    clearTimeout(sessionWriteTimer);
    await writeFile(getSessionFile(), JSON.stringify(sessions, null, 2), "utf8");
    return { ok: true, count: sessions.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("file:upload", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: "No window" };
  const result = await dialog.showOpenDialog(win, {
    title: "Choose a file",
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  const filePath = result.filePaths[0];
  const BLOCKED_EXTENSIONS = [".js", ".json", ".html", ".bat", ".cmd"];
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `File type .${ext.slice(1)} is not allowed` };
  }
  try {
    const data = await readFile(filePath);
    return {
      ok: true,
      name: filePath.split(/[\\/]/).pop(),
      path: filePath,
      size: data.length,
      data: data.toString("base64")
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("startup:set", async (_event, enabled) => {
  try {
    const settings = { openAtLogin: !!enabled };
    app.setLoginItemSettings(settings);
    const current = app.getLoginItemSettings();
    return { ok: true, enabled: current.openAtLogin };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("startup:get", () => {
  try {
    const settings = app.getLoginItemSettings();
    return { ok: true, enabled: settings.openAtLogin };
  } catch (err) {
    return { ok: false, error: err.message, enabled: false };
  }
});
ipcMain.handle("app:capture", async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: "No window to capture" };
    const image = await win.webContents.capturePage();
    const pngData = image.toPNG();
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const file = join(app.getPath("pictures"), `chat-${stamp}.png`);
    await writeFile(file, pngData);
    return { ok: true, path: file, data: pngData.toString("base64") };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("chat:send", async (_event, { url, model, messages, provider, apiKey, org }) => {
  try {
    return await chatSend({ url, model, messages, provider, apiKey, envConfig, org });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("chat:send-stream", async (event, { url, model, messages, provider, apiKey, org }) => {
  return await sendWithRetry(async () => {
    const controller = new AbortController();
    streamControllers.set(event.sender.id, controller);
    try {
      return await chatSendStream(
        { url, model, messages, provider, apiKey, envConfig, org },
        {
          signal: controller.signal,
          onChunk: (text) => event.sender.send("chat:stream-chunk", text),
          onReasoning: (text) => event.sender.send("chat:stream-reasoning", text)
        }
      );
    } catch (err) {
      if (err.name === "AbortError") return { ok: true, aborted: true };
      return { ok: false, error: err.message };
    } finally {
      streamControllers.delete(event.sender.id);
    }
  });
});
ipcMain.on("chat:stop-stream", (event) => {
  streamControllers.get(event.sender.id)?.abort();
});
ipcMain.handle("window:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.minimize();
    return { ok: true };
  }
  return { ok: false, error: "No window found" };
});
ipcMain.handle("window:maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, maximized: false };
  win.maximize();
  return { ok: true, maximized: true };
});
ipcMain.handle("window:unmaximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, maximized: false };
  win.unmaximize();
  return { ok: true, maximized: false };
});
ipcMain.handle("window:maximize-toggle", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, maximized: false };
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
  return { ok: true, maximized: win.isMaximized() };
});
ipcMain.handle("window:is-maximized", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return { ok: true, maximized: win?.isMaximized() ?? false };
});
ipcMain.handle("window:get-state", () => {
  try {
    const state = loadWindowState();
    return { ok: true, state };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("window:save-state", async (_event, state) => {
  try {
    saveWindowState(state);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.close();
    return { ok: true };
  }
  return { ok: false, error: "No window found" };
});
ipcMain.handle("window:open-devtools", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools();
});
ipcMain.handle("app:open-external", (_event, url) => {
  if (url && typeof url === "string") shell.openExternal(url);
});
ipcMain.handle("auth:sign-in", async (_event, provider) => {
  if (provider === "google") {
    const http = await import("node:http");
    const https2 = await import("node:https");
    const server = http.createServer(async (req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const code = parsedUrl.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
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
</html>`);
        server.close();
        try {
          const postData = new URLSearchParams({
            code,
            client_id: "397334871290-nmalk9a3erj7qru9v3aic1s1l7lc3c8k.apps.googleusercontent.com",
            client_secret: "GOCSPX-placeholder",
            redirect_uri: "http://127.0.0.1:3000",
            grant_type: "authorization_code"
          }).toString();
          const tokenRes = await new Promise((resolve, reject) => {
            const r = https2.request("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) }
            }, (res2) => {
              let body = "";
              res2.on("data", (d) => body += d);
              res2.on("end", () => {
                try {
                  resolve(JSON.parse(body));
                } catch {
                  reject(new Error("Invalid token response"));
                }
              });
            });
            r.on("error", reject);
            r.write(postData);
            r.end();
          });
          if (tokenRes.access_token) {
            const userRes = await new Promise((resolve, reject) => {
              https2.get("https://www.googleapis.com/oauth2/v2/userinfo", {
                headers: { Authorization: `Bearer ${tokenRes.access_token}` }
              }, (res2) => {
                let body = "";
                res2.on("data", (d) => body += d);
                res2.on("end", () => {
                  try {
                    resolve(JSON.parse(body));
                  } catch {
                    reject(new Error("Invalid user response"));
                  }
                });
              }).on("error", reject);
            });
            if (userRes.name && mainWindow) {
              mainWindow.webContents.send("auth:user", userRes.name);
            }
          }
        } catch {
        }
        return { ok: true, code };
      }
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h1>No code received</h1>");
    });
    server.listen(3e3, () => {
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=397334871290-nmalk9a3erj7qru9v3aic1s1l7lc3c8k.apps.googleusercontent.com&redirect_uri=http://127.0.0.1:3000&response_type=code&scope=openid%20email%20profile&access_type=offline`;
      shell.openExternal(authUrl);
    });
  }
  return { ok: true };
});
ipcMain.handle("auth:sign-out", async () => {
  if (mainWindow) mainWindow.webContents.send("auth:user", "");
  return { ok: true };
});
ipcMain.on("auth:set-user", (_event, name) => {
  if (mainWindow) mainWindow.webContents.send("auth:user", name);
});
function createWindow() {
  const windowState = loadWindowState();
  const win = new BrowserWindow({
    title: "CilamAI",
    icon: join(app.getAppPath(), "resources/icon.ico"),
    width: windowState.width || 1440,
    height: windowState.height || 900,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1e3,
    minHeight: 700,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false
    }
  });
  win.on("ready-to-show", () => {
    win.show();
    if (isWindows11 && typeof win.setBackgroundMaterial === "function") {
      win.setBackgroundMaterial("mica");
    }
    if (windowState.maximized) {
      win.maximize();
    }
  });
  setTimeout(() => {
    if (!win.isVisible()) {
      win.show();
      if (isWindows11 && typeof win.setBackgroundMaterial === "function") {
        win.setBackgroundMaterial("mica");
      }
    }
  }, 3e3);
  win.on("maximize", () => win.webContents.send("window:maximized", true));
  win.on("unmaximize", () => win.webContents.send("window:maximized", false));
  win.on("close", () => {
    const bounds = win.getBounds();
    saveWindowState({
      maximized: win.isMaximized(),
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (argv.includes("--new-chat")) {
      win?.webContents.send("task:new-chat");
    }
    const apiKey = extractApiKey(argv);
    if (apiKey) {
      pendingApiKey = apiKey;
      win?.webContents.send("task:set-apikey", apiKey);
    }
    const ipcCommand = extractIpcCommand(argv);
    if (ipcCommand) {
      win?.webContents.send("task:ipc", ipcCommand);
    }
    if (argv.includes("--settings")) {
      win?.webContents.send("task:show-settings");
    }
    const modelArg = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : null;
    if (modelArg && !modelArg.startsWith("--")) {
      win?.webContents.send("task:ipc", `model:${modelArg}`);
    } else if (argv.includes("--model")) {
      win?.webContents.send("task:show-model-menu");
    }
    if (argv.includes("--view-logs")) {
      win?.webContents.send("task:view-logs");
    }
    if (argv.includes("--whats-new")) {
      win?.webContents.send("task:show-release-notes");
    }
    if (argv.includes("--quit")) {
      app.quit();
      return;
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    app.setPath("userData", join(app.getPath("appData"), "CilamAI"));
    app.setAppUserModelId("com.olinai.app");
    Menu.setApplicationMenu(null);
    app.setUserTasks([]);
    createWindow();
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.once("did-finish-load", () => {
        if (process.argv.includes("--whats-new")) {
          win.webContents.send("task:show-release-notes");
          return;
        }
        const releaseNotes = loadReleaseNotes();
        const currentVersion = app.getVersion();
        if (releaseNotes.lastShownVersion !== currentVersion) {
          saveReleaseNotes({ lastShownVersion: currentVersion });
          win.webContents.send("task:show-release-notes");
          return;
        }
        const apiKey = extractApiKey(process.argv);
        if (apiKey) {
          pendingApiKey = apiKey;
          win.webContents.send("task:set-apikey", apiKey);
        }
        const ipcCommand = extractIpcCommand(process.argv);
        if (ipcCommand) {
          win.webContents.send("task:ipc", ipcCommand);
        }
        const modelArg = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : null;
        if (modelArg && !modelArg.startsWith("--")) {
          win.webContents.send("task:ipc", `model:${modelArg}`);
        } else if (process.argv.includes("--model")) {
          win.webContents.send("task:show-model-menu");
        }
      });
    }
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
app.on("window-all-closed", () => {
  clearTimeout(sessionWriteTimer);
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  clearTimeout(sessionWriteTimer);
});
