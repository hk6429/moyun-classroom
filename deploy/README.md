# 墨韻課堂部署與回復

此版為單一教師管理者的教室服務。公開部署尚未執行：需要已授權的 Linux 主機／網域、持久磁碟與可用的 rootless Docker。不能直接部署到純靜態 Pages。

## 啟動前

- Node.js 22 以上，專案及 DATA_DIR 放本機持久磁碟，不放暫存檔案系統。
- 安裝並啟動 rootless Docker；不要把 Docker socket 掛入不可信的轉檔容器。
- 用 deploy/Dockerfile.converter 建立 moyun-converter:1 映像。
- 以專用無特權服務帳號執行 Node；只授予專案與 DATA_DIR 所需權限。
- TEACHER_PASSWORD 由主機 secret/environment 注入；若未設定，首次啟動會在 DATA_DIR/teacher-password 產生管理密碼（權限600）。不要將此檔提交 Git 或放公開網址。
- PUBLIC_ORIGIN 設成正式 https 網址；HOST=127.0.0.1，PORT=4178。外部由 TLS 反向代理進入。
- 正式環境不可設定 DEVELOPMENT_LOCAL_CONVERTER=1；此旗標會繞過容器隔離，僅用於可信測試教材。

## 指令（於專案根目錄）

```sh
docker build -f deploy/Dockerfile.converter -t moyun-converter:1 .
npm run test:core
npm test
npm start
```

完整測試中的105間短時間開課案例，需在測試環境設 CREATE_RATE_LIMIT=200。測試的 DATA_DIR 應使用獨立資料夾。一般正式環境沿用預設速率。

## HTTPS

將 deploy/Caddyfile.example 中的網域換成指定的正式網域，交由主機的 Caddy 服務管理憑證。DNS必須指向該主機；不得將4178連接埠直接對外開放。PUBLIC_ORIGIN需與正式網址完全一致。

## 驗收

1. /api/health 回傳ok，登入後可開課；未登入上傳回傳401。
2. 以PDF/PPT/PPTX各轉一份，確認中文字型及頁序；確認隔離容器network=none、唯讀根目錄與資源限制。
3. 兩台裝置加入同一課堂，驗證切頁、手寫、回饋與斷線恢復。
4. 重啟服務後返回已儲存課堂，確認作答仍在。
5. 備份教材並於另一環境還原，確認圖片完整。
6. 異班學生無法讀取圖片；登出後舊教師控制權失效。

## 保存與回復

DATA_DIR含課堂、權杖、原始素材、手寫與回收區，屬受保護資料。定期加密備份，限制可讀帳號。教材整包JSON與完整作答JSON可攜帶圖片；CSV只用於表格分析。

更新前先停止接收新課堂、備份 DATA_DIR、保留上一版Git SHA。失敗時回到上一版程式與對應資料備份再啟動；不要用不相容舊版覆寫新資料。回復後輪替教師管理密碼，重新登入。

素材回收區可還原，仍占用磁碟。系統不會偷偷永久刪除教師既有教材；正式營運者應訂定學期末封存及回收區清除期限，並完成備份確認後執行。課堂記錄與學生資料不應無期限公開存取。
