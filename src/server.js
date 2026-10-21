// local dev server. On Vercel the entry is api/index.js and public/ is served statically.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// minimal .env loader (must run before the app modules read process.env)
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {}

const { serve } = await import('@hono/node-server')
const { serveStatic } = await import('@hono/node-server/serve-static')
const { app } = await import('./app.js')

app.get('/', (c) => c.redirect('/admin'))
app.get('/admin', (c) => c.html(fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8')))
app.use('/*', serveStatic({ root: './public' }))

const port = Number(process.env.PORT) || 3000
serve({ fetch: app.fetch, port }, () => console.log(`B3 bot running: admin http://localhost:${port}/admin`))
