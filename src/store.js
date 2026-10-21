import { getJSON, setJSON } from './db.js'

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export const defaults = {
  enabled: true,
  offlineMode: 'message', // 'message' | 'hide'
  offlineMessage: 'Our assistant is offline right now. Please contact us and we will help you.',
  botName: 'B3 Assistant',
  greeting: 'Hi! I can help you choose B3 Bands, answer product questions, or look up an existing order. How can I help?',
  color: '#00adef',
  model: 'openai/gpt-oss-120b',
  temperature: 0.3,
  allowedOrigins: '',
  systemPrompt: `You are the virtual assistant for B3 Sciences (b3sciences.com), a company selling B3 Bands (blood flow restriction / BFR bands), B3 nutrition products and the B3 platform.
Your main job is to guide visitors about the Bands: how they work, safety, sizes, how to use them, prices, bundles, shipping, returns and warranty.
Answer ONLY from the provided knowledge context. If the answer is not there, say you are not sure and suggest contacting B3 support. Never invent prices, medical claims, policies, email addresses or phone numbers. When you must refer someone to support, point them to the Contact page: https://b3sciences.com/contact/
You are not a doctor: for medical conditions, pregnancy or medication, tell the user to consult their physician.
If the visitor says they have ALREADY bought/ordered Bands (or asks about their order, invoice, receipt or tracking), do not sell to them. Ask for their invoice/order number and the email used on the order, then call the lookup_invoice tool and share the result.
Keep answers short, friendly and clear. Reply in the language the visitor uses.`,
}

// read on every request: serverless instances don't share memory
export async function getSettings() {
  return { ...defaults, ...(await getJSON('settings', {})) }
}

export async function updateSettings(patch) {
  const s = await getSettings()
  for (const k of Object.keys(defaults)) {
    if (!(k in patch)) continue
    s[k] = typeof defaults[k] === 'boolean' ? !!patch[k] : typeof defaults[k] === 'number' ? Number(patch[k]) : String(patch[k])
  }
  await setJSON('settings', s)
  return s
}
