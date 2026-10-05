// ===== ยืนยันอีเมล: ส่งลิงก์ (ใช้ได้ 24 ชั่วโมง ครั้งเดียว) แล้วกดยืนยัน =====
// ส่งได้เมื่อตั้ง RESEND_API_KEY แล้ว — ตอนรันในเครื่องพิมพ์ลิงก์ออก console แทน (lib/mailer.js)
const crypto = require('crypto');
const { sendMail, emailFeaturesEnabled } = require('./mailer');

const VERIFY_TTL_HOURS = 24;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const siteOrigin = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

module.exports = function createEmailVerification({ db }) {
  // ส่งลิงก์ไปที่อีเมลปัจจุบันของบัญชี — ขอใหม่แล้วลิงก์เก่าใช้ไม่ได้
  // คืน true เมื่อส่งออกไปจริง, false เมื่อปิดใช้อยู่หรือผู้ให้บริการอีเมลปฏิเสธ
  async function send(req, user) {
    if (!emailFeaturesEnabled()) return false;
    const token = crypto.randomBytes(32).toString('hex');
    await db.email_verifications.deleteMany({ user_id: user._id });
    await db.email_verifications.insertOne({
      user_id: user._id,
      email: user.email,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000),
      created_at: new Date()
    });
    // token อยู่หลัง # → ไม่ถูกส่งไปกับ request และไม่ติดใน log ของ server
    const link = `${siteOrigin(req)}/#verify=${token}`;
    const name = String(user.username).replace(/[<>&]/g, '');
    return sendMail({
      to: user.email,
      subject: 'ยืนยันอีเมล — KnowBridge',
      text: `สวัสดี ${user.username}\n\nกดลิงก์นี้เพื่อยืนยันอีเมลของบัญชี KnowBridge (ใช้ได้ ${VERIFY_TTL_HOURS} ชั่วโมง):\n${link}\n\nถ้าคุณไม่ได้สมัคร ไม่ต้องทำอะไร`,
      html: `<p>สวัสดี ${name}</p><p><a href="${link}">กดที่นี่เพื่อยืนยันอีเมล</a> (ใช้ได้ ${VERIFY_TTL_HOURS} ชั่วโมง)</p><p>ถ้าคุณไม่ได้สมัคร ไม่ต้องทำอะไร</p>`
    });
  }

  // คืนบัญชีที่ยืนยันสำเร็จ หรือ null ถ้าลิงก์ใช้ไม่ได้ (หมดอายุ / ใช้ไปแล้ว / เปลี่ยนอีเมลไปแล้ว)
  async function verify(token) {
    if (!/^[0-9a-f]{64}$/.test(String(token))) return null;
    const row = await db.email_verifications.findOneAndDelete({ token_hash: hashToken(token), expires_at: { $gt: new Date() } });
    if (!row) return null;
    return db.users.findOneAndUpdate(
      { _id: row.user_id, email: row.email },
      { $set: { email_verified: true, email_verified_at: new Date() } },
      { returnDocument: 'after', projection: { username: 1, email: 1 } }
    );
  }

  return { send, verify };
};
