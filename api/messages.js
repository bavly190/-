// Vercel serverless function: GET / POST / PATCH / DELETE  /api/messages
// Storage: Upstash/Vercel KV via REST when KV_REST_API_URL + KV_REST_API_TOKEN are set
// (Vercel dashboard -> Storage -> add KV/Upstash Redis). Without them it falls back to
// data/messages.json (read-only seed) + in-memory, which is for local testing only.
const fs = require('fs'), path = require('path');
const KEY = 'bday:messages';
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
let mem = null;

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(cmd) });
  return (await r.json()).result;
}
async function load() {
  if (URL_) { const v = await redis(['GET', KEY]); return v ? JSON.parse(v) : []; }
  if (!mem) mem = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'messages.json'), 'utf8'));
  return mem;
}
async function save(list) { if (URL_) await redis(['SET', KEY, JSON.stringify(list)]); else mem = list; }
const clean = (s, n) => String(s || '').slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const list = await load();
  const b = req.body || {};
  if (req.method === 'GET') return res.status(200).json(list);
  if (req.method === 'POST') {
    if (!b.id || !b.text) return res.status(400).json({ error: 'id and text required' });
    if (list.some(m => m.id === b.id)) return res.status(409).json({ error: 'exists' });
    const m = { id: clean(b.id, 40), nick: clean(b.nick, 30) || 'Anonymous', text: clean(b.text, 800), t: Date.now(), read: false };
    await save([...list, m]);
    return res.status(201).json(m);
  }
  if (req.method === 'PATCH') {
    const i = list.findIndex(m => m.id === b.id);
    if (i < 0) return res.status(404).json({ error: 'not found' });
    if ('nick' in b) list[i].nick = clean(b.nick, 30);
    if ('text' in b) list[i].text = clean(b.text, 800);
    if ('read' in b) list[i].read = !!b.read;
    await save(list);
    return res.status(200).json(list[i]);
  }
  if (req.method === 'DELETE') { await save(list.filter(m => m.id !== b.id)); return res.status(204).end(); }
  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  res.status(405).end();
};
