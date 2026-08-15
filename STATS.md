# CilamAI - Project Statistics & Metrics

Overview of metrics, codebase scale, feature statistics, and internationalization coverage for **CilamAI**.

---

## 1. Codebase Scale & Lines of Code

| Component | File / Directory | Lines of Code | Description |
| :--- | :--- | :--- | :--- |
| **Electron Main** | `src/main/index.js` | ~1,394 lines | IPC handlers, credits backend, window management |
| **Preload API** | `src/preload/index.js` | ~90 lines | Context bridge & secure API bindings |
| **Renderer Logic** | `src/renderer/src/main.js` | ~3,957 lines | Frontend controller, MCP manager, chat streaming |
| **Styling & Themes** | `src/renderer/src/style.css` | ~4,142 lines | Design system, 8 themes, custom scrollbars |
| **UI Structure** | `src/renderer/index.html` | ~983 lines | Desktop layout, settings, MCP and auth dialogs |
| **Localization Files** | `src/renderer/public/lang/` | ~2,850 lines | 19 language dictionaries with 100% key parity |
| **Total Source Code** | **Core Codebase** | **~13,416+ lines** | Clean, modular Electron + Vite architecture |

---

## 2. Internationalization (i18n) Metrics

- **Supported Languages**: `19 Languages`
- **Translation Keys per File**: `118+ Keys`
- **Total Translated Phrases**: `2,242+ Phrases` across all dictionaries
- **Key Parity Coverage**: `100% Complete`

### Language Matrix:
1. English (`en`)
2. 한국어 / Korean (`ko`)
3. Türkçe / Turkish (`tr`)
4. Русский / Russian (`ru`)
5. 简体中文 / Simplified Chinese (`zh`)
6. 繁體中文 / Traditional Chinese (`zh-TW`)
7. 日本語 / Japanese (`ja`)
8. Español / Spanish (`es`)
9. Français / French (`fr`)
10. Deutsch / German (`de`)
11. Português / Portuguese (`pt`)
12. Italiano / Italian (`it`)
13. العربية / Arabic (`ar`)
14. हिन्दी / Hindi (`hi`)
15. Tiếng Việt / Vietnamese (`vi`)
16. Bahasa Indonesia / Indonesian (`id`)
17. Polski / Polish (`pl`)
18. Українська / Ukrainian (`uk`)
19. Nederlands / Dutch (`nl`)

---

## 3. Themes & Customization

| Theme | Background | Accent | Contrast-Safe Text |
| :--- | :--- | :--- | :--- |
| **Dark (Default)** | `#121212` | `#f0f0f0` | `#111111` |
| **Light** | `#ffffff` | `#2563eb` | `#ffffff` |
| **Blue** | `#0d1524` | `#4d9fff` | `#ffffff` |
| **Red** | `#1c0d0d` | `#ff5a5a` | `#ffffff` |
| **Yellow** | `#171407` | `#f5c518` | `#1a1400` |
| **Green** | `#0c1710` | `#3ddc84` | `#0a120c` |
| **Black** | `#000000` | `#f2f2f2` | `#111111` |
| **System** | Adaptive | Adaptive | Adaptive |

---

## 4. Key Feature Matrix

- **Model Context Protocol (MCP)**: Supports `stdio` and `sse` transports with quick templates (*Filesystem*, *Brave Search*, *GitHub*, *Memory*).
- **Credits & Spending Engine**:
  - Default Limit: `100 credits` with 24-hour automatic reset.
  - VIP Limit: `100,000 credits` with 1-year reset cycle (`kevccx@gmail.com`).
  - Spent cost calculation: `$0.02 * credits spent` formatted as `0.00$`.
- **Packaging Distribution**:
  - **Portable (.exe)**: Standalone single-file executable (`CilamAI-0.1.0.1-Portable.exe`).
  - **Installer (.exe)**: Setup wizard with desktop and Start Menu shortcuts (`CilamAI-0.1.0.1-Setup.exe`).
