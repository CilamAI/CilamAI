# OlinaAI

A fast, private, cross-platform AI assistant desktop app built with Electron and Vite, supporting multiple models (Ollama, OpenAI, OpenCode) with streaming, themes, file uploads, and image (vision) support.

## Features

* **Multi-provider support**: Ollama, OpenAI, and OpenCode inference with a single configurable endpoint.
* **Streaming responses**: token-by-token streaming with a collapsible "Thinking" block for reasoning models.
* **Chat themes**: dark, light, blue, red, yellow, and a system-aware theme that follows your OS.
* **File & image uploads**: upload images (vision), with inline preview chips and a 10 MB limit (audio/video blocked). Vision payloads are sent as base64 to the API.
* **Native-feeling window**: frameless titlebar with centered menu bar (File, View, Window), Windows 11 Mica/Acrylic backdrop support, and custom window controls.
* **Keyboard-first**: Enter to send, Escape to close menus, global hotkeys, and a focused composer with model selector.
* **Local-first settings**: preferences (theme, model, provider, API key, streaming, startup launch, font size) persist in the app's userData directory (`Ollama 2` on Windows).
* **Startup launcher**: launches on login with a 5s branded loading screen.

## Getting Started

### Prerequisites

* **Node.js** 20+ and npm
* For Ollama provider: a running [Ollama](https://ollama.com) instance
* For OpenAI provider: a valid OpenAI API key
* For OpenCode provider: an [OpenCode](https://opencode.ai) API key

### Install & run

```bash
# from the project root
npm install
npm start
```

For development with hot reload:

```bash
npm run dev
```

### Build

To apply source changes in the running app (preview mode), rebuild after each change:

```bash
npm run build
npm start
```

### Configuration

| Setting | Description |
|---------|-------------|
| `provider` | `openai`, `ollama`, or `opencode` |
| `openaiUrl` | API base URL |
| `apiKey` | Bearer token for the chosen provider |
| `stream` | Enable/disable streaming (default true) |
| `theme` | dark, light, blue, red, yellow, or system |
| `model` | Default chat model (e.g. `gemma4:26b`) |
| `fontSize` | Chat font size (13/14/15/17) |
| `startupLaunch` | Launch app on login |

API keys are never committed, they are stored only in your local userData directory.

## Project Structure

```
src/
  main/index.js
  preload/index.js
  renderer/
    index.html
    loading.gif
    src/
      main.js
      style.css
      App.js
      highlight.css
```

## Development

* `npm start` = `electron-vite preview` (serves **built** output from `out/`). Edit, build, then restart.
* `npm run dev` = `electron-vite dev` (live reload of source).
* IPC channels: `chat:send`, `chat:send-stream`, `chat:stream-chunk`, `chat:stream-reasoning`, `chat:stop-stream`, `file:upload`, `window:*`.
* Model menu is populated from the provider's `/models` endpoint (OpenAI `data[].id` or Ollama `models[].name`), with a searchable dropdown.

## Keyboard Shortcuts

| Keys | Action |
|------|--------|
| Enter | Send message |
| Escape | Close open menus |
| Ctrl/Cmd + K | Reset / New chat |
| Ctrl/Cmd + Shift + U | Upload file |

## Theming

Each theme is a full set of CSS custom properties. Switching theme updates the live `data-theme` attribute on `html` and persists the selection. The `system` theme reads `prefers-color-scheme` and updates live with OS changes.

## Roadmap

* Native notifications for new messages
* Session history / local conversation persistence
* Plugin support for custom providers

## License

MIT. See [LICENSE](LICENSE).

## Links

* GitHub: [https://github.com/OlinaAI/OlinaAI](https://github.com/OlinaAI/OlinaAI)
* Issues: [https://github.com/OlinaAI/OlinaAI/issues](https://github.com/OlinaAI/OlinaAI/issues)
