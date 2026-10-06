// ===== ใครออนไลน์อยู่ — เก็บในหน่วยความจำเท่านั้น ไม่บันทึกลงฐานข้อมูล =====
// นับ socket ต่อผู้ใช้: เปิดหลายแท็บก็ยังออนไลน์ จนกว่าจะปิดแท็บสุดท้าย
// คนที่เห็นสถานะของเรามีแค่คู่แลกเปลี่ยน (ดู lib/socket.js) และปิดได้ในโปรไฟล์ (users.hide_presence)
module.exports = function createPresence() {
  const sockets = new Map();  // userId → จำนวน socket ที่เปิดอยู่
  const lastSeen = new Map(); // userId → เวลาที่ปิดแท็บสุดท้าย
  const hidden = new Set();   // userId ที่เลือกซ่อนสถานะออนไลน์

  async function loadHidden(db) {
    hidden.clear();
    const rows = await db.users.find({ hide_presence: true }, { projection: { _id: 1 } }).toArray();
    rows.forEach(u => hidden.add(u._id.toString()));
  }

  // คืน true เมื่อเพิ่งออนไลน์ (socket แรก)
  function connect(userId) {
    const n = (sockets.get(userId) || 0) + 1;
    sockets.set(userId, n);
    return n === 1;
  }

  // คืน true เมื่อเพิ่งออฟไลน์ (socket สุดท้ายปิด)
  function disconnect(userId) {
    const n = (sockets.get(userId) || 1) - 1;
    if (n > 0) {
      sockets.set(userId, n);
      return false;
    }
    sockets.delete(userId);
    lastSeen.set(userId, new Date());
    return true;
  }

  // สถานะที่คนอื่นเห็น — คนที่ซ่อนสถานะจะเห็นเป็น hidden ไม่บอกว่าออนไลน์หรือไม่
  function statusOf(userId) {
    const id = String(userId);
    if (hidden.has(id)) return { online: false, last_seen: null, hidden: true };
    const online = sockets.has(id);
    return { online, last_seen: online ? null : lastSeen.get(id) || null };
  }

  return { loadHidden, connect, disconnect, statusOf, hidden, onlineCount: () => sockets.size };
};
