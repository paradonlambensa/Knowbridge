// ===== บัญชี: เปลี่ยนรหัสผ่าน / ลืมรหัสผ่าน / ตั้งรหัสใหม่จากลิงก์ =====
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sendMail, canSendEmail } = require('../lib/mailer');
const { validatePassword } = require('../lib/accountRules');

const RESET_TTL_MINUTES = 30;

module.exports = function accountRouter({ db, ObjectId, requireLogin, requireAdmin, isValidId, limits, CI }) {
  const router = express.Router();
  // เก็บแค่ hash ของ token — ถ้าฐานข้อมูลหลุด ก็เอา token ไปใช้ไม่ได้
  const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

  // ออกจากระบบทุกเครื่องของผู้ใช้ (ยกเว้นเครื่องที่ระบุ) — session ของ connect-mongo เก็บเป็น JSON string
  async function endSessions(userId, exceptSid) {
    const filter = { session: { $regex: `"userId":"${String(userId)}"` } };
    if (exceptSid) filter._id = { $ne: exceptSid };
    return (await db.sessions.deleteMany(filter)).deletedCount;
  }

  async function createResetLink(req, user) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.password_resets.deleteMany({ user_id: user._id }); // ขอใหม่ → ลิงก์เก่าใช้ไม่ได้
    await db.password_resets.insertOne({
      user_id: user._id,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
      created_at: new Date()
    });
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    // token อยู่หลัง # → ไม่ถูกส่งไปกับ request และไม่ติดใน log ของ server
    return `${base}/#reset=${token}`;
  }

  router.post('/account/password', requireLogin, limits.password, async (req, res) => {
    try {
      const current = String(req.body.current_password || '');
      const next = String(req.body.new_password || '');
      const user = await db.users.findOne({ _id: new ObjectId(req.session.userId) });
      if (!user || !bcrypt.compareSync(current, user.password))
        return res.status(400).json({ success: false, error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
      const invalid = validatePassword(next);
      if (invalid) return res.status(400).json({ success: false, error: invalid });
      if (bcrypt.compareSync(next, user.password))
        return res.status(400).json({ success: false, error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม' });
      await db.users.updateOne({ _id: user._id }, { $set: { password: bcrypt.hashSync(next, 10) } });
      const ended = await endSessions(req.session.userId, req.sessionID);
      res.json({ success: true, other_sessions_ended: ended });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  router.post('/password/forgot', limits.forgot, async (req, res) => {
    try {
      const email = String(req.body.email || '').trim();
      const user = email && await db.users.findOne({ email }, { collation: CI });
      if (user && !user.disabled) {
        const link = await createResetLink(req, user);
        await sendMail({
          to: user.email,
          subject: 'ตั้งรหัสผ่านใหม่ — KnowBridge',
          text: `สวัสดี ${user.username}\n\nกดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ ${RESET_TTL_MINUTES} นาที):\n${link}\n\nถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ`,
          html: `<p>สวัสดี ${user.username.replace(/[<>&]/g, '')}</p><p><a href="${link}">กดที่นี่เพื่อตั้งรหัสผ่านใหม่</a> (ใช้ได้ ${RESET_TTL_MINUTES} นาที)</p><p>ถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ</p>`
        });
      }
      // ตอบเหมือนกันทุกกรณี ไม่บอกว่าอีเมลนี้มีบัญชีหรือไม่
      res.json({ success: true, delivery: canSendEmail() ? 'email' : 'unavailable' });
    } catch (e) {
      console.error('forgot error:', e);
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  router.post('/password/reset', limits.forgot, async (req, res) => {
    try {
      const token = String(req.body.token || '');
      const password = String(req.body.password || '');
      const badLink = { success: false, error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว ขอลิงก์ใหม่อีกครั้ง' };
      if (!/^[0-9a-f]{64}$/.test(token)) return res.status(400).json(badLink);
      // เช็กรหัสก่อนใช้ token จะได้ไม่เสียลิงก์ไปเพราะตั้งรหัสไม่ผ่านกติกา
      const invalid = validatePassword(password);
      if (invalid) return res.status(400).json({ success: false, error: invalid });
      const reset = await db.password_resets.findOneAndDelete({ token_hash: hashToken(token), expires_at: { $gt: new Date() } });
      if (!reset) return res.status(400).json(badLink);
      await db.users.updateOne({ _id: reset.user_id }, { $set: { password: bcrypt.hashSync(password, 10) } });
      await endSessions(reset.user_id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  // ยังไม่ได้ตั้งระบบส่งอีเมล → แอดมินสร้างลิงก์แล้วส่งให้ผู้ใช้ทางช่องทางอื่นได้
  router.post('/admin/users/:id/reset-link', requireLogin, requireAdmin, async (req, res) => {
    try {
      if (!isValidId(req.params.id)) return res.status(404).json({ success: false });
      const user = await db.users.findOne({ _id: new ObjectId(req.params.id) });
      if (!user) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้' });
      res.json({ success: true, link: await createResetLink(req, user), expires_in_minutes: RESET_TTL_MINUTES });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  return router;
};
