// Redis access over REST (Upstash / Vercel Marketplace). Without credentials, falls back to a local JSON file
// that emulates the few commands used here, so `npm start` works on a laptop.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Vercel's Upstash integration can add a custom prefix (e.g. STORAGE_KV_REST_API_URL), so match by suffix
const envFind = (re) => {
  const k = Object.keys(process.env).find((n) => re.test(n) && process.env[n])
  return k ? process.env[k] : undefined
}
const URL_ = envFind(/(^|_)(KV_REST_API_URL|REDIS_REST_URL|REST_API_URL)$/)
const TOKEN = envFind(/(^|_)(KV_REST_API_TOKEN|REDIS_REST_TOKEN|REST_API_TOKEN)$/)

export const redisConfigured = !!(URL_ && TOKEN)

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'local-db.json')
let mem

function local(args) {
  if (!mem) {
    try { mem = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { mem = {} }
  }
  const [op, key, ...rest] = args
  const flush = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(mem)) }
  switch (op.toUpperCase()) {
    case 'GET': return mem[key] ?? null
    case 'SET': mem[key] = rest[0]; flush(); return 'OK'
    case 'HGET': return mem[key]?.[rest[0]] ?? null
    case 'HSET': {
      mem[key] ||= {}
      for (let i = 0; i < rest.length; i += 2) mem[key][rest[i]] = rest[i + 1]
      flush(); return rest.length / 2
    }
    case 'HDEL': { if (mem[key]) for (const f of rest) delete mem[key][f]; flush(); return 1 }
    case 'HGETALL': return Object.entries(mem[key] || {}).flat()
    case 'LPUSH': mem[key] ||= []; mem[key].unshift(rest[0]); flush(); return mem[key].length
    case 'LTRIM': mem[key] = (mem[key] || []).slice(Number(rest[0]), Number(rest[1]) + 1); flush(); return 'OK'
    case 'LRANGE': return (mem[key] || []).slice(Number(rest[0]), Number(rest[1]) + 1)
    default: throw new Error('unsupported local command ' + op)
  }
}

export async function cmd(...args) {
  args = args.map(String)
  if (!URL_ || !TOKEN) {
    if (process.env.VERCEL) throw new Error('Redis is not configured (UPSTASH_REDIS_REST_URL / KV_REST_API_URL missing)')
    return local(args)
  }
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await res.json()
  if (data.error) throw new Error('Redis: ' + data.error)
  return data.result
}

export async function getJSON(key, fallback) {
  const v = await cmd('GET', key)
  try { return v ? JSON.parse(v) : fallback } catch { return fallback }
}
export const setJSON = (key, val) => cmd('SET', key, JSON.stringify(val))

// HGETALL returns a flat [field, value, ...] array
export async function hashAll(key) {
  const flat = (await cmd('HGETALL', key)) || []
  const out = {}
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1]
  return out
}
