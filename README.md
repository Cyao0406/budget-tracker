# 記帳 App（Budget Tracker）

快速輸入自動分類的個人記帳 PWA。可在 iPhone / iPad / 筆電瀏覽器直接使用，也能「加入主畫面」變成類 App 圖示。

**線上網址：https://budget-tracker-8edd1.firebaseapp.com/**（部署在 Firebase Hosting，登入雲端同步一定要用這個網址，GitHub Pages 那份僅保留原始碼備份用）

## 技術

前端 HTML / CSS / JS（無建置流程），資料預設存在瀏覽器 `localStorage`（不登入也能正常使用）。登入 Google 帳號後會額外背景同步到 Firebase（Firestore），多裝置登入同帳號會自動同步。

- `index.html` — 頁面結構（含登入畫面）
- `style.css` — 樣式（淺色/深色皆支援）
- `app.js` — 所有邏輯（資料模型、自動分類、圖表、CRUD、雲端同步）
- `firebase-config.js` — Firebase 初始化（本機自動接 emulator，正式站已填入專案 config）
- `firestore.rules` / `firebase.json` — 雲端安全規則與 emulator 設定
- `manifest.json` / `sw.js` / `icons/` — PWA 設定與離線快取

## 本機測試

```bash
cd "budget_tracker_2026"
python -m http.server 8791
```
瀏覽器開 `http://localhost:8791`。同一 Wi-Fi 下手機可用電腦的區網 IP 連線測試。

## 功能

- 點日期列切換/選日期（含自訂月曆彈窗）
- 快速輸入（例：「早餐 全家 150」）自動判斷金額並依關鍵字猜測分類
- 分類與關鍵字可在右上角設定裡自訂
- 日/週/月報表（圓餅圖 + 圖例）
- 點紀錄可編輯，或刪除
- CSV 匯出/匯入（備份、跨裝置搬家）
- 設定裡可選擇用 Google 帳號登入，啟用雲端同步（選用功能，不影響單機使用）

## 已知限制

資料預設只存在單一瀏覽器裝置上，清除瀏覽器資料會遺失紀錄，建議定期用「設定」裡的「匯出 CSV 備份」，即使已經登入雲端同步也一樣。

## 未來規劃

其他建議加強的功能列在 [ROADMAP.md](ROADMAP.md)。
