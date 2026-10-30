#!/usr/bin/env node
// يبني نسختي الدعوة (front / back) وصفحة الإدارة وملف التقويم من invite.config.json
// الاستخدام:  node build.mjs            → المخرجات في المجلد _site/
// اختياري:    SITE_URL=https://.../ node build.mjs        (يتجاوز siteUrl)
//             SUPABASE_URL=... SUPABASE_KEY=... node build.mjs   (يتجاوز إعدادات Supabase — للاختبار المحلي)

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, '_site');
const cfg = JSON.parse(readFileSync(join(ROOT, 'invite.config.json'), 'utf8'));
const T = cfg.texts;

let siteUrl = (process.env.SITE_URL || cfg.siteUrl || '').trim();
if (siteUrl && !siteUrl.endsWith('/')) siteUrl += '/';
if (!/^https:\/\//.test(siteUrl)) console.warn('⚠ siteUrl غير مضبوط برابط https كامل — صورة المعاينة في واتساب لن تعمل.');

const backend = {
  url: (process.env.SUPABASE_URL ?? cfg.backend.supabaseUrl ?? '').trim().replace(/\/+$/, ''),
  key: (process.env.SUPABASE_KEY ?? cfg.backend.supabaseKey ?? '').trim(),
};
const backendOn = Boolean(backend.url && backend.key);
if (!backendOn) console.warn('⚠ إعدادات Supabase فارغة — أقسام تأكيد الحضور والمباركات والعداد لن تعمل حتى تُضبط.');

// ---------- التوقيت ----------
const start = new Date(cfg.event.startLocal);
if (Number.isNaN(start.getTime())) throw new Error('event.startLocal غير صالح');
const startUTC = start.toISOString().replace('.000Z', 'Z');
(() => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.event.timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(start).reduce((o, x) => (o[x.type] = x.value, o), {});
  const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  const written = cfg.event.startLocal.slice(0, 16);
  if (local !== written) console.warn(`⚠ تنبيه توقيت: ${cfg.event.startLocal} يقابل ${local} في ${cfg.event.timeZone}. راجع الإزاحة.`);
  else console.log(`✓ الموعد ${written} (${cfg.event.timeZone}) = ${startUTC}`);
})();
const icsStamp = startUTC.replace(/[-:]/g, '');

// ---------- أدوات ----------
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const hash = (p) => createHash('sha1').update(readFileSync(join(ROOT, p))).digest('hex').slice(0, 8);
const fmtSec = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
const jsonScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// ---------- ملف التقويم ICS ----------
const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) {
  const enc = new TextEncoder(); const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length; const limit = out.length === 0 ? 75 : 74;
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur); return out.join('\r\n ');
}
const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const icsDesc = `${cfg.event.ceremonyLine}\n${cfg.share.description}\nموقع الفرح: ${cfg.venue.mapUrl}`;
const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Omar and Habiba//Wedding Invitation//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  'BEGIN:VEVENT',
  `UID:wedding-${icsStamp}@invitation`, `DTSTAMP:${dtstamp}`, `DTSTART:${icsStamp}`,
  `SUMMARY:${icsEscape(T.calendarTitle)}`, `LOCATION:${icsEscape(cfg.venue.calendarLocation)}`,
  `DESCRIPTION:${icsEscape(icsDesc)}`, `URL:${cfg.venue.mapUrl}`,
  'END:VEVENT', 'END:VCALENDAR',
].map(icsFold).join('\r\n') + '\r\n';

// لا يوجد وقت انتهاء معتمد؛ Google يشترط قيمة، فتساوي النهاية البداية.
const gcal = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
  action: 'TEMPLATE', text: T.calendarTitle, dates: `${icsStamp}/${icsStamp}`,
  details: icsDesc, location: cfg.venue.calendarLocation,
}).toString();

