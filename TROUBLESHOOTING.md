| 症状 | 原因 | 处置 |
|---|---|---|
| 灯常红、网口链路 Up 1Gbps、无 DHCP、无 ARP | 系统分区损坏，uboot 未进恢复模式 | 断电+按住 reset 通电 10~15s 触发恢复模式，再抓包 |
| 抓包看到对端发 DHCP DISCOVER | uboot 恢复模式在跑（vendor-class=`U-Boot`） | 起 DHCP+TFTP 两个服务，等 RRQ |
| TFTP 传完 9.5MB 但机器仍紫/粉灯闪、零流量 | 喂的是无 `HDR1` 头的 OpenWrt 裸镜像，uboot 校验拒绝、不写 flash | 换官方 HDR1 ROM（firmware-manifest.json `stock-ax1800-rom`） |
| DHCP OFFER 发送报 `EACCES` | Windows 不允许从绑定具体 IP 的 socket 发受限广播 255.255.255.255 | 改发子网定向广播 192.168.31.255（tools/uboot-dhcpd.js 已按此实现） |
| 自建 DHCP 把局域网别的设备带偏 | 0.0.0.0:67 的 socket 会收到 WLAN 侧请求（实测 iPhone/Mac/vivo） | 只回应 vendor-class=`U-Boot` 或指定 MAC（脚本已过滤） |
| `ssh: no matching host key type found. Their offer: ssh-rsa` | 老 dropbear 只提供 ssh-rsa | 加 `-o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa` |
| SSH `Permission denied` | 以为密码是 web 密码 | xmir-patcher 解锁后 SSH 密码固定是 `root` |
| `scp` 报 `Connection closed` | dropbear 不支持 SFTP 子系统 | 用 `ssh host 'cat > /tmp/x' < file` / `ssh host 'cat /tmp/x' > file` |
| breed 刷完 OpenWrt 不启动 | 用了 r1416 breed（不支持 OpenWrt 镜像布局） | 用 r1338；breed 网页里也可降级回 r1338 |
| xmir-patcher `install_bl` 报 cannot be installed | 它只放行 R3G/R3P/RM2100 | 手动 `mtd write ... Bootloader` |
| breed 上传固件后没反应 | breed 是两段式：POST /upload.html 只暂存 | 再 GET `/upgrading.html` 才真正写 |
| 救援机断网 / agent 会话掉线 | 有线拿到路由器默认路由，抢走 WLAN 的默认路由 | 有线接口 metric 调高（如 400）；或恢复阶段干脆不设网关 |
| 本机 WLAN 与小米恢复网段同为 192.168.31.x | 两接口同网段路由歧义 | 恢复阶段有线用静态 IP + 对路由器 IP 的 /32 主机路由；**不要禁用 WLAN**（会断 agent 会话） |
| `pktmon etl2txt` 输出乱码 | 输出是 UTF-16 | `iconv -f UTF-16LE -t UTF-8` |
| raw.githubusercontent.com TLS 失败 | 部分网络被墙 | github 用 codeload zip；OpenWrt 用 downloads.openwrt.org；breed 用 breed.hackpascal.net 根路径 |
| miwifi.com 下载页抓不到固件链接 | 页面 JS 渲染 | 直接拼 `https://bigota.miwifi.com/xiaoqiang/rom/<model>/miwifi_<model>_firmware_<hash>_<ver>.bin` 并 `curl -I` 验证 |
