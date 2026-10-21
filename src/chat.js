import { searchAll } from './knowledge.js'
import { lookup } from './invoices.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

const tools = [
  {
    type: 'function',
    function: {
      name: 'lookup_invoice',
      description: "Find a customer's existing order/invoice. Needs BOTH the invoice (order) number and the email used on the order.",
      parameters: {
        type: 'object',
        properties: {
          invoice_number: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['invoice_number', 'email'],
      },
    },
  },
]

async function groq(body) {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  const send = () => fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let res = await send()
  if (res.status === 429) {
    // free tier is token-per-minute limited: wait the suggested time (max 10s) and retry once
    const wait = Number((await res.text()).match(/try again in ([\d.]+)s/)?.[1]) || 5
    await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000 + 300))
    res = await send()
  }
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

// messages: [{role:'user'|'assistant', content}] from the client; only the last few are used
export async function reply(messages, settings) {
  const history = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
  // use the last two user turns so short follow-ups ("and the price?") still retrieve well
  const q = history.filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join(' ')
  const found = await searchAll(q, 4)
  const ctx = found.map((c, i) => `[${i + 1}] ${c.title}\n${c.text}`).join('\n\n')

  const msgs = [
    { role: 'system', content: `${settings.systemPrompt}\n\nKNOWLEDGE CONTEXT:\n${ctx || '(nothing relevant found)'}` },
    ...history,
  ]

  for (let step = 0; step < 4; step++) {
    const data = await groq({
      model: settings.model,
      temperature: Number(settings.temperature) || 0.3,
      max_tokens: 700,
      ...(settings.model.includes('gpt-oss') && { reasoning_effort: 'low' }),
      messages: msgs,
      tools,
      tool_choice: 'auto',
    })
    const msg = data.choices?.[0]?.message
    if (!msg) throw new Error('Empty response from Groq')
    if (!msg.tool_calls?.length) return { text: msg.content || '', sources: found.map((c) => c.title) }

    msgs.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls })
    for (const call of msg.tool_calls) {
      let out
      try {
        const a = JSON.parse(call.function.arguments || '{}')
        const inv = await lookup(a.invoice_number, a.email)
        out = inv ? { found: true, invoice: inv } : { found: false, note: 'No invoice matches that number and email. Ask the customer to double-check both.' }
      } catch {
        out = { found: false, note: 'Bad arguments' }
      }
      msgs.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out) })
    }
  }
  return { text: 'Sorry, I could not complete that. Please try again.', sources: [] }
}
