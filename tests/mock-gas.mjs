// خادم محلي يحاكي Google Apps Script Web App (للاختبار فقط):
// POST /exec (text/plain JSON) ← يعالج ثم يحوّل 302 إلى /result مثل Apps Script.
//   node tests/mock-gas.mjs 8766   ثم   INVITE_ENDPOINT=http://localhost:8766/exec node build.mjs
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 8766);
const db = { events: [], rsvps: [], wishes: [], files: {} };
const results = new Map(); let seq = 0, fail = false;
const VER = { front: 'الأمامية', back: 'الخلفية' };
const MIME = { 'audio/mp4': 1, 'audio/webm': 1, 'audio/ogg': 1, 'video/mp4': 1, 'video/webm': 1 };

function handle(d) {
  if (!VER[d.version]) return { ok: false, error: 'version' };
  const test = d.test === true;
  if (d.type === 'event') {
    if (!['visit', 'open'].includes(d.kind)) return { ok: false, error: 'kind' };
    db.events.push({ version: d.version, kind: d.kind, device: d.device, test }); return { ok: true };
  }
  const name = String(d.name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'name' };
  if (d.type === 'rsvp') { db.rsvps.push({ version: d.version, name, attending: d.attending === true, device: d.device, test }); return { ok: true }; }
  if (d.type === 'wish') {
    const msg = String(d.message || '').trim();
    if (!msg && !(d.audio && d.audio.b64) && !(d.video && d.video.b64)) return { ok: false, error: 'empty' };
    const save = (m, kind) => {
      if (!m || !m.b64) return null;
      if (!MIME[m.type] || (kind === 'video') !== m.type.startsWith('video/')) throw new Error('bad_type');
      const bytes = Buffer.from(m.b64, 'base64');
      if (!bytes.length || bytes.length > (kind === 'video' ? 13 : 6) * 1048576) throw new Error('bad_size');
      const id = `${kind}-${++seq}`; db.files[id] = bytes.length; return { id, secs: m.secs, bytes: bytes.length };
    };
    const a = save(d.audio, 'audio'), v = save(d.video, 'video');
    db.wishes.push({ version: d.version, name, message: msg, audio: a, video: v, device: d.device, test });
    return { ok: true };
  }
  return { ok: false, error: 'type' };
}

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const json = (code, o) => { res.writeHead(code, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/__dump') return json(200, db);
    if (url.pathname === '/__reset') { db.events = []; db.rsvps = []; db.wishes = []; db.files = {}; fail = false; return json(200, { ok: 1 }); }
    if (url.pathname === '/__fail') { fail = url.searchParams.get('on') === '1'; return json(200, { fail }); }
    if (url.pathname === '/result') { const r = results.get(url.searchParams.get('id')) || { ok: false, error: 'gone' }; return json(200, r); }
    if (url.pathname !== '/exec' || req.method !== 'POST') return json(404, { ok: false });
    // مثل Apps Script: ردّ 302 (يحمل Access-Control-Allow-Origin) ثم النتيجة على رابط آخر
    let out;
    if (!/^text\/plain/.test(req.headers['content-type'] || '')) out = { ok: false, error: 'content-type' };
    else if (fail) out = { ok: false, error: 'forced' };
    else { try { out = handle(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { out = { ok: false, error: String(e.message) }; } }
    const id = String(++seq); results.set(id, out);
    res.writeHead(302, { Location: `/result?id=${id}`, 'Access-Control-Allow-Origin': '*' }); res.end();
  });
}).listen(port, () => console.log('mock apps script on', port));
