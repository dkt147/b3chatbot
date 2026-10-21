import { uid } from './store.js'

// split text into ~900 char chunks on paragraph boundaries
export function chunk(text, size = 900) {
  const out = []
  let cur = ''
  for (const p of text.split(/\n+/)) {
    if (cur && cur.length + p.length > size) {
      out.push(cur)
      cur = ''
    }
    cur += (cur ? '\n' : '') + p
    while (cur.length > size * 1.6) {
      out.push(cur.slice(0, size))
      cur = cur.slice(size)
    }
  }
  if (cur.trim()) out.push(cur)
  return out.filter((p) => p.trim().length >= 20)
}

export const toChunks = (source, title, text) => chunk(text.trim()).map((t) => ({ id: uid(), source, title, text: t }))

// crawled site dump (pages separated by ===== lines) -> chunks
export function parseSiteDump(raw) {
  const seen = new Set()
  const out = []
  for (const page of raw.split(/\n={20,}\n/)) {
    const url = page.match(/^URL: (.+)$/m)?.[1]
    if (!url) continue
    const title = page.match(/^TITLE: (.+)$/m)?.[1] || url
    const body = page.split(/\n-{20,}\n/).slice(1).join('\n').trim()
    if (!body || /identical to/i.test(body.slice(0, 120)) || seen.has(body)) continue
    seen.add(body)
    out.push(...toChunks('site', `${title} (${url})`, body))
  }
  return out
}
