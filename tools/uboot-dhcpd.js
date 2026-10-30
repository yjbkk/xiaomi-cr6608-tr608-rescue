// 小米原厂 uboot 恢复模式的 DHCP 应答器。
// uboot 先 DHCP 后 TFTP；只回应 vendor-class 以 U-Boot 开头（或 MAC 匹配）的请求，避免毒化同网段其他客户端。
// 用法: node uboot-dhcpd.js [客户端MAC,可选]
// 环境: BIND=本机有线 IP(默认 192.168.31.100)  LEASE=发给路由器的 IP(默认 192.168.31.2)
const dgram = require('dgram');

const TARGET_MAC = process.argv[2]
  ? Buffer.from(process.argv[2].split(/[:-]/).map((h) => parseInt(h, 16)))
  : null;
const LEASE = process.env.LEASE || '192.168.31.2';
const SERVER = process.env.BIND || '192.168.31.100';
const MASK = '255.255.255.0';

const ip = (s) => Buffer.from(s.split('.').map(Number));
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

function buildReply(xid, flags, chaddr, msgType) {
  const chunks = [];
  const opt = (code, val) => chunks.push(Buffer.from([code, val.length]), Buffer.from(val));
  opt(53, [msgType]);
  opt(54, ip(SERVER));
  opt(1, ip(MASK));
  opt(3, ip(SERVER));
  opt(6, ip(SERVER));
  opt(51, [0x00, 0x00, 0x0e, 0x10]);
  opt(66, Buffer.from(SERVER, 'ascii'));
  chunks.push(Buffer.from([0xff]));
  const optLen = chunks.reduce((s, b) => s + b.length, 0);

  const pkt = Buffer.alloc(240 + optLen);
  pkt[0] = 2; pkt[1] = 1; pkt[2] = 6; pkt[3] = 0;
  pkt.writeUInt32BE(xid >>> 0, 4);
  pkt.writeUInt16BE(flags, 10);
  ip(LEASE).copy(pkt, 16);
  ip(SERVER).copy(pkt, 20);
  chaddr.copy(pkt, 28, 0, 16);
  Buffer.from([0x63, 0x82, 0x53, 0x63]).copy(pkt, 236);
  let o = 240;
  for (const c of chunks) { c.copy(pkt, o); o += c.length; }
  return pkt;
}

const tx = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const rx = dgram.createSocket({ type: 'udp4', reuseAddr: true });

function parseOptions(buf) {
  const out = {};
  let p = 240;
  while (p < buf.length) {
    const code = buf[p++];
    if (code === 0xff) break;
    if (code === 0x00) continue;
    const len = buf[p++];
    out[code] = buf.subarray(p, p + len);
    p += len;
  }
  return out;
}

rx.on('message', (msg) => {
  if (msg.length < 240 || msg[0] !== 1) return;
  if (msg.readUInt32BE(236) !== 0x63825363) return;
  const xid = msg.readUInt32BE(4);
  const flags = msg.readUInt16BE(10);
  const chaddr = msg.subarray(28, 44);
  const mac = Array.from(chaddr.subarray(0, 6)).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const opts = parseOptions(msg);
  const type = opts[53] ? opts[53][0] : 0;
  const vc = opts[60] ? opts[60].toString('latin1') : '';
  log(`RX type=${type} mac=${mac} vendor-class=${JSON.stringify(vc)}`);

  const isUboot = vc.toLowerCase().indexOf('u-boot') === 0;
  if (!isUboot && !(TARGET_MAC && chaddr.subarray(0, 6).equals(TARGET_MAC))) {
    log('  ignored: not the router in recovery');
    return;
  }
  let replyType = 0;
  if (type === 1) replyType = 2;
  else if (type === 3) replyType = 5;
  if (!replyType) return;

  // 必须用绑定到 SERVER 的 socket 发子网定向广播；发 255.255.255.255 在 Windows 上 EACCES
  const pkt = buildReply(xid, flags, chaddr, replyType);
  const bcast = LEASE.split('.').slice(0, 3).join('.') + '.255';
  tx.send(pkt, 68, bcast, (e) => {
    if (e) log('  send failed', e.message);
    else log(`  TX ${replyType === 2 ? 'OFFER' : 'ACK'} yiaddr=${LEASE} siaddr=${SERVER} -> ${bcast}:68`);
  });
});

tx.bind(67, SERVER, () => log(`tx bound ${SERVER}:67`));
rx.bind(67, '0.0.0.0', () => log(`listening 0.0.0.0:67, lease ${LEASE}, server ${SERVER}`));
