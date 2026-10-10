#!/usr/bin/env node
// يبني نسختي الدعوة (front / back) وملف التقويم من invite.config.json
// الاستخدام:  node build.mjs            → المخرجات في المجلد _site/
// اختياري:    SITE_URL=https://.../ node build.mjs   (يتجاوز siteUrl في ملف الإعدادات)

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, '_site');
const cfg = JSON.parse(readFileSync(join(ROOT, 'invite.config.json'), 'utf8'));

let siteUrl = (process.env.SITE_URL || cfg.siteUrl || '').trim();
if (siteUrl && !siteUrl.endsWith('/')) siteUrl += '/';
if (!/^https:\/\//.test(siteUrl)) {
  console.warn('⚠ siteUrl غير مضبوط برابط https كامل — صورة المعاينة في واتساب لن تعمل حتى يُضبط.');
}

// ---------- التوقيت ----------
const start = new Date(cfg.event.startLocal);
if (Number.isNaN(start.getTime())) throw new Error('event.startLocal غير صالح');
const startUTC = start.toISOString().replace('.000Z', 'Z');
// تحقّق: هل الإزاحة المكتوبة تطابق المنطقة الزمنية في تلك اللحظة؟
(() => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.event.timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(start).reduce((o, p) => (o[p.type] = p.value, o), {});
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  const written = cfg.event.startLocal.slice(0, 16);
  if (local !== written) {
    console.warn(`⚠ تنبيه توقيت: ${cfg.event.startLocal} يقابل ${local} في ${cfg.event.timeZone}. راجع الإزاحة.`);
  } else {
    console.log(`✓ الموعد ${written} (${cfg.event.timeZone}) = ${startUTC}`);
  }
})();
const icsStamp = startUTC.replace(/[-:]/g, ''); // 20261111T110000Z

// ---------- أدوات ----------
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const hash = (p) => createHash('sha1').update(readFileSync(join(ROOT, p))).digest('hex').slice(0, 8);

// ---------- ملف التقويم ICS ----------
function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsFold(line) {
  // طيّ الأسطر عند 75 بايت (UTF-8) دون كسر حرف
  const enc = new TextEncoder();
  const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const icsLines = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Omar and Habiba//Wedding Invitation//AR',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'BEGIN:VEVENT',
  `UID:wedding-${icsStamp}@invitation`,
  `DTSTAMP:${dtstamp}`,
  `DTSTART:${icsStamp}`,
  `SUMMARY:${icsEscape(cfg.texts.calendarTitle)}`,
  `LOCATION:${icsEscape(cfg.venue.calendarLocation)}`,
  `DESCRIPTION:${icsEscape(`${cfg.share.description}\nموقع الفرح: ${cfg.venue.mapUrl}`)}`,
  `URL:${cfg.venue.mapUrl}`,
  'END:VEVENT',
  'END:VCALENDAR',
];
const ics = icsLines.map(icsFold).join('\r\n') + '\r\n';

// ---------- رابط Google Calendar ----------
// لا يوجد وقت انتهاء معتمد؛ Google يشترط قيمة، فتساوي النهاية البداية (حدث بلا مدة).
const gcal = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
  action: 'TEMPLATE',
  text: cfg.texts.calendarTitle,
  dates: `${icsStamp}/${icsStamp}`,
  details: `${cfg.share.description}\nموقع الفرح: ${cfg.venue.mapUrl}`,
  location: cfg.venue.calendarLocation,
}).toString();

// ---------- الإعدادات المضمّنة في الصفحة ----------
const runtime = {
  startUTC,
  texts: {
    gateHint: cfg.texts.gateHint,
    gateHintOpening: cfg.texts.gateHintOpening,
    countdownTitle: cfg.texts.countdownTitle,
    countdownDone: cfg.texts.countdownDone,
    units: cfg.texts.units,
  },
};

// ---------- القالب ----------
const V = { css: hash('assets/css/invite.css'), js: hash('assets/js/invite.js') };

