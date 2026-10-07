// Vercel serverless function: GET / POST / PATCH / DELETE  /api/messages
// Storage: Upstash Redis (Vercel Storage / Marketplace). Each message is one field in a Redis hash,
// so simultaneous writes can't overwrite each other and a failed read can never wipe the data.
// Required env vars (added automatically when you connect the store to the project):
//   KV_REST_API_URL + KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
const KEY = 'bday:messages';
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  if (!URL_ || !TOKEN) throw new Error('KV env vars missing - connect an Upstash Redis store to this project and redeploy');
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'redis error ' + r.status);
  return j.result;
}

async function getAll() {
  const res = (await redis(['HGETALL', KEY])) || [];
  const values = Array.isArray(res)
    ? res.filter((_, i) => i % 2 === 1)   // flat [field, value, field, value, ...]
    : Object.values(res);                 // object form, just in case
  return values.map((v) => JSON.parse(v)).sort((a, b) => a.t - b.t);
}
async function getOne(id) {
  const v = await redis(['HGET', KEY, id]);
  return v ? JSON.parse(v) : null;
}
const put = (m) => redis(['HSET', KEY, m.id, JSON.stringify(m)]);
const clean = (s, n) => String(s || '').slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }

    if (req.method === 'GET') return res.status(200).json(await getAll());

    if (req.method === 'POST') {
      if (!b.id || !b.text) return res.status(400).json({ error: 'id and text required' });
      const id = clean(b.id, 40);
      if (await getOne(id)) return res.status(409).json({ error: 'exists' });
      const m = { id, nick: clean(b.nick, 30) || 'Anonymous', text: clean(b.text, 800), t: Date.now(), read: false };
      await put(m);
      return res.status(201).json(m);
    }

    if (req.method === 'PATCH') {
      const m = await getOne(clean(b.id, 40));
      if (!m) return res.status(404).json({ error: 'not found' });
      if ('nick' in b) m.nick = clean(b.nick, 30);
      if ('text' in b) m.text = clean(b.text, 800);
      if ('read' in b) m.read = !!b.read;
      await put(m);
      return res.status(200).json(m);
    }

    if (req.method === 'DELETE') {
      await redis(['HDEL', KEY, clean(b.id, 40)]);
      return res.status(204).end();
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    res.status(405).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
};
