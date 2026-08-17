export function isFreeModel(model) {
  return /-free$/.test(model || '')
}

const isOpenAiCompat = (provider) => provider === 'openai' || provider === 'opencode'

export function buildHeaders({ model, apiKey, envConfig, org }) {
  const headers = { 'Content-Type': 'application/json' }
  const key = isFreeModel(model) ? '' : (apiKey || envConfig?.opencodeApiKey || '').trim()
  if (key) {
    headers.Authorization = `Bearer ${key}`
  }
  const orgId = org || envConfig?.opencodeOrgId
  if (orgId) headers['x-org-id'] = orgId
  return headers
}

const TRANSIENT_STATUSES = new Set([408, 425, 429, 502, 503, 504])
const TRANSIENT_PATTERNS = /temporarily unavailable|rate limit|overloaded|timeout|busy|capacity|queue|service unavailable/i

function isTransientError(status, message) {
  if (TRANSIENT_STATUSES.has(status)) return true
  return TRANSIENT_PATTERNS.test(message)
}

export async function chatSend({ url, model, messages, provider, apiKey, envConfig }) {
  const headers = buildHeaders({ model, apiKey, envConfig })
  const isOpenAI = isOpenAiCompat(provider)
  let attempt = 0
  const maxAttempts = 5
  while (true) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, stream: false })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      const error = data?.error?.message || data?.error || `HTTP ${res.status}`
      if (attempt < maxAttempts - 1 && isTransientError(res.status, error)) {
        attempt += 1
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
        continue
      }
      return { ok: false, error, status: res.status }
    }
    const data = await res.json().catch(() => null)
    const error = data?.error?.message || data?.error || null
    if (error && isTransientError(res.status, error) && attempt < maxAttempts - 1) {
      attempt += 1
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
      continue
    }
    const content = isOpenAI ? data?.choices?.[0]?.message?.content : data?.message?.content
    const reasoning = data?.choices?.[0]?.message?.reasoning || ''
    return { ok: true, data: { message: { content }, reasoning } }
  }
}

export async function chatSendStream({ url, model, messages, provider, apiKey, envConfig }, { signal, onChunk, onReasoning }) {
  const headers = buildHeaders({ model, apiKey, envConfig })
  const isOpenAI = isOpenAiCompat(provider)
  let attempt = 0
  const maxAttempts = 5
  let res
  while (true) {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, stream: true })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      const error = data?.error?.message || data?.error || `HTTP ${res.status}`
      if (attempt < maxAttempts - 1 && isTransientError(res.status, error)) {
        attempt += 1
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
        continue
      }
      return { ok: false, error, status: res.status }
    }
    break
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // Accumulates partial <think> blocks that span multiple stream chunks
  let thinkBuffer = ''
  let inThinkTag = false

  // Abort by cancelling the *response* reader only, not the request body upload.
  // Aborting the POST body itself tears down the upload data pipe and surfaces the
  // "chunked_data_pipe_upload_data_stream OnSizeReceived failed" network error.
  let aborted = false
  if (signal) {
    if (signal.aborted) aborted = true
    signal.addEventListener('abort', () => { aborted = true })
  }

  // Route text through <think>...</think> splitter.
  // Content inside tags goes to onReasoning; everything else goes to onChunk.
  const routeContent = (text) => {
    if (!text) return
    let remaining = text
    while (remaining.length > 0) {
      if (inThinkTag) {
        const closeIdx = remaining.indexOf('</think>')
        if (closeIdx === -1) {
          // Still inside a think block — buffer it all
          thinkBuffer += remaining
          onReasoning(remaining)
          return
        }
        // Found the closing tag
        const inside = remaining.slice(0, closeIdx)
        if (inside) {
          thinkBuffer += inside
          onReasoning(inside)
        }
        inThinkTag = false
        thinkBuffer = ''
        remaining = remaining.slice(closeIdx + '</think>'.length)
      } else {
        const openIdx = remaining.indexOf('<think>')
        if (openIdx === -1) {
          // No think block — send it all as content
          onChunk(remaining)
          return
        }
        // Send content before the opening tag
        if (openIdx > 0) {
          onChunk(remaining.slice(0, openIdx))
        }
        inThinkTag = true
        remaining = remaining.slice(openIdx + '<think>'.length)
      }
    }
  }

  while (true) {
    if (aborted) break
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf(isOpenAI ? '\n\n' : '\n')) !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + (isOpenAI ? 2 : 1))
      if (!block.trim()) continue
      if (isOpenAI) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          let chunk
          try {
            chunk = JSON.parse(payload)
          } catch {
            continue
          }
          const delta = chunk.choices?.[0]?.delta
          const reasoning = delta?.reasoning_content || delta?.reasoning || ''
          if (reasoning) {
            onReasoning(reasoning)
          } else if (Array.isArray(delta?.reasoning_details)) {
            for (const d of delta.reasoning_details) {
              if (d.text) onReasoning(d.text)
            }
          }
          routeContent(delta?.content ?? '')
        }
      } else {
        let chunk
        try {
          chunk = JSON.parse(block)
        } catch {
          continue
        }
        const reasoning = chunk.message?.reasoning_content || chunk.message?.reasoning || ''
        if (reasoning) onReasoning(reasoning)
        if (Array.isArray(chunk.message?.reasoning_details)) {
          for (const d of chunk.message.reasoning_details) {
            if (d.text) onReasoning(d.text)
          }
        }
        routeContent(chunk.message?.content ?? '')
      }
    }
  }
  if (aborted) {
    try { await reader.cancel() } catch {}
  }
  return { ok: true }
}

export async function webFetchStream(url, { signal, onChunk, onReasoning }) {
  let res
  try {
    res = await fetch(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
  } catch (err) {
    return { ok: false, error: err.message }
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }

  const contentType = res.headers.get('content-type') || ''
  // For non-text responses just return a notice
  if (!contentType.includes('text') && !contentType.includes('json')) {
    return { ok: false, error: `Unsupported content type: ${contentType}` }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let inThinkTag = false

  const routeContent = (text) => {
    if (!text) return
    let remaining = text
    while (remaining.length > 0) {
      if (inThinkTag) {
        const closeIdx = remaining.indexOf('</think>')
        if (closeIdx === -1) {
          onReasoning(remaining)
          return
        }
        if (closeIdx > 0) onReasoning(remaining.slice(0, closeIdx))
        inThinkTag = false
        remaining = remaining.slice(closeIdx + '</think>'.length)
      } else {
        const openIdx = remaining.indexOf('<think>')
        if (openIdx === -1) {
          onChunk(remaining)
          return
        }
        if (openIdx > 0) onChunk(remaining.slice(0, openIdx))
        inThinkTag = true
        remaining = remaining.slice(openIdx + '<think>'.length)
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      routeContent(decoder.decode(value, { stream: true }))
    }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: true, aborted: true }
    return { ok: false, error: err.message }
  }
  return { ok: true }
}

export async function googleSearch(query, apiKey, cx) {
  const params = new URLSearchParams({ key: apiKey, cx, q: query, num: '8' })
  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || `HTTP ${res.status}` }
  }
  const results = (data.items || []).map((item) => ({
    title: item.title || '',
    snippet: item.snippet || '',
    link: item.link || ''
  }))
  return { ok: true, results }
}
