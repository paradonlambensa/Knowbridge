// ===== บันทึกข้อผิดพลาดของระบบ (แทน Sentry — ไม่ต้องสมัครบริการภายนอก) =====
// เก็บใน collection error_logs ให้แอดมินดูในเมนูแอดมิน → แท็บ "ข้อผิดพลาด"
// - ข้อผิดพลาดเดียวกัน (ประเภท + ข้อความ + จุดที่เกิด) รวมเป็นแถวเดียว นับจำนวนครั้ง และเวลาล่าสุด
// - ไม่เก็บข้อมูลผู้ใช้: ไม่มี body ของ request ไม่มี id/IP และลบอีเมล token รหัสในลิงก์ฐานข้อมูลออกก่อนบันทึก
// - ลบเองหลังไม่เกิดซ้ำ 30 วัน (TTL index ใน database.js)
const crypto = require('crypto');

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;
const realConsoleError = console.error.bind(console);

// ลบสิ่งที่ไม่ควรติดไปในบันทึก
function scrub(text) {
  return String(text)
    .replace(/\/\/[^/@\s:]+:[^/@\s]+@/g, '//***:***@')                // user:password ในลิงก์ (เช่น mongodb+srv://)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[0-9a-f]{64}\b/gi, '[token]')
    .replace(/\bre_[A-Za-z0-9_]{8,}/g, '[api-key]');
}

// ทำให้ข้อความที่ต่างกันแค่ id/ตัวเลข รวมเป็นกลุ่มเดียวกัน
const normalize = (text) => text.replace(/\b[0-9a-f]{24}\b/gi, ':id').replace(/\d+/g, '#');
const topFrame = (stack) => (stack.split('\n').find(l => /^\s*at /.test(l)) || '').trim();

module.exports = function createErrorLog({ db }) {
  // บันทึกพลาดเองใช้ console.error ตัวจริง (realConsoleError) — ไม่วนกลับมาบันทึกซ้ำ
  async function record({ source = 'server', kind = 'log', message, stack = '', path = '', status = null }) {
    if (!db.error_logs) return; // ฐานข้อมูลยังไม่พร้อม
    try {
      const msg = scrub(message || 'ไม่ทราบสาเหตุ').slice(0, MAX_MESSAGE);
      const stk = scrub(stack || '').slice(0, MAX_STACK);
      const key = crypto.createHash('sha1')
        .update([source, kind, normalize(msg), topFrame(stk), path].join('|')).digest('hex');
      const now = new Date();
      const save = () => db.error_logs.updateOne(
        { key },
        {
          $set: { source, kind, message: msg, stack: stk, path, status, last_seen: now },
          $setOnInsert: { first_seen: now },
          $inc: { count: 1 }
        },
        { upsert: true }
      );
      // error ใหม่เกิดพร้อมกัน 2 ครั้ง → สร้างแถวชนกัน (unique index) — ลองอีกครั้งจะเป็นการบวกจำนวนแทน
      await save().catch(e => (e.code === 11000 ? save() : Promise.reject(e)));
    } catch (e) {
      realConsoleError('บันทึกข้อผิดพลาดไม่สำเร็จ:', e.message);
    }
  }

  // ทุก console.error ใน server (ที่ catch แล้ว log ไว้) ไปอยู่ในบันทึกด้วย
  function captureConsole() {
    console.error = (...args) => {
      realConsoleError(...args);
      const err = args.find(a => a instanceof Error);
      const message = args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a))).join(' ');
      record({ kind: 'log', message, stack: err?.stack || '' });
    };
  }

  return { record, captureConsole, scrub };
};

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}
