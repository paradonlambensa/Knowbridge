// ===== สมัคร / เข้าสู่ระบบ / ออกจากระบบ =====
const express = require('express');
const bcrypt = require('bcryptjs');
const { validateAccount } = require('../lib/accountRules');
const { PRIVACY_VERSION } = require('../lib/accountData');
const { emailFeaturesEnabled } = require('../lib/mailer');

module.exports = function authRouter({ db, moderation, limits, CI, emailVerification }) {
  const router = express.Router();

  function startSession(req, user) {
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.isAdmin = moderation.isAdminEmail(user.email);
  }

  router.post('/register', limits.register, async (req, res) => {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!username || !email || !password)
      return res.status(400).json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ' });
    const invalid = validateAccount({ username, email, password });
    if (invalid) return res.status(400).json({ success: false, error: invalid });
    // PDPA: แจ้งนโยบายก่อนเก็บข้อมูล และบันทึกว่ายอมรับเวอร์ชันไหน เมื่อไร
    if (req.body.accept_privacy !== true)
      return res.status(400).json({ success: false, error: 'กรุณาอ่านและยอมรับนโยบายความเป็นส่วนตัวก่อนสมัคร' });
    try {
      const existing = await db.users.findOne({ $or: [{ email }, { username }] }, { collation: CI });
      if (existing) return res.status(409).json({ success: false, error: 'ชื่อผู้ใช้หรืออีเมลนี้มีคนใช้แล้ว' });
      const hashed = bcrypt.hashSync(password, 10);
      const now = new Date();
      const user = { username, email, password: hashed, bio: '', created_at: now, privacy_version: PRIVACY_VERSION, privacy_accepted_at: now };
      const result = await db.users.insertOne(user);
      startSession(req, { ...user, _id: result.insertedId });
      // ส่งลิงก์ยืนยันอีเมล (ส่งไม่สำเร็จก็ยังสมัครได้ ขอลิงก์ใหม่ได้ในโปรไฟล์)
      const verifyEmailSent = await emailVerification.send(req, { ...user, _id: result.insertedId }).catch(() => false);
      res.json({ success: true, verify_email_sent: verifyEmailSent, verify_email_failed: emailFeaturesEnabled() && !verifyEmailSent });
    } catch (e) {
      // สมัครพร้อมกันสองคนด้วยอีเมลเดียวกัน → unique index กันไว้
      if (e.code === 11000) return res.status(409).json({ success: false, error: 'ชื่อผู้ใช้หรืออีเมลนี้มีคนใช้แล้ว' });
      console.error('Register error:', e);
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  router.post('/login', limits.login, async (req, res) => {
    try {
      const email = String(req.body.email || '').trim();
      const password = String(req.body.password || '');
      // อีเมลไม่สนตัวพิมพ์เล็ก-ใหญ่ (รองรับบัญชีเก่าที่สมัครด้วยตัวพิมพ์ใหญ่ด้วย)
      const user = email && await db.users.findOne({ email }, { collation: CI });
      if (!user || !bcrypt.compareSync(password, user.password))
        return res.status(401).json({ success: false, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
      if (user.disabled) return res.status(403).json({ success: false, error: 'บัญชีนี้ถูกระงับการใช้งาน' });
      startSession(req, user);
      res.json({ success: true, username: user.username });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  router.post('/logout', (req, res) => {
    // รอให้ลบ session ออกจาก MongoDB เสร็จก่อนตอบ ไม่งั้นหน้าเว็บที่ reload ทันทีอาจยังเห็นว่า login อยู่
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });

  return router;
};
