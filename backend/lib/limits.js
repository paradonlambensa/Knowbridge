// ===== จำกัดจำนวนครั้ง กันเดารหัสผ่าน / สแปม =====
// เก็บตัวนับในหน่วยความจำ (เพียงพอสำหรับ server ตัวเดียว) — ตั้ง RATE_LIMIT=off เพื่อปิด (ใช้ตอนเทส)
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const MINUTE = 60 * 1000;

function limiter({ windowMs, limit, message, byUser = true, ...rest }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // login แล้วนับต่อบัญชี ยังไม่ login นับต่อ IP
    keyGenerator: (req) => (byUser && req.session?.userId) || ipKeyGenerator(req.ip),
    skip: () => process.env.RATE_LIMIT === 'off',
    handler: (req, res) => res.status(429).json({ success: false, error: message }),
    ...rest
  });
}

module.exports = {
  // นับเฉพาะครั้งที่ login ไม่ผ่าน (ตอบ 4xx)
  login: limiter({
    windowMs: 15 * MINUTE, limit: 10, byUser: false, skipSuccessfulRequests: true,
    message: 'ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่'
  }),
  register: limiter({ windowMs: 60 * MINUTE, limit: 5, byUser: false, message: 'สมัครสมาชิกบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' }),
  // เปลี่ยนรหัส: นับเฉพาะครั้งที่ใส่รหัสเดิมผิด (กันเดารหัสจากเครื่องที่ login ค้างไว้)
  password: limiter({ windowMs: 15 * MINUTE, limit: 10, skipSuccessfulRequests: true, message: 'ลองหลายครั้งเกินไป กรุณารอ 15 นาที' }),
  forgot: limiter({ windowMs: 60 * MINUTE, limit: 10, byUser: false, message: 'ขอรีเซ็ตรหัสผ่านบ่อยเกินไป กรุณารอสักครู่' }),
  post: limiter({ windowMs: 10 * MINUTE, limit: 10, message: 'โพสต์บ่อยเกินไป กรุณารอสักครู่' }),
  comment: limiter({ windowMs: 10 * MINUTE, limit: 30, message: 'แสดงความคิดเห็นบ่อยเกินไป กรุณารอสักครู่' }),
  exchange: limiter({ windowMs: 60 * MINUTE, limit: 20, message: 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่' }),
  report: limiter({ windowMs: 60 * MINUTE, limit: 20, message: 'รายงานบ่อยเกินไป กรุณารอสักครู่' }),
  suggest: limiter({ windowMs: 60 * MINUTE, limit: 10, message: 'เสนอทักษะบ่อยเกินไป กรุณารอสักครู่' }),
  exportData: limiter({ windowMs: 60 * MINUTE, limit: 10, message: 'ดาวน์โหลดข้อมูลบ่อยเกินไป กรุณารอสักครู่' }),
  // กันยิง API รัว ๆ ทั้งระบบ
  api: limiter({ windowMs: MINUTE, limit: 300, message: 'ใช้งานถี่เกินไป กรุณารอสักครู่' })
};
