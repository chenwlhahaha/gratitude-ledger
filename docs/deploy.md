# 部署指南

本项目是单进程应用：一个 `server.js` 同时提供 JSON API、静态前端和家书图片托管。每个班级部署一份独立实例，一份 `DATA_DIR` 对应一个班级。

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | 任意 Linux 发行版（Debian / Ubuntu / Rocky 等），macOS 也可本地试跑 |
| Node.js | **18 或更高版本**（建议 20 LTS） |
| 内存 | 128 MB 起，班级规模下 256 MB 足够 |
| 磁盘 | 程序约 5 MB；数据按家书图片量增长，建议预留 1 GB 以上 |
| 网络 | 需要一个域名（HTTPS 必需），80/443 对外开放，应用端口只监听本机 |

后端零依赖，**不需要** `npm install`。`public/` 已包含构建好的前端，克隆下来即可运行。

## 2. 首次部署（Linux 单机）

以 `/opt/gratitude-ledger` 为程序目录、`/var/lib/gratitude-ledger` 为数据目录、`gratitude` 为运行用户为例。

### 2.1 创建用户与目录

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin gratitude
sudo mkdir -p /opt/gratitude-ledger /var/lib/gratitude-ledger

sudo git clone https://github.com/chenwlhahaha/gratitude-ledger.git /opt/gratitude-ledger
sudo chown -R gratitude:gratitude /var/lib/gratitude-ledger
```

> 数据目录必须放在代码目录之外，避免 `git pull`、重新克隆或误删程序目录时带走数据。

### 2.2 先手动启动一次

```bash
sudo -u gratitude env \
  PORT=3104 HOST=127.0.0.1 \
  DATA_DIR=/var/lib/gratitude-ledger \
  node /opt/gratitude-ledger/server.js
```

看到类似 `[gratitude-ledger] :3104 ...` 的日志即启动成功。另开终端检查健康接口：

```bash
curl -fsS http://127.0.0.1:3104/healthz
# {"ok":true}
```

初始化页面有两种打开方式（应用此时只监听本机）：

- SSH 端口转发（推荐，不暴露端口）：`ssh -L 3104:127.0.0.1:3104 <user>@<server>`，然后在本地浏览器打开 `http://127.0.0.1:3104`；
- 临时把 `HOST` 改成 `0.0.0.0` 并在安全组/防火墙放行 3104，初始化完成后改回 `127.0.0.1`。

初始化完成后按 `Ctrl+C` 停止，交给 systemd 托管。

### 2.3 systemd 服务

创建 `/etc/systemd/system/gratitude-ledger.service`：

```ini
[Unit]
Description=gratitude-ledger（班级学习收益核算）
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=gratitude
Group=gratitude
WorkingDirectory=/opt/gratitude-ledger
Environment=PORT=3104
Environment=HOST=127.0.0.1
Environment=DATA_DIR=/var/lib/gratitude-ledger
ExecStart=/usr/bin/node /opt/gratitude-ledger/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/gratitude-ledger

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gratitude-ledger
sudo systemctl status gratitude-ledger --no-pager
sudo journalctl -u gratitude-ledger -f       # 查看日志
```

如果 `node` 不在 `/usr/bin`，请用 `command -v node` 的结果替换 `ExecStart` 的路径。

服务运行时 `/opt` 对服务进程是只读的（管理员 shell 不受影响）；升级代码前请先 `sudo systemctl stop gratitude-ledger`，避免运行中的进程与新代码不一致。

### 2.4 反向代理与 HTTPS

应用只监听 `127.0.0.1:3104`，由反向代理对外提供 HTTPS。下面把 `ledger.example.com` 换成你自己的域名。

**Nginx**

