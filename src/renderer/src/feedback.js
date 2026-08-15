// Provide Feedback standalone window logic
let localeData = {}

async function loadLocale() {
  let lang = 'en'
  try {
    const raw = localStorage.getItem('ollama-settings')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.language) lang = parsed.language
    }
  } catch {}

  try {
    const res = await fetch(`./lang/${lang}.json`)
    localeData = res.ok ? await res.json() : {}
  } catch {
    localeData = {}
  }

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')
    if (localeData[key]) el.textContent = localeData[key]
  })

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder')
    if (localeData[key]) el.setAttribute('placeholder', localeData[key])
  })
}

function showToast(msg) {
  const toast = document.createElement('div')
  toast.className = 'notification-toast'
  toast.textContent = msg
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 2500)
}

function init() {
  loadLocale()

  const typeRadios = document.querySelectorAll('input[name="feedback-type"]')
  const stepsGroup = document.querySelector('#feedback-steps-group')
  const msgInput = document.querySelector('#feedback-message')
  const attachTrigger = document.querySelector('#feedback-attach-trigger')
  const fileInput = document.querySelector('#feedback-file-input')
  const filePreview = document.querySelector('#feedback-file-preview')
  const removeFileBtn = document.querySelector('#feedback-file-remove')
  const previewFilename = document.querySelector('.preview-filename')
  const cancelBtn = document.querySelector('#feedback-cancel-btn')
  const githubBtn = document.querySelector('#feedback-github-btn')
  const form = document.querySelector('#feedback-form')

  typeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.value === 'bug') {
        if (stepsGroup) stepsGroup.hidden = false
        if (msgInput) msgInput.placeholder = localeData?.feedbackDescPlaceholder || 'Describe the bug you encountered...'
      } else if (radio.value === 'feature') {
        if (stepsGroup) stepsGroup.hidden = true
        if (msgInput) msgInput.placeholder = 'Describe the feature you would like to see...'
      } else if (radio.value === 'auth-billing') {
        if (stepsGroup) stepsGroup.hidden = true
        if (msgInput) msgInput.placeholder = 'Describe the authentication or billing issue...'
      } else {
        if (stepsGroup) stepsGroup.hidden = true
        if (msgInput) msgInput.placeholder = 'Share your thoughts, suggestions, or experience...'
      }
    })
  })

  if (attachTrigger && fileInput) {
    attachTrigger.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (file && filePreview && previewFilename) {
        previewFilename.textContent = file.name
        filePreview.hidden = false
        attachTrigger.hidden = true
      }
    })
  }

  if (removeFileBtn && fileInput && filePreview && attachTrigger) {
    removeFileBtn.addEventListener('click', () => {
      fileInput.value = ''
      filePreview.hidden = true
      attachTrigger.hidden = false
    })
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      window.close()
    })
  }

  if (githubBtn) {
    githubBtn.addEventListener('click', () => {
      window.electron?.openExternal?.('https://github.com/CilamAI/CilamAI/issues/new/choose')
    })
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const msg = msgInput?.value?.trim()
      if (!msg) return
      showToast(localeData?.feedbackSent || 'Thank you for your feedback!')
      form.reset()
      setTimeout(() => window.close(), 1200)
    })
  }
}

document.addEventListener('DOMContentLoaded', init)
