/* دعوة زفاف — فتح الظرف، ظهور الأقسام، العد التنازلي، إعادة الفتح */
(function () {
  'use strict';

  var root = document.documentElement;
  var cfg = JSON.parse(document.getElementById('invite-config').textContent);
  var $ = function (id) { return document.getElementById(id); };

  var gate = $('gate'), head = $('gateHead'), hint = $('gateHint');
  var gateInner = gate.querySelector('.gate-inner'), wash = gate.querySelector('.wash');
  var btn = $('openBtn'), env = $('env'), card = $('envCard'), flap = $('envFlap'), seal = $('seal');
  var invite = $('invite'), replayBtn = $('replayBtn');

  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var state = 'closed';            // closed | opening | open
  var anims = [], timers = [];

  // ---------- أدوات ----------
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function animate(el, frames, opts) {
    if (!el.animate) return null;
    var a = el.animate(frames, Object.assign({ fill: 'both' }, opts));
    anims.push(a);
    return a;
  }
  function swapHint(text) {
    var a = animate(hint, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
    var set = function () {
      hint.textContent = text;
      animate(hint, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-in' });
    };
    if (a) a.onfinish = set; else set();
  }
  function scrollTop() {
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
    catch (e) { window.scrollTo(0, 0); }
  }

  // ---------- فتح الظرف (~5.6 ثانية) ----------
  function open() {
    if (state !== 'closed') return;           // منع إعادة التشغيل بالضغط المتكرر
    state = 'opening';
    btn.setAttribute('aria-disabled', 'true');
    swapHint(cfg.texts.gateHintOpening);

    if (reduceMQ.matches || !env.animate) { openReduced(); return; }

    // مسافة صعود البطاقة: تتكيّف مع ارتفاع الشاشة حتى لا تخرج عن أعلاها
    var er = env.getBoundingClientRect(), cr = card.getBoundingClientRect();
    var room = cr.top - 12;                    // المسافة المتاحة فوق البطاقة
    var rise = Math.max(er.height * 0.30, Math.min(er.height * 0.56, room));

    // 0 → 1s: الختم يرتفع ويدور قليلًا ثم يتلاشى
    animate(seal, [
      { transform: 'translateY(0) rotate(0deg) scale(1)', opacity: 1, offset: 0 },
      { transform: 'translateY(-7px) rotate(-10deg) scale(1.05)', opacity: 1, offset: .45 },
      { transform: 'translateY(-12px) rotate(-16deg) scale(1.02)', opacity: 0, offset: 1 }
    ], { duration: 1000, easing: 'cubic-bezier(.35,.1,.25,1)' });

    // 0.65 → 2.3s: اللسان ينفتح من حافته العليا
    animate(flap, [
      { transform: 'rotateX(0deg)' },
      { transform: 'rotateX(180deg)' }
    ], { duration: 1650, delay: 650, easing: 'cubic-bezier(.45,.05,.25,1)' });
    // عند تجاوز اللسان 90° ينتقل خلف البطاقة — لا تظهر البطاقة فوق الطيات قبل أوانها
    later(function () { flap.classList.add('is-under'); }, 650 + 1650 * 0.52);

    // يتلاشى العنوان والتاريخ قبل أن يرتفع اللسان المفتوح فوقهما (شفافية فقط)
    animate(head, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, delay: 750, easing: 'ease' });

    // 1.8 → 4.2s: البطاقة ترتفع ببطء من داخل الظرف
    animate(card, [
      { transform: 'translateY(0)' },
      { transform: 'translateY(' + (-rise).toFixed(1) + 'px)' }
    ], { duration: 2400, delay: 1800, easing: 'cubic-bezier(.33,.0,.2,1)' });

    // 4.2 → 4.9s: يذوب مشهد الظرف في الورق، ثم 4.9 → 5.6s تظهر الدعوة من خلفه
    later(function () {
      gate.style.pointerEvents = 'none';
      animate(gateInner, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-in' });
      animate(wash, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-in' });
    }, 4200);
    later(function () {
      root.classList.add('show-invite');        // تُجهَّز الدعوة خلف الورق دون قفزة في الموضع
      scrollTop();
      startReveal();
      animate(gate, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });
    }, 4900);

    // 5.6s: انتهاء المشهد، التمرير متاح، والتركيز على الدعوة
    later(finish, 5600);
  }

  function openReduced() {
    root.classList.add('show-invite');
    scrollTop();
    startReveal();
    gate.style.pointerEvents = 'none';
    animate(gate, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'linear' });
    later(finish, 320);
  }

  function finish() {
    state = 'open';
    root.classList.add('gate-done');
    anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    anims = [];
    scrollTop();
    try { invite.focus({ preventScroll: true }); } catch (e) { invite.focus(); }
  }

  // ---------- إعادة فتح الدعوة ----------
  function reset() {
    timers.forEach(clearTimeout); timers = [];
    anims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); anims = [];
    stopReveal();
    root.classList.remove('show-invite', 'gate-done');
    scrollTop();
    flap.classList.remove('is-under');
    gate.style.pointerEvents = '';
    hint.textContent = cfg.texts.gateHint;
    btn.removeAttribute('aria-disabled');
    state = 'closed';
    btn.focus({ preventScroll: true });
  }

  // ---------- ظهور الأقسام بالشفافية فقط ----------
  var io = null;
  var sections = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  function startReveal() {
    if (!('IntersectionObserver' in window)) {
      sections.forEach(function (s) { s.classList.add('is-in'); });
      return;
    }
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    sections.forEach(function (s) { io.observe(s); });
  }
  function stopReveal() {
    if (io) { io.disconnect(); io = null; }
    sections.forEach(function (s) { s.classList.remove('is-in'); });
  }

  // ---------- العد التنازلي (لحظة واحدة لكل الضيوف بالتوقيت العالمي) ----------
  var target = Date.parse(cfg.startUTC);
  var countTitle = $('countTitle');
  var units = ['d', 'h', 'm', 's'].map(function (u) {
    return { el: document.querySelector('.num[data-u="' + u + '"]'), sr: document.querySelector('[data-sr="' + u + '"]'), last: '' };
  });
  var labels = cfg.texts.units;
  var tickTimer = null, done = false;

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function paint(u, str, label) {
    if (u.last === str) return;
    var cells = u.el.children;
    if (cells.length !== str.length) {
      u.el.innerHTML = '';
      for (var i = 0; i < str.length; i++) {
        var c = document.createElement('span'); c.className = 'd'; u.el.appendChild(c);
      }
      cells = u.el.children;
    }
    for (var j = 0; j < str.length; j++) {
      if (cells[j].textContent !== str[j]) cells[j].textContent = str[j];
    }
    u.sr.textContent = parseInt(str, 10) + ' ' + label;
    u.last = str;
  }
  function tick() {
    clearTimeout(tickTimer);
    var diff = Math.max(0, target - Date.now());
    var s = Math.floor(diff / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    paint(units[0], pad(d), labels[0]);
    paint(units[1], pad(h), labels[1]);
    paint(units[2], pad(m), labels[2]);
    paint(units[3], pad(s), labels[3]);
    if (diff <= 0) {
      if (!done) { done = true; countTitle.textContent = cfg.texts.countdownDone; }
      return;                                   // تتوقف الأرقام عند الصفر
    }
    if (done) { done = false; countTitle.textContent = cfg.texts.countdownTitle; }
    tickTimer = setTimeout(tick, 1000 - (Date.now() % 1000) + 20);   // محاذاة مع بداية كل ثانية
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  window.addEventListener('pageshow', function (e) {
    tick();
    if (e.persisted && state !== 'closed') reset();   // الرجوع من الذاكرة المؤقتة يعيد الظرف مغلقًا
  });
  window.addEventListener('focus', tick);

  // ---------- الربط ----------
  btn.addEventListener('click', open);
  replayBtn.addEventListener('click', reset);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  tick();
})();
