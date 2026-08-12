import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

const installerDir = 'C:\\Users\\omg\\my-electrons\\tools\\inno-setup\\installer'
const destDir = 'C:\\Users\\omg\\my-electrons\\tools\\inno-setup'
const installer = installerDir + '\\is-setup.exe'

console.log('Installer exists:', existsSync(installer))
mkdirSync(destDir, { recursive: true })

const args = [
  '/SP-',
  '/VERYSILENT',
  '/SUPPRESSMSGBOXES',
  '/NORESTART',
  '/NOICONS',
  `/DIR=${destDir}`
]

console.log('Running:', installer, args.join(' '))
const r = spawnSync(installer, args, { stdio: 'inherit', windowsHide: true })
console.log('status:', r.status)
console.log('signal:', r.signal)
console.log('error:', r.error?.message)
console.log('stdout:', r.stdout?.toString())
console.log('stderr:', r.stderr?.toString())
