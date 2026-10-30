// اختبار الميزات المتصلة بقاعدة البيانات على خادم محاكاة محلي.
//   node tests/mock-supabase.mjs 8766 &   ثم   SUPABASE_URL=http://localhost:8766 SUPABASE_KEY=test-key node build.mjs
//   node tests/features.mjs http://localhost:8765/ http://localhost:8766
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8765/';
const MOCK = process.argv[3] || 'http://localhost:8766';
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass }); console.log(`${pass ? '✓' : '✗'} ${name}${info ? '  — ' + info : ''}`); };
const dump = async () => (await fetch(MOCK + '/__dump')).json();
await fetch(MOCK + '/__reset');

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function open(ver, query = '?test=1', opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'], ...opts });
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(e.message));
  await page.goto(BASE + ver + '/' + query, { waitUntil: 'networkidle' });
  return { ctx, page };
}
async function openEnvelope(page) {
  await page.click('#openBtn');
  await page.waitForFunction(() => document.documentElement.classList.contains('gate-done'), null, { timeout: 9000 });
}

// 1) العداد: زيارة + فتح ظرف لكل نسخة، مع تمييز التجربة
{
  const a = await open('front'); await openEnvelope(a.page);
  await a.page.click('#replayBtn'); await openEnvelope(a.page);         // إعادة الفتح لا تُحسب مرة ثانية
  const b = await open('back', ''); await openEnvelope(b.page);
  await a.page.waitForTimeout(400);
  const d = await dump();
  const ev = d.invite_events;
  const fv = ev.filter((e) => e.version === 'front' && e.kind === 'visit').length;
  const fo = ev.filter((e) => e.version === 'front' && e.kind === 'open').length;
  const bv = ev.filter((e) => e.version === 'back' && e.kind === 'visit').length;
  const bo = ev.filter((e) => e.version === 'back' && e.kind === 'open').length;
  ok('العداد: زيارة وفتح لكل نسخة على حدة', fv === 1 && fo === 1 && bv === 1 && bo === 1, `front ${fv}/${fo} · back ${bv}/${bo}`);
  ok('العداد: روابط ?test=1 تُعلَّم كتجربة، والعادية حقيقية', ev.filter((e) => e.version === 'front').every((e) => e.is_test === true) && ev.filter((e) => e.version === 'back').every((e) => e.is_test === false));
  ok('العداد: معرّف جهاز مجهول بالصيغة المسموحة', ev.every((e) => /^[a-z0-9]{8,40}$/.test(e.device)));
  ok('العداد: المفتاح العام فقط في الطلبات', ev.every((e) => e.apikey === 'test-key'));
  ok('لا أخطاء JavaScript', !a.page._errors.length && !b.page._errors.length, [...a.page._errors, ...b.page._errors].join(' | '));
  await a.ctx.close(); await b.ctx.close();
}

// 2) تأكيد الحضور
{
  await fetch(MOCK + '/__reset');
  const { ctx, page } = await open('back');
  await openEnvelope(page);
  await page.locator('#rsvp').scrollIntoViewIfNeeded();
  await page.click('[data-attending="yes"]');
  const msgEmpty = await page.textContent('#rsvpMsg');
  ok('الحضور: الاسم مطلوب', msgEmpty.includes('الاسم') && (await dump()).invite_rsvps.length === 0, msgEmpty);
  await page.fill('#rsvpName', '  أحمد   محمود ');
  await page.click('[data-attending="yes"]');
  await page.waitForSelector('#rsvpDone:not([hidden])');
  const text = await page.textContent('#rsvpDoneText');
  let d = await dump();
  ok('الحضور: «سأحضر» يُحفظ بالاسم والنسخة', d.invite_rsvps.length === 1 && d.invite_rsvps[0].name === 'أحمد محمود' && d.invite_rsvps[0].attending === true && d.invite_rsvps[0].version === 'back', text);
  await page.reload({ waitUntil: 'networkidle' });
  await openEnvelope(page);
  const already = await page.evaluate(() => ({ form: document.getElementById('rsvpForm').hidden, t: document.getElementById('rsvpDoneText').textContent }));
  ok('الحضور: الجهاز يتذكّر الرد بعد إعادة الفتح', already.form && already.t.includes('سبق'), already.t);
  await page.click('#rsvpAnother');
  await page.fill('#rsvpName', 'منى');
  await page.click('[data-attending="no"]');
  await page.waitForSelector('#rsvpDone:not([hidden])');
  d = await dump();
  ok('الحضور: «تأكيد حضور شخص آخر» + «أعتذر»', d.invite_rsvps.length === 2 && d.invite_rsvps[1].attending === false, await page.textContent('#rsvpDoneText'));
  // فشل الشبكة
  await page.click('#rsvpAnother');
  await fetch(MOCK + '/__fail?on=1');
  await page.fill('#rsvpName', 'سارة');
  await page.click('[data-attending="yes"]');
  await page.waitForFunction(() => document.getElementById('rsvpMsg').textContent.length > 0);
  const err = await page.textContent('#rsvpMsg');
  ok('الحضور: رسالة واضحة عند فشل الإرسال، والنموذج يبقى', err.includes('تعذّر') && !(await page.isHidden('#rsvpForm')), err);
  await fetch(MOCK + '/__fail?on=0');
  ok('لا أخطاء JavaScript', !page._errors.length, page._errors.join(' | '));
  await ctx.close();
}

