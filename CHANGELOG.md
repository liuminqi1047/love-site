# 更新记录

## 1.1.0 — 2026-11-21

### 新增：完整备份包（可换主机恢复）

- **一个文件装下全部状态**：`data/*.json` + 照片 + 音乐 + sha256 清单打成一个 zip，
  换服务器后上传它就能回到备份那一刻（配置、留言、情书、胶囊、每日一问、默契记录、
  心愿状态、身份归属、照片、音乐、当前曲目、管理员账号）。
- 后台「备份与恢复 → 完整备份包」：下载（含音乐 / 仅数据+照片）、上传恢复（带进度条）。
- 新增接口：
  - `admin/backup.php` 流式下载（需后台登录，`?music=0` 排除音乐）
  - `admin/api.php` 新增 `restore_archive`（multipart 上传）
- 新增 `lib/archive.php`（打包 / 校验 / 落地）与 `lib/zip.php` 的读取能力
  （支持 store 与 deflate，带 CRC 校验，坏包整包拒绝）。
- 新增 `tools/archive.php`：命令行打包与校验，供 U 盘脚本调用。
- 恢复前自动把当前 `data/*.json` 存到 `data/pre-restore/<时间>/`；照片与音乐按包内集合
  整组替换（包外的旧文件会被移除），并清空缩略图缓存。
- 包内**不含** `data/security.json`（限流计数）与 `data/gate_secret`（门禁密钥）。

### 变更

- 上传上限：PHP `upload_max_filesize` 2M → **64M**、`post_max_size` 8M → **72M**；
  Nginx `client_max_body_size` 20m → **64m**（11MB 的备份包需要整包上传）。
- 新增 `site/VERSION`（当前 `1.1.0`），备份包与文件名都带版本号。

### 说明

- 旧的两条备份路径保留：JSON 备份（逐字段清洗、只恢复 5 个数据块）与
  `export.php`（data + 照片，无导入端）。换主机请用「完整备份包」。
