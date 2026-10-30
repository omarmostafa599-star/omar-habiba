/* لوحة الدعوة — قراءة فقط لصاحب الدعوة */
(function () {
  'use strict';
  var cfg = JSON.parse(document.getElementById('admin-config').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var ADMIN = String(cfg.adminEmail || '').toLowerCase();
  var VERS = Object.keys(cfg.versions);           // ['front','back']
  var data = { events: [], rsvps: [], wishes: [] };
  var dataset = 'real', rsvpFilter = 'all', wishFilter = 'all';
  var signed = {};                                 // مسار → رابط مؤقت
  var refreshTimer = null, sb = null, entered = false;

  function show(id, on) { $(id).hidden = !on; }
  function fatal(text) { var f = $('fatal'); f.textContent = text; f.hidden = false; }
  var dtf = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
  function fmt(ts) { try { return dtf.format(new Date(ts)); } catch (e) { return ts; } }
  var dts = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' });
  function fmtShort(ts) { try { return dts.format(new Date(ts)); } catch (e) { return ts; } }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[^؀-ۿa-z0-9]+/g, '');
  }
  function verLabel(v) { return cfg.versions[v] || v; }

  if (!cfg.backend) { show('notConfigured', true); return; }

  function boot() {
    if (!window.supabase || !window.supabase.createClient) { fatal('تعذّر تحميل مكتبة الاتصال. تحقّق من الإنترنت ثم أعد تحميل الصفحة.'); return; }
    sb = window.supabase.createClient(cfg.backend.url, cfg.backend.key, {
      auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    sb.auth.onAuthStateChange(function (_ev, session) { session ? enter(session) : showLogin(); });
    sb.auth.getSession().then(function (r) { r.data.session ? enter(r.data.session) : showLogin(); });
  }

  function showLogin() {
    entered = false; clearInterval(refreshTimer);
    show('dash', false); show('topActions', false); show('loginPanel', true);
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('loginEmail').value.trim().toLowerCase();
    var msg = $('loginMsg'); msg.className = 'msg';
    if (email !== ADMIN) { msg.className = 'msg err'; msg.textContent = 'هذا البريد غير مصرّح له بالدخول.'; return; }
    $('loginBtn').disabled = true; msg.textContent = 'جارٍ الإرسال…';
    sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: cfg.redirect || location.href.split('#')[0].split('?')[0] } })
      .then(function (r) {
        if (r.error) throw r.error;
        msg.textContent = 'أرسلنا رابط الدخول إلى بريدك. افتحه لإكمال الدخول.';
      })
      .catch(function (err) {
        msg.className = 'msg err';
        msg.textContent = /rate|seconds/i.test(err && err.message || '') ? 'طلبات كثيرة. انتظر دقيقة ثم حاول مجددًا.' : 'تعذّر إرسال الرابط. حاول مرة أخرى.';
      })
      .then(function () { $('loginBtn').disabled = false; });
  });

  function enter(session) {
    var email = String(session.user && session.user.email || '').toLowerCase();
    if (email !== ADMIN) { fatal('هذا الحساب غير مصرّح له.'); sb.auth.signOut(); return; }
    if (entered) return;
    entered = true;
    if (location.hash && /access_token/.test(location.hash)) history.replaceState(null, '', location.pathname);
    $('who').textContent = email;
    show('loginPanel', false); show('topActions', true); show('dash', true);
    load();
    clearInterval(refreshTimer); refreshTimer = setInterval(load, 60000);
  }

  $('logoutBtn').addEventListener('click', function () { sb.auth.signOut(); });
  $('refreshBtn').addEventListener('click', load);

  function fetchAll(table, cols) {
    var out = [], step = 1000;
    function page(from) {
      return sb.from(table).select(cols).order('created_at', { ascending: false }).range(from, from + step - 1).then(function (r) {
        if (r.error) throw r.error;
        out = out.concat(r.data || []);
        return (r.data || []).length === step ? page(from + step) : out;
      });
    }
    return page(0);
  }

  function load() {
    $('refreshBtn').disabled = true;
    Promise.all([
      fetchAll('invite_events', 'created_at,version,kind,device,is_test'),
      fetchAll('invite_rsvps', 'id,created_at,version,name,attending,device,is_test'),
      fetchAll('invite_wishes', 'id,created_at,version,name,message,audio_path,audio_seconds,audio_bytes,video_path,video_seconds,video_bytes,device,is_test')
    ]).then(function (r) {
      data.events = r[0]; data.rsvps = r[1]; data.wishes = r[2];
      $('updatedAt').textContent = 'آخر تحديث: ' + fmt(Date.now());
      render();
    }).catch(function (err) {
      fatal('تعذّر تحميل البيانات: ' + (err && err.message || 'خطأ غير معروف'));
    }).then(function () { $('refreshBtn').disabled = false; });
  }

  function pick(list) { var t = dataset === 'test'; return list.filter(function (x) { return !!x.is_test === t; }); }

  // ---------- الأرقام لكل نسخة + الإجمالي ----------
  function renderStats() {
    var ev = pick(data.events), rs = pick(data.rsvps), ws = pick(data.wishes);
    function by(v, list) { return v === 'all' ? list : list.filter(function (x) { return x.version === v; }); }
    function uniq(list) { var s = {}; list.forEach(function (x) { if (x.device) s[x.device] = 1; }); return Object.keys(s).length; }
    function latestYes(list, wantYes) {
      var last = {};
      list.forEach(function (x) { var k = norm(x.name); if (!last[k] || last[k].created_at < x.created_at) last[k] = x; });
      return Object.keys(last).filter(function (k) { return !!last[k].attending === wantYes; }).length;
    }
    var rows = [
      ['زيارات الصفحة', function (v) { return by(v, ev).filter(function (x) { return x.kind === 'visit'; }).length; }],
      ['أجهزة مختلفة زارت', function (v) { return uniq(by(v, ev).filter(function (x) { return x.kind === 'visit'; })); }],
      ['فتح الظرف', function (v) { return by(v, ev).filter(function (x) { return x.kind === 'open'; }).length; }, true],
      ['أجهزة مختلفة فتحت الظرف', function (v) { return uniq(by(v, ev).filter(function (x) { return x.kind === 'open'; })); }],
      ['سيحضرون', function (v) { return by(v, rs).filter(function (x) { return x.attending; }).length; }, true],
      ['سيحضرون (بعد حذف الأسماء المكررة)', function (v) { return latestYes(by(v, rs), true); }],
      ['اعتذروا', function (v) { return by(v, rs).filter(function (x) { return !x.attending; }).length; }],
      ['المباركات', function (v) { return by(v, ws).length; }, true],
      ['منها تسجيلات صوتية', function (v) { return by(v, ws).filter(function (x) { return x.audio_path; }).length; }],
      ['منها فيديوهات', function (v) { return by(v, ws).filter(function (x) { return x.video_path; }).length; }]
    ];
    var t = $('statsTable'); t.textContent = '';
    var thead = el('thead'), hr = el('tr');
    hr.appendChild(el('th', '', 'البند'));
    VERS.forEach(function (v) { hr.appendChild(el('th', 'n', 'النسخة ' + verLabel(v))); });
    hr.appendChild(el('th', 'n', 'الإجمالي'));
    thead.appendChild(hr); t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (row) {
      var tr = el('tr', row[2] ? 'hl' : '');
      tr.appendChild(el('td', '', row[0]));
      VERS.forEach(function (v) { tr.appendChild(el('td', 'n', String(row[1](v)))); });
      tr.appendChild(el('td', 'n total', String(row[1]('all'))));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    // المساحة المستخدمة (كل البيانات بما فيها التجربة)
    var used = 0; data.wishes.forEach(function (x) { used += (x.audio_bytes || 0) + (x.video_bytes || 0); });
    var LIMIT = 1024 * 1024 * 1024, pct = used / LIMIT * 100;
    var u = $('usage');
    u.textContent = 'المساحة المستخدمة للتسجيلات والفيديوهات: ' + (used / 1048576).toFixed(1) + ' ميجا من 1024 ميجا (' + pct.toFixed(1) + '%)';
    u.className = 'muted small' + (pct >= 85 ? ' warn' : '');
    if (pct >= 85) u.textContent += ' — اقتربت المساحة من الامتلاء، نزّل الذكرى وفكّر في إيقاف الفيديو.';
  }

  // ---------- تأكيد الحضور ----------
  function renderRsvps() {
    var rs = pick(data.rsvps);
    var counts = {}, devs = {};
    rs.forEach(function (x) { var k = norm(x.name); counts[k] = (counts[k] || 0) + 1; });
    var list = rs.filter(function (x) { return rsvpFilter === 'all' || (rsvpFilter === 'yes') === !!x.attending; });
    var t = $('rsvpTable'); t.textContent = '';
    if (!list.length) { var tr0 = el('tr'), td0 = el('td', 'empty', 'لا توجد ردود بعد'); td0.colSpan = 5; tr0.appendChild(td0); t.appendChild(tr0); return; }
    var hr = el('tr');
    ['#', 'الاسم', 'الرد', 'النسخة', 'الوقت'].forEach(function (h) { hr.appendChild(el('th', '', h)); });
    var thead = el('thead'); thead.appendChild(hr); t.appendChild(thead);
    var tb = el('tbody');
    list.forEach(function (x, i) {
      var tr = el('tr');
      tr.appendChild(el('td', 'num-ltr', String(i + 1)));
      var nameTd = el('td'); nameTd.appendChild(el('span', '', x.name));
      if (counts[norm(x.name)] > 1) { nameTd.appendChild(document.createTextNode(' ')); nameTd.appendChild(el('span', 'chip dup', 'اسم مكرر')); }
      tr.appendChild(nameTd);
      var resTd = el('td'); resTd.appendChild(el('span', 'chip ' + (x.attending ? 'yes' : 'no'), x.attending ? 'سيحضر' : 'اعتذر')); tr.appendChild(resTd);
      tr.appendChild(el('td', '', verLabel(x.version)));
      tr.appendChild(el('td', 'wish-meta', fmtShort(x.created_at)));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }

  // ---------- المباركات ----------
  function getSigned(path, bucket) {
    var key = (bucket || cfg.bucket) + ':' + path;
    if (signed[key] && signed[key].exp > Date.now()) return Promise.resolve(signed[key].url);
    return sb.storage.from(bucket || cfg.bucket).createSignedUrl(path, 3600).then(function (r) {
      if (r.error) throw r.error;
      signed[key] = { url: r.data.signedUrl, exp: Date.now() + 3300 * 1000 };
      return r.data.signedUrl;
    });
  }
  function renderWishes() {
    var ws = pick(data.wishes).filter(function (x) {
      if (wishFilter === 'voice') return !!x.audio_path;
      if (wishFilter === 'video') return !!x.video_path;
      if (wishFilter === 'text') return !x.audio_path && !x.video_path;
      return true;
    });
    var box = $('wishList'); box.textContent = '';
    if (!ws.length) { box.appendChild(el('p', 'empty', 'لا توجد مباركات بعد')); return; }
    ws.forEach(function (x) {
      var c = el('article', 'wish');
      var h = el('div', 'wish-head');
      h.appendChild(el('span', 'wish-name', x.name));
      h.appendChild(el('span', 'chip', 'النسخة ' + verLabel(x.version)));
      var mmss = function (n) { n = n || 0; return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
      if (x.audio_path) h.appendChild(el('span', 'chip', 'صوت · ' + mmss(x.audio_seconds)));
      if (x.video_path) h.appendChild(el('span', 'chip', 'فيديو · ' + mmss(x.video_seconds)));
      h.appendChild(el('span', 'wish-meta', fmt(x.created_at)));
      c.appendChild(h);
      if (x.message) c.appendChild(el('p', 'wish-text', x.message));
      if (x.audio_path) {
        var b = el('button', 'btn', 'تشغيل التسجيل'); b.type = 'button';
        b.addEventListener('click', function () {
          b.disabled = true; b.textContent = 'جارٍ التحميل…';
          getSigned(x.audio_path).then(function (url) {
            var a = document.createElement('audio'); a.controls = true; a.preload = 'auto'; a.src = url;
            b.replaceWith(a); a.play().catch(function () {});
          }).catch(function () { b.disabled = false; b.textContent = 'تعذّر التحميل — حاول مجددًا'; });
        });
        c.appendChild(b);
      }
      if (x.video_path) {
        var vb = el('button', 'btn', 'تشغيل الفيديو'); vb.type = 'button';
        vb.addEventListener('click', function () {
          vb.disabled = true; vb.textContent = 'جارٍ التحميل…';
          getSigned(x.video_path, cfg.videoBucket).then(function (url) {
            var vd = document.createElement('video'); vd.controls = true; vd.playsInline = true; vd.preload = 'auto'; vd.src = url;
            vb.replaceWith(vd); vd.play().catch(function () {});
          }).catch(function () { vb.disabled = false; vb.textContent = 'تعذّر التحميل — حاول مجددًا'; });
        });
        c.appendChild(vb);
      }
      box.appendChild(c);
    });
  }

  function render() { renderStats(); renderRsvps(); renderWishes(); }

  Array.prototype.forEach.call(document.querySelectorAll('input[name="dataset"]'), function (r) {
    r.addEventListener('change', function () { dataset = r.value; render(); });
  });
  function tabs(id, set) {
    var btns = $(id).querySelectorAll('button');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(btns, function (x) { x.setAttribute('aria-selected', String(x === b)); });
        set(b.getAttribute('data-f')); render();
      });
    });
  }
  tabs('rsvpTabs', function (f) { rsvpFilter = f; });
  tabs('wishTabs', function (f) { wishFilter = f; });

  // ---------- الذكرى: Excel و ZIP ----------
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  $('xlsxBtn').addEventListener('click', function () {
    var msg = $('exportMsg');
    if (!window.XLSX) { msg.textContent = 'تعذّر تحميل مكتبة Excel.'; return; }
    var rs = pick(data.rsvps), ws = pick(data.wishes), ev = pick(data.events);
    var wb = XLSX.utils.book_new();
    var sum = [];
    Array.prototype.forEach.call($('statsTable').querySelectorAll('tbody tr'), function (tr) {
      var c = tr.children, row = { 'البند': c[0].textContent };
      VERS.forEach(function (v, i) { row['النسخة ' + verLabel(v)] = Number(c[i + 1].textContent); });
      row['الإجمالي'] = Number(c[c.length - 1].textContent); sum.push(row);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sum), 'الملخص');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rs.map(function (x) {
      return { 'الاسم': x.name, 'الرد': x.attending ? 'سيحضر' : 'اعتذر', 'النسخة': verLabel(x.version), 'الوقت': fmt(x.created_at) };
    })), 'تأكيد الحضور');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ws.map(function (x) {
      return { 'الاسم': x.name, 'المباركة': x.message || '', 'تسجيل صوتي': x.audio_path ? 'نعم' : 'لا', 'مدة التسجيل (ث)': x.audio_seconds || '', 'فيديو': x.video_path ? 'نعم' : 'لا', 'مدة الفيديو (ث)': x.video_seconds || '', 'النسخة': verLabel(x.version), 'الوقت': fmt(x.created_at) };
    })), 'المباركات');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ev.map(function (x) {
      return { 'النوع': x.kind === 'open' ? 'فتح الظرف' : 'زيارة', 'النسخة': verLabel(x.version), 'الوقت': fmt(x.created_at) };
    })), 'الزيارات');
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.writeFile(wb, 'دعوة-عمر-وحبيبة' + (dataset === 'test' ? '-تجربة' : '') + '.xlsx');
    msg.textContent = 'تم تنزيل ملف Excel.';
  });
  $('zipBtn').addEventListener('click', function () {
    var msg = $('exportMsg'), btn = $('zipBtn');
    if (!window.JSZip) { msg.textContent = 'تعذّر تحميل مكتبة الضغط.'; return; }
    var items = [];
    pick(data.wishes).slice().reverse().forEach(function (x) {
      if (x.audio_path) items.push({ w: x, path: x.audio_path, bucket: cfg.bucket, kind: 'صوت' });
      if (x.video_path) items.push({ w: x, path: x.video_path, bucket: cfg.videoBucket, kind: 'فيديو' });
    });
    if (!items.length) { msg.textContent = 'لا توجد تسجيلات أو فيديوهات بعد.'; return; }
    btn.disabled = true;
    var zip = new JSZip(), index = [], done = 0;
    var safe = function (s) { return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 40) || 'ضيف'; };
    var chain = Promise.resolve();
    items.forEach(function (it, i) {
      chain = chain.then(function () {
        return getSigned(it.path, it.bucket).then(function (url) { return fetch(url); }).then(function (r) { return r.blob(); }).then(function (b) {
          var x = it.w, ext = it.path.split('.').pop();
          var fname = String(i + 1).padStart(3, '0') + ' - ' + it.kind + ' - ' + safe(x.name) + '.' + ext;
          zip.file(fname, b);
          index.push(fname + '\n' + fmt(x.created_at) + ' · النسخة ' + verLabel(x.version) + (x.message ? '\n' + x.message : '') + '\n');
          done++; msg.textContent = 'جارٍ التجهيز… ' + done + ' / ' + items.length;
        });
      });
    });
    chain.then(function () {
      zip.file('فهرس المباركات.txt', '﻿' + index.join('\n'));
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) {
      download(blob, 'مباركات-عمر-وحبيبة' + (dataset === 'test' ? '-تجربة' : '') + '.zip');
      msg.textContent = 'تم تنزيل ' + done + ' ملف.';
    }).catch(function () { msg.textContent = 'تعذّر تجهيز الملف المضغوط. حاول مجددًا.'; })
      .then(function () { btn.disabled = false; });
  });

  if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot);
})();
