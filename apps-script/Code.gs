/**
 * دعوة عمر وحبيبة — استقبال الردود (Google Apps Script)
 * ---------------------------------------------------------------
 * يحفظ: الزيارات وفتح الظرف، وتأكيد الحضور، والمباركات (نص/صوت/فيديو)
 * في Google Sheet، والتسجيلات والفيديوهات في مجلد على Google Drive.
 * الضيف يضيف فقط ولا يستطيع القراءة. البيانات كلها في حسابك وخاصة بك.
 *
 * الإعداد (مرة واحدة):
 *   1) شغّل الدالة setup من المحرر، ووافق على الصلاحيات.
 *   2) Deploy ← New deployment ← Web app
 *      Execute as: Me   ·   Who has access: Anyone
 *   3) انسخ رابط Web app (ينتهي بـ /exec) وضعه في invite.config.json ← backend.endpoint
 */

var VERSIONS = { front: 'الأمامية', back: 'الخلفية' };
var KINDS = { visit: 'زيارة', open: 'فتح الظرف' };
var MIME = {
  'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
  'video/mp4': 'mp4', 'video/webm': 'webm'
};
var MAX_AUDIO_BYTES = 6 * 1024 * 1024;
var MAX_VIDEO_BYTES = 13 * 1024 * 1024;
var MAX_BODY_CHARS = 26 * 1024 * 1024;

var SHEETS = {
  events: { name: 'الزيارات', head: ['الوقت', 'النسخة', 'النوع', 'الجهاز', 'تجربة'] },
  rsvps:  { name: 'الحضور', head: ['الوقت', 'النسخة', 'الاسم', 'الرد', 'الجهاز', 'تجربة'] },
  wishes: { name: 'المباركات', head: ['الوقت', 'النسخة', 'الاسم', 'المباركة', 'التسجيل الصوتي', 'مدة الصوت (ث)', 'الفيديو', 'مدة الفيديو (ث)', 'الحجم (ميجا)', 'الجهاز', 'تجربة'] }
};

// ---------- الإعداد ----------
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = book_(true);
  Object.keys(SHEETS).forEach(function (k) {
    var def = SHEETS[k];
    var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    sh.setRightToLeft(true);
    if (sh.getLastRow() === 0) sh.appendRow(def.head);
    sh.getRange(1, 1, 1, def.head.length).setFontWeight('bold').setBackground('#EFE7D6');
    sh.setFrozenRows(1);
  });
  buildSummary_(ss);
  var def0 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ورقة1');
  if (def0 && ss.getSheets().length > 1) ss.deleteSheet(def0);
  folder_('voices'); folder_('videos');
  Logger.log('الشيت: ' + ss.getUrl());
  Logger.log('مجلد Drive: ' + DriveApp.getFolderById(props.getProperty('ROOT_ID')).getUrl());
}

function buildSummary_(ss) {
  var sh = ss.getSheetByName('الملخص') || ss.insertSheet('الملخص', 0);
  sh.clear(); sh.setRightToLeft(true);
  // كل المدى يبدأ من الصف 2 لتجنّب صف العناوين
  function rng(sheet, col) { return "'" + sheet + "'!" + col + '2:' + col; }
  var E = SHEETS.events.name, R = SHEETS.rsvps.name, W = SHEETS.wishes.name;
  function cnt(sheet, pairs, testCol, v) {
    var args = pairs.map(function (p) { return rng(sheet, p[0]) + ',"' + p[1] + '"'; });
    args.push(rng(sheet, testCol) + ',"<>نعم"');
    if (v) args.push(rng(sheet, 'B') + ',"' + v + '"');
    return '=COUNTIFS(' + args.join(',') + ')';
  }
  function uniq(sheet, valCol, conds, testCol, v) {
    var c = conds.map(function (p) { return rng(sheet, p[0]) + '="' + p[1] + '"'; });
    c.push(rng(sheet, testCol) + '<>"نعم"');
    if (v) c.push(rng(sheet, 'B') + '="' + v + '"');
    return '=IFERROR(COUNTUNIQUE(FILTER(' + rng(sheet, valCol) + ',' + c.join(',') + ')),0)';
  }
  var defs = [
    ['زيارات الصفحة', function (v) { return cnt(E, [['C', 'زيارة']], 'E', v); }],
    ['أجهزة مختلفة زارت', function (v) { return uniq(E, 'D', [['C', 'زيارة']], 'E', v); }],
    ['فتح الظرف', function (v) { return cnt(E, [['C', 'فتح الظرف']], 'E', v); }],
    ['أجهزة مختلفة فتحت الظرف', function (v) { return uniq(E, 'D', [['C', 'فتح الظرف']], 'E', v); }],
    ['سيحضرون', function (v) { return cnt(R, [['D', 'سيحضر']], 'F', v); }],
    ['سيحضرون (بدون تكرار الأسماء)', function (v) {
      var c = [rng(R, 'D') + '="سيحضر"', rng(R, 'F') + '<>"نعم"'];
      if (v) c.push(rng(R, 'B') + '="' + v + '"');
      return '=IFERROR(COUNTUNIQUE(FILTER(TRIM(' + rng(R, 'C') + '),' + c.join(',') + ')),0)';
    }],
    ['اعتذروا', function (v) { return cnt(R, [['D', 'اعتذر']], 'F', v); }],
    ['المباركات', function (v) { return cnt(W, [['C', '?*']], 'K', v); }],
    ['منها تسجيلات صوتية', function (v) { return cnt(W, [['F', '>0']], 'K', v); }],
    ['منها فيديوهات', function (v) { return cnt(W, [['H', '>0']], 'K', v); }]
  ];
  var rows = [['البند', 'النسخة الأمامية', 'النسخة الخلفية', 'الإجمالي']];
  defs.forEach(function (d) { rows.push([d[0], d[1](VERSIONS.front), d[1](VERSIONS.back), d[1](null)]); });
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.getRange(rows.length + 2, 1).setValue('المساحة المستخدمة للتسجيلات والفيديوهات (ميجا)');
  sh.getRange(rows.length + 2, 4).setFormula('=ROUND(SUM(' + rng(W, 'I') + '),1)');
  sh.getRange(rows.length + 3, 1).setValue('الأرقام لا تشمل بيانات التجربة (روابط ?test=1). «أجهزة مختلفة» تقدير لعدد الأشخاص.');
  sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#6D6654').setFontColor('#FBF6EC');
  sh.getRange(2, 2, rows.length - 1, 3).setHorizontalAlignment('center').setFontSize(13);
  sh.getRange(2, 4, rows.length - 1, 1).setFontWeight('bold');
  sh.setColumnWidth(1, 260); sh.setColumnWidths(2, 3, 130);
  sh.setFrozenRows(1);
}

