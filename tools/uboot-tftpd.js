// 最小 TFTP 服务端（RFC 1350 + blksize OACK），用于 uboot 恢复模式喂固件。
// uboot 会请求 <自身IP十六进制>.img，例如 C0A81F02.img；把固件改成该名放进本脚本目录即可。
// 用法: node uboot-tftpd.js
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 69;
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

function startTransfer(file, rinfo, opts) {
  const buf = fs.readFileSync(file);
  let blksize = 512;
  for (let k = 0; k < opts.length - 1; k++) {
    if (opts[k].toLowerCase() === 'blksize') {
      const v = parseInt(opts[k + 1], 10);
      if (v > 0) blksize = Math.min(v, 1468);
    }
  }
  log(`  serving ${path.basename(file)} size=${buf.length} blksize=${blksize}`);

  const sock = dgram.createSocket('udp4');
  sock.bind(0, () => {
    let block = 1;
    let offset = 0;
    let timer = null;
    let last = null;
    let oackPending = blksize !== 512;
    const started = Date.now();

    const arm = (fn, ms) => { clearTimeout(timer); timer = setTimeout(fn, ms || 2000); };

    const sendOACK = () => {
      const parts = ['blksize', String(blksize)];
      const len = 2 + parts.reduce((s, p) => s + p.length + 1, 0);
      const pkt = Buffer.alloc(len);
      pkt.writeUInt16BE(6, 0);
      let o = 2;
      for (const p of parts) { pkt.write(p, o); o += p.length; pkt[o++] = 0; }
      last = pkt;
      sock.send(pkt, rinfo.port, rinfo.address);
      arm(sendOACK, 3000);
    };

    const retransmit = () => {
      if (!last) return;
      log(`  retransmit block ${block}`);
      sock.send(last, rinfo.port, rinfo.address);
      arm(retransmit);
    };

    const sendBlock = () => {
      const chunk = buf.subarray(offset, offset + blksize);
      const pkt = Buffer.alloc(4 + chunk.length);
      pkt.writeUInt16BE(3, 0);
      pkt.writeUInt16BE(block, 2);
      chunk.copy(pkt, 4);
      last = pkt;
      sock.send(pkt, rinfo.port, rinfo.address);
      if (block % 500 === 1) log(`  DATA block ${block} sent ${offset + chunk.length}/${buf.length}`);
      offset += chunk.length;
      arm(retransmit);
    };

    sock.on('message', (m) => {
      if (m.length < 4) return;
      const op = m.readUInt16BE(0);
      if (op === 5) { log('  ERROR from client:', m.subarray(2).toString()); return; }
      if (op !== 4) return;
      const ack = m.readUInt16BE(2);
      if (oackPending) {
        if (ack === 0) { oackPending = false; clearTimeout(timer); sendBlock(); }
        return;
      }
      if (ack !== block) return;
      clearTimeout(timer);
      if (offset >= buf.length) {
        log(`  TRANSFER COMPLETE: ${buf.length} bytes in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        sock.close();
        return;
      }
      block++;
      sendBlock();
    });

    sock.on('close', () => clearTimeout(timer));
    if (oackPending) sendOACK();
    else sendBlock();
  });
}

const srv = dgram.createSocket({ type: 'udp4', reuseAddr: true });

srv.on('message', (msg, rinfo) => {
  const op = msg.readUInt16BE(0);
  if (op === 1) {
    const parts = [];
    let start = 2;
    for (let j = 2; j < msg.length; j++) {
      if (msg[j] === 0) { parts.push(msg.subarray(start, j).toString()); start = j + 1; }
    }
    const filename = parts[0] || '';
    log('RRQ from', `${rinfo.address}:${rinfo.port}`, 'file=', JSON.stringify(filename), 'opts=', JSON.stringify(parts.slice(2)));
    const local = path.join(ROOT, path.basename(filename));
    if (fs.existsSync(local)) startTransfer(local, rinfo, parts.slice(2));
    else log('  no local file named', path.basename(filename), '| client will retry');
  } else if (op === 2) {
    log('WRQ from', `${rinfo.address}:${rinfo.port}`, JSON.stringify(msg.subarray(2).toString()));
  }
});

srv.on('error', (e) => { log('SERVER ERROR', e.message); process.exit(1); });
srv.bind(PORT, '0.0.0.0', () => log(`TFTP listening 0.0.0.0:${PORT}, dir ${ROOT}`));
