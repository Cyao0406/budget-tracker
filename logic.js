// 記帳核心規則的純函式版本：快速輸入解析、自動分類、期間計算、紀錄篩選。
// 跟 csv.js 同樣的精神——不碰 state/DOM，資料用參數傳入、結果直接回傳，方便寫單元測試
// （見 test/run.mjs）。app.js 裡同名/相近名稱的函式（guessCategory、getRange、
// reportFilteredRecords、hasActiveSearchFilters、calendarFilteredRecords）是包一層讀
// state 的薄殼，呼叫這裡對應的 xxxIn/xxxFor 版本，呼叫端簽名不變、行為不變，只是把運算
// 本體搬出來讓它可以脫離瀏覽器環境單獨驗證。
import { toKey, startOfMonth, endOfMonth, startOfYear, endOfYear } from './utils.js';

export function parseQuickInput(text) {
  text = (text || '').trim();
  if (!text) return { amount: null, note: '' };
  var tokens = text.split(/\s+/);
  var amount = null, amountIdx = -1;
  for (var i = tokens.length - 1; i >= 0; i--) {
    var t = tokens[i].replace(/[,$元]/g, '');
    if (/^\d+(\.\d+)?$/.test(t)) { amount = parseFloat(t); amountIdx = i; break; }
  }
  var noteTokens = tokens.slice();
  if (amountIdx >= 0) noteTokens.splice(amountIdx, 1);
  return { amount: amount, note: noteTokens.join(' ').trim() };
}

// cats：呼叫端已經用 catsOfType(type) 篩過的同一個 type 分類清單（含 fallback 那筆）。
// 跟原本 app.js 的 guessCategory(note, type) 邏輯完全一致：先比對非 fallback 分類的關鍵字，
// 都沒中才退回這個 type 的 fallback 分類。
export function guessCategoryIn(note, cats) {
  var lower = (note || '').toLowerCase();
  for (var i = 0; i < cats.length; i++) {
    var c = cats[i];
    if (c.fallback) continue;
    for (var j = 0; j < c.keywords.length; j++) {
      var kw = c.keywords[j];
      if (kw && lower.indexOf(kw.toLowerCase()) !== -1) return c;
    }
  }
  return cats.find(function (c) { return c.fallback; }) || cats[cats.length - 1];
}

// 報表頁自己的期間導覽：period 只有 'month'/'year' 兩種（v2.6 拿掉了日/週分頁）。
export function getRangeFor(d, period) {
  if (period === 'year') return [startOfYear(d), endOfYear(d)];
  return [startOfMonth(d), endOfMonth(d)];
}

export function sortRecs(recs) {
  return recs.sort(function (a, b) { return a.date === b.date ? b.createdAt - a.createdAt : (a.date < b.date ? 1 : -1); });
}

// 報表頁用：純粹依 range 篩選，不管搜尋、不管日曆頁選了哪一天。
export function reportFilteredRecordsIn(records, range) {
  var startKey = toKey(range[0]), endKey = toKey(range[1]);
  return sortRecs(records.filter(function (r) { return r.date >= startKey && r.date <= endKey; }));
}

export function hasActiveSearchFiltersIn(query, filters) {
  return !!(query.trim() || filters.amountMin != null || filters.amountMax != null || filters.dateFrom || filters.dateTo);
}

// 日曆頁用：有搜尋字串或進階篩選條件時故意不限制日期範圍（搜尋的目的就是「不記得是哪一天
// 記的，用條件找」，限制在目前瀏覽的月份反而失去搜尋的意義）；沒有任何條件時依目前瀏覽的
// 月份，再看有沒有額外點選單一天要進一步縮小範圍。
// opts: { query, filters, month, selectedDay }
export function calendarFilteredRecordsIn(records, categories, opts) {
  var q = opts.query.trim().toLowerCase();
  var f = opts.filters;
  var recs;
  if (hasActiveSearchFiltersIn(opts.query, f)) {
    recs = records.filter(function (r) {
      if (q) {
        var cat = categories.find(function (c) { return c.id === r.categoryId; });
        var catName = cat ? cat.name.toLowerCase() : '';
        var note = (r.note || '').toLowerCase();
        if (note.indexOf(q) === -1 && catName.indexOf(q) === -1 && String(r.amount).indexOf(q) === -1) return false;
      }
      if (f.amountMin != null && r.amount < f.amountMin) return false;
      if (f.amountMax != null && r.amount > f.amountMax) return false;
      if (f.dateFrom && r.date < f.dateFrom) return false;
      if (f.dateTo && r.date > f.dateTo) return false;
      return true;
    });
  } else {
    var monthStartKey = toKey(startOfMonth(opts.month));
    var monthEndKey = toKey(endOfMonth(opts.month));
    recs = records.filter(function (r) { return r.date >= monthStartKey && r.date <= monthEndKey; });
    if (opts.selectedDay) {
      recs = recs.filter(function (r) { return r.date === opts.selectedDay; });
    }
  }
  return sortRecs(recs);
}
