import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const rl = createInterface({ input: process.stdin, output: process.stdout })

rl.on('close', () => process.exit(0))

function prompt() {
  rl.question('> ', (line) => {
    const cmd = line.trim()
    if (!cmd) { prompt(); return }
    if (cmd === 'quit' || cmd === 'exit') { rl.close(); return }
    if (cmd === 'dev') {
      console.log('[INFO] starting electron-vite dev...')
      spawn('npx', ['electron-vite', 'dev'], { cwd: root, stdio: 'inherit', shell: true })
    } else if (cmd === 'build') {
      console.log('[INFO] building...')
      spawn('npx', ['electron-vite', 'build'], { cwd: root, stdio: 'inherit', shell: true })
    } else if (cmd === 'preview') {
      console.log('[INFO] previewing...')
      spawn('npx', ['electron-vite', 'preview'], { cwd: root, stdio: 'inherit', shell: true })
    } else {
      console.log(`[WARN] unknown command: ${cmd}`)
      console.log('[INFO] commands: dev | build | preview | quit')
    }
    prompt()
  })
}

console.log('[INFO] CilamAI Console')
console.log('[INFO] commands: dev | build | preview | quit')
prompt()