// ---------- الإعدادات المضمّنة في الصفحة ----------
const runtimeFor = (version) => ({
  version, startUTC,
  backend: backendOn ? { url: backend.url, key: backend.key } : null,
  voiceMax: cfg.backend.voiceMaxSeconds || 120,
  videoMax: cfg.backend.videoMaxSeconds || 60,
  videoMaxBytes: Math.round((cfg.backend.videoMaxMB || 18) * 1024 * 1024),
  t: {
    gateHint: T.gateHint, gateHintOpening: T.gateHintOpening,
    countdownTitle: T.countdownTitle, countdownDone: T.countdownDone, units: T.units,
    rsvpThanksYes: T.rsvpThanksYes, rsvpThanksNo: T.rsvpThanksNo, rsvpAlready: T.rsvpAlready,
    wishThanks: T.wishThanks, sendError: T.sendError, nameRequired: T.nameRequired,
    wishRequired: T.wishRequired, sending: T.sending, voiceNoMic: T.voiceNoMic,
    videoNoCam: T.videoNoCam, videoLimit: T.videoLimit, uploading: T.uploading,
  },
});

const V = {
  css: hash('assets/css/invite.css'), js: hash('assets/js/invite.js'),
  acss: hash('assets/css/admin.css'), ajs: hash('assets/js/admin.js'),
};

const SPRITE = `
<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <symbol id="i-heart" viewBox="0 0 24 22"><path d="M12 20.2C7.1 16.4 2.4 12.6 2.4 7.6 2.4 4.6 4.7 2.3 7.5 2.3c1.9 0 3.5 1 4.5 2.6 1-1.6 2.6-2.6 4.5-2.6 2.8 0 5.1 2.3 5.1 5.3 0 5-4.7 8.8-9.6 12.6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></symbol>
    <symbol id="i-pin" viewBox="0 0 24 30"><path d="M12 28.2s-8.6-9.1-8.6-15.4a8.6 8.6 0 0 1 17.2 0c0 6.3-8.6 15.4-8.6 15.4z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><circle cx="12" cy="12.6" r="3.1" fill="none" stroke="currentColor" stroke-width="1.15"/></symbol>
    <symbol id="i-sprig" viewBox="0 0 64 26">
      <path d="M2 18c14-1 30-4 46-10 4-1.5 8-3.4 13-6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
      <g fill="currentColor" fill-opacity=".38" stroke="currentColor" stroke-width=".8" stroke-linejoin="round">
        <path d="M14 16.6c-.6-3.6 1.4-6.6 5.2-7.8.4 3.6-1.6 6.6-5.2 7.8z"/><path d="M14.8 17c2.8 2.3 6.5 2.6 9.7.6-2.6-2.6-6.6-2.7-9.7-.6z"/>
        <path d="M27 13.9c-.2-3.8 2-6.6 5.8-7.4.1 3.7-2.2 6.5-5.8 7.4z"/><path d="M27.9 14.2c3 2 6.6 2 9.6-.2-2.8-2.3-6.7-2.2-9.6.2z"/>
        <path d="M40 9.8c.1-3.6 2.5-6.1 6.2-6.6-.2 3.6-2.6 6.1-6.2 6.6z"/><path d="M41 10.1c2.9 1.6 6.3 1.4 9-.8-2.8-2-6.4-1.7-9 .8z"/>
        <path d="M53 5.2c1.4-2.6 3.8-3.8 6.8-3.5-1.3 2.5-3.8 3.8-6.8 3.5z"/>
      </g>
    </symbol>
    <symbol id="i-cal" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.2"/><path d="M3.5 9.6h17M8 3v4M16 3v4"/></g></symbol>
    <symbol id="i-replay" viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4M4.3 3.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-mic" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></g></symbol>
    <symbol id="i-cam" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><rect x="3" y="6.5" width="13" height="11" rx="2.2"/><path d="M16 10.5l5-3v9l-5-3z"/></g></symbol>
    <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></symbol>
    <symbol id="i-pause" viewBox="0 0 24 24"><path d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z" fill="currentColor"/></symbol>
    <symbol id="i-lock" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.15"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></g></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  </defs>
</svg>`;

function envelope(imgBase) {
  return `
<div class="env" id="env">
  <div class="env-inside" aria-hidden="true">
    <div class="env-card" id="envCard">
      <picture>
        <source type="image/webp" srcset="../assets/img/${imgBase}.webp">
        <img src="../assets/img/${imgBase}.png" width="1024" height="1536" alt="" decoding="async">
      </picture>
    </div>
  </div>
  <div class="door door-r" id="doorR" aria-hidden="true"><span class="door-face door-out"></span><span class="door-face door-in"></span></div>
  <div class="door door-l" id="doorL" aria-hidden="true"><span class="door-face door-out"></span><span class="door-face door-in"></span></div>
  <div class="seal" id="seal" aria-hidden="true">
    <img class="seal-img" src="../assets/img/seal.png" width="422" height="490" alt="" decoding="async">
    <span class="seal-mono"></span>
  </div>
</div>`;
}

