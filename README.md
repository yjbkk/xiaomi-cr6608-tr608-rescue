# 小米 / 红米 MT7621 救砖 + 刷 OpenWrt 实战手册（CR6608 / TR608 / CR660x）

> Field-proven on 2026-10-30 on a Xiaomi **TR608**（移动定制版 CR6608）：全砖 → 原厂 uboot TFTP 救活 → 解锁 SSH → breed → OpenWrt 25.12.6，每一步都在真机上验证过。
> 写给人，也写给 agent：所有步骤带命令、判定条件和失败分支。

## 适用机型

| 型号 | 说明 |
|---|---|
| TR608 | 中国移动定制版 CR6608（本手册实测机型） |
| CR6608 / CR6606 / CR6609 | 公版 / 联通 / 电信定制，硬件同 AX1800：MT7621A + 256MB RAM + 128MB NAND |
| 红米 AX1800 (RA71) | 同硬件公版，官方固件可与 CR6608 互刷 |

## 30 秒结论

- **砖了**（灯常红或紫/粉闪、网口链路 Up 1Gbps 但零流量零 ARP）：原厂 uboot 还活着。进恢复模式（断电 → 按住 reset 通电 → 灯变色闪烁后松开），uboot 会**先发 DHCP DISCOVER（vendor-class 字段就是 `U-Boot`）**，拿到 IP 后再发 TFTP RRQ，文件名是**自身 IP 的十六进制 + `.img`**（如 192.168.31.2 → `C0A81F02.img`）。
  **这条路只认带 `HDR1` 头的小米官方 ROM**；OpenWrt 裸 uImage 会被完整传完但不写 flash，机器照旧砖。
- **能进系统**：xmir-patcher 解锁 SSH（密码是 `root`，不是 web 密码）→ 备份 4 个分区 → `mtd write` breed r1338 → breed 网页**两段式**刷 OpenWrt initramfs → 起来后 `sysupgrade`。
- 分步命令与判定见 [RUNBOOK.md](RUNBOOK.md)；症状→原因→处置见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)；固件直链与校验值见 [firmware-manifest.json](firmware-manifest.json)；DHCP/TFTP 服务脚本在 [tools/](tools)。

## 仓库结构

```
RUNBOOK.md              可执行手册：阶段 0 侦察 → 阶段 1 救砖 → 阶段 2 刷 OpenWrt → 阶段 3 收尾
TROUBLESHOOTING.md      症状对照表（灯色、链路、ARP、TFTP、SSH、网段冲突）
firmware-manifest.json  官方 ROM / OpenWrt / breed / xmir-patcher 的直链、大小、sha256
tools/uboot-dhcpd.js    恢复模式专用 DHCP 应答器（按 vendor-class/MAC 过滤，不毒化局域网）
tools/uboot-tftpd.js    最小 TFTP 服务端（支持 blksize OACK、正确重传）
tools/dhcp-parse.js     从 pcapng 里解析 DHCP 选项，用于确认对端是不是 uboot
```

## 安全须知

- 动 bootloader **之前**必备份 `Bootloader / Nvram / Bdata / Factory` 四个分区（`ssh cat` 拉回本机并 md5 校验）。
  **这些备份是设备专属的（含 WiFi 校准、SN、运营商密钥），不要提交或公开分享。**
- breed 是安全网：任何时候按住 reset 上电都能回 breed 网页（192.168.1.1）；breed 升级页的 `boot_file` 字段可回写原厂 uboot，再配合 HDR1 官方 ROM 可完全回到出厂。
- 真正不可逆的只有「刷写/传输过程中断电」。只要 uboot 或 breed 还在，所有失败都能重试。

## 已验证环境

Windows 10 + Git Bash + Node 24 + OpenSSH 9.9；路由器先刷红米 AX1800 官方固件 1.0.88；OpenWrt 25.12.6（ramips/mt7621）；breed r1338（git-839fb85）。
