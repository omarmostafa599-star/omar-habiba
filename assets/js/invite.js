/* دعوة زفاف — فتح الظرف، ظهور الأقسام، العد التنازلي، تأكيد الحضور، المباركات والصوت، العداد */
(function () {
  'use strict';

  var root = document.documentElement;
  var cfg = JSON.parse(document.getElementById('invite-config').textContent);
  var T = cfg.t;
  var $ = function (id) { return document.getElementById(id); };
  var noop = function () {};

  var gate = $('gate'), head = $('gateHead'), hint = $('gateHint');
  var gateInner = gate.querySelector('.gate-inner'), wash = gate.querySelector('.wash');
  var btn = $('openBtn'), env = $('env'), card = $('envCard'), seal = $('seal');
  var doorL = $('doorL'), doorR = $('doorR');
  var invite = $('invite'), replayBtn = $('replayBtn');

  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var state = 'closed';            // closed | opening | open
  var anims = [], timers = [];

  // ---------- أدوات ----------
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function animate(el, frames, opts) {
    if (!el || !el.animate) return null;
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
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
  }
  function store(key, val) { try { if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) {} }
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function rand(n) {
    var s = '', abc = 'abcdefghijklmnopqrstuvwxyz0123456789', buf;
    try { buf = crypto.getRandomValues(new Uint8Array(n)); } catch (e) { buf = null; }
    for (var i = 0; i < n; i++) s += abc[(buf ? buf[i] : Math.floor(Math.random() * 256)) % 36];
    return s;
  }
  function uuid() {
    return rand(8) + '-' + rand(4) + '-' + rand(4) + '-' + rand(12);
  }
  function fmtTime(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60); }

  // ---------- الاتصال بقاعدة البيانات ----------
  var B = cfg.backend;
  var IS_TEST = /(?:^|[?&])test=1(?:&|$)/.test(location.search.slice(1));
  var deviceCache = null;
  function deviceId() {
    if (deviceCache) return deviceCache;
    var d = load('inv.device');
    if (!d || !/^[a-z0-9]{8,40}$/.test(d)) { d = rand(20); store('inv.device', d); }
    return (deviceCache = d);
  }
  function headers(extra) {
    var h = { apikey: B.key, Authorization: 'Bearer ' + B.key };
    for (var k in extra) h[k] = extra[k];
    return h;
  }
  function insert(table, row) {
    row.version = cfg.version; row.device = deviceId(); row.is_test = IS_TEST;
    return fetch(B.url + '/rest/v1/' + table, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(row)
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
  }
  function upload(bucket, path, blob, type, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', B.url + '/storage/v1/object/' + bucket + '/' + path);
      var h = headers({ 'Content-Type': type, 'x-upsert': 'false', 'cache-control': '3600' });
      for (var k in h) x.setRequestHeader(k, h[k]);
      if (onProgress && x.upload) x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = function () { x.status >= 200 && x.status < 300 ? resolve() : reject(new Error('HTTP ' + x.status)); };
      x.onerror = function () { reject(new Error('network')); };
      x.send(blob);
    });
  }
  var openCounted = false;
  function track(kind) { if (B) insert('invite_events', { kind: kind }).catch(noop); }

  // ---------- فتح الظرف (~5.6 ثانية) ----------
  function open() {
    if (state !== 'closed') return;           // منع إعادة التشغيل بالضغط المتكرر
    state = 'opening';
    btn.setAttribute('aria-disabled', 'true');
    swapHint(T.gateHintOpening);
    if (!openCounted) { openCounted = true; track('open'); }

    if (reduceMQ.matches || !env.animate) { openReduced(); return; }

    var er = env.getBoundingClientRect(), cr = card.getBoundingClientRect();
    var rise = Math.max(0, Math.min(er.height * 0.09, cr.top - 14));

    // 0 → 1s: الختم يرتفع ويدور قليلًا ثم يتلاشى
    animate(seal, [
      { transform: 'translateY(0) rotate(0deg) scale(1)', opacity: 1, offset: 0 },
      { transform: 'translateY(-8px) rotate(-10deg) scale(1.05)', opacity: 1, offset: .45 },
      { transform: 'translateY(-14px) rotate(-16deg) scale(1.02)', opacity: 0, offset: 1 }
    ], { duration: 1000, easing: 'cubic-bezier(.35,.1,.25,1)' });

    // 0.65 → 2.3s: الضلفتان تنفتحان من المنتصف نحو الجانبين
    var doorEase = 'cubic-bezier(.45,.05,.25,1)';
    animate(doorR, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(118deg)' }], { duration: 1650, delay: 650, easing: doorEase });
    animate(doorL, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-118deg)' }], { duration: 1650, delay: 720, easing: doorEase });
    later(function () { doorL.classList.add('is-open'); doorR.classList.add('is-open'); }, 650 + 1650 * 0.55);

    // يتلاشى العنوان والتاريخ قبل أن تتقدّم البطاقة (شفافية فقط)
    animate(head, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, delay: 750, easing: 'ease' });

    // 1.8 → 4.2s: البطاقة ترتفع وتتقدّم ببطء من داخل الظرف
    animate(card, [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(' + (-rise).toFixed(1) + 'px) scale(1.06)' }
    ], { duration: 2400, delay: 1800, easing: 'cubic-bezier(.33,0,.2,1)' });

    // 4.2 → 4.9s: يذوب مشهد الظرف، ثم 4.9 → 5.6s تظهر الدعوة
    later(function () {
      gate.style.pointerEvents = 'none';
      animate(gateInner, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-in' });
      animate(wash, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-in' });
    }, 4200);
    later(function () {
      root.classList.add('show-invite');
      scrollTop();
      startReveal();
      animate(gate, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });
    }, 4900);
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
    doorL.classList.remove('is-open'); doorR.classList.remove('is-open');
    gate.style.pointerEvents = '';
    hint.textContent = T.gateHint;
    btn.removeAttribute('aria-disabled');
    state = 'closed';
    try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
  }

  // ---------- ظهور الأقسام بالشفافية فقط ----------
  var io = null;
  var sections = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  function startReveal() {
    if (!('IntersectionObserver' in window)) { sections.forEach(function (s) { s.classList.add('is-in'); }); return; }
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
  var tickTimer = null, done = false;
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function paint(u, str, label) {
    if (u.last === str) return;
    var cells = u.el.children;
    if (cells.length !== str.length) {
      u.el.innerHTML = '';
      for (var i = 0; i < str.length; i++) { var c = document.createElement('span'); c.className = 'd'; u.el.appendChild(c); }
      cells = u.el.children;
    }
    for (var j = 0; j < str.length; j++) if (cells[j].textContent !== str[j]) cells[j].textContent = str[j];
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
    paint(units[0], pad(d), T.units[0]); paint(units[1], pad(h), T.units[1]);
    paint(units[2], pad(m), T.units[2]); paint(units[3], pad(s), T.units[3]);
    if (diff <= 0) { if (!done) { done = true; countTitle.textContent = T.countdownDone; } return; }
    if (done) { done = false; countTitle.textContent = T.countdownTitle; }
    tickTimer = setTimeout(tick, 1000 - (Date.now() % 1000) + 20);
  }

  // ---------- تأكيد الحضور ----------
  function setupRsvp() {
    var sec = $('rsvp'); if (!sec || !B) return;
    var form = $('rsvpForm'), nameIn = $('rsvpName'), msg = $('rsvpMsg');
    var doneBox = $('rsvpDone'), doneText = $('rsvpDoneText'), another = $('rsvpAnother');
    var buttons = form.querySelectorAll('[data-attending]');
    var busy = false;

    function showDone(text) { form.hidden = true; doneBox.hidden = false; doneText.textContent = text; }
    function showForm() { doneBox.hidden = true; form.hidden = false; nameIn.value = ''; msg.textContent = ''; nameIn.focus(); }

    if (load('inv.rsvp')) showDone(T.rsvpAlready);

    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener('click', function () {
        if (busy) return;
        var name = nameIn.value.replace(/\s+/g, ' ').trim();
        var field = nameIn.closest('.field');
        if (name.length < 2) { field.classList.add('is-invalid'); msg.textContent = T.nameRequired; nameIn.focus(); return; }
        field.classList.remove('is-invalid');
        var yes = b.getAttribute('data-attending') === 'yes';
        busy = true; msg.textContent = '';
        Array.prototype.forEach.call(buttons, function (x) { x.setAttribute('aria-busy', 'true'); x.disabled = true; });
        insert('invite_rsvps', { name: name, attending: yes }).then(function () {
          store('inv.rsvp', JSON.stringify({ a: yes ? 1 : 0, t: Date.now() }));
          showDone(yes ? T.rsvpThanksYes : T.rsvpThanksNo);
        }).catch(function () {
          msg.textContent = T.sendError;
        }).then(function () {
          busy = false;
          Array.prototype.forEach.call(buttons, function (x) { x.removeAttribute('aria-busy'); x.disabled = false; });
        });
      });
    });
    nameIn.addEventListener('input', function () { nameIn.closest('.field').classList.remove('is-invalid'); if (msg.textContent === T.nameRequired) msg.textContent = ''; });
    nameIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    another.addEventListener('click', showForm);
  }

  // ---------- مسجّل عام للصوت والفيديو ----------
  function makeRecorder(o) {
    // o: { box, note, timeEl, lenEl, start, stop, play, redo, del, player, live, kind, max, maxBytes, constraints, mimes, noAccess, others }
    var rec = null, stream = null, chunks = [], bytes = 0, t0 = 0, timer = null, clip = null, waiters = [];
    var maxLabel = fmtTime(o.max);
    var supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    function setState(st) { o.box.setAttribute('data-state', st); }
    if (!supported) { setState('unsupported'); o.note.textContent = o.noAccess; }
    function pickMime() {
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
      for (var i = 0; i < o.mimes.length; i++) if (MediaRecorder.isTypeSupported(o.mimes[i])) return o.mimes[i];
      return '';
    }
    function baseType(m) {
      m = (m || '').toLowerCase();
      if (o.kind === 'video') return m.indexOf('webm') > -1 ? { type: 'video/webm', ext: 'webm' } : { type: 'video/mp4', ext: 'mp4' };
      if (m.indexOf('webm') > -1) return { type: 'audio/webm', ext: 'webm' };
      if (m.indexOf('ogg') > -1) return { type: 'audio/ogg', ext: 'ogg' };
      return { type: 'audio/mp4', ext: 'm4a' };
    }
    function stopStream() {
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
      if (o.live) { try { o.live.srcObject = null; } catch (e) {} }
    }
    function clear() {
      if (clip && clip.url) { try { URL.revokeObjectURL(clip.url); } catch (e) {} }
      clip = null; o.player.removeAttribute('src'); try { o.player.load(); } catch (e) {}
      o.play.setAttribute('aria-pressed', 'false');
    }
    function lockOthers(on) { (o.others || []).forEach(function (r) { r.lock(on); }); }
    function start() {
      if (!supported) return;
      o.note.textContent = ''; clear();
      setState('busy'); lockOthers(true);
      navigator.mediaDevices.getUserMedia(o.constraints).then(function (s) {
        stream = s; chunks = []; bytes = 0;
        if (o.live) { o.live.srcObject = s; o.live.play().catch(noop); }
        var mime = pickMime(), opts = { audioBitsPerSecond: 64000 };
        if (o.kind === 'video') opts.videoBitsPerSecond = 700000;
        if (mime) opts.mimeType = mime;
        try { rec = new MediaRecorder(s, opts); } catch (e) { rec = new MediaRecorder(s); }
        var hitLimit = false;
        rec.ondataavailable = function (e) {
          if (e.data && e.data.size) {
            chunks.push(e.data); bytes += e.data.size;
            if (o.maxBytes && bytes >= o.maxBytes * 0.94 && !hitLimit) { hitLimit = true; stop(); }
          }
        };
        rec.onstop = function () {
          clearInterval(timer);
          var secs = Math.max(1, Math.min(o.max, Math.round((Date.now() - t0) / 1000)));
          var bt = baseType(rec.mimeType || mime);
          var blob = new Blob(chunks, { type: bt.type });
          stopStream(); lockOthers(false);
          if (blob.size > 0 && (!o.maxBytes || blob.size <= o.maxBytes)) {
            clip = { blob: blob, secs: secs, type: bt.type, ext: bt.ext, url: URL.createObjectURL(blob) };
            o.player.src = clip.url;
            o.lenEl.textContent = fmtTime(secs);
            setState('ready');
            if (hitLimit && o.limitText) o.note.textContent = o.limitText;
          } else { setState('idle'); o.note.textContent = blob.size > 0 && o.limitText ? o.limitText : o.noAccess; }
          var w = waiters; waiters = []; w.forEach(function (f) { f(); });
        };
        rec.start(1000);
        t0 = Date.now();
        o.timeEl.textContent = '0:00 / ' + maxLabel;
        setState('recording');
        timer = setInterval(function () {
          var el = (Date.now() - t0) / 1000;
          o.timeEl.textContent = fmtTime(Math.min(el, o.max)) + ' / ' + maxLabel;
          if (el >= o.max) stop();
        }, 250);
        try { o.stop.focus({ preventScroll: true }); } catch (e) {}
      }).catch(function () { stopStream(); setState('idle'); lockOthers(false); o.note.textContent = o.noAccess; });
    }
    function stop() {
      return new Promise(function (resolve) {
        if (rec && rec.state !== 'inactive') { waiters.push(resolve); try { rec.stop(); } catch (e) { resolve(); } }
        else resolve();
      });
    }
    o.start.addEventListener('click', start);
    o.stop.addEventListener('click', function () { stop(); });
    o.redo.addEventListener('click', function () { o.player.pause(); start(); });
    o.del.addEventListener('click', function () { o.player.pause(); clear(); o.note.textContent = ''; setState('idle'); });
    o.play.addEventListener('click', function () {
      if (!clip) return;
      if (o.player.paused) { o.player.play().then(function () { o.play.setAttribute('aria-pressed', 'true'); }).catch(noop); }
      else o.player.pause();
    });
    o.player.addEventListener('pause', function () { o.play.setAttribute('aria-pressed', 'false'); });
    o.player.addEventListener('ended', function () { o.play.setAttribute('aria-pressed', 'false'); });
    return {
      get clip() { return clip; },
      recording: function () { return !!(rec && rec.state !== 'inactive'); },
      stop: stop,
      lock: function (on) { if (o.box.getAttribute('data-state') === 'idle' || o.box.getAttribute('data-state') === 'busy') setState(on ? 'busy' : 'idle'); },
      reset: function () { o.player.pause(); clear(); o.note.textContent = supported ? '' : o.noAccess; if (supported) setState('idle'); }
    };
  }

  // ---------- المباركات: نص + صوت + فيديو ----------
  function setupWish() {
    var sec = $('wish'); if (!sec || !B) return;
    var form = $('wishForm'), nameIn = $('wishName'), msgIn = $('wishMessage'), msg = $('wishMsg');
    var sendBtn = $('wishSend'), sendLabel = $('wishSendLabel'), labelText = sendLabel.textContent;
    var doneBox = $('wishDone'), another = $('wishAnother');
    var busy = false;

    var voiceOpts = {
      kind: 'audio', box: $('voice'), note: $('voiceNote'), timeEl: $('recTime'), lenEl: $('recLen'),
      start: $('recStart'), stop: $('recStop'), play: $('recPlay'), redo: $('recRedo'), del: $('recDel'), player: $('recAudio'),
      max: cfg.voiceMax || 120, noAccess: T.voiceNoMic,
      constraints: { audio: { echoCancellation: true, noiseSuppression: true } },
      mimes: ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    };
    var videoOpts = $('video') ? {
      kind: 'video', box: $('video'), note: $('videoNote'), timeEl: $('vidTime'), lenEl: $('vidLen'),
      start: $('vidStart'), stop: $('vidStop'), play: $('vidPlayBtn'), redo: $('vidRedo'), del: $('vidDel'), player: $('vidPlay'), live: $('vidLive'),
      max: cfg.videoMax || 60, maxBytes: cfg.videoMaxBytes, noAccess: T.videoNoCam, limitText: T.videoLimit,
      constraints: { audio: { echoCancellation: true, noiseSuppression: true }, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } },
      mimes: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'],
      others: []
    } : null;
    var voiceR = makeRecorder(voiceOpts);
    var videoR = videoOpts ? makeRecorder(videoOpts) : null;
    // لا تسجيل صوت وفيديو في نفس الوقت
    if (videoR) { voiceOpts.others = [videoR]; videoOpts.others = [voiceR]; }

    function progressLabel(p) { sendLabel.textContent = T.uploading + ' ' + Math.round(p * 100) + '%'; }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var go = function () {
        var name = nameIn.value.replace(/\s+/g, ' ').trim();
        var text = msgIn.value.trim();
        var nf = nameIn.closest('.field');
        var a = voiceR.clip, v = videoR && videoR.clip;
        if (name.length < 2) { nf.classList.add('is-invalid'); msg.textContent = T.nameRequired; nameIn.focus(); return; }
        nf.classList.remove('is-invalid');
        if (!text && !a && !v) { msg.textContent = T.wishRequired; msgIn.focus(); return; }
        busy = true; msg.textContent = '';
        sendBtn.disabled = true; sendBtn.setAttribute('aria-busy', 'true'); sendLabel.textContent = T.sending;
        var aPath = a ? cfg.version + '/' + uuid() + '.' + a.ext : null;
        var vPath = v ? cfg.version + '/' + uuid() + '.' + v.ext : null;
        var total = (a ? a.blob.size : 0) + (v ? v.blob.size : 0), doneBytes = 0;
        Promise.resolve()
          .then(function () { return a ? upload('invite-voices', aPath, a.blob, a.type, function (p) { progressLabel((p * a.blob.size) / total); }).then(function () { doneBytes += a.blob.size; }) : null; })
          .then(function () { return v ? upload('invite-videos', vPath, v.blob, v.type, function (p) { progressLabel((doneBytes + p * v.blob.size) / total); }) : null; })
          .then(function () {
            return insert('invite_wishes', {
              name: name, message: text || null,
              audio_path: aPath, audio_seconds: a ? a.secs : null, audio_bytes: a ? a.blob.size : null,
              video_path: vPath, video_seconds: v ? v.secs : null, video_bytes: v ? v.blob.size : null
            });
          })
          .then(function () {
            form.hidden = true; doneBox.hidden = false;
            nameIn.value = ''; msgIn.value = ''; voiceR.reset(); if (videoR) videoR.reset();
          })
          .catch(function () { msg.textContent = T.sendError; })
          .then(function () { busy = false; sendBtn.disabled = false; sendBtn.removeAttribute('aria-busy'); sendLabel.textContent = labelText; });
      };
      var pending = [];
      if (voiceR.recording()) pending.push(voiceR.stop());
      if (videoR && videoR.recording()) pending.push(videoR.stop());
      Promise.all(pending).then(go);
    });
    nameIn.addEventListener('input', function () { nameIn.closest('.field').classList.remove('is-invalid'); });
    another.addEventListener('click', function () { doneBox.hidden = true; form.hidden = false; msg.textContent = ''; nameIn.focus(); });
  }

  // ---------- الربط ----------
  btn.addEventListener('click', open);
  replayBtn.addEventListener('click', reset);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  window.addEventListener('pageshow', function (e) {
    tick();
    if (e.persisted && state !== 'closed') reset();
  });
  window.addEventListener('focus', tick);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  tick();
  setupRsvp();
  setupWish();
  track('visit');
})();