const SPRITE = `
<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <symbol id="i-heart" viewBox="0 0 24 22">
      <path d="M12 20.2C7.1 16.4 2.4 12.6 2.4 7.6 2.4 4.6 4.7 2.3 7.5 2.3c1.9 0 3.5 1 4.5 2.6 1-1.6 2.6-2.6 4.5-2.6 2.8 0 5.1 2.3 5.1 5.3 0 5-4.7 8.8-9.6 12.6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-pin" viewBox="0 0 24 30">
      <path d="M12 28.2s-8.6-9.1-8.6-15.4a8.6 8.6 0 0 1 17.2 0c0 6.3-8.6 15.4-8.6 15.4z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>
      <circle cx="12" cy="12.6" r="3.1" fill="none" stroke="currentColor" stroke-width="1.15"/>
    </symbol>
    <symbol id="i-sprig" viewBox="0 0 64 26">
      <path d="M2 18c14-1 30-4 46-10 4-1.5 8-3.4 13-6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
      <g fill="currentColor" fill-opacity=".38" stroke="currentColor" stroke-width=".8" stroke-linejoin="round">
        <path d="M14 16.6c-.6-3.6 1.4-6.6 5.2-7.8.4 3.6-1.6 6.6-5.2 7.8z"/>
        <path d="M14.8 17c2.8 2.3 6.5 2.6 9.7.6-2.6-2.6-6.6-2.7-9.7-.6z"/>
        <path d="M27 13.9c-.2-3.8 2-6.6 5.8-7.4.1 3.7-2.2 6.5-5.8 7.4z"/>
        <path d="M27.9 14.2c3 2 6.6 2 9.6-.2-2.8-2.3-6.7-2.2-9.6.2z"/>
        <path d="M40 9.8c.1-3.6 2.5-6.1 6.2-6.6-.2 3.6-2.6 6.1-6.2 6.6z"/>
        <path d="M41 10.1c2.9 1.6 6.3 1.4 9-.8-2.8-2-6.4-1.7-9 .8z"/>
        <path d="M53 5.2c1.4-2.6 3.8-3.8 6.8-3.5-1.3 2.5-3.8 3.8-6.8 3.5z"/>
      </g>
    </symbol>
    <symbol id="i-cal" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round">
        <rect x="3.5" y="5" width="17" height="15" rx="2.2"/><path d="M3.5 9.6h17M8 3v4M16 3v4"/>
      </g>
    </symbol>
    <symbol id="i-replay" viewBox="0 0 24 24">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4M4.3 3.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
  </defs>
</svg>`;

