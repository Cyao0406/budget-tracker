// 最小化單元測試：不用任何測試框架，直接 import 真正的原始碼（utils.js / csv.js / logic.js），
// 對純函式的輸出做斷言。用 `npm test` 或 `node test/run.mjs` 執行。
// 只測「不碰 DOM/state/Firebase」的純邏輯——這正是這次從 app.js 拆出 utils.js/csv.js/logic.js
// 的目的，讓這些邏輯能脫離瀏覽器環境單獨驗證。
import assert from 'node:assert/strict';
import {
  uid, debounce, pad2, toKey, fromKey, addDays, addMonths, addYears,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  isSameDay, formatMoney, shortDate, formatTime, escapeHtml
} from '../utils.js';
import {
  parseCsvText, isBlankRow, nextColorVarIn, findOrCreateCategoryByNameIn,
  normalizeImportDate, isValidImportAmount, stageOwnFormatCsv, stageMoneyNoteCsv, stageImportCsv
} from '../csv.js';
import {
  parseQuickInput, guessCategoryIn, getRangeFor, sortRecs,
  reportFilteredRecordsIn, hasActiveSearchFiltersIn, calendarFilteredRecordsIn
} from '../logic.js';

var passed = 0, failed = 0;
// fn 可以是同步函式，也可以回傳一個 Promise（非同步測試，例如 debounce 這種要等時間過去才能斷言的）。
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (e) {
    failed++;
    console.error('FAIL: ' + name);
    console.error('  ' + e.message);
  }
}

// ---------- utils.js ----------
await test('pad2 補零', function () {
  assert.equal(pad2(3), '03');
  assert.equal(pad2(12), '12');
});
await test('toKey / fromKey 互為反函式', function () {
  var d = new Date(2026, 1, 5); // 2026-02-05
  assert.equal(toKey(d), '2026-02-05');
  var back = fromKey('2026-02-05');
  assert.equal(back.getFullYear(), 2026);
  assert.equal(back.getMonth(), 1);
  assert.equal(back.getDate(), 5);
});
await test('addDays / addMonths / addYears', function () {
  var d = new Date(2026, 0, 31); // 2026-01-31
  assert.equal(toKey(addDays(d, 1)), '2026-02-01');
  var m = new Date(2026, 0, 15);
  assert.equal(toKey(addMonths(m, 1)), '2026-02-15');
  var y = new Date(2026, 5, 1);
  assert.equal(toKey(addYears(y, -1)), '2025-06-01');
});
await test('startOfWeek / endOfWeek 涵蓋整個星期', function () {
  var wed = new Date(2026, 7, 12); // 2026-08-12 是週三
  assert.equal(startOfWeek(wed).getDay(), 0);
  assert.equal(endOfWeek(wed).getDay(), 6);
});
await test('startOfMonth / endOfMonth', function () {
  var d = new Date(2026, 1, 15); // 2026-02-15，2026 是平年
  assert.equal(toKey(startOfMonth(d)), '2026-02-01');
  assert.equal(toKey(endOfMonth(d)), '2026-02-28');
});
await test('startOfYear / endOfYear', function () {
  var d = new Date(2026, 5, 15);
  assert.equal(toKey(startOfYear(d)), '2026-01-01');
  assert.equal(toKey(endOfYear(d)), '2026-12-31');
});
await test('isSameDay', function () {
  assert.equal(isSameDay(new Date(2026, 0, 1, 8, 0), new Date(2026, 0, 1, 23, 0)), true);
  assert.equal(isSameDay(new Date(2026, 0, 1), new Date(2026, 0, 2)), false);
});
await test('formatMoney 千分位與正負號', function () {
  assert.equal(formatMoney(1234), '$1,234');
  assert.equal(formatMoney(-1234), '-$1,234');
  assert.equal(formatMoney(0), '$0');
});
await test('shortDate / formatTime', function () {
  assert.equal(shortDate(new Date(2026, 7, 5)), '08/05');
  assert.equal(formatTime(new Date(2026, 0, 1, 8, 5).getTime()), '08:05');
  assert.equal(formatTime(0), '');
});
await test('escapeHtml 防 XSS', function () {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("it's ok"), 'it&#39;s ok');
});
await test('uid 每次呼叫都不一樣', function () {
  var a = uid(), b = uid();
  assert.notEqual(a, b);
  assert.equal(typeof a, 'string');
});
await test('debounce 只有最後一次呼叫真的生效', function () {
  return new Promise(function (resolve, reject) {
    var calls = 0;
    var fn = debounce(function () { calls++; }, 20);
    fn(); fn(); fn();
    setTimeout(function () {
      try { assert.equal(calls, 1); resolve(); } catch (e) { reject(e); }
    }, 60);
  });
});

