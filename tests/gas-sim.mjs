// تشغيل Code.gs محليًا على بدائل مبسّطة لخدمات Google (لاختبار المنطق فقط).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const results = []; const ok = (n, p, i = '') => { results.push(p); console.log(`${p ? '✓' : '✗'} ${n}${i ? '  — ' + i : ''}`); };

const props = {}; const sheets = {}; const files = []; let folders = 0;
function mkSheet(name) {
  const rows = [];
  const sh = {
    name, rows,
    appendRow: (r) => rows.push(r), getLastRow: () => rows.length,
    setRightToLeft() {}, setFrozenRows() {}, clear() { rows.length = 0; }, setColumnWidth() {}, setColumnWidths() {},
    getRange: () => ({ setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setHorizontalAlignment() { return this; }, setFontSize() { return this; }, setValues(v) { sh.values = v; return this; }, setValue() { return this; }, setFormula(f) { sh.formula = f; return this; } })
  };
  return sh;
}
const ss = {
  getId: () => 'SHEET1', getUrl: () => 'https://docs/x',
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = mkSheet(n)),
  getSheets: () => Object.values(sheets), deleteSheet: (s) => delete sheets[s.name]
};
const byId = {};
const folder = (name) => { const id = 'F' + (++folders); const f = { getId: () => id, getUrl: () => 'https://drive/f', createFolder: (n) => folder(n),
  createFile: (blob) => { files.push({ folder: name, ...blob }); return { getUrl: () => 'https://drive/file/' + files.length }; } }; byId[id] = f; return f; };
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => null, create: () => ss },
  DriveApp: { createFolder: (n) => folder(n), getFolderById: (id) => byId[id] },
  Utilities: { base64Decode: (s) => [...Buffer.from(s, 'base64')], newBlob: (bytes, type, name) => ({ bytes: bytes.length, type, name }), formatDate: () => '2026-11-01 10-00-00' },
  Session: { getScriptTimeZone: () => 'Asia/Riyadh' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType() { return JSON.parse(t); } }) },
  Logger: { log() {} }
};
vm.createContext(ctx); vm.runInContext(src, ctx);
ctx.setup();
ok('setup: الأوراق الأربع', ['الزيارات', 'الحضور', 'المباركات', 'الملخص'].every((n) => sheets[n]), Object.keys(sheets).join(', '));
const post = (o) => ctx.doPost({ postData: { contents: JSON.stringify(o) } });
const base = { version: 'front', device: 'abcdefgh12', test: false };

ok('زيارة', post({ ...base, type: 'event', kind: 'visit' }).ok && sheets['الزيارات'].rows.at(-1)[2] === 'زيارة');
ok('نوع حدث غير معروف يُرفض', post({ ...base, type: 'event', kind: 'hack' }).ok === false);
ok('نسخة غير معروفة تُرفض', post({ ...base, version: 'x', type: 'event', kind: 'visit' }).ok === false);
ok('حضور: «سيحضر» مع النسخة الخلفية', post({ ...base, version: 'back', type: 'rsvp', name: ' منى   علي ', attending: true }).ok && JSON.stringify(sheets['الحضور'].rows.at(-1).slice(1, 4)) === '["الخلفية","منى علي","سيحضر"]', JSON.stringify(sheets['الحضور'].rows.at(-1).slice(1, 4)));
ok('حضور: اسم قصير يُرفض', post({ ...base, type: 'rsvp', name: 'a', attending: true }).ok === false);
const inj = post({ ...base, type: 'rsvp', name: '=IMPORTXML("http://x")', attending: false });
ok('منع تنفيذ معادلة مكتوبة في الاسم', inj.ok && sheets['الحضور'].rows.at(-1)[2].startsWith("'="), sheets['الحضور'].rows.at(-1)[2]);
ok('تجربة تُعلَّم «نعم»', post({ ...base, test: true, type: 'event', kind: 'open' }).ok && sheets['الزيارات'].rows.at(-1)[4] === 'نعم');
ok('مباركة فارغة تُرفض', post({ ...base, type: 'wish', name: 'خالد', message: '  ' }).ok === false);
ok('مباركة نصية متعددة الأسطر', post({ ...base, type: 'wish', name: 'خالد', message: 'مبروك\nبارك الله' }).ok && sheets['المباركات'].rows.at(-1)[3] === 'مبروك\nبارك الله');
const audio = Buffer.alloc(30000, 1).toString('base64');
const r1 = post({ ...base, type: 'wish', name: 'ليلى', message: '', audio: { b64: audio, type: 'audio/mp4', secs: 42 } });
const wrow = sheets['المباركات'].rows.at(-1);
ok('مباركة صوتية: ملف في مجلد التسجيلات + رابط + مدة + حجم', r1.ok && files.at(-1).folder === 'تسجيلات صوتية' && /\.m4a$/.test(files.at(-1).name) && wrow[4].startsWith('=HYPERLINK(') && wrow[5] === 42 && wrow[8] > 0, files.at(-1).name);
const vid = Buffer.alloc(50000, 2).toString('base64');
const r2 = post({ ...base, type: 'wish', name: 'يوسف', video: { b64: vid, type: 'video/mp4', secs: 20 } });
ok('مباركة فيديو: ملف في مجلد الفيديوهات', r2.ok && files.at(-1).folder === 'فيديوهات' && /\.mp4$/.test(files.at(-1).name));
ok('نوع ملف خاطئ يُرفض (صوت بنوع فيديو)', post({ ...base, type: 'wish', name: 'سارة', audio: { b64: audio, type: 'video/mp4', secs: 3 } }).ok === false);
const big = Buffer.alloc(14 * 1024 * 1024, 3).toString('base64');
ok('فيديو أكبر من 13 ميجا يُرفض', post({ ...base, type: 'wish', name: 'سارة', video: { b64: big, type: 'video/mp4', secs: 60 } }).ok === false);
ok('نص غير JSON يُرفض بأمان', ctx.doPost({ postData: { contents: 'not json' } }).ok === false);
const sumF = sheets['الملخص'].values;
ok('الملخص: صفوف لكل البنود بثلاثة أعمدة', sumF.length === 11 && sumF.every((r) => r.length === 4) && /COUNTIFS\('الزيارات'!C2:C,"زيارة"/.test(sumF[1][1]), sumF[1][1]);
console.log(`\n${results.filter(Boolean).length}/${results.length} نجح`);
process.exit(results.every(Boolean) ? 0 : 1);
