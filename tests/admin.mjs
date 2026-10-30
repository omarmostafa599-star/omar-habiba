// اختبار عرض لوحة الإدارة ببيانات وهمية (مكتبة Supabase مستبدلة بنسخة محاكاة).
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8765/';
const SHOT = process.argv[3] || '';
const results = [];
const ok = (n, p, i = '') => { results.push(p); console.log(`${p ? '✓' : '✗'} ${n}${i ? '  — ' + i : ''}`); };

const fake = `
window.supabase = { createClient: function () {
  var now = Date.now(), t = function (m) { return new Date(now - m * 60000).toISOString(); };
  var rows = {
    invite_events: [
      {created_at:t(1),version:'front',kind:'visit',device:'aaaaaaaa1',is_test:false},
      {created_at:t(2),version:'front',kind:'visit',device:'aaaaaaaa1',is_test:false},
      {created_at:t(3),version:'front',kind:'open',device:'aaaaaaaa1',is_test:false},
      {created_at:t(4),version:'back',kind:'visit',device:'bbbbbbbb2',is_test:false},
      {created_at:t(5),version:'back',kind:'visit',device:'cccccccc3',is_test:false},
      {created_at:t(6),version:'back',kind:'open',device:'cccccccc3',is_test:false},
      {created_at:t(7),version:'front',kind:'visit',device:'tttttttt9',is_test:true}
    ],
    invite_rsvps: [
      {id:1,created_at:t(10),version:'front',name:'أحمد محمود',attending:true,device:'aaaaaaaa1',is_test:false},
      {id:2,created_at:t(9),version:'back',name:'احمد  محمود',attending:true,device:'bbbbbbbb2',is_test:false},
      {id:3,created_at:t(8),version:'back',name:'منى',attending:false,device:'cccccccc3',is_test:false},
      {id:4,created_at:t(7),version:'front',name:'<img src=x onerror=alert(1)>',attending:true,device:'dddddddd4',is_test:false}
    ],
    invite_wishes: [
      {id:1,created_at:t(5),version:'front',name:'ليلى',message:'ألف مبروك\\nبارك الله لكما',audio_path:'front/abcdefgh-1.m4a',audio_seconds:75,device:'aaaaaaaa1',is_test:false},
      {id:2,created_at:t(4),version:'back',name:'خالد',message:'مبروك',audio_path:null,audio_seconds:null,device:'bbbbbbbb2',is_test:false}
    ]
  };
  function q(table){ var api={ select:function(){return api;}, order:function(){return api;}, range:function(a,b){ return Promise.resolve({data:rows[table].slice(a,b+1),error:null}); } }; return api; }
  var session = { user: { email: 'omar.mostafa599@gmail.com' } };
  return {
    auth: { onAuthStateChange: function (cb) { setTimeout(function(){ cb('SIGNED_IN', session); }, 0); },
            getSession: function () { return Promise.resolve({ data: { session: session } }); },
            signOut: function(){}, signInWithOtp: function(){ return Promise.resolve({}); } },
    from: q,
    storage: { from: function(){ return { createSignedUrl: function(){ return Promise.resolve({data:{signedUrl:'data:audio/mp4;base64,'},error:null}); } }; } }
  };
} };`;

const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
let dialogs = 0; page.on('dialog', (d) => { dialogs++; d.dismiss(); });
await page.route(/supabase-js/, (r) => r.fulfill({ contentType: 'application/javascript', body: fake }));
await page.route(/(xlsx|jszip)/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
await page.goto(BASE + 'admin/', { waitUntil: 'networkidle' });
await page.waitForSelector('#dash:not([hidden])');
await page.waitForFunction(() => document.querySelectorAll('#statsTable tbody tr').length > 0);
const stats = await page.evaluate(() => [...document.querySelectorAll('#statsTable tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)));
const row = (label) => stats.find((r) => r[0] === label);
ok('الأرقام: زيارات لكل نسخة + الإجمالي', JSON.stringify(row('زيارات الصفحة').slice(1)) === '["2","2","4"]', row('زيارات الصفحة').join(' | '));
ok('الأرقام: أجهزة مختلفة', JSON.stringify(row('أجهزة مختلفة زارت').slice(1)) === '["1","2","3"]');
ok('الأرقام: فتح الظرف', JSON.stringify(row('فتح الظرف').slice(1)) === '["1","1","2"]');
ok('الأرقام: سيحضرون / بعد حذف المكرر / اعتذروا', row('سيحضرون')[3] === '3' && row('سيحضرون (بعد حذف الأسماء المكررة)')[3] === '2' && row('اعتذروا')[3] === '1');
ok('الأرقام: مباركات وتسجيلات', row('المباركات')[3] === '2' && row('منها تسجيلات صوتية')[3] === '1');
ok('بيانات التجربة مستبعدة من الأرقام الحقيقية', row('زيارات الصفحة')[1] === '2');
const dup = await page.locator('#rsvpTable .chip.dup').count();
ok('تعليم الأسماء المكررة (أحمد محمود / احمد  محمود)', dup === 2, String(dup));
const xss = await page.evaluate(() => document.querySelectorAll('#rsvpTable img').length);
ok('أسماء الضيوف تُعرض كنص (لا تنفيذ لأكواد)', xss === 0 && dialogs === 0);
ok('المباركة متعددة الأسطر تظهر كما كُتبت', (await page.textContent('.wish-text')).includes('\n'));
await page.click('#wishTabs [data-f="voice"]');
ok('فلتر «بالصوت»', (await page.locator('.wish').count()) === 1);
await page.click('input[value="test"] + span');
ok('عرض بيانات التجربة', (await page.evaluate(() => document.querySelector('#statsTable tbody tr').children[3].textContent)) === '1');
await page.click('input[value="real"] + span');
await page.click('#wishTabs [data-f="all"]');
const sw = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
ok('لا تمرير أفقي على الموبايل', sw);
if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });
ok('لا أخطاء JavaScript', errs.length === 0, errs.join(' | '));
await b.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} نجح`);
process.exit(results.every(Boolean) ? 0 : 1);
