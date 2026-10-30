// خادم محلي يحاكي واجهات Supabase التي تستخدمها صفحة الضيف (للاختبار فقط).
// node tests/mock-supabase.mjs 8766   ← ثم ابنِ بـ SUPABASE_URL=http://localhost:8766 SUPABASE_KEY=test
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 8766);
const db = { invite_events: [], invite_rsvps: [], invite_wishes: [], objects: {} };
let fail = false;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'apikey,authorization,content-type,prefer,x-upsert,cache-control',
};
const VER = /^(front|back)$/;

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const send = (code, body) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(body ? JSON.stringify(body) : ''); };
    if (req.method === 'OPTIONS') return send(204);
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__dump') return send(200, { ...db, objects: Object.fromEntries(Object.entries(db.objects).map(([k, v]) => [k, v.length])) });
    if (url.pathname === '/__reset') { db.invite_events = []; db.invite_rsvps = []; db.invite_wishes = []; db.objects = {}; fail = false; return send(200, { ok: 1 }); }
    if (url.pathname === '/__fail') { fail = url.searchParams.get('on') === '1'; return send(200, { fail }); }
    if (req.method !== 'POST') return send(404);
    if (!req.headers.apikey) return send(401, { message: 'no apikey' });
    if (fail) return send(500, { message: 'forced failure' });
    const body = Buffer.concat(chunks);
    const m = url.pathname.match(/^\/rest\/v1\/(invite_events|invite_rsvps|invite_wishes)$/);
    if (m) {
      let row; try { row = JSON.parse(body.toString('utf8')); } catch { return send(400, { message: 'bad json' }); }
      if (!VER.test(row.version)) return send(400, { message: 'version' });
      if (m[1] === 'invite_events' && !/^(visit|open)$/.test(row.kind)) return send(400, { message: 'kind' });
      if (m[1] !== 'invite_events') {
        const n = String(row.name || '').trim();
        if (n.length < 2 || n.length > 80) return send(400, { message: 'name' });
      }
      if (m[1] === 'invite_wishes') {
        if (!((row.message && row.message.trim()) || row.audio_path || row.video_path)) return send(400, { message: 'content' });
        if (row.video_path && !db.objects[row.video_path]) return send(400, { message: 'video missing' });
        if (row.video_path && !/^(front|back)\/[a-z0-9-]{8,60}\.(mp4|webm)$/.test(row.video_path)) return send(400, { message: 'video_path' });
        if (row.audio_path && !db.objects[row.audio_path]) return send(400, { message: 'audio missing' });
        if (row.audio_path && !/^(front|back)\/[a-z0-9-]{8,60}\.(m4a|webm|ogg)$/.test(row.audio_path)) return send(400, { message: 'audio_path' });
      }
      db[m[1]].push({ ...row, created_at: new Date().toISOString(), apikey: req.headers.apikey });
      return send(201);
    }
    const s = url.pathname.match(/^\/storage\/v1\/object\/(invite-voices|invite-videos)\/(.+)$/);
    if (s) {
      const type = req.headers['content-type'] || '';
      const okType = s[1] === 'invite-voices' ? /^audio\/(mp4|webm|ogg)$/ : /^video\/(mp4|webm)$/;
      if (!okType.test(type)) return send(400, { message: 'mime ' + type });
      if (s[1] === 'invite-videos' && body.length > 20971520) return send(413, { message: 'too big' });
      s[1] = s[2];
      if (!/^(front|back)\//.test(s[1])) return send(403, { message: 'folder' });
      db.objects[s[1]] = body;
      return send(200, { Key: 'invite-voices/' + s[1] });
    }
    send(404);
  });
}).listen(port, () => console.log('mock supabase on', port));
