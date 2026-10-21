import { cmd, hashAll } from './db.js'

// Redis hash "inv": field = normalised invoice number, value = invoice JSON
const norm = (s) => String(s || '').trim().toLowerCase().replace(/^#/, '')

const clean = (inv) => ({
  invoiceNumber: String(inv.invoiceNumber || '').trim(),
  email: String(inv.email || '').trim(),
  name: inv.name || '',
  date: inv.date || '',
  items: inv.items || '',
  total: inv.total || '',
  status: inv.status || '',
  tracking: inv.tracking || '',
  notes: inv.notes || '',
})

export async function upsertMany(list) {
  const recs = list.map(clean).filter((r) => r.invoiceNumber)
  if (recs.length) await cmd('HSET', 'inv', ...recs.flatMap((r) => [norm(r.invoiceNumber), JSON.stringify(r)]))
  return recs.length
}

export async function list() {
  return Object.entries(await hashAll('inv')).map(([id, v]) => ({ id, ...JSON.parse(v) }))
}

export const remove = (id) => cmd('HDEL', 'inv', id)

// requires BOTH invoice number and matching email, so nobody can browse other people's orders
export async function lookup(invoiceNumber, email) {
  const v = await cmd('HGET', 'inv', norm(invoiceNumber))
  if (!v) return null
  const inv = JSON.parse(v)
  return norm(inv.email) === norm(email) ? inv : null
}

const ALIAS = {
  invoice: 'invoiceNumber', invoicenumber: 'invoiceNumber', invoiceno: 'invoiceNumber',
  order: 'invoiceNumber', ordernumber: 'invoiceNumber',
  email: 'email', customeremail: 'email',
  name: 'name', customer: 'name',
  date: 'date', items: 'items', products: 'items',
  total: 'total', amount: 'total', status: 'status',
  tracking: 'tracking', trackingnumber: 'tracking', notes: 'notes',
}

export function parseCsv(text) {
  const rows = []
  let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cur += c
  }
  row.push(cur)
  if (row.some((x) => x.trim())) rows.push(row)
  const head = (rows.shift() || []).map((h) => ALIAS[h.trim().replace(/[\s_-]/g, '').toLowerCase()])
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]?.trim()]).filter(([k]) => k)))
}
