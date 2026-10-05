// ===== เชื่อม MongoDB Atlas (mongodb+srv://) ให้ได้แม้ DNS ของเครื่องไม่ตอบ SRV record =====
// บางเครื่อง Windows (DNS ชี้ไปที่ 127.0.0.1, VPN, โปรแกรมกรองโฆษณา) Node จะได้ querySrv ECONNREFUSED
// ทั้งที่เบราว์เซอร์ใช้เน็ตได้ปกติ → ลองใหม่อีกครั้งด้วย DNS สาธารณะ (บน Render ไม่เคยเข้าเงื่อนไขนี้)
const dns = require('dns');

const PUBLIC_DNS = ['8.8.8.8', '1.1.1.1'];

async function connectWithDnsFallback(client) {
  try {
    return await client.connect();
  } catch (e) {
    if (!String(e?.message).includes('querySrv')) throw e;
    console.warn(`⚠️ DNS ของเครื่องนี้หา MongoDB ไม่เจอ (${e.message}) — ลองใหม่ด้วย DNS สาธารณะ ${PUBLIC_DNS.join(', ')}`);
    dns.setServers(PUBLIC_DNS);
    return client.connect();
  }
}

module.exports = { connectWithDnsFallback };
