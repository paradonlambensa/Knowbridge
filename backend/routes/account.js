// ===== บัญชี: เปลี่ยนรหัสผ่าน / ลืมรหัสผ่าน / ตั้งรหัสใหม่จากลิงก์ / ข้อมูลส่วนบุคคล (PDPA) =====
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sendMail, canSendEmail, emailFeaturesEnabled } = require('../lib/mailer');
const { validatePassword, validateUsername, validateEmail } = require('../lib/accountRules');
const { PRIVACY_VERSION, exportUserData, deleteUserData } = require('../lib/accountData');

const RESET_TTL_MINUTES = 30;
// ผู้ให้บริการอีเมลปฏิเสธ (เช่น ยังไม่ได้ยืนยันโดเมนกับ Resend) — สาเหตุจริงอยู่ใน log ของ server
const EMAIL_FAILED = 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่ภายหลัง หรือแจ้งผู้ดูแลระบบ';

module.exports = function accountRouter({
  db, ObjectId, io, requireLogin, requireAdmin, isValidId, moderation, limits, CI, DEMO_EMAILS, emailVerification,
  presence, liveStats, realtime
}) {
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

  // เปลี่ยนชื่อผู้ใช้ และ/หรือ อีเมล (ยืนยันด้วยรหัสผ่าน)
  // เครื่องอื่นที่ login ค้างไว้จะถูกออกจากระบบ เพราะ session เก่ายังจำชื่อเดิมอยู่
  router.post('/account/identity', requireLogin, limits.password, async (req, res) => {
    try {
      const user = await db.users.findOne({ _id: new ObjectId(req.session.userId) });
      if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password))
        return res.status(400).json({ success: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      if (DEMO_EMAILS.includes(String(user.email).toLowerCase()))
        return res.status(403).json({ success: false, error: 'บัญชีทดลองเปลี่ยนชื่อหรืออีเมลไม่ได้' });

      const username = req.body.username === undefined ? user.username : String(req.body.username).trim();
      const email = req.body.email === undefined ? user.email : String(req.body.email).trim().toLowerCase();
      const nameChanged = username !== user.username;
      const emailChanged = email !== String(user.email).toLowerCase();
      if (!nameChanged && !emailChanged) return res.status(400).json({ success: false, error: 'ไม่มีข้อมูลที่เปลี่ยน' });
      const invalid = (nameChanged && validateUsername(username)) || (emailChanged && validateEmail(email));
      if (invalid) return res.status(400).json({ success: false, error: invalid });
      // แอดมินกำหนดด้วยอีเมล — ห้ามเปลี่ยนไปใช้อีเมลแอดมินที่ไม่ใช่ของตัวเอง
      if (emailChanged && moderation.isAdminEmail(email))
        return res.status(400).json({ success: false, error: 'ใช้อีเมลนี้ไม่ได้' });

      const or = [];
      if (nameChanged) or.push({ username });
      if (emailChanged) or.push({ email });
      const taken = await db.users.findOne({ _id: { $ne: user._id }, $or: or }, { collation: CI, projection: { username: 1, email: 1 } });
      if (taken) {
        const sameName = nameChanged && taken.username.toLowerCase() === username.toLowerCase();
        return res.status(409).json({ success: false, error: sameName ? 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' : 'อีเมลนี้มีคนใช้แล้ว' });
      }

      const update = { $set: { username, email } };
      if (emailChanged) {
        update.$set.email_verified = false;
        update.$unset = { email_verified_at: '' };
      }
      await db.users.updateOne({ _id: user._id }, update);
      const id = user._id.toString();
      if (nameChanged) {
        // ชื่อในแชทและแจ้งเตือนเก็บเป็นข้อความ — เปลี่ยนตามให้ด้วย
        await db.messages.updateMany({ sender_id: id }, { $set: { sender_name: username } });
        await db.notifications.updateMany({ from: user.username }, { $set: { from: username } });
      }
      let verifyEmailSent = false;
      if (emailChanged) {
        verifyEmailSent = await emailVerification.send(req, { ...user, username, email }).catch(() => false);
        if (canSendEmail()) {
          sendMail({
            to: user.email,
            subject: 'อีเมลของบัญชีถูกเปลี่ยน — KnowBridge',
            text: `บัญชี KnowBridge ของคุณ (${username}) เปลี่ยนอีเมลเป็น ${email} แล้ว\nถ้าคุณไม่ได้เปลี่ยนเอง กรุณาติดต่อผู้ดูแลระบบ`
          }).catch(() => {});
        }
      }
      req.session.username = username;
      req.session.isAdmin = moderation.isAdminEmail(email);
      await endSessions(id, req.sessionID);
      io.in('user:' + id).disconnectSockets(true); // socket เก่ายังจำชื่อเดิม — หน้าเว็บจะโหลดใหม่เอง
      res.json({
        success: true, username, email, verify_email_sent: verifyEmailSent,
        verify_email_failed: emailChanged && emailFeaturesEnabled() && !verifyEmailSent
      });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ success: false, error: 'ชื่อผู้ใช้หรืออีเมลนี้มีคนใช้แล้ว' });
      console.error('identity change error:', e);
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  // แสดง/ซ่อนสถานะออนไลน์ที่คู่แลกเปลี่ยนเห็น
  router.post('/account/presence', requireLogin, async (req, res) => {
    try {
      const visible = req.body.visible !== false;
      const id = req.session.userId;
      await db.users.updateOne({ _id: new ObjectId(id) }, visible ? { $unset: { hide_presence: '' } } : { $set: { hide_presence: true } });
      if (visible) presence.hidden.delete(id); else presence.hidden.add(id);
      await realtime.announcePresence?.(id, { always: true });
      res.json({ success: true, visible });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  // ===== ยืนยันอีเมล =====
  router.post('/account/verify-email/send', requireLogin, limits.forgot, async (req, res) => {
    try {
      const user = await db.users.findOne({ _id: new ObjectId(req.session.userId) });
      if (!user) return res.status(404).json({ success: false });
      if (user.email_verified) return res.json({ success: true, already: true });
      if (!emailFeaturesEnabled()) return res.status(400).json({ success: false, error: 'ระบบส่งอีเมลยังไม่เปิดใช้งาน' });
      if (!(await emailVerification.send(req, user))) return res.status(502).json({ success: false, error: EMAIL_FAILED });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  router.post('/account/verify-email', limits.forgot, async (req, res) => {
    try {
      const user = await emailVerification.verify(req.body.token);
      if (!user) return res.status(400).json({ success: false, error: 'ลิงก์ยืนยันไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว — ขอลิงก์ใหม่ได้ในโปรไฟล์' });
      res.json({ success: true, email: user.email });
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

  // ===== ข้อมูลส่วนบุคคล (PDPA) =====

  // เวอร์ชันนโยบาย + ช่องทางติดต่อ สำหรับหน้า #privacy
  router.get('/privacy', (req, res) => {
    res.json({ version: PRIVACY_VERSION, contact_email: process.env.CONTACT_EMAIL || null });
  });

  // ผู้ใช้เดิม (สมัครก่อนมีนโยบาย / นโยบายเปลี่ยน) กด "รับทราบ"
  router.post('/account/privacy', requireLogin, async (req, res) => {
    try {
      await db.users.updateOne(
        { _id: new ObjectId(req.session.userId) },
        { $set: { privacy_version: PRIVACY_VERSION, privacy_accepted_at: new Date() } }
      );
      res.json({ success: true, version: PRIVACY_VERSION });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  // สิทธิขอรับสำเนาข้อมูล: ดาวน์โหลดทุกอย่างที่เก็บเกี่ยวกับเราเป็นไฟล์ JSON
  router.get('/account/export', requireLogin, limits.exportData, async (req, res) => {
    try {
      const data = await exportUserData({ db }, new ObjectId(req.session.userId));
      if (!data) return res.status(404).json({ success: false, error: 'ไม่พบบัญชี' });
      res.attachment(`knowbridge-my-data-${new Date().toISOString().slice(0, 10)}.json`);
      res.type('application/json').send(JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('export error:', e);
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  // สิทธิขอให้ลบข้อมูล: ลบบัญชีตัวเอง (ยืนยันด้วยรหัสผ่าน) — ลบจริงทันที กู้คืนไม่ได้
  router.post('/account/delete', requireLogin, limits.password, async (req, res) => {
    try {
      const user = await db.users.findOne({ _id: new ObjectId(req.session.userId) });
      if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password))
        return res.status(400).json({ success: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      // บัญชีทดลองใช้ร่วมกันหลายคน ลบแล้วคนอื่นจะเข้าไม่ได้
      if (DEMO_EMAILS.includes(String(user.email).toLowerCase()))
        return res.status(403).json({ success: false, error: 'บัญชีทดลองลบไม่ได้' });
      const deleted = await deleteUserData({ db, ObjectId }, user);
      const id = user._id.toString();
      moderation.banned.delete(id);
      presence.hidden.delete(id);
      liveStats.changed();
      io.in('user:' + id).disconnectSockets(true);
      await endSessions(id); // ทุกเครื่อง รวมเครื่องนี้
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true, deleted });
      });
    } catch (e) {
      console.error('delete account error:', e);
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง' });
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
