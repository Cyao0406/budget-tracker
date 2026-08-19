// Regression cases from CHANGELOG.md v2.9 and v2.8:
// - v2.9: "CSV 匯出的公式注入防護只做了一半：自己匯出帶特殊符號開頭備註的紀錄，重新匯入回來
//   會多一個看不出來的符號" -> export/import must be symmetric, not accumulate escape chars.
// - v2.8: "CSV 匯入偶爾會把備註裡的換行內容弄壞" -> a multi-line note (only reachable via CSV
//   import, since the edit-record note field is a single-line <input>) must survive import.
//
// Uses disposable in-browser localStorage only - no Firebase involved.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

async function downloadCsvText(page, triggerLocator) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    triggerLocator.click(),
  ]);
  const path = await download.path();
  const fs = await import('node:fs/promises');
  return fs.readFile(path, 'utf-8');
}

test('formula-injection-prefixed note survives repeated export/import without accumulating escape characters', async ({ page }) => {
  await page.fill('#quickInput', '=SUM(A1) 100');
  await page.click('#addBtn');

  // #exportBtn lives in the 日曆 (calendar) tab, not the 輸入 (input) tab that's active by default.
  await page.click('[data-tab="calendar"]');
  await expect(page.locator('#recordsList')).toContainText('=SUM(A1)');

  const firstExport = await downloadCsvText(page, page.locator('#exportBtn'));
  expect(firstExport).toContain("'=SUM(A1)"); // exported form must carry the safety prefix

  // Re-import the file we just exported, via 設定 > 匯入 CSV 備份 (#importFileInput lives in settingsSheet).
  await page.click('#settingsBtn');
  const buffer = Buffer.from(firstExport, 'utf-8');
  await page.setInputFiles('#importFileInput', {
    name: 'reimport.csv',
    mimeType: 'text/csv',
    buffer,
  });
  await expect(page.locator('#importPreviewConfirmBtn')).toBeVisible();
  await expect(page.locator('#importPreviewConfirmBtn')).toBeEnabled();
  await page.click('#importPreviewConfirmBtn');

  // The re-imported note must display as the original "=SUM(A1)", not "'=SUM(A1)" or "''=SUM(A1)".
  const noteTexts = await page.locator('.record-note', { hasText: 'SUM(A1)' }).allTextContents();
  expect(noteTexts.length).toBeGreaterThan(0);
  for (const text of noteTexts) {
    expect(text).toBe('=SUM(A1)');
  }

  await page.click('#settingsCloseBtn').catch(() => {});
  const secondExport = await downloadCsvText(page, page.locator('#exportBtn'));
  // Second export (now containing the original + re-imported record) must still only carry
  // a single escape prefix per occurrence - compare escape-prefix counts, not raw text, since
  // there are now 2 records with the same note.
  const firstPrefixCount = (firstExport.match(/'=SUM\(A1\)/g) || []).length;
  const secondPrefixCount = (secondExport.match(/'=SUM\(A1\)/g) || []).length;
  const secondDoublePrefixCount = (secondExport.match(/''=SUM\(A1\)/g) || []).length;
  expect(secondDoublePrefixCount).toBe(0);
  expect(secondPrefixCount).toBeGreaterThanOrEqual(firstPrefixCount);
});

test('multi-line note imported from CSV round-trips without corruption', async ({ page }) => {
  const multiline = 'line one\nline two\nline three';
  const csv = '﻿date,type,category,amount,note\n' +
    `2026-08-01,expense,餐飲,120,"${multiline.replace(/"/g, '""')}"\n`;

  await page.click('#settingsBtn');
  await page.setInputFiles('#importFileInput', {
    name: 'multiline.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf-8'),
  });
  await expect(page.locator('#importPreviewSummary')).not.toContainText('0 筆');
  await page.click('#importPreviewConfirmBtn');

  await page.click('#settingsCloseBtn').catch(() => {});
  await page.click('[data-tab="calendar"]');
  const exported = await downloadCsvText(page, page.locator('#exportBtn'));
  // The exported field must still be a single properly-quoted field containing all 3 lines,
  // not split across multiple CSV rows and not missing the embedded newlines.
  expect(exported).toContain('line one');
  expect(exported).toContain('line two');
  expect(exported).toContain('line three');
  // A naive line-split would show these as separate top-level rows; count actual CSV records
  // by counting date-prefixed lines instead.
  const recordRowCount = (exported.match(/^2026-08-01,/gm) || []).length;
  expect(recordRowCount).toBe(1);
});