// ---------- أدوات ----------
function book_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!ss && create) ss = SpreadsheetApp.create('دعوة عمر وحبيبة — الردود');
  if (!ss) throw new Error('not_setup');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}
function folder_(kind) {
  var props = PropertiesService.getScriptProperties();
  var rootId = props.getProperty('ROOT_ID'), root;
  if (rootId) root = DriveApp.getFolderById(rootId);
  else { root = DriveApp.createFolder('مباركات عمر وحبيبة'); props.setProperty('ROOT_ID', root.getId()); }
  var key = kind === 'videos' ? 'VIDEOS_ID' : 'VOICES_ID';
  var name = kind === 'videos' ? 'فيديوهات' : 'تسجيلات صوتية';
  var id = props.getProperty(key);
  if (id) return DriveApp.getFolderById(id);
  var f = root.createFolder(name); props.setProperty(key, f.getId());
  return f;
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function clean_(s, max, keepLines) {
  s = String(s == null ? '' : s);
  s = keepLines ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
                : s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ');
  s = s.trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;          // منع تنفيذ المعادلات في الشيت
}
function saveMedia_(m, kind, name, verLabel) {
  if (!m || !m.b64) return null;
  var ext = MIME[m.type];
  if (!ext || (kind === 'videos') !== (m.type.indexOf('video/') === 0)) throw new Error('bad_type');
  var bytes = Utilities.base64Decode(m.b64);
  var max = kind === 'videos' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
  if (!bytes.length || bytes.length > max) throw new Error('bad_size');
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm-ss');
  var fname = stamp + ' - ' + String(name).replace(/[\\\/:*?"<>|']/g, ' ').slice(0, 40) + ' - ' + verLabel + '.' + ext;
  var file = folder_(kind).createFile(Utilities.newBlob(bytes, m.type, fname));
  var secs = Math.max(1, Math.min(kind === 'videos' ? 65 : 125, parseInt(m.secs, 10) || 1));
  return { url: file.getUrl(), secs: secs, bytes: bytes.length };
}
function append_(def, row) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { book_(false).getSheetByName(def.name).appendRow(row); }
  finally { lock.releaseLock(); }
}

// ---------- الاستقبال ----------
function doGet() { return out_({ ok: true, service: 'invite' }); }

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents || '';
    if (!raw || raw.length > MAX_BODY_CHARS) return out_({ ok: false, error: 'size' });
    var d = JSON.parse(raw);
    var verLabel = VERSIONS[d.version];
    if (!verLabel) return out_({ ok: false, error: 'version' });
    var test = d.test === true ? 'نعم' : '';
    var device = /^[a-z0-9]{8,40}$/.test(d.device || '') ? d.device : '';
    var now = new Date();

    if (d.type === 'event') {
      if (!KINDS[d.kind]) return out_({ ok: false, error: 'kind' });
      append_(SHEETS.events, [now, verLabel, KINDS[d.kind], device, test]);
      return out_({ ok: true });
    }

    var name = clean_(d.name, 80, false);
    if (name.replace(/^'/, '').length < 2) return out_({ ok: false, error: 'name' });

    if (d.type === 'rsvp') {
      append_(SHEETS.rsvps, [now, verLabel, name, d.attending === true ? 'سيحضر' : 'اعتذر', device, test]);
      return out_({ ok: true });
    }

    if (d.type === 'wish') {
      var msg = clean_(d.message, 1500, true);
      if (!msg && !(d.audio && d.audio.b64) && !(d.video && d.video.b64)) return out_({ ok: false, error: 'empty' });
      var a = saveMedia_(d.audio, 'voices', name, verLabel);
      var v = saveMedia_(d.video, 'videos', name, verLabel);
      var mb = ((a ? a.bytes : 0) + (v ? v.bytes : 0)) / 1048576;
      append_(SHEETS.wishes, [
        now, verLabel, name, msg,
        a ? '=HYPERLINK("' + a.url + '","استماع")' : '', a ? a.secs : '',
        v ? '=HYPERLINK("' + v.url + '","مشاهدة")' : '', v ? v.secs : '',
        mb ? Math.round(mb * 100) / 100 : '', device, test
      ]);
      return out_({ ok: true });
    }
    return out_({ ok: false, error: 'type' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}