```nginx
server {
    listen 80;
    server_name ledger.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ledger.example.com;

    ssl_certificate     /etc/letsencrypt/live/ledger.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ledger.example.com/privkey.pem;

    # 家书图片以 base64 JSON 提交，单张限 2 MB，留出编码与请求头余量
    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:3104;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

证书可用 Certbot 申请：

```bash
sudo certbot --nginx -d ledger.example.com
```

**Caddy**（自动申请和续期证书）

```caddyfile
ledger.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3104
}
```

Caddy 默认允许较大的请求体，如需限制可自行加 `request_body { max_size 8MB }`。

### 2.5 防火墙

只开放 22、80、443，不要对公网开放 3104：

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 3. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3104` | 应用监听端口 |
| `HOST` | `0.0.0.0` | 监听地址；用反向代理时建议设为 `127.0.0.1` |
| `DATA_DIR` | `./data` | 数据目录，存放 `store.json` 与 `uploads/`；生产环境务必使用绝对路径并放在代码目录之外 |
| `CLASS_NAME` | `学习小组` | 未初始化时，初始化页面默认展示的班级名；以页面提交的班级名为准 |
| `INITIAL_CODE` | 空 | 可选，部署时预置的初始登录码；仅当初始化表单未填写登录码时使用 |

> 登录码是班主任及成员的账号入口，创建后可在管理控制台修改或重置。请使用 8 位以上、非弱口令的组合，且不要在各班之间复用。

## 4. 升级

1. **先备份数据**（见 [备份与恢复](backup.md)）。
2. 停止服务，拉取新版本：

   ```bash
   sudo systemctl stop gratitude-ledger
   sudo git -C /opt/gratitude-ledger fetch --tags
   sudo git -C /opt/gratitude-ledger checkout v1.0.0   # 换成目标版本
   ```

3. 启动并检查：

   ```bash
   sudo systemctl start gratitude-ledger
   curl -fsS http://127.0.0.1:3104/healthz
   sudo journalctl -u gratitude-ledger -n 50 --no-pager
   ```

4. 打开页面抽查登录、今日打卡、家书页和控制台账。

关于前端：`public/` 已提交构建产物，正常升级无需构建。只有你修改了 `frontend/` 源码才需要：

```bash
cd frontend && npm ci && npm run build   # 输出到 ../public
```

关于数据迁移：服务启动时会按 `schemaV2` 自动升级数据结构，并在升级前自动写一份 `store.json.pre-*.bak` 备份。升级大版本前仍建议手动备份一次。

## 5. 回滚

代码回滚：

```bash
sudo systemctl stop gratitude-ledger
sudo git -C /opt/gratitude-ledger checkout v1.0.0   # 回到上一个可用版本
sudo systemctl start gratitude-ledger
```

如果新版本已经写入旧版本无法识别的数据结构，只回滚代码可能不够，需要同时恢复备份：

```bash
sudo systemctl stop gratitude-ledger
sudo cp -a /var/lib/gratitude-ledger /var/lib/gratitude-ledger.bak.$(date +%Y%m%d%H%M)
sudo tar -xzf /path/to/gratitude-ledger-data-YYYYMMDD.tar.gz -C /var/lib/gratitude-ledger
sudo chown -R gratitude:gratitude /var/lib/gratitude-ledger
sudo systemctl start gratitude-ledger
```

回滚后请再次核对 `/healthz` 和登录是否正常。

## 6. 常见问题

| 现象 | 排查方向 |
| --- | --- |
| 启动即退出，日志提示"成员数据无效" | `store.json` 损坏或为空；用备份恢复，不要删除文件后重启 |
| 页面能开，接口 401 | 登录码错误或会话过期（默认 30 天）；重新登录 |
| 上传家书图片失败 | 反向代理 `client_max_body_size` 太小，或 `DATA_DIR/uploads` 不可写 |
| 升级后页面样式错乱 | `public/` 与 `server.js` 版本不匹配，确认拉到了同一 tag |
| 时间/日期不对 | 服务器时区应为 `Asia/Shanghai`，应用按中国时区计算"今天" |
