# RUNBOOK：CR6608 / TR608 救砖与刷 OpenWrt

每一步给出 **命令 → 判定**。判定不满足就跳 TROUBLESHOOTING.md 对应条目。
变量约定：`ETH` = 连接路由器的有线网卡；`PC_IP` = 该网卡上的静态 IP（恢复阶段用 192.168.31.100）。

---

## 阶段 0：侦察（判断砖的类型）

1. 看链路：网卡 Status=Up 且 LinkSpeed=1Gbps，但拿不到 DHCP（只有 169.254.x）→ 系统没起，bootloader 可能还在。
2. 抓包确认对端身份（Windows 自带 pktmon，无需 Wireshark）：
   ```bash
   pktmon list                      # 找到有线网卡的组件 id
   pktmon start --capture --comp <id> --pkt-size 0 --file-name cap.etl
   # ...等待/操作...
   pktmon stop && pktmon etl2txt cap.etl && iconv -f UTF-16LE -t UTF-8 cap.txt > cap8.txt
   ```
   判定：收到 `0.0.0.0.68 > 255.255.255.255.67` 的广播且方向为 Rx → 对端在当 DHCP 客户端。
3. 用 `tools/dhcp-parse.js` 解析 pcapng 里的 DHCP 选项：
   ```bash
   pktmon etl2pcap cap.etl -o cap.pcapng && node tools/dhcp-parse.js cap.pcapng
   ```
   判定：`vendor-class="U-Boot"` → **原厂 uboot 恢复模式在跑**，走阶段 1。
   没有任何对端流量、灯常红 → 先做阶段 1 的 reset 触发再抓一次。

## 阶段 1：uboot 恢复模式救砖（只认 HDR1 官方 ROM）

1. 触发恢复模式：**断电 → 按住 reset → 通电 → 继续按住 10~15 秒（灯变橙/紫/粉闪烁）→ 松开**。网线插任意口（uboot 阶段交换机会泛洪到所有口）。
2. 本机有线网卡设静态 `192.168.31.100/24`，**不设网关**；若本机 WLAN 也在 192.168.31.x，加一条主机路由避免歧义：
   ```powershell
   New-NetRoute -InterfaceIndex <ETH> -DestinationPrefix 192.168.31.1/32 -NextHop 192.168.31.100 -RouteMetric 1
   ```
3. 起两个服务（uboot 先 DHCP 后 TFTP，缺一不可）：
   ```bash
   node tools/uboot-dhcpd.js            # BIND=192.168.31.100，LEASE 默认 192.168.31.2
   node tools/uboot-tftpd.js            # 服务目录 = 脚本所在目录
   ```
   判定：dhcpd 日志出现 `RX DISCOVER ... vendor-class="U-Boot"` 且 OFFER/ACK 发出成功。
   注意：DHCP 回包必须用**绑定到 PC_IP 的 socket 发子网定向广播 192.168.31.255**；发 255.255.255.255 在 Windows 上会 `EACCES`（脚本已处理）。
4. 看 tftpd 日志拿到 uboot 要的文件名：`RRQ ... file="C0A81F02.img"`（= 它拿到的 IP 的十六进制）。
5. 把**官方 HDR1 ROM** 复制成该文件名放进服务目录（见 firmware-manifest.json 的 `stock-ax1800-rom`）：
   ```bash
   cp miwifi_ra71_firmware_e8042_1.0.88.bin C0A81F02.img
   ```
   判定：日志 `TRANSFER COMPLETE: 13239240 bytes`；随后路由器**蓝灯快闪 = 写入完成**。
   **不要放 OpenWrt 镜像**：无 HDR1 头，传完也不写 flash（见 TROUBLESHOOTING「紫/粉灯闪 + 零流量」）。
6. 断电等 10 秒再上电 → 蓝灯常亮 → 浏览器 192.168.31.1 出现 MiWiFi 首次设置页 = 救活。

## 阶段 2：解锁 SSH → breed → OpenWrt

