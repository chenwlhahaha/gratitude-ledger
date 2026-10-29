# 备份与恢复

本项目的全部业务数据都在 `DATA_DIR` 下，只有两部分：

```text
DATA_DIR/
├── store.json     # 班级、成员、打卡、家书文字、审批、会话、评选等全部结构化数据
└── uploads/       # 家书附图（PNG / JPG / WebP）
```

没有数据库、没有对象存储，备份就是"打包这个目录"。

> 备份文件包含学员姓名、家书正文等敏感信息，请按机构要求加密存放、限定访问权限并设置保留期限。

## 1. 备份前须知

- `server.js` 写入 `store.json` 时先写 `store.json.tmp` 再原子改名，单次写入不会产生半个 JSON；但**跨两个文件的备份**仍建议在低峰期做，或短暂停服。
- 服务收到 `SIGTERM` / `SIGINT` 时会立即落盘，`systemctl stop` 是安全的。
- 迁移或大版本升级前，服务会自动生成 `store.json.pre-*.bak`，这是"最后一道保险"，不能替代定期备份。
- 会话（`store.tokens`）也在 `store.json` 里，恢复后旧登录态仍然有效；如需强制全员重新登录，可清空该字段。

## 2. 手动备份

### 2.1 停服备份（最稳妥）

```bash
sudo systemctl stop gratitude-ledger

STAMP=$(date +%Y%m%d-%H%M%S)
sudo tar -czf /var/backups/gratitude-ledger-data-$STAMP.tar.gz \
  -C /var/lib gratitude-ledger

sudo systemctl start gratitude-ledger
```

### 2.2 不停服备份

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
sudo tar -czf /var/backups/gratitude-ledger-data-$STAMP.tar.gz \
  -C /var/lib gratitude-ledger
node -e "JSON.parse(require('fs').readFileSync('/var/lib/gratitude-ledger/store.json','utf8')); console.log('store.json OK')"
```

打包后务必验证一次 JSON 可解析；如果此时正好有一次写入，重试即可。

### 2.3 只备份结构化数据（体积小）

```bash
sudo cp /var/lib/gratitude-ledger/store.json /var/backups/store-$(date +%Y%m%d-%H%M%S).json
```

适合高频快照。注意：`store.json` 不包含图片文件，家书里的图片会 404，恢复时仍需图片备份。

## 3. 自动备份

用 systemd timer 每天凌晨备份，保留 30 天。创建 `/etc/systemd/system/gratitude-ledger-backup.service`：

```ini
[Unit]
Description=Backup gratitude-ledger data

[Service]
Type=oneshot
User=root
ExecStart=/usr/local/bin/gratitude-ledger-backup.sh
```

> 如果 `node` 不在 systemd 的默认 `PATH`（例如用 nvm 安装），请在 `[Service]` 里加 `Environment=PATH=/usr/local/bin:/usr/bin:/bin`，或把脚本里的 `node` 改成绝对路径。

`/usr/local/bin/gratitude-ledger-backup.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077

SRC=/var/lib/gratitude-ledger
DST=/var/backups/gratitude-ledger
KEEP_DAYS=30
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$DST"
tar -czf "$DST/data-$STAMP.tar.gz" -C "$(dirname "$SRC")" "$(basename "$SRC")"

# 校验备份里的 store.json 可解析
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
tar -xzf "$DST/data-$STAMP.tar.gz" -C "$tmp"
store=$(find "$tmp" -name store.json -print -quit)
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$store"

find "$DST" -name 'data-*.tar.gz' -mtime +$KEEP_DAYS -delete
```

```bash
sudo chmod 750 /usr/local/bin/gratitude-ledger-backup.sh
```

`/etc/systemd/system/gratitude-ledger-backup.timer`：

```ini
[Unit]
Description=Daily gratitude-ledger backup

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gratitude-ledger-backup.timer
systemctl list-timers gratitude-ledger-backup.timer
```

如果机器已有备份系统（Borg、restic、云盘同步等），把 `/var/lib/gratitude-ledger` 加进去即可，不必重复搭建。

## 4. 恢复

### 4.1 原地恢复

```bash
sudo systemctl stop gratitude-ledger

# 先保留现场，便于事后排查
sudo mv /var/lib/gratitude-ledger /var/lib/gratitude-ledger.broken.$(date +%Y%m%d-%H%M%S)

sudo mkdir -p /var/lib/gratitude-ledger
sudo tar -xzf /var/backups/gratitude-ledger/data-YYYYMMDD-HHMMSS.tar.gz \
  -C /var/lib
sudo chown -R gratitude:gratitude /var/lib/gratitude-ledger
sudo chmod 700 /var/lib/gratitude-ledger

sudo systemctl start gratitude-ledger
curl -fsS http://127.0.0.1:3104/healthz
sudo journalctl -u gratitude-ledger -n 50 --no-pager
```

恢复后抽查：管理员登录、成员名单、最近一周家书与图片、当月收益数字。

### 4.2 先恢复到临时目录验证

不想直接覆盖线上数据时，可以先验证备份是否完整：

```bash
TMP=$(mktemp -d)
tar -xzf /var/backups/gratitude-ledger/data-YYYYMMDD-HHMMSS.tar.gz -C "$TMP"
DATA_DIR="$TMP/gratitude-ledger" PORT=3199 HOST=127.0.0.1 node /opt/gratitude-ledger/server.js
# 另开终端
curl -fsS http://127.0.0.1:3199/healthz
```

确认数据正常后再按 4.1 覆盖。

## 5. 迁移到新机器

1. 在新机器按 [部署指南](deploy.md) 装好 Node 与 systemd 服务，但先不要启动。
2. 把备份包传到新机器并解压到数据目录：

   ```bash
   sudo tar -xzf data-YYYYMMDD-HHMMSS.tar.gz -C /var/lib
   sudo chown -R gratitude:gratitude /var/lib/gratitude-ledger
   ```

3. 确认 `store.json` 里的 `className` 是目标班级，避免把别的班数据挂上来。
4. 启动服务，检查 `/healthz`、登录、家书图片访问（`/uploads/...`）。
5. 域名解析切到新机器，确认 HTTPS 证书正常。
6. 观察 1～2 天后再下线旧机器，旧机数据保留至少一个备份周期。

## 6. 灾难场景速查

| 场景 | 处理 |
| --- | --- |
| `store.json` 损坏，服务无法启动 | 用最近备份恢复；不要"删掉重来"，那会丢全部数据 |
| `uploads/` 丢失但 `store.json` 完好 | 从备份只恢复 `uploads/`；文字与积分不受影响 |
| 误停用了管理员账号 | 用其他管理员在成员名单里启用；若全部被停用，恢复停用前的备份 |
| 误把收支标准改错 | 改回正确值；已产生的历史月份不会重算，必要时用组内加减分修正 |
| 升级后数据结构异常 | 回滚代码并恢复升级前备份（升级时自动生成的 `.pre-*.bak` 可作为最后手段） |
| 服务器整机丢失 | 新机器部署 + 最新备份 + 切 DNS，参考第 5 节 |