const rsvpSection = () => !backendOn ? '' : `
      <section class="sec sec-rsvp reveal" id="rsvp" aria-labelledby="rsvpTitle" data-state="form">
        <h2 class="h-sec" id="rsvpTitle">${esc(T.rsvpTitle)}</h2>
        <p class="lead">${esc(T.rsvpLead)}</p>
        <form class="card-form" id="rsvpForm" novalidate>
          <label class="field">
            <span class="field-label">${esc(T.rsvpName)}</span>
            <input type="text" name="name" id="rsvpName" maxlength="80" autocomplete="name" enterkeyhint="done" required>
          </label>
          <div class="choice">
            <button type="button" class="btn btn-primary" data-attending="yes">${esc(T.rsvpYes)}</button>
            <button type="button" class="btn btn-ghost" data-attending="no">${esc(T.rsvpNo)}</button>
          </div>
          <p class="form-msg" id="rsvpMsg" role="status" aria-live="polite"></p>
        </form>
        <div class="done" id="rsvpDone" hidden>
          <span class="done-ico" aria-hidden="true"><svg><use href="#i-check"/></svg></span>
          <p class="done-text" id="rsvpDoneText" role="status" aria-live="polite"></p>
          <button type="button" class="link-btn" id="rsvpAnother">${esc(T.rsvpAnother)}</button>
        </div>
      </section>`;

const wishSection = () => !backendOn ? '' : `
      <section class="sec sec-wish reveal" id="wish" aria-labelledby="wishTitle">
        <p class="dua">${esc(T.dua)}</p>
        <div class="divider small" aria-hidden="true"><span class="line"></span><svg class="ico-heart"><use href="#i-heart"/></svg><span class="line"></span></div>
        <h2 class="h-sec" id="wishTitle">${esc(T.wishTitle)}</h2>
        <p class="lead">${esc(T.wishLead)}</p>
        <form class="card-form" id="wishForm" novalidate>
          <label class="field">
            <span class="field-label">${esc(T.wishName)}</span>
            <input type="text" name="name" id="wishName" maxlength="80" autocomplete="name" required>
          </label>
          <label class="field">
            <span class="sr">${esc(T.wishMessage)}</span>
            <textarea name="message" id="wishMessage" rows="4" maxlength="1500" placeholder="${esc(T.wishMessage)}"></textarea>
          </label>
          <div class="voice" id="voice" data-state="idle">
            <p class="voice-title">${esc(T.voiceTitle)}</p>
            <div class="voice-row v-idle">
              <button type="button" class="btn btn-voice" id="recStart"><svg aria-hidden="true"><use href="#i-mic"/></svg><span>${esc(T.voiceStart)}</span></button>
            </div>
            <div class="voice-row v-rec">
              <span class="rec-dot" aria-hidden="true"></span>
              <span class="rec-label">${esc(T.voiceRecording)}</span>
              <span class="rec-time ltr" dir="ltr" id="recTime">0:00 / ${fmtSec(cfg.backend.voiceMaxSeconds || 120)}</span>
              <button type="button" class="btn btn-small" id="recStop">${esc(T.voiceStop)}</button>
            </div>
            <div class="voice-row v-ready">
              <button type="button" class="btn btn-small btn-play" id="recPlay" aria-pressed="false"><svg class="ic-play" aria-hidden="true"><use href="#i-play"/></svg><svg class="ic-pause" aria-hidden="true"><use href="#i-pause"/></svg><span>${esc(T.voicePlay)}</span><span class="ltr play-len" dir="ltr" id="recLen"></span></button>
              <button type="button" class="link-btn" id="recRedo">${esc(T.voiceRedo)}</button>
              <button type="button" class="link-btn" id="recDel">${esc(T.voiceDelete)}</button>
              <audio id="recAudio" preload="metadata"></audio>
            </div>
            <p class="voice-note" id="voiceNote" role="status" aria-live="polite"></p>
          </div>
          <div class="voice video" id="video" data-state="idle">
            <p class="voice-title">${esc(T.videoTitle)}</p>
            <div class="voice-row v-idle">
              <button type="button" class="btn btn-voice" id="vidStart"><svg aria-hidden="true"><use href="#i-cam"/></svg><span>${esc(T.videoStart)}</span></button>
            </div>
            <div class="vid-frame v-rec v-ready">
              <video id="vidLive" playsinline muted autoplay></video>
              <video id="vidPlay" playsinline preload="metadata"></video>
            </div>
            <div class="voice-row v-rec">
              <span class="rec-dot" aria-hidden="true"></span>
              <span class="rec-label">${esc(T.voiceRecording)}</span>
              <span class="rec-time ltr" dir="ltr" id="vidTime">0:00 / ${fmtSec(cfg.backend.videoMaxSeconds || 60)}</span>
              <button type="button" class="btn btn-small" id="vidStop">${esc(T.voiceStop)}</button>
            </div>
            <div class="voice-row v-ready">
              <button type="button" class="btn btn-small btn-play" id="vidPlayBtn" aria-pressed="false"><svg class="ic-play" aria-hidden="true"><use href="#i-play"/></svg><svg class="ic-pause" aria-hidden="true"><use href="#i-pause"/></svg><span>${esc(T.voicePlay)}</span><span class="ltr play-len" dir="ltr" id="vidLen"></span></button>
              <button type="button" class="link-btn" id="vidRedo">${esc(T.voiceRedo)}</button>
              <button type="button" class="link-btn" id="vidDel">${esc(T.voiceDelete)}</button>
            </div>
            <p class="voice-note" id="videoNote" role="status" aria-live="polite"></p>
          </div>
          <p class="privacy"><svg aria-hidden="true"><use href="#i-lock"/></svg><span>${esc(T.privacyNote)}</span></p>
          <button type="submit" class="btn btn-primary btn-wide" id="wishSend"><span id="wishSendLabel">${esc(T.wishSend)}</span></button>
          <p class="form-msg" id="wishMsg" role="status" aria-live="polite"></p>
        </form>
        <div class="done" id="wishDone" hidden>
          <span class="done-ico" aria-hidden="true"><svg><use href="#i-heart"/></svg></span>
          <p class="done-text" role="status" aria-live="polite">${esc(T.wishThanks)}</p>
          <button type="button" class="link-btn" id="wishAnother">${esc(T.wishAnother)}</button>
        </div>
      </section>`;

