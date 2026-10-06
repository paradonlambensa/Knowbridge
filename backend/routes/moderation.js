// ===== ดูแลเนื้อหา: รายงาน / บล็อก / แอดมิน =====
const express = require('express');

const REPORT_REASONS = {
  spam: 'สแปม / โฆษณา',
  inappropriate: 'ไม่เหมาะสม / หยาบคาย',
  harassment: 'คุกคาม / กลั่นแกล้ง',
  misinformation: 'ข้อมูลเท็จ',
  other: 'อื่น ๆ'
};
const AUTO_HIDE_AT = 3; // คนรายงานไม่ซ้ำกันครบเท่านี้ → ซ่อนไว้ก่อนรอแอดมินตรวจ

module.exports = function moderationRouter({ db, ObjectId, io, requireLogin, requireAdmin, isValidId, moderation, limits }) {
  const router = express.Router();
  // ดึง collection ตอนมี request (ตอนสร้าง router ยังเชื่อม DB ไม่เสร็จ db.posts ยังเป็น undefined)
  const coll = (type) => ({ post: db.posts, comment: db.comments, user: db.users })[type];

  // ผู้เขียน/เจ้าของของสิ่งที่ถูกรายงาน
  async function findTarget(type, id) {
    const doc = await coll(type).findOne({ _id: new ObjectId(id) });
    if (!doc) return null;
    return { doc, ownerId: type === 'user' ? doc._id : doc.author_id };
  }

  router.post('/reports', requireLogin, limits.report, async (req, res) => {
    try {
      const { type, target_id, reason } = req.body;
      if (!coll(type) || !isValidId(target_id) || !REPORT_REASONS[reason])
        return res.status(400).json({ success: false, error: 'ข้อมูลรายงานไม่ถูกต้อง' });
      const target = await findTarget(type, target_id);
      if (!target) return res.status(404).json({ success: false, error: 'ไม่พบสิ่งที่รายงาน' });
      const me = new ObjectId(req.session.userId);
      if (target.ownerId.equals(me)) return res.status(400).json({ success: false, error: 'รายงานของตัวเองไม่ได้' });

      const targetId = new ObjectId(target_id);
      // รายงานซ้ำเรื่องเดิม ไม่นับเพิ่ม
      const already = await db.reports.findOne({ reporter_id: me, type, target_id: targetId, status: 'open' });
      if (!already) {
        await db.reports.insertOne({
          reporter_id: me, type, target_id: targetId, owner_id: target.ownerId,
          reason, detail: String(req.body.detail || '').trim().slice(0, 300),
          status: 'open', created_at: new Date()
        });
        if (type !== 'user') {
          const reporters = await db.reports.distinct('reporter_id', { type, target_id: targetId, status: 'open' });
          if (reporters.length >= AUTO_HIDE_AT) await coll(type).updateOne({ _id: targetId }, { $set: { hidden: true } });
        }
      }
      res.json({ success: true, already: !!already });
    } catch (e) {
      console.error('report error:', e);
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  // บล็อก / เลิกบล็อก (กดซ้ำ = สลับ)
  router.post('/blocks/:userId', requireLogin, async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isValidId(userId) || userId === req.session.userId)
        return res.status(400).json({ success: false, error: 'บล็อกผู้ใช้นี้ไม่ได้' });
      if (!(await db.users.findOne({ _id: new ObjectId(userId) }, { projection: { _id: 1 } })))
        return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้' });
      const pair = { blocker_id: new ObjectId(req.session.userId), blocked_id: new ObjectId(userId) };
      const { deletedCount } = await db.blocks.deleteOne(pair);
      if (!deletedCount) await db.blocks.insertOne({ ...pair, created_at: new Date() });
      res.json({ success: true, blocked: !deletedCount });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  router.get('/blocks', requireLogin, async (req, res) => {
    try {
      const rows = await db.blocks.find({ blocker_id: new ObjectId(req.session.userId) }).sort({ _id: -1 }).toArray();
      const users = await db.users.find({ _id: { $in: rows.map(r => r.blocked_id) } }, { projection: { username: 1 } }).toArray();
      res.json(users.map(u => ({ id: u._id, username: u.username })));
    } catch (e) {
      res.json([]);
    }
  });

  // ===== แอดมิน =====

  // รายงานที่ยังไม่จัดการ รวมเป็นรายการละ 1 สิ่ง (โพสต์/ความคิดเห็น/ผู้ใช้)
  router.get('/admin/reports', requireLogin, requireAdmin, async (req, res) => {
    try {
      const groups = await db.reports.aggregate([
        { $match: { status: 'open' } },
        { $group: {
          _id: { type: '$type', target_id: '$target_id' },
          owner_id: { $first: '$owner_id' },
          count: { $sum: 1 },
          reasons: { $push: '$reason' },
          details: { $push: '$detail' },
          latest: { $max: '$created_at' }
        } },
        { $sort: { count: -1, latest: -1 } },
        { $limit: 100 }
      ]).toArray();

      const owners = await db.users.find(
        { _id: { $in: groups.map(g => g.owner_id) } }, { projection: { username: 1, disabled: 1 } }
      ).toArray();
      const items = await Promise.all(groups.map(async g => {
        const target = await coll(g._id.type).findOne({ _id: g._id.target_id });
        const owner = owners.find(o => o._id.equals(g.owner_id));
        const reasons = {};
        g.reasons.forEach(r => { reasons[REPORT_REASONS[r] || r] = (reasons[REPORT_REASONS[r] || r] || 0) + 1; });
        return {
          type: g._id.type,
          target_id: g._id.target_id,
          exists: !!target,
          preview: !target ? '(ถูกลบไปแล้ว)' : g._id.type === 'user' ? (target.bio || '') : target.text,
          hidden: !!target?.hidden,
          owner: owner ? { id: owner._id, username: owner.username, banned: !!owner.disabled } : null,
          count: g.count,
          reasons,
          details: g.details.filter(Boolean).slice(0, 3),
          latest: g.latest
        };
      }));
      res.json(items);
    } catch (e) {
      console.error('admin reports error:', e);
      res.status(500).json([]);
    }
  });

  // ปิดรายงาน: dismiss = ไม่ผิด (คืนเนื้อหาที่ถูกซ่อน) / remove = ลบเนื้อหานั้นทิ้ง
  router.post('/admin/reports/resolve', requireLogin, requireAdmin, async (req, res) => {
    try {
      const { type, target_id, action } = req.body;
      if (!coll(type) || !isValidId(target_id) || !['dismiss', 'remove'].includes(action))
        return res.status(400).json({ success: false });
      const targetId = new ObjectId(target_id);
      if (action === 'dismiss' && type !== 'user') {
        await coll(type).updateOne({ _id: targetId }, { $unset: { hidden: '' } });
      }
      if (action === 'remove') {
        if (type === 'post') {
          await db.posts.deleteOne({ _id: targetId });
          await db.comments.deleteMany({ post_id: targetId });
          io.emit('feed:delete', { post_id: target_id });
        } else if (type === 'comment') {
          const comment = await db.comments.findOneAndDelete({ _id: targetId });
          if (comment) {
            const post = await db.posts.findOneAndUpdate(
              { _id: comment.post_id }, { $inc: { comment_count: -1 } }, { returnDocument: 'after', projection: { comment_count: 1 } }
            );
            if (post) io.emit('feed:counts', { post_id: comment.post_id.toString(), comment_count: post.comment_count });
          }
        } else {
          return res.status(400).json({ success: false, error: 'ผู้ใช้ใช้ปุ่มระงับบัญชีแทน' });
        }
      }
      await db.reports.updateMany(
        { type, target_id: targetId, status: 'open' },
        { $set: { status: action === 'remove' ? 'removed' : 'dismissed', resolved_by: new ObjectId(req.session.userId), resolved_at: new Date() } }
      );
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  // ระงับ / ปลดระงับบัญชี — ไม่ลบข้อมูล แค่ login ไม่ได้และถูกซ่อนจากทุกที่
  router.post('/admin/users/:id/ban', requireLogin, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidId(id) || id === req.session.userId) return res.status(400).json({ success: false, error: 'ระงับบัญชีนี้ไม่ได้' });
      const user = await db.users.findOne({ _id: new ObjectId(id) }, { projection: { email: 1 } });
      if (!user) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้' });
      if (moderation.isAdminEmail(user.email)) return res.status(400).json({ success: false, error: 'ระงับบัญชีแอดมินไม่ได้' });
      const banned = req.body.banned !== false;
      await db.users.updateOne({ _id: user._id }, { $set: { disabled: banned } });
      if (banned) {
        moderation.banned.add(id);
        io.in('user:' + id).disconnectSockets(true); // ตัดแชท/แจ้งเตือนที่เปิดค้างอยู่
        await db.reports.updateMany(
          { type: 'user', target_id: user._id, status: 'open' },
          { $set: { status: 'banned', resolved_by: new ObjectId(req.session.userId), resolved_at: new Date() } }
        );
      } else {
        moderation.banned.delete(id);
      }
      res.json({ success: true, banned });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  return router;
};

module.exports.REPORT_REASONS = REPORT_REASONS;
