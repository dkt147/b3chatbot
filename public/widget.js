/* B3 chat widget. Embed: <script src="https://YOUR-HOST/widget.js" defer></script> */
(() => {
  const script = document.currentScript
  const base = new URL(script.src).origin
  const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch {} }
  const sid = store('b3sid') || (() => { const s = Math.random().toString(36).slice(2) + Date.now().toString(36); store('b3sid', s); return s })()
  const messages = []

  fetch(base + '/api/public/config').then((r) => r.json()).then(init).catch(() => {})

  function init(cfg) {
    if (!cfg.enabled && cfg.offlineMode === 'hide') return
    // brand fonts (same as b3sciences.com); fonts must be loaded in the host page, not inside the shadow root
    if (!document.querySelector('link[data-b3font]')) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.dataset.b3font = '1'
      l.href = 'https://fonts.googleapis.com/css2?family=Barlow:wght@600;700&family=Roboto:wght@400;500&display=swap'
      document.head.appendChild(l)
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `
<style>
:host{all:initial}
*{box-sizing:border-box;font-family:Roboto,system-ui,-apple-system,Segoe UI,sans-serif}
.fab{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;background:${cfg.color};color:#0f0f0f;font-size:26px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:2147483646}
.box{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:2147483646}
.box.open{display:flex}
header{background:#0f0f0f;color:#fff;padding:12px 14px;font:700 17px/1.2 Barlow,Roboto,sans-serif;letter-spacing:.02em;text-transform:uppercase;border-bottom:3px solid ${cfg.color};display:flex;justify-content:space-between;align-items:center}
header button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer}
.log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f6f7f9}
.m{max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}
.m.bot{background:#fff;color:#0f0f0f;align-self:flex-start;border:1px solid #e5e7eb}
.m.me{background:${cfg.color};color:#0f0f0f;align-self:flex-end}
form{display:flex;gap:6px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}
input{flex:1;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px}
form button{background:${cfg.color};color:#0f0f0f;border:0;border-radius:8px;padding:0 14px;cursor:pointer;font:500 14px Roboto,sans-serif}
input:focus{outline:2px solid ${cfg.color};border-color:transparent}
form button:disabled{opacity:.5}
</style>
<button class="fab" aria-label="Open chat">💬</button>
<div class="box" role="dialog" aria-label="${cfg.botName}">
  <header><span></span><button aria-label="Close">×</button></header>
  <div class="log"></div>
  <form><input placeholder="Type your message..." maxlength="1000" autocomplete="off"><button>Send</button></form>
</div>`
    const $ = (s) => root.querySelector(s)
    $('header span').textContent = cfg.botName
    const box = $('.box'), log = $('.log'), input = $('input'), btn = $('form button')
    // safe minimal markdown: **bold** only, everything else stays plain text (no innerHTML)
    const fill = (el, text) => {
      el.textContent = ''
      text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
        if (i % 2) el.appendChild(document.createElement('b')).textContent = part
        else el.appendChild(document.createTextNode(part.replace(/^#+\s*/gm, '').replace(/^(\s*)[*-]\s+/gm, '$1• ')))
      })
    }
    const add = (text, cls) => {
      const d = document.createElement('div')
      d.className = 'm ' + cls
      fill(d, text)
      log.appendChild(d)
      log.scrollTop = log.scrollHeight
      return d
    }
    add(cfg.enabled ? cfg.greeting : cfg.offlineMessage, 'bot')
    $('.fab').onclick = () => { box.classList.toggle('open'); input.focus() }
    $('header button').onclick = () => box.classList.remove('open')

    if (!cfg.enabled) { input.disabled = btn.disabled = true; return }

    $('form').onsubmit = async (e) => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) return
      input.value = ''
      add(text, 'me')
      messages.push({ role: 'user', content: text })
      btn.disabled = true
      const wait = add('…', 'bot')
      try {
        const r = await fetch(base + '/api/public/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, sessionId: sid }),
        })
        const data = await r.json()
        const out = data.reply || data.error || 'Something went wrong.'
        fill(wait, out)
        if (data.reply && r.ok) messages.push({ role: 'assistant', content: out })
      } catch {
        wait.textContent = 'Connection problem. Please try again.'
      }
      btn.disabled = false
      log.scrollTop = log.scrollHeight
    }
  }
})()