function envelope(imgBase, alt) {
  // ظرف رأسي: الخلفية الداخلية ← البطاقة ← الجيب الأمامي ← اللسان ← الختم
  return `
<div class="env" id="env">
  <svg class="env-back" viewBox="0 0 300 420" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="gBack" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#E9DCC8"/><stop offset="1" stop-color="#E3D3BC"/>
      </linearGradient>
      <linearGradient id="gLiner" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#C9D6DC"/><stop offset=".55" stop-color="#E7D7C2"/><stop offset="1" stop-color="#EBCDB4"/>
      </linearGradient>
    </defs>
    <rect width="300" height="420" rx="7" fill="url(#gBack)"/>
    <rect x=".5" y=".5" width="299" height="419" rx="6.5" fill="none" stroke="#B39570" stroke-opacity=".35"/>
    <path d="M10 8h280l-140 214z" fill="url(#gLiner)" opacity=".55"/>
  </svg>

  <div class="env-card" id="envCard" aria-hidden="true">
    <picture>
      <source type="image/webp" srcset="../assets/img/${imgBase}.webp">
      <img src="../assets/img/${imgBase}.png" width="1024" height="1536" alt="" decoding="async">
    </picture>
  </div>

  <div class="env-front" aria-hidden="true">
    <svg viewBox="0 0 300 420" preserveAspectRatio="none">
      <defs>
        <linearGradient id="gSideL" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#FCF8F1"/><stop offset="1" stop-color="#F2E7D7"/>
        </linearGradient>
        <linearGradient id="gSideR" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stop-color="#FCF8F1"/><stop offset="1" stop-color="#F2E7D7"/>
        </linearGradient>
        <linearGradient id="gBottom" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#FEFCF8"/><stop offset="1" stop-color="#F5ECDF"/>
        </linearGradient>
        <filter id="fFold" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.2"/>
          <feOffset dy="-1.6" result="b"/>
          <feComponentTransfer><feFuncA type="linear" slope=".22"/></feComponentTransfer>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <pattern id="pPaper" width="96" height="96" patternUnits="userSpaceOnUse">
          <image href="../assets/img/paper.png" width="96" height="96"/>
        </pattern>
      </defs>
      <path d="M0 7Q0 0 6 2L156 238 6 418Q0 420 0 413Z" fill="url(#gSideL)"/>
      <path d="M300 7Q300 0 294 2L144 238 294 418Q300 420 300 413Z" fill="url(#gSideR)"/>
      <path d="M0 413V7L156 238ZM300 413V7L144 238Z" fill="url(#pPaper)" opacity=".7"/>
      <g filter="url(#fFold)">
        <path d="M0 413Q0 420 7 420H293Q300 420 300 413L163 216Q150 199 137 216Z" fill="url(#gBottom)"/>
      </g>
      <path d="M0 413Q0 420 7 420H293Q300 420 300 413L163 216Q150 199 137 216Z" fill="url(#pPaper)" opacity=".7"/>
      <path d="M2 411L137 216Q150 199 163 216L298 411" fill="none" stroke="#C9B494" stroke-opacity=".45" stroke-width=".8"/>
      <rect x=".5" y=".5" width="299" height="419" rx="6.5" fill="none" stroke="#B39570" stroke-opacity=".32"/>
      <path d="M2 6L150 232M298 6L150 232" fill="none" stroke="#C9B494" stroke-opacity=".28" stroke-width=".7"/>
    </svg>
    <p class="env-line">${esc(cfg.texts.envelopeLine)}</p>
  </div>

  <div class="env-flap" id="envFlap" aria-hidden="true">
    <svg class="flap-face flap-out" viewBox="0 0 300 262" preserveAspectRatio="none">
      <defs>
        <linearGradient id="gFlap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#F6EDE1"/><stop offset="1" stop-color="#FDF9F3"/>
        </linearGradient>
        <filter id="fFlap" x="-10%" y="-10%" width="120%" height="130%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.6"/>
          <feOffset dy="2.4"/>
          <feComponentTransfer><feFuncA type="linear" slope=".24"/></feComponentTransfer>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <pattern id="pPaper2" width="96" height="96" patternUnits="userSpaceOnUse">
          <image href="../assets/img/paper.png" width="96" height="96"/>
        </pattern>
      </defs>
      <g filter="url(#fFlap)">
        <path d="M0 7Q0 0 7 0H293Q300 0 300 7L163 246Q150 263 137 246Z" fill="url(#gFlap)"/>
      </g>
      <path d="M0 7Q0 0 7 0H293Q300 0 300 7L163 246Q150 263 137 246Z" fill="url(#pPaper2)" opacity=".75"/>
      <path d="M2 9L137 246Q150 263 163 246L298 9" fill="none" stroke="#C9B494" stroke-opacity=".5" stroke-width=".8"/>
    </svg>
    <svg class="flap-face flap-in" viewBox="0 0 300 262" preserveAspectRatio="none">
      <defs>
        <linearGradient id="gFlapIn" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#D3DEE3"/><stop offset=".5" stop-color="#EADCC9"/><stop offset="1" stop-color="#EDD2BC"/>
        </linearGradient>
      </defs>
      <path d="M0 7Q0 0 7 0H293Q300 0 300 7L163 246Q150 263 137 246Z" fill="url(#gFlapIn)"/>
      <path d="M0 7Q0 0 7 0H293Q300 0 300 7L163 246Q150 263 137 246Z" fill="url(#pPaper2)" opacity=".6"/>
    </svg>
  </div>

  <div class="seal" id="seal" aria-hidden="true">
    <svg class="seal-wax" viewBox="0 0 100 100">
      <defs>
        <radialGradient id="gWax" cx="40%" cy="34%" r="70%">
          <stop offset="0" stop-color="#D9BC8C"/><stop offset=".45" stop-color="#C29D66"/><stop offset=".85" stop-color="#A9844F"/><stop offset="1" stop-color="#977443"/>
        </radialGradient>
        <radialGradient id="gWaxIn" cx="50%" cy="46%" r="55%">
          <stop offset="0" stop-color="#C7A36D"/><stop offset=".8" stop-color="#BB975F"/><stop offset="1" stop-color="#A88550"/>
        </radialGradient>
      </defs>
      <path d="M50 2.5c6.3 0 9.8 3.2 15 4.6 6 1.6 11.6.7 15.7 5.3 4 4.4 3.1 9.7 5.4 15 2.4 5.6 7.4 9.7 7.4 16.9 0 6.6-4.6 10.4-5.6 16.3-1.2 6.6.9 12.2-3.7 17.4-4.6 5.2-10.6 4.2-16.6 6.5-5.4 2.1-9.6 6.9-17.6 6.9-7.2 0-11-4.7-16.8-6.7-6.2-2.1-12-.9-16.6-5.8-4.4-4.7-2.7-10.6-4.6-16.6C10.2 56 5.4 52.4 5.4 45c0-7.4 5.3-11 7.5-17.2 2-5.5.8-10.8 5.2-15.3 4.4-4.5 10-3.7 15.6-5.4C38.8 5.6 43.3 2.5 50 2.5z" fill="url(#gWax)"/>
      <circle cx="50" cy="48.5" r="33.5" fill="url(#gWaxIn)"/>
      <circle cx="50" cy="48.5" r="33.5" fill="none" stroke="#8E6D3E" stroke-opacity=".55" stroke-width="1.1"/>
      <circle cx="50" cy="48.5" r="30.6" fill="none" stroke="#E6CFA4" stroke-opacity=".5" stroke-width=".7"/>
      <path d="M22 30c6-9 16-14 28-14" fill="none" stroke="#F1DDB8" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
    <span class="seal-mono"></span>
  </div>
</div>`;
}

