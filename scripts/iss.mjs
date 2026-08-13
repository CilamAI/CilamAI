#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, createWriteStream, readdirSync } from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const cacheDir = path.join(root, 'tools', 'inno-setup')
const installerDir = path.join(cacheDir, 'installer')
const installerExe = path.join(installerDir, 'is-setup.exe')
const isccCache = path.join(cacheDir, 'ISCC.exe')
const isccUrl = 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe'

const candidates = [
  process.env.ISCC_PATH,
  isccCache,
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 5\\ISCC.exe'
].filter(Boolean)

let iscc = candidates.find((p) => existsSync(p))

if (!iscc) {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const found = spawnSync(which, ['iscc'], { encoding: 'utf8' })
    const first = found.stdout?.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (first && existsSync(first)) iscc = first
  } catch {}
}

if (!iscc) {
  if (process.platform !== 'win32') {
    console.error('Inno Setup only runs on Windows.')
    process.exit(1)
  }
  console.log('Inno Setup not found. Downloading portable copy...')
  try {
    await download(isccUrl, installerExe)
    console.log(`Downloaded to ${installerExe}`)
    console.log('Silent-installing to local cache...')
    const ok = silentInstall(installerExe, cacheDir)
    if (!ok) {
      console.error('Silent install failed. Try running the installer manually:')
      console.error(`  ${installerExe} /SP- /SILENT /SUPPRESSMSGBOXES /DIR="${cacheDir}"`)
      process.exit(1)
    }
    const found = findExe(cacheDir, 'ISCC.exe')
    if (!found) {
      console.error(`ISCC.exe not found under ${cacheDir} after install.`)
      process.exit(1)
    }
    iscc = found
    console.log(`Installed: ${iscc}`)
  } catch (err) {
    console.error('Auto-download failed:', err.message)
    console.error('')
    console.error('Install Inno Setup 6 from https://jrsoftware.org/isdl.php')
    console.error('   or set ISCC_PATH to the ISCC.exe location.')
    process.exit(1)
  }
}

if (!existsSync(iscc)) {
  console.error(`ISCC.exe still not found at: ${iscc}`)
  process.exit(1)
}

const hasExplicitIss = process.argv[2] && (process.argv[2].endsWith('.iss') || (existsSync(process.argv[2]) && !process.argv[2].startsWith('/')))
const issFile = hasExplicitIss ? process.argv[2] : path.join(root, 'iss', 'installer.iss')
if (!existsSync(issFile)) {
  console.error(`Installer script not found: ${issFile}`)
  process.exit(1)
}

const extraArgs = hasExplicitIss ? process.argv.slice(3) : process.argv.slice(2)

console.log(`Building installer: ${issFile}`)
console.log(`Using ISCC: ${iscc}`)
const child = spawn(iscc, [issFile, ...extraArgs], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (err) => {
  console.error(`Failed to run ${iscc}:`, err.message)
  process.exit(1)
})

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'))
    mkdirSync(path.dirname(dest), { recursive: true })
    const file = createWriteStream(dest)
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      file.close()
      if (err) reject(err)
      else resolve()
    }
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CilamAI-iss-build'
        }
      },
      (res) => {
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          const next = res.headers.location
          res.resume()
          if (!next) return finish(new Error(`Redirect with no location from ${url}`))
          let absolute
          try {
            absolute = new URL(next, url).toString()
          } catch (e) {
            return finish(e)
          }
          download(absolute, dest, redirects - 1).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          return finish(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        res.pipe(file)
        file.on('finish', () => finish())
      }
    )
    req.on('error', finish)
    file.on('error', finish)
  })
}

function silentInstall(installer, destDir) {
  mkdirSync(destDir, { recursive: true })
  const args = [
    '/SP-',
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
    '/NOICONS',
    `/DIR=${destDir}`
  ]
  const r = spawnSync(installer, args, { stdio: 'inherit', windowsHide: true })
  return r.status === 0
}

function findExe(dir, name) {
  if (!existsSync(dir)) return null
  const direct = path.join(dir, name)
  if (existsSync(direct)) return direct
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile() && e.name === name) return p
    }
  }
  return null
}
