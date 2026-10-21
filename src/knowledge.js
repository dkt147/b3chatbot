import fs from 'node:fs'
import { cmd, hashAll } from './db.js'
import { createIndex } from './search.js'
import { toChunks } from './ingest.js'

// built-in site knowledge: read-only, bundled with the deploy, indexed once per instance
let site = []
try {
  site = JSON.parse(fs.readFileSync(new URL('../data/site.json', import.meta.url), 'utf8'))
} catch {
  console.warn('data/site.json missing: run `npm run build-site`')
}
// site + client entries share ONE index so BM25 scores are comparable. Rebuilt only when the
// client's entries change (cached per instance); the client's own text gets a ranking boost.
let cache = { sig: null, search: createIndex(site) }
async function searcher() {
  const all = await hashAll('kn')
  const sig = Object.keys(all).sort().join(',')
  if (sig !== cache.sig) cache = { sig, search: createIndex([...site, ...Object.values(all).map((v) => JSON.parse(v))]) }
  return cache.search
}

export async function searchAll(query, k = 6) {
  const hits = (await searcher())(query, k * 2).map(([s, c]) => [c.source === 'site' ? s : s * 1.5, c])
  return hits.sort((a, b) => b[0] - a[0]).slice(0, k).map((x) => x[1])
}

export async function addCustom(source, title, text) {
  const chunks = toChunks(source, title, text)
  if (!chunks.length) return 0
  await cmd('HSET', 'kn', ...chunks.flatMap((c) => [c.id, JSON.stringify(c)]))
  return chunks.length
}

export async function customItems() {
  return Object.values(await hashAll('kn')).map((v) => JSON.parse(v))
}

export async function removeCustom({ id, source }) {
  const ids = id ? [id] : (await customItems()).filter((c) => c.source === source).map((c) => c.id)
  if (ids.length) await cmd('HDEL', 'kn', ...ids)
}

export async function summary() {
  const m = new Map()
  for (const c of await customItems()) m.set(c.source, (m.get(c.source) || 0) + 1)
  return [{ source: 'website (built-in)', chunks: site.length, builtin: true }, ...[...m].map(([source, chunks]) => ({ source, chunks }))]
}