// ---------- csv.js ----------
await test('parseCsvText 基本欄位與換行', function () {
  var rows = parseCsvText('a,b,c\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});
await test('parseCsvText 引號內的逗號跟換行不會被誤判成分隔符', function () {
  var rows = parseCsvText('date,note\n2026-08-01,"hello, world\nsecond line"\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], 'hello, world\nsecond line');
});
await test('parseCsvText 雙引號跳脫（""）', function () {
  var rows = parseCsvText('note\n"she said ""hi"""\n');
  assert.equal(rows[1][0], 'she said "hi"');
});
await test('parseCsvText 支援 CRLF 換行', function () {
  var rows = parseCsvText('a,b\r\n1,2\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});
await test('isBlankRow', function () {
  assert.equal(isBlankRow([]), true);
  assert.equal(isBlankRow(['']), true);
  assert.equal(isBlankRow(['', 'x']), false);
});
await test('normalizeImportDate 接受合法格式', function () {
  assert.equal(normalizeImportDate('2026-08-05'), '2026-08-05');
  assert.equal(normalizeImportDate('2026/8/5'), '2026-08-05');
});
await test('normalizeImportDate 擋掉格式合法但不存在的日期', function () {
  assert.equal(normalizeImportDate('2026-02-30'), null);
  assert.equal(normalizeImportDate('2026-13-01'), null);
});
await test('normalizeImportDate 擋掉亂打的字串', function () {
  assert.equal(normalizeImportDate('not a date'), null);
  assert.equal(normalizeImportDate(''), null);
});
await test('isValidImportAmount 擋 NaN/Infinity/負數', function () {
  assert.equal(isValidImportAmount(100), true);
  assert.equal(isValidImportAmount(0), true);
  assert.equal(isValidImportAmount(NaN), false);
  assert.equal(isValidImportAmount(Infinity), false);
  assert.equal(isValidImportAmount(-1), false);
});
await test('nextColorVarIn 依現有數量輪流分配', function () {
  assert.equal(nextColorVarIn([], 'expense'), '--series-1');
  var cats = [{ type: 'expense' }, { type: 'expense' }];
  assert.equal(nextColorVarIn(cats, 'expense'), '--series-3');
});
await test('findOrCreateCategoryByNameIn 同名分類不會重複建立', function () {
  var cats = [{ id: 'x1', type: 'expense', name: '餐飲' }];
  var found = findOrCreateCategoryByNameIn(cats, 'expense', '餐飲');
  assert.equal(found.id, 'x1');
  assert.equal(cats.length, 1);
  var created = findOrCreateCategoryByNameIn(cats, 'expense', '交通');
  assert.equal(cats.length, 2);
  assert.equal(created.name, '交通');
});
await test('stageOwnFormatCsv 有效/無效資料正確分類', function () {
  var rows = parseCsvText('date,type,category,amount,note\n2026-08-01,expense,餐飲,100,ok\n2026-02-30,expense,餐飲,50,bad date\nx,expense,餐飲,abc,bad amount\n');
  var cats = [];
  var result = stageOwnFormatCsv(rows, cats);
  assert.equal(result.recordsToAdd.length, 1);
  assert.equal(result.errorCount, 2);
  assert.equal(result.recordsToAdd[0].amount, 100);
});
await test('stageOwnFormatCsv 解開匯出時加的公式注入防護單引號', function () {
  // exportCsv 為了防公式注入，欄位開頭是 =/+/-/@ 時會加一個單引號前綴。匯入要能把這個
  // 單引號解開，不然自己匯出的備份再匯入回來，備註/分類名稱就會永久多一個引號。
  var rows = parseCsvText("date,type,category,amount,note\n2026-08-01,expense,餐飲,100,\"'=SUM(A1:A10)\"\n2026-08-02,expense,'開頭本來就有引號,50,note\n");
  var cats = [];
  var result = stageOwnFormatCsv(rows, cats);
  assert.equal(result.recordsToAdd.length, 2);
  assert.equal(result.recordsToAdd[0].note, '=SUM(A1:A10)', '引號+公式字元開頭要被解開');
  assert.equal(cats.find(function (c) { return c.id === result.recordsToAdd[1].categoryId; }).name, "'開頭本來就有引號", '引號後面不是公式字元就不該被動到');
});
await test('stageMoneyNoteCsv 分類對照與收支類型判斷', function () {
  var rows = parseCsvText('#CATEGORIES\nheader\n1,飲食費,,,0\n#DAILY_DATAS\nheader\n2026-08-01,150,午餐,1,0,2026-08-01T12:00:00\n');
  var cats = [];
  var result = stageMoneyNoteCsv(rows, cats);
  assert.equal(result.recordsToAdd.length, 1);
  assert.equal(result.recordsToAdd[0].type, 'expense');
  // 飲食費照 MONEYNOTE_MERGE_MAP 應該合併成「餐飲」
  var cat = cats.find(function (c) { return c.id === result.recordsToAdd[0].categoryId; });
  assert.equal(cat.name, '餐飲');
});
await test('stageImportCsv 不會動到傳進去的原始分類陣列', function () {
  var originalCats = [{ id: 'x1', type: 'expense', name: '餐飲', keywords: [] }];
  var csvText = 'date,type,category,amount,note\n2026-08-01,expense,新分類,100,test\n';
  var staged = stageImportCsv(csvText, originalCats);
  assert.equal(originalCats.length, 1, '原始分類陣列不該被直接修改');
  assert.equal(staged.workingCategories.length, 2, '暫存的分類清單應該多一個新分類');
  assert.equal(staged.newCategoryCount, 1);
});
await test('stageImportCsv 自動偵測 MoneyNote 格式', function () {
  var csvText = '#CATEGORIES\nheader\n1,交通費,,,0\n#DAILY_DATAS\nheader\n2026-08-01,60,公車,1,0,2026-08-01T08:00:00\n';
  var staged = stageImportCsv(csvText, []);
  assert.equal(staged.format, 'moneynote');
});

// ---------- logic.js（原本 app.js 裡的核心記帳規則，2026-08-18 拆出來補測試） ----------
await test('parseQuickInput 抓最後一個數字當金額，其餘當備註', function () {
  var r = parseQuickInput('早餐 全家 150');
  assert.equal(r.amount, 150);
  assert.equal(r.note, '早餐 全家');
});
await test('parseQuickInput 金額可以帶逗號/元/小數', function () {
  assert.equal(parseQuickInput('房租 1,200元').amount, 1200);
  assert.equal(parseQuickInput('房租 1,200元').note, '房租');
  assert.equal(parseQuickInput('咖啡 65.5').amount, 65.5);
});
await test('parseQuickInput 沒有數字就沒有金額，全部當備註', function () {
  var r = parseQuickInput('只有文字沒有金額');
  assert.equal(r.amount, null);
  assert.equal(r.note, '只有文字沒有金額');
});
await test('parseQuickInput 空字串', function () {
  assert.deepEqual(parseQuickInput(''), { amount: null, note: '' });
  assert.deepEqual(parseQuickInput('   '), { amount: null, note: '' });
});

await test('guessCategoryIn 關鍵字比對命中（不分大小寫）', function () {
  var cats = [
    { id: 'c1', fallback: false, keywords: ['早餐', '午餐'] },
    { id: 'c2', fallback: false, keywords: ['netflix', 'spotify'] },
    { id: 'c3', fallback: true, keywords: [] }
  ];
  assert.equal(guessCategoryIn('全家 早餐 150', cats).id, 'c1');
  assert.equal(guessCategoryIn('Netflix 訂閱', cats).id, 'c2', '關鍵字比對要不分大小寫');
});
await test('guessCategoryIn 都沒命中就回傳 fallback 分類，不管它排在陣列哪個位置', function () {
  var cats = [
    { id: 'c1', fallback: false, keywords: ['早餐'] },
    { id: 'c2', fallback: true, keywords: [] },
    { id: 'c3', fallback: false, keywords: ['晚餐'] }
  ];
  assert.equal(guessCategoryIn('完全比對不到的備註', cats).id, 'c2');
});
await test('guessCategoryIn 跳過 fallback 分類本身的關鍵字比對', function () {
  // fallback 分類理論上 keywords 應該是空陣列，但就算不小心填了關鍵字，
  // 也該被當成最後手段而不是優先命中——這裡確認迴圈確實用 continue 跳過它。
  var cats = [
    { id: 'c1', fallback: true, keywords: ['其他'] },
    { id: 'c2', fallback: false, keywords: ['早餐'] }
  ];
  assert.equal(guessCategoryIn('早餐 150', cats).id, 'c2');
});

await test('getRangeFor 月報表回傳當月第一天到最後一天', function () {
  var range = getRangeFor(new Date(2026, 1, 15), 'month'); // 2026-02，平年28天
  assert.equal(toKey(range[0]), '2026-02-01');
  assert.equal(toKey(range[1]), '2026-02-28');
});
await test('getRangeFor 年報表回傳當年1/1到12/31', function () {
  var range = getRangeFor(new Date(2026, 5, 1), 'year');
  assert.equal(toKey(range[0]), '2026-01-01');
  assert.equal(toKey(range[1]), '2026-12-31');
});

await test('sortRecs 依日期新到舊，同一天依 createdAt 新到舊', function () {
  var recs = [
    { id: 'a', date: '2026-01-01', createdAt: 100 },
    { id: 'b', date: '2026-01-02', createdAt: 200 },
    { id: 'c', date: '2026-01-01', createdAt: 300 }
  ];
  var sorted = sortRecs(recs).map(function (r) { return r.id; });
  assert.deepEqual(sorted, ['b', 'c', 'a']);
});
await test('reportFilteredRecordsIn 依 range 篩選並依日期新到舊排序', function () {
  var records = [
    { id: 'r1', date: '2026-01-15', amount: 100, createdAt: 1 },
    { id: 'r2', date: '2026-02-10', amount: 200, createdAt: 1 },
    { id: 'r3', date: '2026-02-20', amount: 300, createdAt: 1 }
  ];
  var range = getRangeFor(new Date(2026, 1, 1), 'month'); // 2026-02
  var result = reportFilteredRecordsIn(records, range);
  assert.deepEqual(result.map(function (r) { return r.id; }), ['r3', 'r2'], '1月的紀錄要被篩掉，2月的依日期新到舊排序');
});

await test('hasActiveSearchFiltersIn', function () {
  var empty = { amountMin: null, amountMax: null, dateFrom: null, dateTo: null };
  assert.equal(hasActiveSearchFiltersIn('', empty), false);
  assert.equal(hasActiveSearchFiltersIn('  ', empty), false, '純空白不算有效搜尋字串');
  assert.equal(hasActiveSearchFiltersIn('早餐', empty), true);
  assert.equal(hasActiveSearchFiltersIn('', Object.assign({}, empty, { amountMin: 100 })), true);
});
await test('calendarFilteredRecordsIn 沒有搜尋條件時依瀏覽月份+選中的天篩選', function () {
  var records = [
    { id: 'r1', date: '2026-02-05', categoryId: 'c1', amount: 100, note: '早餐', createdAt: 1 },
    { id: 'r2', date: '2026-02-05', categoryId: 'c1', amount: 200, note: '午餐', createdAt: 2 },
    { id: 'r3', date: '2026-03-01', categoryId: 'c1', amount: 300, note: '晚餐', createdAt: 3 }
  ];
  var cats = [{ id: 'c1', name: '餐飲' }];
  var emptyFilters = { amountMin: null, amountMax: null, dateFrom: null, dateTo: null };
  var byMonth = calendarFilteredRecordsIn(records, cats, { query: '', filters: emptyFilters, month: new Date(2026, 1, 1), selectedDay: null });
  assert.deepEqual(byMonth.map(function (r) { return r.id; }), ['r2', 'r1'], '只留2月的紀錄，同一天內依 createdAt 新到舊排序');
  var byDay = calendarFilteredRecordsIn(records, cats, { query: '', filters: emptyFilters, month: new Date(2026, 1, 1), selectedDay: '2026-02-05' });
  assert.equal(byDay.length, 2);
});
await test('calendarFilteredRecordsIn 有搜尋字串時忽略月份範圍，比對分類名/備註/金額', function () {
  var records = [
    { id: 'r1', date: '2026-01-01', categoryId: 'c1', amount: 100, note: '早餐', createdAt: 1 },
    { id: 'r2', date: '2026-06-01', categoryId: 'c2', amount: 999, note: '', createdAt: 1 }
  ];
  var cats = [{ id: 'c1', name: '餐飲' }, { id: 'c2', name: '交通' }];
  var emptyFilters = { amountMin: null, amountMax: null, dateFrom: null, dateTo: null };
  var result = calendarFilteredRecordsIn(records, cats, { query: '餐飲', filters: emptyFilters, month: new Date(2026, 1, 1), selectedDay: null });
  assert.deepEqual(result.map(function (r) { return r.id; }), ['r1'], '跨月份也要找得到，用分類名稱比對命中');
});
await test('calendarFilteredRecordsIn 金額區間篩選', function () {
  var records = [
    { id: 'r1', date: '2026-02-01', categoryId: 'c1', amount: 50, note: '', createdAt: 1 },
    { id: 'r2', date: '2026-02-02', categoryId: 'c1', amount: 500, note: '', createdAt: 1 }
  ];
  var cats = [{ id: 'c1', name: '餐飲' }];
  var result = calendarFilteredRecordsIn(records, cats, {
    query: '', filters: { amountMin: 100, amountMax: null, dateFrom: null, dateTo: null }, month: new Date(2026, 1, 1), selectedDay: null
  });
  assert.deepEqual(result.map(function (r) { return r.id; }), ['r2']);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
