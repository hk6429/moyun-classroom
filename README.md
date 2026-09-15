# 墨韻課堂

國風潑墨、青綠山水與 Q 版書生風格的互動簡報網站。以 Nearpod 教學流程為參考，採原創介面與插畫。

## 線上免費首版

- [Cloudflare 主站](https://moyun-classroom.hk6429.workers.dev)
- [Netlify 入口](https://moyun-classroom.netlify.app)

兩入口共用 Cloudflare API 與 Turso `moyun-classroom` 資料庫，教室代碼可跨站加入。登入 Cookie 各屬自己的網域；換入口需重新登入或加入。沒有開通 Workers Paid 或 R2。

## 使用

1. 按「教師登入」，輸入管理者提供的密碼。學生不需要教師密碼。
2. 選擇範例教材或建立教材，按「上傳 PDF／圖片」。PDF 在教師瀏覽器逐頁轉成圖片，再存入 Turso；PPT 請先用 PowerPoint 匯出 PDF。
3. 選中頁面後，可插入投票、選擇題、填空、開放問題、便利貼或手寫互動。
4. 按「開始授課」，把六位數代碼交給學生。畫面約每 2.5 秒同步。
5. 公布答案後停止收件；可對學生提供個別回饋，並匯出含未作答者的 CSV 與圖片報告。
6. 教材草稿存在目前瀏覽器；開課後的課堂與作答保存至 Turso。請定期下載完整教材備份與作答報告。

## 本版功能

- PDF、PNG、JPG、WebP、GIF 匯入，逐頁穿插互動。
- 原子筆、鉛筆、毛筆、螢光筆、橡皮擦、筆色、粗細、復原／重做。
- 教師底圖標註、學生手寫及文字替代作答，保存 PNG 與筆畫。
- 教師開課、學生代碼加入、同步切頁、在線狀態、鎖定加入與移除成員。
- 未公布答案不傳給學生；圖片需登入教師或所屬課堂成員權限。
- 教材完整備份／還原、可還原素材回收區、課堂續課與作答報告。
- 學習目標、成功條件、教材描述、分層提示與答案解析。

## 容量與待辦

- **PPT／PPTX 直接匯入列為待辦**；本次依使用者選擇先提供 PDF／圖片版。
- 頁數與加入人數沒有產品級固定上限；免費平台的請求、CPU、儲存與流量額度仍有限。不可視為無限容量或大型並發保證。
- 單張圖片／單次 API 資料上限 8 MB；PDF 逐頁處理，不必整份上傳到伺服器。大 PDF 仍受教師裝置記憶體與處理能力限制。
- Turso 保存課堂快照並用版本比對重試防止並行覆寫；圖片以分塊保存。現階段適合試用，較大規模營運需進一步拆分課堂資料表並做負載驗證。
- 目前使用單一教師管理密碼；尚無多教師獨立帳號、學生自主進度及正式學籍名冊。
- PDF 轉頁會保留靜態畫面，不保留動畫與文字編輯能力。Google Fonts、YouTube 等外部資源依網路及對方政策提供。
- 實體觸控筆、完整輔具、各類 PDF 字型與長時間大型班級尚未完成驗收。

## 開發與測試

需要 Node.js 22 以上。

```sh
npm ci
npm run build:web
npm run test:cloud
npm run test:core
npm run test:hosting
```

`server.mjs` 保留本機 Node／Docker 版本，執行 `npm start`。本機預設只監聽 `127.0.0.1:4178`；原版轉檔環境見 [Node 部署說明](deploy/README.md)。線上版不依賴本機 Docker。

## 部署

1. 執行 `npm ci` 與 `npm run build:web`。
2. 以秘密管理提供 `TURSO_URL`、`TURSO_TOKEN`、`TEACHER_PASSWORD`，不得放入 `public/` 或 Git。
3. 初次資料庫使用 `node scripts/init-cloud.mjs /私密位置/cloud-secrets.json` 初始化。
4. 依 `wrangler.json` 發布 Cloudflare；初次可使用 Wrangler 的 `--secrets-file`，後續部署沿用平台秘密。
5. 執行 `node scripts/prepare-hosting.mjs https://moyun-classroom.hk6429.workers.dev`，將 `dist/netlify/public` 發布至既有 Netlify 專案。
6. 新增網域時，更新 `ALLOWED_ORIGINS` 精確清單，並重新驗證 Cookie 與跨站加入。

Netlify 專案 ID：`8a7210c6-7e7e-482a-9f09-b22366a51808`。

## 驗證證據

- [正式雙站 API 驗證](deploy/live-evidence.json)：雙站登入、5 人並行加入、圖片、文字、手寫、權限與報告。
- `cloud/cloud.test.mjs`：10 人並行加入、持久保存、答案保護與圖片／筆畫權限。
- `.github/workflows/linux-release.yml`：Linux 隔離轉檔及本機／雲端核心回歸測試。
- 本版瀏覽器驗證與部署狀態見 [免費首版發布紀錄](deploy/免費首版發布.md)。

## 專案結構

- `engine.mjs`：Node 與雲端共用的課堂邏輯。
- `cloud/worker.mjs`：Cloudflare 請求、登入、圖片與資料庫介面。
- `cloud/database.mjs`：Turso 版本比對寫入、圖片分塊與速率保護。
- `public/`：前端及原創 SVG；`public/vendor/` 由 build:web 產生。
- `scripts/`：前端資產、部署套件、健康檢查與正式驗證。

[大乃老師的 Nearpod 教學講義](https://app.notion.com/p/44decd34565e415eb43f78fe2bdda2fd)。本專案與 Nearpod 官方無隸屬關係。
