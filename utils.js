// 純函式工具集：不碰 state / DOM / Firebase，單純輸入輸出。抽成獨立模組主要是為了能寫
// 單元測試（見 test/ 目錄），也讓 app.js 不用把這些跟畫面渲染邏輯混在一起。
export var WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

export function debounce(fn, wait) {
  var t;
  return function () {
    var args = arguments, ctx = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(ctx, args); }, wait);
  };
}

export function pad2(n) { return String(n).padStart(2, '0'); }
export function toKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
export function fromKey(key) { var p = key.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
export function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
export function addMonths(d, n) { var r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
export function startOfWeek(d) { var r = new Date(d); r.setDate(r.getDate() - r.getDay()); r.setHours(0, 0, 0, 0); return r; }
export function endOfWeek(d) { return addDays(startOfWeek(d), 6); }
export function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
export function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
export function endOfYear(d) { return new Date(d.getFullYear(), 11, 31); }
export function addYears(d, n) { var r = new Date(d); r.setFullYear(r.getFullYear() + n); return r; }
export function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
export function formatMoney(n) {
  var sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
}
export function shortDate(d) { return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()); }
export function formatTime(ms) {
  if (!ms) return '';
  var d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
