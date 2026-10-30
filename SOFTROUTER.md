# 软路由化：OpenWrt 25.12 装 v2rayA + xray（机场订阅 / 透明代理）

实测机型同本仓库（CR6608/TR608，MT7621A / 256MB RAM），系统 OpenWrt 25.12.6。目标：导入机场节点订阅，全家用它当透明代理软路由。

## 选型结论

- 官方源 mipsel_24kc 可用的代理核心只有：`sing-box`、`v2ray-core`、`xray-core`、`v2raya`；LuCI 界面只有 `luci-app-v2raya`。
- **v2rayA** 的 Web UI（`:2017`）原生支持粘贴机场订阅（base64 通用订阅与 clash 订阅都认），自带透明代理与 nft 规则、DNS 防污染，最贴合“导入订阅当软路由”。
- OpenClash / PassWall 不在官方源且只发 ipk，**apk 系统装不了**，未采用。

## 前提与包管理差异（25.12 必看）

- 25.12 起包管理是 **apk**，不是 opkg；索引是 `index.json`（`{"packages": {名字: 版本}}`），老教程里的 `Packages.gz` 已不存在。
- 源布局：`releases/<ver>/packages/<arch>/{base,packages,luci,routing,telephony,video}/index.json`。
- **内核模块不在上面任何源**，在 `releases/<ver>/targets/<target>/<subtarget>/kmods/<内核版本>-<hash>/index.json`。权威清单看路由器 `/etc/apk/repositories.d/distfeeds.list`。

## 离线安装（路由器无外网时，PC 下载后推送）

1. 按 index.json 里的精确版本下载（openwrt.org TLS 抖动就换清华镜像 `https://mirrors.tuna.tsinghua.edu.cn/openwrt` 同路径）：

   | 源 | 包 |
   |---|---|
   | packages | `v2raya`、`xray-core`、`v2ray-geoip`、`v2ray-geosite` |
   | luci | `luci-app-v2raya`、`luci-i18n-v2raya-zh-cn` |
   | base | `ca-bundle`、`libcap` |
   | kmods | `kmod-nft-tproxy`、`kmod-nft-socket`、`kmod-nf-socket`、`kmod-nf-tproxy`（v2raya 硬依赖 kmod-nft-tproxy） |

2. 推上路由器（**scp 的 SFTP 会被 dropbear 断连，用 `ssh cat`**）：
   ```bash
   ssh root@192.168.1.1 'mkdir -p /tmp/apk'
   ssh root@192.168.1.1 "cat > /tmp/apk/$f" < "$f"
   ```
3. 安装：
   ```bash
   apk add --allow-untrusted --no-network /tmp/apk/*.apk
   ```
   `--no-network` 跳过联网刷索引（无外网时会刷出一堆 wget 报错）；缺依赖时 apk 会点名，回第 1 步补包再装。

## 启用与判定

```bash
uci set v2raya.config.enabled='1'; uci commit v2raya
/etc/init.d/v2raya enable && /etc/init.d/v2raya start
```
判定：
- `netstat -lnt | grep 2017` 有 LISTEN；
- PC 访问 `http://192.168.1.1:2017` 返回 200；
- 核心自动探测到 `/usr/bin/xray`（只装 xray-core 即可，不必装 v2ray-core）；
- geodata 由 v2ray-geoip/v2ray-geosite 提供，`/usr/share/xray/` 与 `/usr/share/v2ray/` 下都有 geoip.dat/geosite.dat。

## 使用（浏览器，订阅链接属用户隐私、由用户自己粘贴）

1. 入户线接路由器 **WAN**（没外网一切白搭）。
2. 打开 `http://192.168.1.1:2017`，首访创建管理账号（仅本机管理用）。
3. 「导入」→ 粘贴机场订阅链接 → 确定；识别不了就换机场提供的“通用/base64 订阅”地址。
4. 节点列表选节点 → 连接。
5. 「设置」：**透明代理 = 开**（局域网/网关模式）、**代理模式 = 规则**（要全流量走代理选全局）→ 保存。
6. 此后接该路由器 LAN/WiFi 的所有设备自动走代理；LuCI → 服务 → v2rayA 可开关，开机自启已 enable。

## 坑位记录

- `kmod-nft-tproxy` 版本必须与运行内核一致（本机 6.12.112），拿错会装不上或 insmod 失败。
- apk 装本地包必须 `--allow-untrusted`；依赖无法离线解析时只能按报错名字逐个补包。
- 256MB 内存跑 xray + 几百节点无压力；订阅节点上千时建议定期清理。
- 规则模式国内直连、国外走节点；DNS 防污染由 v2rayA 自行处理，不需要改 dnsmasq。
