// 从 pcapng 里抠出所有 DHCP 载荷并解析选项，用于确认对端是不是 uboot（vendor-class="U-Boot"）。
// 用法: node dhcp-parse.js <file.pcapng> [...more]
// 配合: pktmon etl2pcap cap.etl -o cap.pcapng
const fs = require('fs');

const MAGIC = Buffer.from([0x63, 0x82, 0x53, 0x63]);
const NAMES = {
  1: 'netmask', 3: 'router', 6: 'dns', 12: 'hostname', 50: 'requested-ip',
  51: 'lease-time', 53: 'msg-type', 54: 'server-id', 55: 'param-list',
  60: 'vendor-class', 61: 'client-id', 66: 'tftp-server', 67: 'bootfile'
};
const MSGTYPE = { 1: 'DISCOVER', 2: 'OFFER', 3: 'REQUEST', 5: 'ACK', 6: 'NAK', 8: 'INFORM' };

const seen = new Set();
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  let idx = 0;
  while ((idx = buf.indexOf(MAGIC, idx)) !== -1) {
    const hdrStart = idx - 24;
    const opts = [];
    let p = idx + 4;
    while (p < buf.length && p < idx + 400) {
      const code = buf[p++];
      if (code === 0xff) break;
      if (code === 0x00) continue;
      const len = buf[p++];
      const val = buf.subarray(p, p + len);
      p += len;
      const name = NAMES[code] || `opt${code}`;
      let disp;
      if (code === 53) disp = MSGTYPE[val[0]] || String(val[0]);
      else if ([1, 3, 6, 50, 54].includes(code)) disp = Array.from(val).join('.');
      else if (val.length > 1 && /^[\x20-\x7e]*$/.test(val.toString('latin1'))) disp = JSON.stringify(val.toString('latin1'));
      else disp = val.toString('hex');
      opts.push(`${name}=${disp}`);
    }
    const ciaddr = hdrStart >= 0 ? Array.from(buf.subarray(hdrStart + 12, hdrStart + 16)).join('.') : '';
    const key = opts.join('|') + ciaddr;
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`[${f}] ciaddr=${ciaddr} :: ${opts.join('  ')}`);
    }
    idx += 4;
  }
}
if (seen.size === 0) console.log('no DHCP payloads found');
