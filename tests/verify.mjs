// فحص آلي للدعوة على Chromium (Playwright). الاستخدام:
//   node tests/verify.mjs http://localhost:8765/
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8765/';
const MAP = 'https://maps.app.goo.gl/fnK5L8Yv1MMb4ncd7?g_st=ic';
const TARGET = Date.parse('2026-11-11T11:00:00Z');
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? '✓' : '✗'} ${name}${info ? '  — ' + info : ''}`); };

const browser = await chromium.launch();
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...opts });
  const page = await ctx.newPage();
  page._errors = [];
  page._requests = [];
  page.on('pageerror', e => page._errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page._errors.push(m.text()); });
  page.on('request', r => page._requests.push(r.url()));
  return { ctx, page };
}

for (const ver of ['front', 'back']) {
  const other = ver === 'front' ? 'back' : 'front';

  // 1) الصورة الصحيحة فقط + لا أخطاء
  {
    const { ctx, page } = await newPage();
    await page.goto(BASE + ver + '/', { waitUntil: 'networkidle' });
    const own = page._requests.some(u => u.includes(`/img/${ver}.`));
    const foreign = page._requests.some(u => u.includes(`/img/${other}.`));
    ok(`[${ver}] تحميل صورة النسخة فقط`, own && !foreign, `own=${own} other=${foreign}`);
    const failed = [];
    for (const u of [...new Set(page._requests)]) {
      if (!u.startsWith(BASE)) continue;
      const r = await page.request.get(u); if (!r.ok()) failed.push(u);
    }
    ok(`[${ver}] كل الملفات تُحمَّل (200)`, failed.length === 0, failed.join(', '));
    const fontsOk = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight); });
    ok(`[${ver}] الخطوط المحلية محمَّلة`, fontsOk.some(f => f.includes('Amiri')) && fontsOk.some(f => f.includes('Noto Naskh')), [...new Set(fontsOk)].join(' | '));

    // OG
    const og = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"],meta[name="robots"]')].map(m => [m.getAttribute('property') || m.name, m.content])));
    ok(`[${ver}] Open Graph + noindex`, og['og:title'] === 'دعوة فرح · 11 / 11 — عمر وحبيبة' && og['og:description'] === 'حضوركم يسعدنا، ودعواتكم تتمّم فرحتنا' && og['og:image'].includes(`og-${ver}.jpg`) && /noindex/.test(og.robots), og['og:image']);

    // المحتوى المخفي غير قابل للوصول قبل الفتح
    const hiddenFocusable = await page.evaluate(() => {
      const inv = document.getElementById('invite');
      return getComputedStyle(inv).display === 'none';
    });
    ok(`[${ver}] محتوى الدعوة غير قابل للوصول قبل الفتح`, hiddenFocusable);
    // لا تبدأ الحركة تلقائيًا
    await page.waitForTimeout(1500);
    const stillClosed = await page.evaluate(() => !document.documentElement.classList.contains('show-invite') && getComputedStyle(document.getElementById('seal')).opacity === '1');
    ok(`[${ver}] لا تبدأ الحركة دون ضغط`, stillClosed);
    ok(`[${ver}] لا أخطاء JavaScript`, page._errors.length === 0, page._errors.join(' | '));
    await ctx.close();
  }

  // 2) الفتح بلوحة المفاتيح + المدة + منع التكرار + التركيز
  {
    const { ctx, page } = await newPage({ isMobile: false, hasTouch: false });
    await page.goto(BASE + ver + '/', { waitUntil: 'networkidle' });
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement.id);
    ok(`[${ver}] أول عنصر بالتبويب هو الظرف`, focused === 'openBtn', focused);
    const t0 = await page.evaluate(() => { window.__done = 0; new MutationObserver(() => { if (document.documentElement.classList.contains('gate-done') && !window.__done) window.__done = performance.now(); }).observe(document.documentElement, { attributes: true }); return performance.now(); });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const hintText = await page.evaluate(() => document.getElementById('gateHint').textContent);
    await page.waitForTimeout(400);
    // ضغطات متكررة أثناء الفتح
    const animDelta = await page.evaluate(() => {
      const before = document.getAnimations().length;
      for (let i = 0; i < 5; i++) document.getElementById('openBtn').click();
      return document.getAnimations().length - before;
    });
    await page.waitForFunction(() => window.__done > 0, null, { timeout: 9000 });
    const dur = await page.evaluate(t0 => window.__done - t0, t0);
    ok(`[${ver}] النص الإرشادي يتغير أثناء الفتح`, (await page.evaluate(() => document.getElementById('gateHint').textContent)) === 'أهلًا بكم في فرحتنا', hintText);
    ok(`[${ver}] مدة الفتح ≈ 5.6 ث`, dur > 5400 && dur < 6100, `${Math.round(dur)}ms`);
    ok(`[${ver}] الضغط المتكرر لا يعيد الحركة`, animDelta === 0, `حركات جديدة=${animDelta}`);
    const after = await page.evaluate(() => ({ y: scrollY, active: document.activeElement.id, overflow: getComputedStyle(document.body).overflow, gate: getComputedStyle(document.getElementById('gate')).display }));
    ok(`[${ver}] بعد الفتح: التمرير متاح، التركيز على الدعوة، الموضع أعلى الصفحة`, after.y === 0 && after.active === 'invite' && after.overflow !== 'hidden' && after.gate === 'none', JSON.stringify(after));

    // ثبات النصوص: لا transform على النصوص وحاوياتها، والمواضع ثابتة أثناء الظهور
    const textTransforms = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('#invite *').forEach(el => {
        if (el.closest('svg') || el.matches('.mono, .divider .line, .pin, .sprig, .sprig *')) return;
        const t = getComputedStyle(el).transform;
        if (t && t !== 'none') bad.push(el.className || el.tagName);
      });
      return bad;
    });
    ok(`[${ver}] لا translate/scale على النصوص أو حاوياتها`, textTransforms.length === 0, textTransforms.join(','));
    const pos = async () => page.evaluate(() => [...document.querySelectorAll('.names,.welcome,.dm,.count-title,.venue,.closing')].map(e => Math.round(e.getBoundingClientRect().top + scrollY)));
    await page.evaluate(() => window.scrollTo(0, 900));
    const p1 = await pos(); await page.waitForTimeout(500); const p2 = await pos(); await page.waitForTimeout(800); const p3 = await pos();
    ok(`[${ver}] مواضع النصوص ثابتة أثناء الظهور والتمرير`, JSON.stringify(p1) === JSON.stringify(p2) && JSON.stringify(p2) === JSON.stringify(p3), p1.join(','));

    // زر الموقع
    const medal = await page.evaluate(() => { const a = document.querySelector('.medal'); return { href: a.getAttribute('href'), target: a.target, rel: a.rel }; });
    ok(`[${ver}] زر الموقع يفتح الرابط المعتمد في نافذة جديدة`, medal.href === MAP && medal.target === '_blank' && medal.rel.includes('noopener'), medal.href);

    // إعادة الفتح مرتين
    let replayOk = true;
    for (let i = 0; i < 2; i++) {
      await page.click('#replayBtn');
      const s = await page.evaluate(() => ({ y: scrollY, gate: getComputedStyle(document.getElementById('gate')).display, inv: getComputedStyle(document.getElementById('invite')).display, active: document.activeElement.id, hint: document.getElementById('gateHint').textContent, seal: getComputedStyle(document.getElementById('seal')).opacity }));
      replayOk = replayOk && s.y === 0 && s.gate !== 'none' && s.inv === 'none' && s.active === 'openBtn' && s.hint === 'اضغط على الختم لفتح الدعوة' && s.seal === '1';
      await page.evaluate(() => { window.__done = 0; });
      await page.click('#openBtn');
      await page.waitForFunction(() => document.documentElement.classList.contains('gate-done'), null, { timeout: 9000 });
    }
    ok(`[${ver}] «إعادة فتح الدعوة» تعمل أكثر من مرة`, replayOk);
    ok(`[${ver}] لا أخطاء JavaScript أثناء التفاعل`, page._errors.length === 0, page._errors.join(' | '));
    await ctx.close();
  }
}

// 3) تقليل الحركة
{
  const { ctx, page } = await newPage({ reducedMotion: 'reduce' });
  await page.goto(BASE + 'front/', { waitUntil: 'networkidle' });
  const t0 = Date.now();
  await page.click('#openBtn');
  await page.waitForFunction(() => document.documentElement.classList.contains('gate-done'), null, { timeout: 3000 });
  ok('تقليل الحركة: فتح مباشر', Date.now() - t0 < 1200, `${Date.now() - t0}ms`);
  await ctx.close();
}

// 4) العد التنازلي: لحظة واحدة لكل المناطق الزمنية + عند الموعد وبعده
for (const [label, tz, now] of [
  ['قبل الموعد (القاهرة)', 'Africa/Cairo', '2026-11-10T10:59:50Z'],
  ['قبل الموعد (الرياض)', 'Asia/Riyadh', '2026-11-10T10:59:50Z'],
  ['قبل الموعد (نيويورك)', 'America/New_York', '2026-11-10T10:59:50Z'],
  ['قبل الموعد بثوانٍ', 'Asia/Riyadh', '2026-11-11T10:59:57Z'],
  ['بعد الموعد', 'Asia/Riyadh', '2026-11-12T08:00:00Z'],
]) {
  const { ctx, page } = await newPage({ timezoneId: tz });
  await page.clock.install({ time: new Date(now) });
  await page.goto(BASE + 'front/', { waitUntil: 'load' });
  await page.clock.runFor(1500);
  const read = () => page.evaluate(() => ({ v: ['d', 'h', 'm', 's'].map(u => document.querySelector(`.num[data-u="${u}"]`).textContent), title: document.getElementById('countTitle').textContent }));
  let r = await read();
  if (label === 'قبل الموعد بثوانٍ') {
    const before = r;
    await page.clock.runFor(5000);
    r = await read();
    ok(`العد: ${label} → الصفر وتغيير العنوان`, before.v.join(':') === '00:00:00:01' && r.v.join(':') === '00:00:00:00' && r.title === 'بدأت فرحتنا', `${before.v.join(':')} → ${r.v.join(':')} | ${r.title}`);
  } else if (label === 'بعد الموعد') {
    ok(`العد: ${label} → أصفار بلا قيم سالبة`, r.v.join(':') === '00:00:00:00' && r.title === 'بدأت فرحتنا', `${r.v.join(':')} | ${r.title}`);
  } else {
    ok(`العد: ${label}`, r.v.join(':') === '01:00:00:08' && r.title === 'ونعدّ الأيام للقائكم', r.v.join(':'));
  }
  await ctx.close();
}

// 5) المقاسات: شاشة الظرف بلا تمرير، ولا تمرير أفقي
for (const [w, h] of [[320, 460], [320, 568], [375, 553], [375, 667], [390, 664], [390, 844], [430, 739], [430, 932], [1280, 620], [1440, 900]]) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900 });
  await page.goto(BASE + 'back/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const g = await page.evaluate(() => {
    const hint = document.getElementById('gateHint').getBoundingClientRect();
    const head = document.getElementById('gateHead').getBoundingClientRect();
    return { hintBottom: Math.round(hint.bottom), headTop: Math.round(head.top), vh: innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  ok(`${w}×${h}: شاشة الظرف كاملة دون تمرير`, g.headTop >= 0 && g.hintBottom <= g.vh && g.sw <= g.cw, JSON.stringify(g));
  await page.click('#openBtn');
  await page.waitForFunction(() => document.documentElement.classList.contains('gate-done'), null, { timeout: 9000 });
  const o = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#invite p, #invite h1, #invite h2, #invite a, #invite button, #invite .unit, #invite summary').forEach(el => {
      const r = el.getBoundingClientRect(); if (r.left < -1 || r.right > innerWidth + 1) out.push(el.className || el.tagName);
    });
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, out };
  });
  ok(`${w}×${h}: الدعوة بلا تمرير أفقي أو خروج عناصر`, o.sw <= o.cw && o.out.length === 0, JSON.stringify(o));
  await ctx.close();
}

// 6) بدون JavaScript: محتوى أساسي مقروء
{
  const { ctx, page } = await newPage({ javaScriptEnabled: false });
  await page.goto(BASE + 'front/', { waitUntil: 'load' });
  const s = await page.evaluate(() => ({ gate: getComputedStyle(document.getElementById('gate')).display, inv: getComputedStyle(document.getElementById('invite')).display, names: document.querySelector('.names').textContent.trim() }));
  ok('بدون JavaScript: الدعوة ظاهرة والظرف مخفي', s.gate === 'none' && s.inv !== 'none' && s.names === 'عمر وحبيبة', JSON.stringify(s));
  await ctx.close();
}

// 7) التقويم
{
  const { ctx, page } = await newPage();
  const r = await page.request.get(BASE + 'assets/calendar/wedding.ics');
  const body = await r.text();
  const unfolded = body.replace(/\r\n /g, '');
  ok('ملف ICS: الموعد والمكان والرابط ولا وقت انتهاء', r.ok() && /DTSTART:20261111T110000Z/.test(body) && !/DTEND|DURATION/.test(body) && unfolded.includes('مسجد النور المكي') && unfolded.includes(MAP) && body.includes('\r\n'), r.headers()['content-type']);
  await page.goto(BASE + 'front/');
  const g = await page.evaluate(() => [...document.querySelectorAll('.cal-opt')].map(a => a.href));
  const gu = new URL(g[1]);
  ok('رابط Google Calendar: نفس اللحظة والمكان', gu.searchParams.get('dates') === '20261111T110000Z/20261111T110000Z' && gu.searchParams.get('location').includes('دمنهور') && gu.searchParams.get('details').includes(MAP), gu.searchParams.get('dates'));
  await ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} نجح`);
process.exit(failed.length ? 1 : 0);