function page(version) {
  const v = cfg.versions[version];
  const pageUrl = siteUrl ? `${siteUrl}${version}/` : '';
  const ogImg = siteUrl ? `${siteUrl}assets/img/og-${v.image}.jpg` : `../assets/img/og-${v.image}.jpg`;
  const [unitD, unitH, unitM, unitS] = cfg.texts.units;
  const cell = (u, label) => `
          <div class="unit">
            <span class="num" data-u="${u}" aria-hidden="true"><span class="d">0</span><span class="d">0</span></span>
            <span class="sr" data-sr="${u}"></span>
            <span class="lbl">${esc(label)}</span>
          </div>`;

  return `<!doctype html>
<html lang="ar" dir="rtl" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>document.documentElement.className='js';</script>
<title>${esc(cfg.share.title)}</title>
<meta name="description" content="${esc(cfg.share.description)}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F8F0E5">
<meta name="color-scheme" content="light">
<meta name="format-detection" content="telephone=no, date=no, address=no">
${pageUrl ? `<link rel="canonical" href="${esc(pageUrl)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_AR">
<meta property="og:title" content="${esc(cfg.share.title)}">
<meta property="og:description" content="${esc(cfg.share.description)}">
${pageUrl ? `<meta property="og:url" content="${esc(pageUrl)}">` : ''}
<meta property="og:image" content="${esc(ogImg)}">
${ogImg.startsWith('https://') ? `<meta property="og:image:secure_url" content="${esc(ogImg)}">` : ''}
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="630">
<meta property="og:image:height" content="945">
<meta property="og:image:alt" content="${esc(cfg.share.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(cfg.share.title)}">
<meta name="twitter:description" content="${esc(cfg.share.description)}">
<meta name="twitter:image" content="${esc(ogImg)}">
<link rel="icon" href="../assets/img/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="../assets/img/apple-touch-icon.png">
<link rel="preload" href="../assets/fonts/amiri-arabic-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="../assets/fonts/noto-naskh-arabic-arabic-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../assets/css/invite.css?v=${V.css}">
<script id="invite-config" type="application/json">${JSON.stringify(runtime).replace(/</g, '\\u003c')}</script>
<script src="../assets/js/invite.js?v=${V.js}" defer></script>
</head>
<body>
${SPRITE}

<div class="gate" id="gate">
  <div class="wash" aria-hidden="true">
    <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span><span class="blob b4"></span>
  </div>
  <div class="gate-inner">
    <header class="gate-head" id="gateHead">
      <p class="gate-title">${esc(cfg.texts.gateTitle)}</p>
      <p class="gate-date"><span class="rule" aria-hidden="true"></span><span dir="ltr" class="ltr">${esc(cfg.event.gateDate)}</span><span class="rule" aria-hidden="true"></span></p>
    </header>
    <div class="gate-stage">
      <button type="button" class="env-btn" id="openBtn" aria-describedby="gateHint">
        <span class="sr">${esc(cfg.texts.gateHint)}</span>
        ${envelope(v.image, v.alt)}
      </button>
    </div>
    <p class="gate-hint" id="gateHint">${esc(cfg.texts.gateHint)}</p>
  </div>
</div>

<main class="invite" id="invite" tabindex="-1" aria-label="${esc(`دعوة زفاف ${cfg.couple.groom} و${cfg.couple.bride}`)}">
  <div class="layout">
    <figure class="hero">
      <picture>
        <source type="image/webp" srcset="../assets/img/${v.image}.webp">
        <img src="../assets/img/${v.image}.png" width="1024" height="1536" alt="${esc(v.alt)}" decoding="async" fetchpriority="high">
      </picture>
    </figure>

    <div class="details">
      <section class="sec sec-intro reveal">
        <img class="mono" src="../assets/img/monogram.png" width="220" height="420" alt="" aria-hidden="true">
        <p class="story">${esc(cfg.texts.storyLine)}</p>
        <h1 class="names">${esc(cfg.couple.groom)} <span class="waw">و</span>${esc(cfg.couple.bride)}</h1>
        <h2 class="welcome">${esc(cfg.texts.welcomeTitle)}</h2>
        <p class="lead">${cfg.texts.welcomeBody.map(esc).join('<br>')}</p>
        <div class="divider" aria-hidden="true"><span class="line"></span><svg class="ico-heart"><use href="#i-heart"/></svg><span class="line"></span></div>
      </section>

      <section class="sec sec-date reveal" aria-label="الموعد">
        <p class="day">${esc(cfg.event.dayName)}</p>
        <p class="dm"><span dir="ltr" class="ltr">${esc(cfg.event.dayMonth)}</span></p>
        <p class="yr"><span dir="ltr" class="ltr">${esc(cfg.event.year)}</span></p>
        <p class="time">${esc(cfg.event.timeLabel)}</p>
        <p class="tz">${esc(cfg.event.timeZoneLabel)}</p>
        <details class="cal">
          <summary><svg class="ico"><use href="#i-cal"/></svg><span>${esc(cfg.texts.addToCalendar)}</span></summary>
          <div class="cal-opts">
            <a class="cal-opt" href="../assets/calendar/wedding.ics">تقويم Apple والبرامج المتوافقة</a>
            <a class="cal-opt" href="${esc(gcal)}" target="_blank" rel="noopener">تقويم Google</a>
          </div>
        </details>
      </section>

      <section class="sec sec-count reveal" aria-labelledby="countTitle">
        <h2 class="count-title" id="countTitle">${esc(cfg.texts.countdownTitle)}</h2>
        <div class="count" role="timer">${cell('d', unitD)}${cell('h', unitH)}${cell('m', unitM)}${cell('s', unitS)}
        </div>
        <span class="rule-short" aria-hidden="true"></span>
      </section>

      <section class="sec sec-venue reveal" aria-label="المكان">
        <h2 class="venue">${esc(cfg.venue.name)}</h2>
        <p class="city">${esc(cfg.venue.city)}</p>
        <a class="medal" href="${esc(cfg.venue.mapUrl)}" target="_blank" rel="noopener">
          <svg class="sprig sprig-r" aria-hidden="true"><use href="#i-sprig"/></svg>
          <span class="medal-body">
            <svg class="pin" aria-hidden="true"><use href="#i-pin"/></svg>
            <span class="medal-main">${esc(cfg.texts.mapMain)}</span>
            <span class="medal-sub">${esc(cfg.texts.mapSub)}</span>
          </span>
          <svg class="sprig sprig-l" aria-hidden="true"><use href="#i-sprig"/></svg>
        </a>
      </section>

      <section class="sec sec-close reveal">
        <p class="closing">${esc(cfg.texts.closing)}</p>
        <svg class="ico-heart" aria-hidden="true"><use href="#i-heart"/></svg>
        <button type="button" class="replay" id="replayBtn"><svg class="ico" aria-hidden="true"><use href="#i-replay"/></svg><span>${esc(cfg.texts.replay)}</span></button>
      </section>
    </div>
  </div>
</main>
</body>
</html>
`;
}

// ---------- الإخراج ----------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'assets'), join(OUT, 'assets'), { recursive: true });
mkdirSync(join(OUT, 'assets/calendar'), { recursive: true });
writeFileSync(join(OUT, 'assets/calendar/wedding.ics'), ics);
for (const ver of Object.keys(cfg.versions)) {
  mkdirSync(join(OUT, ver), { recursive: true });
  writeFileSync(join(OUT, ver, 'index.html'), page(ver));
}
// الجذر: لا شاشة اختيار؛ يحوّل بهدوء إلى النسخة الأمامية
writeFileSync(join(OUT, 'index.html'), `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0; url=./front/"><link rel="canonical" href="./front/"><title>${esc(cfg.share.title)}</title></head><body><a href="./front/">${esc(cfg.share.title)}</a></body></html>\n`);
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`✓ تم البناء في ${OUT}  (siteUrl: ${siteUrl || '—'})`);