function page(version) {
  const v = cfg.versions[version];
  const pageUrl = siteUrl ? `${siteUrl}${version}/` : '';
  const ogImg = siteUrl ? `${siteUrl}assets/img/og-${v.image}.jpg` : `../assets/img/og-${v.image}.jpg`;
  const cell = (u, label) => `
          <div class="unit">
            <span class="num" data-u="${u}" aria-hidden="true"><span class="d">0</span><span class="d">0</span></span>
            <span class="sr" data-sr="${u}"></span>
            <span class="lbl">${esc(label)}</span>
          </div>`;
  const [uD, uH, uM, uS] = T.units;

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
<link rel="preload" href="../assets/img/doors.jpg" as="image">
<link rel="preload" href="../assets/img/seal.png" as="image">
${backendOn ? `<link rel="preconnect" href="${esc(backend.url)}" crossorigin>` : ''}
<link rel="stylesheet" href="../assets/css/invite.css?v=${V.css}">
<script id="invite-config" type="application/json">${jsonScript(runtimeFor(version))}</script>
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
      <p class="gate-title">${esc(T.gateTitle)}</p>
      <p class="gate-date"><span class="rule" aria-hidden="true"></span><span dir="ltr" class="ltr">${esc(cfg.event.gateDate)}</span><span class="rule" aria-hidden="true"></span></p>
    </header>
    <div class="gate-stage">
      <button type="button" class="env-btn" id="openBtn" aria-describedby="gateHint">
        <span class="sr">${esc(T.gateHint)}</span>
        ${envelope(v.image)}
      </button>
    </div>
    <p class="gate-hint" id="gateHint">${esc(T.gateHint)}</p>
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
        <span class="mono" aria-hidden="true"></span>
        <h1 class="names">${esc(cfg.couple.groom)} <span class="waw">و</span>${esc(cfg.couple.bride)}</h1>
        <h2 class="welcome">${esc(T.introTitle)}</h2>
        <p class="lead">${esc(T.introBody)}</p>
        <div class="divider" aria-hidden="true"><span class="line"></span><svg class="ico-heart"><use href="#i-heart"/></svg><span class="line"></span></div>
        <p class="intro-close">${esc(T.introClose)}</p>
      </section>

      <section class="sec sec-date reveal" aria-label="الموعد">
        <p class="day">${esc(cfg.event.dayName)}</p>
        <p class="dm"><span dir="ltr" class="ltr">${esc(cfg.event.dayMonth)}</span></p>
        <p class="yr"><span dir="ltr" class="ltr">${esc(cfg.event.year)}</span></p>
        <p class="time">${esc(cfg.event.timeLabel)}</p>
        <p class="tz">${esc(cfg.event.timeZoneLabel)}</p>
        <p class="ceremony">${esc(cfg.event.ceremonyLine)}</p>
        <details class="cal">
          <summary><svg class="ico" aria-hidden="true"><use href="#i-cal"/></svg><span>${esc(T.addToCalendar)}</span></summary>
          <div class="cal-opts">
            <a class="cal-opt" href="../assets/calendar/wedding.ics">${esc(T.calendarApple)}</a>
            <a class="cal-opt" href="${esc(gcal)}" target="_blank" rel="noopener">${esc(T.calendarGoogle)}</a>
          </div>
        </details>
      </section>

      <section class="sec sec-count reveal" aria-labelledby="countTitle">
        <h2 class="count-title" id="countTitle">${esc(T.countdownTitle)}</h2>
        <div class="count" role="timer">${cell('d', uD)}${cell('h', uH)}${cell('m', uM)}${cell('s', uS)}
        </div>
      </section>

      <section class="sec sec-venue reveal" aria-label="المكان">
        <h2 class="venue">${esc(cfg.venue.name)}</h2>
        <p class="city">${esc(cfg.venue.city)}</p>
        <figure class="mosque">
          <picture>
            <source type="image/webp" srcset="../assets/img/mosque.webp">
            <img src="../assets/img/mosque.jpg" width="1200" height="800" alt="${esc(cfg.venue.imageAlt)}" loading="lazy" decoding="async">
          </picture>
        </figure>
        <a class="medal" href="${esc(cfg.venue.mapUrl)}" target="_blank" rel="noopener">
          <svg class="sprig sprig-r" aria-hidden="true"><use href="#i-sprig"/></svg>
          <span class="medal-body">
            <svg class="pin" aria-hidden="true"><use href="#i-pin"/></svg>
            <span class="medal-main">${esc(T.mapMain)}</span>
            <span class="medal-sub">${esc(T.mapSub)}</span>
          </span>
          <svg class="sprig sprig-l" aria-hidden="true"><use href="#i-sprig"/></svg>
        </a>
      </section>
${rsvpSection()}
${wishSection()}
      <section class="sec sec-close reveal">
        <p class="closing">${esc(T.closing)}</p>
        <svg class="ico-heart" aria-hidden="true"><use href="#i-heart"/></svg>
        <button type="button" class="replay" id="replayBtn"><svg class="ico" aria-hidden="true"><use href="#i-replay"/></svg><span>${esc(T.replay)}</span></button>
      </section>
    </div>
  </div>
</main>
</body>
</html>
`;
}

function adminPage() {
  const adminCfg = {
    backend: backendOn ? { url: backend.url, key: backend.key } : null,
    adminEmail: cfg.backend.adminEmail,
    redirect: siteUrl ? `${siteUrl}admin/` : null,
    versions: Object.fromEntries(Object.entries(cfg.versions).map(([k, v]) => [k, v.label])),
    bucket: 'invite-voices',
    videoBucket: 'invite-videos',
    title: `${cfg.couple.groom} و${cfg.couple.bride}`,
  };
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>لوحة الدعوة — ${esc(adminCfg.title)}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#F8F0E5">
<link rel="icon" href="../assets/img/favicon.png" type="image/png">
<link rel="stylesheet" href="../assets/css/admin.css?v=${V.acss}">
<script id="admin-config" type="application/json">${jsonScript(adminCfg)}</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js" defer></script>
<script src="../assets/js/admin.js?v=${V.ajs}" defer></script>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <p class="kicker">لوحة الدعوة</p>
      <h1>${esc(adminCfg.title)}</h1>
    </div>
    <div class="top-actions" id="topActions" hidden>
      <span class="who" id="who"></span>
      <button type="button" class="btn btn-ghost" id="refreshBtn">تحديث</button>
      <button type="button" class="btn btn-ghost" id="logoutBtn">خروج</button>
    </div>
  </header>

  <section class="panel" id="loginPanel" hidden>
    <h2>تسجيل الدخول</h2>
    <p class="muted">يصلك رابط دخول على بريدك. افتحه من نفس الجهاز أو من أي جهاز.</p>
    <form id="loginForm" class="login">
      <label class="field"><span>البريد الإلكتروني</span>
        <input type="email" id="loginEmail" dir="ltr" autocomplete="email" required value="${esc(cfg.backend.adminEmail)}"></label>
      <button type="submit" class="btn btn-primary" id="loginBtn">أرسل رابط الدخول</button>
      <p class="msg" id="loginMsg" role="status" aria-live="polite"></p>
    </form>
  </section>

  <section class="panel" id="notConfigured" hidden>
    <h2>قاعدة البيانات غير مضبوطة بعد</h2>
    <p class="muted">أضف supabaseUrl و supabaseKey في invite.config.json ثم أعد النشر.</p>
  </section>

  <div id="dash" hidden>
    <div class="filters">
      <div class="seg" role="radiogroup" aria-label="نوع البيانات">
        <label><input type="radio" name="dataset" value="real" checked><span>البيانات الحقيقية</span></label>
        <label><input type="radio" name="dataset" value="test"><span>بيانات التجربة</span></label>
      </div>
      <p class="muted small" id="updatedAt"></p>
    </div>

    <section class="panel">
      <h2>الأرقام</h2>
      <div class="table-wrap"><table class="stats" id="statsTable"></table></div>
      <p class="muted small" id="usage"></p>
      <p class="muted small">الزيارات تُحسب عند فتح الرابط، وفتح الظرف عند الضغط على الختم. «أجهزة مختلفة» تقدير لعدد الأشخاص؛ نفس الشخص من جهازين يُحسب مرتين.</p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>تأكيد الحضور</h2>
        <div class="tabs" role="tablist" id="rsvpTabs">
          <button type="button" role="tab" data-f="all" aria-selected="true">الكل</button>
          <button type="button" role="tab" data-f="yes" aria-selected="false">سيحضرون</button>
          <button type="button" role="tab" data-f="no" aria-selected="false">اعتذروا</button>
        </div>
      </div>
      <div class="table-wrap"><table class="list" id="rsvpTable"></table></div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>المباركات</h2>
        <div class="tabs" role="tablist" id="wishTabs">
          <button type="button" role="tab" data-f="all" aria-selected="true">الكل</button>
          <button type="button" role="tab" data-f="voice" aria-selected="false">بالصوت</button>
          <button type="button" role="tab" data-f="video" aria-selected="false">بالفيديو</button>
          <button type="button" role="tab" data-f="text" aria-selected="false">مكتوبة فقط</button>
        </div>
      </div>
      <div class="wishes" id="wishList"></div>
    </section>

    <section class="panel">
      <h2>الذكرى</h2>
      <p class="muted">نزّل كل البيانات في ملف Excel، وكل التسجيلات الصوتية والفيديوهات في ملف مضغوط. نزّلها خلال أسبوع من الفرح.</p>
      <div class="row">
        <button type="button" class="btn btn-primary" id="xlsxBtn">تنزيل Excel</button>
        <button type="button" class="btn btn-ghost" id="zipBtn">تنزيل التسجيلات والفيديوهات (ZIP)</button>
      </div>
      <p class="msg" id="exportMsg" role="status" aria-live="polite"></p>
    </section>
  </div>
  <p class="msg err" id="fatal" role="alert" hidden></p>
</div>
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
mkdirSync(join(OUT, 'admin'), { recursive: true });
writeFileSync(join(OUT, 'admin', 'index.html'), adminPage());
writeFileSync(join(OUT, 'index.html'), `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0; url=./front/"><link rel="canonical" href="./front/"><title>${esc(cfg.share.title)}</title></head><body><a href="./front/">${esc(cfg.share.title)}</a></body></html>\n`);
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`✓ تم البناء في ${OUT}  (siteUrl: ${siteUrl || '—'} · Supabase: ${backendOn ? 'مفعّل' : 'غير مضبوط'})`);
