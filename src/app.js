import crypto from 'node:crypto'
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { cmd, redisConfigured } from './db.js'
import { getSettings, updateSettings, uid } from './store.js'
import * as K from './knowledge.js'
import * as I from './invoices.js'
import { reply } from './chat.js'

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me'
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(ADMIN_PASSWORD + 'b3bot').digest('hex')
if (ADMIN_PASSWORD === 'change-me') console.warn('WARNING: set ADMIN_PASSWORD')

export const app = new Hono()

// ---------- auth ----------
const sign = (exp) => exp + '.' + crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex')
const valid = (t) => {
  if (!t) return false
  const [exp] = t.split('.')
  const good = sign(exp)
  return t.length === good.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(good)) && Number(exp) > Date.now()
}
const requireAdmin = async (c, next) => (valid(getCookie(c, 'b3admin')) ? next() : c.json({ error: 'unauthorized' }, 401))

// best-effort per-instance limiter (serverless instances don't share memory)
const hits = new Map()
const limited = (key, max, windowMs) => {
  const now = Date.now()
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs)
  arr.push(now)
  hits.set(key, arr)
  return arr.length > max
}
const ipOf = (c) => c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local'

// quick diagnostics, no secrets: which pieces are configured and does Redis answer
app.get('/api/health', async (c) => {
  let redis = 'ok'
  try { await cmd('GET', 'health-check') } catch (e) { redis = e.message.slice(0, 120) }
  return c.json({ redisConfigured, redis, groqKey: !!process.env.GROQ_API_KEY, adminPasswordSet: !!process.env.ADMIN_PASSWORD })
})

// ---------- public API (used by the embedded widget) ----------
app.use('/api/public/*', async (c, next) => {
  const s = await getSettings()
  const list = s.allowedOrigins.split(/[\s,]+/).filter(Boolean)
  const o = c.req.header('origin')
  if (list.length && o && !list.includes(o)) return c.json({ error: 'origin not allowed' }, 403)
  c.header('Access-Control-Allow-Origin', o || '*')
  c.header('Access-Control-Allow-Headers', 'Content-Type')
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  c.set('settings', s)
  return next()
})

app.get('/api/public/config', (c) => {
  const s = c.get('settings')
  return c.json({ enabled: s.enabled, offlineMode: s.offlineMode, offlineMessage: s.offlineMessage, botName: s.botName, greeting: s.greeting, color: s.color })
})

app.post('/api/public/chat', async (c) => {
  const s = c.get('settings')
  if (!s.enabled) return c.json({ error: 'offline', reply: s.offlineMessage }, 503)
  if (limited(ipOf(c), 20, 60_000)) return c.json({ error: 'Too many messages, slow down.' }, 429)
  const { messages, sessionId } = await c.req.json().catch(() => ({}))
  if (!Array.isArray(messages) || !messages.length) return c.json({ error: 'bad request' }, 400)
  try {
    const { text } = await reply(messages, s)
    const entry = { sid: String(sessionId || uid()).slice(0, 40), at: new Date().toISOString(), user: String(messages.at(-1).content).slice(0, 2000), bot: text }
    await cmd('LPUSH', 'conv', JSON.stringify(entry))
    await cmd('LTRIM', 'conv', 0, 499)
    return c.json({ reply: text })
  } catch (e) {
    console.error(e.message)
    return c.json({ error: 'The assistant had a problem. Please try again.' }, 502)
  }
})

// ---------- admin API ----------
app.post('/api/admin/login', async (c) => {
  if (limited('login' + ipOf(c), 8, 600_000)) return c.json({ error: 'Too many attempts' }, 429)
  const { username, password } = await c.req.json().catch(() => ({}))
  const h = (v) => crypto.createHash('sha256').update(String(v ?? '')).digest()
  // compare both fields without short-circuiting so timing doesn't reveal which was wrong
  const okUser = crypto.timingSafeEqual(h(username), h(ADMIN_USERNAME))
  const okPass = crypto.timingSafeEqual(h(password), h(ADMIN_PASSWORD))
  if (!(okUser && okPass)) return c.json({ error: 'Wrong username or password' }, 401)
  setCookie(c, 'b3admin', sign(Date.now() + 12 * 3600_000), { httpOnly: true, secure: !!process.env.VERCEL, sameSite: 'Lax', path: '/', maxAge: 12 * 3600 })
  return c.json({ ok: true })
})
app.post('/api/admin/logout', (c) => (deleteCookie(c, 'b3admin', { path: '/' }), c.json({ ok: true })))

app.use('/api/admin/*', async (c, next) => (c.req.path.endsWith('/login') ? next() : requireAdmin(c, next)))

app.get('/api/admin/settings', async (c) => c.json({ settings: await getSettings(), hasKey: !!process.env.GROQ_API_KEY }))
app.put('/api/admin/settings', async (c) => c.json({ settings: await updateSettings(await c.req.json()) }))

// chatbot on/off
app.post('/api/admin/toggle', async (c) => {
  const { enabled } = await c.req.json()
  return c.json({ enabled: (await updateSettings({ enabled })).enabled })
})

// admin test chat: works even while the public bot is OFF
app.post('/api/admin/chat', async (c) => {
  const { messages } = await c.req.json()
  try {
    const { text, sources } = await reply(messages, await getSettings())
    return c.json({ reply: text, context: sources.slice(0, 3) })
  } catch (e) {
    return c.json({ error: e.message }, 502)
  }
})

// training
app.get('/api/admin/knowledge', async (c) => c.json({ sources: await K.summary(), items: await K.customItems() }))
app.post('/api/admin/knowledge', async (c) => {
  const { title, text, source } = await c.req.json()
  if (!text?.trim()) return c.json({ error: 'text required' }, 400)
  return c.json({ added: await K.addCustom(source || 'manual', title || 'Custom note', text) })
})
app.delete('/api/admin/knowledge/source/:s', async (c) => (await K.removeCustom({ source: c.req.param('s') }), c.json({ ok: true })))
app.delete('/api/admin/knowledge/:id', async (c) => (await K.removeCustom({ id: c.req.param('id') }), c.json({ ok: true })))

// invoices
app.get('/api/admin/invoices', async (c) => c.json(await I.list()))
app.post('/api/admin/invoices', async (c) => {
  const b = await c.req.json()
  const list = Array.isArray(b) ? b : b.csv ? I.parseCsv(b.csv) : [b]
  return c.json({ saved: await I.upsertMany(list) })
})
app.delete('/api/admin/invoices/:id', async (c) => (await I.remove(c.req.param('id')), c.json({ ok: true })))

// conversations, grouped per visitor session
app.get('/api/admin/conversations', async (c) => {
  const rows = ((await cmd('LRANGE', 'conv', 0, 299)) || []).map((r) => JSON.parse(r)).reverse() // oldest first
  const by = new Map()
  for (const r of rows) {
    if (!by.has(r.sid)) by.set(r.sid, { id: r.sid, started: r.at, messages: [] })
    by.get(r.sid).messages.push({ role: 'user', content: r.user }, { role: 'assistant', content: r.bot })
  }
  return c.json([...by.values()].reverse())
})
