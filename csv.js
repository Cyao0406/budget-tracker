// CSV 剖析與匯入「解析→驗證→暫存」的純邏輯，跟 state/DOM 完全脫鉤——傳進來的分類清單、
// 傳出去的結果都是一般物件/陣列，方便寫單元測試（見 test/ 目錄），也方便之後真的要換成
// 更完整的 CSV 函式庫時只動這個檔案。真正「套用到 state、存 localStorage、開 UI 預覽」
// 的部分留在 app.js（那些需要碰 state/els，不是純函式）。
import { uid, pad2 } from './utils.js';

// MoneyNote 匯出檔的分類名稱 -> 對應本 App 既有分類（真的是同一件事才合併，不是同一件事的一律保留原名各自成類）
export var MONEYNOTE_MERGE_MAP = {
  expense: {
    '飲食費': '餐飲', '交通費': '交通', '日用品': '購物', '衣服': '購物', '美容': '購物',
    '醫療費': '醫療', '教育費': '教育',
    '水電費': '居家', '電話費': '居家', '房費': '居家', '家庭開銷': '居家',
    '娛樂費': '娛樂', '訂閱類娛樂費': '娛樂', '旅遊費': '娛樂'
  },
  income: {
    '工資': '薪資', '零花錢': '其他收入', '副業': '其他收入', '臨時收入': '其他收入'
  }
};
// 沒有對應既有分類、會新建成獨立分類的項目，先給合理的關鍵字，別讓它空著
export var MONEYNOTE_NEW_CATEGORY_KEYWORDS = {
  '交際費': ['交際', '應酬', '聚餐', '禮金', '紅包', '送禮'],
  '煙酒': ['煙', '菸', '香菸', '酒', '啤酒', '紅酒', '威士忌', '檳榔']
};

// 完整支援 RFC4180 風格的 CSV 剖析：一次讀整份文字、逐字元判斷，正確處理引號內的逗號、
// 換行（\n、\r\n、單獨 \r 都算）跟雙引號跳脫（""）。之前是先用 split(/\r?\n/) 把整份文字
// 硬切成一行一行，再逐行剖析——這樣引號包住的欄位裡如果有換行（我們自己 exportCsv 就會
// 產生這種欄位），會在切行那一步就被切斷，等於把自己匯出的 CSV 匯回來會壞掉。
export function parseCsvText(text) {
  var rows = [], row = [], field = '', inQuotes = false;
  var i = 0, len = text.length;
  while (i < len) {
    var ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') {
      if (text[i + 1] === '\n') { i++; continue; }
      row.push(field); rows.push(row); row = []; field = ''; i++; continue;
    }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
export function isBlankRow(row) { return row.length === 0 || (row.length === 1 && row[0].trim() === ''); }

// 分類建立要在「暫存的一份分類清單」上做，不能直接動 state.categories——匯入還在預覽階段，
// 使用者按下確認之前不該真的改動到現有資料。
export function nextColorVarIn(categoriesArr, type) {
  var count = categoriesArr.filter(function (c) { return c.type === type; }).length;
  return '--series-' + ((count % 8) + 1);
}
export function findOrCreateCategoryByNameIn(categoriesArr, type, name, keywordsIfCreated) {
  var cat = categoriesArr.find(function (c) { return c.type === type && c.name === name; });
  if (!cat) {
    cat = { id: uid(), type: type, name: name || (type === 'expense' ? '其他' : '其他收入'), colorVar: nextColorVarIn(categoriesArr, type), icon: '', keywords: keywordsIfCreated ? keywordsIfCreated.slice() : [], fallback: false };
    categoriesArr.push(cat);
  }
  return cat;
}
// 光驗證格式還不夠——「2026-02-30」格式合法但日期本身不存在，JS 的 Date 建構子遇到這種
// 情況會自動往後推（變成 3/2），不會報錯，所以要自己拿建出來的年月日回頭比對有沒有跑掉。
export function normalizeImportDate(str) {
  str = (str || '').trim();
  var y, mo, d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    var p = str.split('-').map(Number); y = p[0]; mo = p[1]; d = p[2];
  } else {
    var m = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) return null;
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  }
  var dateObj = new Date(y, mo - 1, d);
  if (dateObj.getFullYear() !== y || dateObj.getMonth() !== mo - 1 || dateObj.getDate() !== d) return null;
  return y + '-' + pad2(mo) + '-' + pad2(d);
}
// 金額除了不能是 NaN（例如 parseFloat("123abc") 會吃成 123 這種「看起來像數字」的髒資料
// 頂多防到格式層級，isFinite 這裡主要擋 Infinity/-Infinity），也不接受負數——這個 App 的
// 紀錄一律是非負金額 + type 欄位分支出/收入，負數金額不符合資料模型。
export function isValidImportAmount(n) { return isFinite(n) && n >= 0; }