// 3) المباركات: نص فقط، ثم صوت
{
  await fetch(MOCK + '/__reset');
  const { ctx, page } = await open('front');
  await openEnvelope(page);
  await page.locator('#wish').scrollIntoViewIfNeeded();
  await page.fill('#wishName', 'خالد');
  await page.click('#wishSend');
  const req = await page.textContent('#wishMsg');
  ok('المباركة: لا تُرسل فارغة', req.length > 0 && (await dump()).invite_wishes.length === 0, req);
  await page.fill('#wishMessage', 'ألف مبروك، بارك الله لكما');
  await page.click('#wishSend');
  await page.waitForSelector('#wishDone:not([hidden])');
  let d = await dump();
  ok('المباركة المكتوبة تُحفظ', d.invite_wishes.length === 1 && d.invite_wishes[0].message.includes('مبروك') && d.invite_wishes[0].audio_path === null);

  await page.click('#wishAnother');
  await page.fill('#wishName', 'ليلى');
  await page.click('#recStart');
  await page.waitForSelector('#voice[data-state="recording"]', { timeout: 5000 });
  await page.waitForTimeout(2300);
  const timer = await page.textContent('#recTime');
  await page.click('#recStop');
  await page.waitForSelector('#voice[data-state="ready"]', { timeout: 5000 });
  const len = await page.textContent('#recLen');
  ok('التسجيل: مؤقّت بصيغة m:ss / 2:00 ثم معاينة', /^0:0[12] \/ 2:00$/.test(timer) && /^0:0[1-3]$/.test(len), `${timer} → ${len}`);
  await page.click('#wishSend');
  await page.waitForSelector('#wishDone:not([hidden])');
  d = await dump();
  const w = d.invite_wishes[1];
  ok('المباركة الصوتية: رفع الملف ثم حفظ المسار والمدة', w && w.audio_path && d.objects[w.audio_path] > 500 && w.audio_seconds >= 1 && w.message === null, w && `${w.audio_path} · ${d.objects[w.audio_path]} bytes · ${w.audio_seconds}s`);

  // حذف وإعادة التسجيل
  await page.click('#wishAnother');
  await page.click('#recStart');
  await page.waitForSelector('#voice[data-state="recording"]');
  await page.waitForTimeout(1200);
  await page.click('#recStop');
  await page.waitForSelector('#voice[data-state="ready"]');
  await page.click('#recDel');
  ok('التسجيل: زر الحذف يرجع للحالة الأولى', await page.getAttribute('#voice', 'data-state') === 'idle');

  // فيديو
  await page.fill('#wishName', 'يوسف');
  await page.click('#vidStart');
  await page.waitForSelector('#video[data-state="recording"]', { timeout: 6000 });
  const voiceLocked = await page.getAttribute('#voice', 'data-state');
  await page.waitForTimeout(2300);
  const vt = await page.textContent('#vidTime');
  await page.click('#vidStop');
  await page.waitForSelector('#video[data-state="ready"]', { timeout: 6000 });
  ok('الفيديو: مؤقّت m:ss / 1:00 ومنع الصوت أثناء التصوير', /^0:0[12] \/ 1:00$/.test(vt) && voiceLocked === 'busy' && await page.getAttribute('#voice', 'data-state') === 'idle', `${vt} · voice=${voiceLocked}`);
  await page.click('#wishSend');
  await page.waitForSelector('#wishDone:not([hidden])', { timeout: 10000 });
  d = await dump();
  const vw = d.invite_wishes[d.invite_wishes.length - 1];
  ok('مباركة الفيديو: رفع الملف وحفظ المسار والمدة والحجم', vw.video_path && d.objects[vw.video_path] > 1000 && vw.video_seconds >= 1 && vw.video_bytes === d.objects[vw.video_path], `${vw.video_path} · ${(vw.video_bytes / 1024).toFixed(0)} KB / ${vw.video_seconds}s`);
  ok('لا أخطاء JavaScript', !page._errors.length, page._errors.join(' | '));
  await ctx.close();
}

// 4) الحد الأقصى للتسجيل (120 ث) — بتسريع الوقت
{
  await fetch(MOCK + '/__reset');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const realNow = Date.now.bind(Date); const t0 = realNow();
    Date.now = () => t0 + (realNow() - t0) * 60;                 // دقيقة لكل ثانية
  });
  await page.goto(BASE + 'front/?test=1', { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.documentElement.classList.add('show-invite', 'gate-done'); });
  await page.click('#recStart');
  await page.waitForSelector('#voice[data-state="ready"]', { timeout: 8000 });
  const len = await page.textContent('#recLen');
  ok('التسجيل يتوقف تلقائيًا عند 2:00', len === '2:00', len);
  await ctx.close();
}

// 5) بلا ميكروفون
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('denied')); });
  await page.goto(BASE + 'front/?test=1', { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.documentElement.classList.add('show-invite', 'gate-done'); });
  await page.click('#recStart');
  await page.waitForFunction(() => document.getElementById('voiceNote').textContent.length > 0);
  ok('رفض الميكروفون: رسالة بديلة والمباركة المكتوبة متاحة', (await page.textContent('#voiceNote')).includes('الميكروفون'));
  await ctx.close();
}

// 6) صفحة الإدارة: لا تعرض بيانات بدون تسجيل دخول
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
  await page.goto(BASE + 'admin/', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({ dash: document.getElementById('dash').hidden, robots: document.querySelector('meta[name=robots]').content, fatal: document.getElementById('fatal').textContent }));
  ok('الإدارة: لوحة البيانات مخفية بدون دخول + noindex', s.dash === true && /noindex/.test(s.robots), s.fatal);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} نجح`);
process.exit(failed.length ? 1 : 0);
