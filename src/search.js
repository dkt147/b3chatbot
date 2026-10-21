// tiny in-memory BM25
const STOP = new Set('the a an and or of to in is are was for on with at by it this that be as from your you we our can do does how what i'.split(' '))
const tok = (s) => (s.toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter((w) => !STOP.has(w))

export function createIndex(chunks) {
  const docs = chunks.map((c) => {
    const terms = tok(c.title + ' ' + c.text)
    const tf = new Map()
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1)
    return { c, tf, len: terms.length }
  })
  const df = new Map()
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1)
  const avg = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1) || 1

  // returns [[score, chunk], ...] best first
  return function search(query, k = 6) {
    const q = [...new Set(tok(query))]
    if (!q.length || !docs.length) return []
    const N = docs.length
    const scored = []
    for (const d of docs) {
      let s = 0
      for (const t of q) {
        const f = d.tf.get(t)
        if (!f) continue
        const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5))
        s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / avg)))
      }
      if (s > 0) scored.push([s, d.c])
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, k)
  }
}
