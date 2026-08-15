# CilamAI - Project Context & Architecture

## 1. Overview
**CilamAI** is a cross-platform, frameless desktop AI chat application built with **Electron**, **Vite** (`electron-vite`), and vanilla JavaScript & CSS. It features local and cloud model streaming, Model Context Protocol (MCP) integrations, credits and usage tracking, and full internationalization supporting 19 languages.

---

## 2. Architecture & File Structure

```
CilamAICode/
├── lang/                       # Root localization JSON files (19 languages)
├── resources/                  # App icons, certificates, installer artwork
├── src/
│   ├── api/                    # API client configurations and endpoints
│   ├── main/
│   │   └── index.js            # Electron Main process (IPC, sessions, window state, credits)
│   ├── preload/
│   │   └── index.js            # Context bridge & secure IPC exposed to renderer
│   └── renderer/
│       ├── index.html          # Single page application structure & dialogs
│       ├── public/
│       │   └── lang/           # Renderer localization JSON files (synced with lang/)
│       └── src/
│           ├── main.js         # Frontend controller (chat, models, credits, MCP, hotkeys)
│           └── style.css       # Unified design system & theme variables
├── package.json                # Project dependencies, build targets & scripts
└── CONTEXT.md                  # This documentation
```

---

## 3. Credits & Account System

### 3.1 Credit Limits & Reset Intervals
- **Default Accounts**:
  - Credit Limit: `100` credits.
  - Reset Cycle: **24 hours** (`24 * 60 * 60 * 1000` ms).
- **VIP Accounts (`kevccx@gmail.com`)**:
  - Credit Limit: `100,000` (`100K`) credits.
  - Reset Cycle: **1 Year** (`365 * 24 * 60 * 60 * 1000` ms).
  - Displays expiration/reset as `Reset in DD/MM/YYYY HH:mm`.

### 3.2 Spent Tracking
- Displays cost calculated from consumed credits (`spent * $0.02`).
- Rendered in `.credit-menu-spent` as `${amount.toFixed(2)}$` (e.g. `0.00$`).

---

## 4. Internationalization (i18n)

The application supports **19 languages** with full key parity:

| Code | Language | Native Name |
| :--- | :--- | :--- |
| `en` | English | English |
| `ko` | Korean | 한국어 |
| `tr` | Turkish | Türkçe |
| `ru` | Russian | Русский |
| `zh` | Simplified Chinese | 简体中文 |
| `zh-TW` | Traditional Chinese | 繁體中文 |
| `ja` | Japanese | 日本語 |
| `es` | Spanish | Español |
| `fr` | French | Français |
| `de` | German | Deutsch |
| `pt` | Portuguese | Português |
| `it` | Italian | Italiano |
| `ar` | Arabic | العربية |
| `hi` | Hindi | हिन्दी |
| `vi` | Vietnamese | Tiếng Việt |
| `id` | Indonesian | Bahasa Indonesia |
| `pl` | Polish | Polski |
| `uk` | Ukrainian | Українська |
| `nl` | Dutch | Nederlands |

- **Attributes**: Elements localized via `data-i18n="key"` and `data-i18n-placeholder="key"`.
- **Dynamic Models**: Model selector buttons and folder headings (e.g. `Auto` / `AUTO`) dynamically localize upon language switch.

---

## 5. Model Context Protocol (MCP) Tools

- **Settings UI**: Manage external tool servers via **Settings > MCP Tools**.
- **Supported Transports**:
  - `stdio`: Local executable command and CLI arguments.
  - `sse`: Server-Sent Events URL endpoints.
- **Quick Templates**:
  - *Filesystem*, *Brave Search*, *GitHub*, *Memory*.
- **Storage**: Persisted locally in `localStorage` under `cilamai-mcp-servers`.

---

## 6. Design System & Themes

- **Themes Supported**: `Dark` (default), `Light`, `Blue`, `Red`, `Yellow`, `Green`, `Black`, `System`.
- **Theme Variables**: Full contrast safety using `--bg`, `--surface`, `--border`, `--text`, `--accent`, and `--accent-text`.
- **Scrollable Menus**: Custom webkit scrollbars applied to `.lang-select-menu`, `.font-select-menu`, `.model-menu`, `.commands-menu`, `.user-menu`, `.credit-menu`, `.mcp-dialog`, and `.auth-dialog`.

---

## 7. Packaging & Scripts

- **Development**: `npm run dev`
- **Frontend/Backend Build**: `npm run build`
- **Windows Portable**: `npm run dist:portable` (generates `CilamAI-0.1.0.1-Portable.exe`)
- **Windows Installer**: `npm run dist:nsis` (generates `CilamAI-0.1.0.1-Setup.exe`)
- **Directory Build**: `npm run dist:dir`