export function stageOwnFormatCsv(rows, workingCategories) {
  var recordsToAdd = [], errorSamples = [], errorCount = 0;
  for (var i = 1; i < rows.length; i++) {
    var cols = rows[i];
    if (isBlankRow(cols)) continue;
    var date = normalizeImportDate(cols[0]);
    var type = cols[1], catName = cols[2], amount = parseFloat(cols[3]), note = cols[4] || '';
    var reason = !date ? '日期無效' : (type !== 'expense' && type !== 'income') ? '收支類型無效' : !isValidImportAmount(amount) ? '金額無效' : null;
    if (reason) {
      errorCount++;
      if (errorSamples.length < 5) errorSamples.push('第 ' + (i + 1) + ' 列：' + reason);
      continue;
    }
    var cat = findOrCreateCategoryByNameIn(workingCategories, type, catName);
    recordsToAdd.push({ id: uid(), date: date, type: type, categoryId: cat.id, amount: amount, note: note, createdAt: Date.now() });
  }
  return { recordsToAdd: recordsToAdd, errorCount: errorCount, errorSamples: errorSamples };
}
// "MoneyNote" app export: multiple #SECTION blocks in one file. We only need
// #DAILY_DATAS (the transactions) and #CATEGORIES (numeric categoryId -> name/type).
export function stageMoneyNoteCsv(rows, workingCategories) {
  var dailyStart = -1, catStart = -1;
  rows.forEach(function (row, idx) {
    if (row.length === 1 && row[0].trim() === '#DAILY_DATAS') dailyStart = idx;
    else if (row.length === 1 && row[0].trim() === '#CATEGORIES') catStart = idx;
  });
  var categoryMap = {};
  if (catStart >= 0) {
    for (var j = catStart + 2; j < rows.length; j++) {
      var crow = rows[j];
      if (isBlankRow(crow) || (crow[0] || '').trim().charAt(0) === '#') break;
      if (!crow[0]) continue;
      categoryMap[crow[0]] = { name: crow[1], type: crow[4] === '1' ? 'income' : 'expense' };
    }
  }
  var recordsToAdd = [], errorSamples = [], errorCount = 0;
  if (dailyStart >= 0) {
    for (var k = dailyStart + 2; k < rows.length; k++) {
      var drow = rows[k];
      if (isBlankRow(drow) || (drow[0] || '').trim().charAt(0) === '#') break;
      var date = normalizeImportDate(drow[0]);
      var amount = parseFloat(drow[1]);
      var typeCode = drow[4];
      var reason = !date ? '日期無效' : !isValidImportAmount(amount) ? '金額無效' : (typeCode !== '0' && typeCode !== '1') ? '收支類型無效' : null;
      if (reason) {
        errorCount++;
        if (errorSamples.length < 5) errorSamples.push('第 ' + (k + 1) + ' 列：' + reason);
        continue;
      }
      var type = typeCode === '1' ? 'income' : 'expense';
      var info = categoryMap[drow[3]];
      var rawName = info ? info.name : null;
      var mergedName = rawName && MONEYNOTE_MERGE_MAP[type][rawName];
      var cat = findOrCreateCategoryByNameIn(workingCategories, type, mergedName || rawName, MONEYNOTE_NEW_CATEGORY_KEYWORDS[rawName]);
      var createdAtMs = Date.parse(drow[5]);
      recordsToAdd.push({
        id: uid(), date: date, type: type, categoryId: cat.id, amount: amount,
        note: (drow[2] || '').replace(/\\n/g, ' ').trim(),
        createdAt: isNaN(createdAtMs) ? Date.now() : createdAtMs
      });
    }
  }
  return { recordsToAdd: recordsToAdd, errorCount: errorCount, errorSamples: errorSamples };
}
// 匯入改成「解析 → 驗證 → 預覽 → 使用者確認 → 套用」，這裡只負責算出「如果匯入的話會變成
// 怎樣」，completely 不動真正的 state（categories 是呼叫端傳進來的目前分類清單，這裡只會
// 複製一份 workingCategories 來加東西，不會動到傳進來的原始陣列本身）。套用（寫回 state、
// 存 localStorage）交給呼叫端（app.js 的 applyImportStaged）在使用者確認後才做。
export function stageImportCsv(text, categories) {
  var normalized = text.replace(/^﻿/, '');
  var rows = parseCsvText(normalized);
  var isMoneyNote = rows.some(function (r) { return r.length === 1 && r[0].trim() === '#DAILY_DATAS'; });
  var workingCategories = categories.map(function (c) { return Object.assign({}, c, { keywords: c.keywords.slice() }); });
  var staged = isMoneyNote ? stageMoneyNoteCsv(rows, workingCategories) : stageOwnFormatCsv(rows, workingCategories);
  return {
    format: isMoneyNote ? 'moneynote' : 'own',
    recordsToAdd: staged.recordsToAdd,
    workingCategories: workingCategories,
    newCategoryCount: workingCategories.length - categories.length,
    errorCount: staged.errorCount,
    errorSamples: staged.errorSamples
  };
}
