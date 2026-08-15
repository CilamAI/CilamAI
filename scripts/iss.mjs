import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const isccPath = join(process.cwd(), 'tools', 'inno-setup', 'ISCC.exe')
const issFile = join(process.cwd(), 'iss', 'installer.iss')

if (!existsSync(isccPath)) {
  console.error('ISCC.exe not found at:', isccPath)
  process.exit(1)
}

if (!existsSync(issFile)) {
  console.error('installer.iss not found at:', issFile)
  process.exit(1)
}

console.log('Building unpacked directory for Inno Setup...')
const buildResult = spawnSync('npm', ['run', 'dist:dir'], {
  stdio: 'inherit',
  shell: true
})

if (buildResult.status !== 0) {
  console.error('Failed to build unpacked application files.')
  process.exit(buildResult.status || 1)
}

console.log('Compiling Inno Setup Installer...')
console.log('Using compiler:', isccPath)
console.log('Script file:', issFile)

const result = spawnSync(isccPath, [issFile], {
  stdio: 'inherit',
  shell: true
})

if (result.status !== 0) {
  console.error('Inno Setup compilation failed with exit code:', result.status)
  process.exit(result.status || 1)
}

console.log('Inno Setup compilation succeeded! Output in Output/ directory.')