1. 完成首次设置（上网方式选自动/DHCP；记住管理密码）。
2. 解锁 SSH：下载 xmir-patcher（`codeload` zip；raw.githubusercontent 在部分网络被墙），解压后：
   ```bash
   echo <web管理密码> | ./python/python.exe connect.py
   ```
   判定：输出 `#### SSH server are activated! ####`。**SSH 密码是 `root`，不是 web 密码。**
3. SSH 细节（老 dropbear + 新 OpenSSH 的坑）：
   ```bash
   export SSH_ASKPASS=./askpass.cmd SSH_ASKPASS_REQUIRE=force   # askpass.cmd 里 echo root
   ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@192.168.31.1 'cat /proc/mtd' < /dev/null
   ```
   传文件**不要用 scp**（SFTP 会被 dropbear 断连），一律 `ssh cat` 双向重定向。
4. 备份 4 个分区并 md5 校验（本机留存，勿公开）：
   ```bash
   ssh ... 'dd if=/dev/mtd0 of=/tmp/Bootloader.bin bs=64k'   # mtd0 Bootloader / mtd1 Nvram / mtd2 Bdata / mtd3 Factory
   ssh ... 'cat /tmp/Bootloader.bin' > backup/Bootloader.bin
   ```
5. 刷 breed r1338（**勿用 r1416**）：
   ```bash
   ssh ... 'cat > /tmp/breed.bin' < breed-mt7621-xiaomi-r3g-r1338.bin
   ssh ... 'md5sum /tmp/breed.bin; mtd write /tmp/breed.bin Bootloader; dd if=/dev/mtd0 bs=116934 count=1 | md5sum'
   ```
   判定：回读 md5 与文件一致。xmir-patcher 自带的 install_bl 拒绝非 R3G/R3P/RM2100 机型，必须手动 mtd。
6. 进 breed：断电 → 按住 reset 通电 → 灯快闪松开 → 本机加静态 `192.168.1.100/24` → 浏览器 `192.168.1.1`（breed 网段是 1.x，不是 31.x）。
7. breed 刷 OpenWrt 是**两段式**（UI 和 HTTP 都一样）：
   ```bash
   curl -X POST http://192.168.1.1/upload.html \
     -F fw_check=1 -F fw_file=@openwrt-<ver>-ramips-mt7621-xiaomi_mi-router-cr6608-initramfs-kernel.bin \
     -F flash_layout=xiaomi-r3g-fw1 -F autoreboot=1 -F skipboot=1 -F skipeeprom=1 \
     -F fw_type=generic -F submit=Upload          # 返回确认页（只暂存，不写）
   curl http://192.168.1.1/upgrading.html          # 这一步才真正写 flash 并重启
   ```
   判定：确认页显示的大小/MD5 与本地一致；约 1 分钟后 192.168.1.1 出现 LuCI（initramfs 内存系统）。
   说明：breed r3g 版的 `xiaomi-r3g-fw1` 布局在 CR6608 上实测无碍——initramfs 自包含，对偏移不敏感。
8. 持久化：
   ```bash
   ssh root@192.168.1.1 'cat > /tmp/fw.bin' < openwrt-<ver>-...-squashfs-sysupgrade.bin   # 首启空密码
   ssh root@192.168.1.1 '( sysupgrade -n /tmp/fw.bin ) >/dev/null 2>&1 < /dev/null &'
   ```
   判定：重启后 `mount` 有 `/rom squashfs` + `/overlay ubifs`，`/proc/mtd` 变成 kernel+ubi 布局。

## 阶段 3：收尾

- 设 root 密码、设 WiFi 密码；入户线接 WAN。
- 若救援机同时靠 WLAN 上网且路由器 WAN 未接线：把有线接口 metric 调高（如 400）防止默认路由被抢；接好 WAN 后 `Set-NetIPInterface -InterfaceIndex <ETH> -AutomaticMetric Enabled` 还原。
- 拆脚手架：停 DHCP/TFTP 服务、删临时防火墙规则与静态 IP/主机路由、网卡改回 DHCP。

## 回滚路径（任何一步失败）

- breed 还在：按住 reset 上电 → breed 网页重刷。
- 要回原厂：breed 升级页 `boot_file` 回写备份的 Bootloader.bin → 原厂 uboot 回来 → 阶段 1 用 HDR1 ROM 恢复系统。
