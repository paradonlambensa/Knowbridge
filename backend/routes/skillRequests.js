// ===== เสนอทักษะใหม่ (ผู้ใช้) / อนุมัติ-ไม่อนุมัติ (แอดมิน) =====
// คนเสนอทักษะชื่อเดียวกันหลายคน → รวมเป็นคำขอเดียว อนุมัติแล้วทุกคนได้แจ้งเตือน
// และระบบเพิ่มทักษะเข้าโปรไฟล์ให้เลย (ถ้ายังไม่ครบ 5 ทักษะในประเภทนั้น)
const express = require('express');
const { CATEGORIES, MAX_SKILLS_PER_TYPE, normalizeSkillName } = require('../lib/skillCatalog');

const MAX_PENDING_PER_USER = 5;

module.exports = function skillRequestsRouter({ db, ObjectId, notify, requireLogin, requireAdmin, isValidId, limits, CI }) {
  const router = express.Router();

  router.post('/skills/suggest', requireLogin, limits.suggest, async (req, res) => {
    try {
      const { name, error } = normalizeSkillName(req.body.name);
      if (error) return res.status(400).json({ success: false, error });
      const category = String(req.body.category || '');
      if (!CATEGORIES.includes(category)) return res.status(400).json({ success: false, error: 'กรุณาเลือกหมวดหมู่' });
      const type = req.body.type === 'learn' ? 'learn' : 'teach';
      const me = new ObjectId(req.session.userId);

      const existing = await db.skills.findOne({ name }, { collation: CI });
      if (existing) {
        return res.status(409).json({ success: false, error: `มีทักษะ "${existing.name}" อยู่แล้ว เลือกจากรายการได้เลย`, skill_id: existing._id });
      }
      const pending = await db.skill_requests.findOne({ name, status: 'pending' }, { collation: CI });
      if (pending?.requests.some(r => r.user_id.equals(me))) {
        return res.status(409).json({ success: false, error: 'คุณเสนอทักษะนี้ไปแล้ว รอแอดมินตรวจสอบ' });
      }
      const mine = await db.skill_requests.countDocuments({ status: 'pending', 'requests.user_id': me });
      if (mine >= MAX_PENDING_PER_USER) {
        return res.status(429).json({ success: false, error: `เสนอได้ครั้งละไม่เกิน ${MAX_PENDING_PER_USER} ทักษะ รอแอดมินตรวจก่อนนะ` });
      }

      const entry = { user_id: me, type, at: new Date() };
      let request;
      if (pending) {
        // มีคนเสนอชื่อนี้อยู่แล้ว → นับเป็นเสียงสนับสนุนเพิ่ม
        request = await db.skill_requests.findOneAndUpdate(
          { _id: pending._id }, { $push: { requests: entry } }, { returnDocument: 'after' }
        );
      } else {
        request = { name, category, status: 'pending', requests: [entry], created_at: new Date() };
        request._id = (await db.skill_requests.insertOne(request)).insertedId;
      }
      res.json({ success: true, joined: !!pending, request: { _id: request._id, name: request.name, category: request.category, type } });
    } catch (e) {
      console.error('suggest skill error:', e);
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  // ทักษะที่เราเสนอและยังรอแอดมินตรวจ (แสดงในโปรไฟล์)
  router.get('/skills/suggestions/mine', requireLogin, async (req, res) => {
    try {
      const me = new ObjectId(req.session.userId);
      const rows = await db.skill_requests.find({ status: 'pending', 'requests.user_id': me }).sort({ _id: -1 }).toArray();
      res.json(rows.map(r => ({
        _id: r._id, name: r.name, category: r.category,
        type: r.requests.find(x => x.user_id.equals(me)).type
      })));
    } catch (e) {
      res.json([]);
    }
  });

  // ===== แอดมิน =====
  router.get('/admin/skill-requests', requireLogin, requireAdmin, async (req, res) => {
    try {
      const rows = await db.skill_requests.find({ status: 'pending' }).sort({ _id: 1 }).limit(100).toArray();
      const users = await db.users.find(
        { _id: { $in: rows.flatMap(r => r.requests.map(x => x.user_id)) } }, { projection: { username: 1 } }
      ).toArray();
      res.json(rows.map(r => ({
        _id: r._id, name: r.name, category: r.category, created_at: r.created_at,
        count: r.requests.length,
        users: r.requests.map(x => users.find(u => u._id.equals(x.user_id))?.username).filter(Boolean)
      })));
    } catch (e) {
      res.status(500).json([]);
    }
  });

  // approve: แอดมินแก้ชื่อ/หมวดก่อนอนุมัติได้ — ถ้าชื่อซ้ำกับทักษะที่มีอยู่ ผูกกับทักษะนั้นแทนการสร้างใหม่
  router.post('/admin/skill-requests/:id', requireLogin, requireAdmin, async (req, res) => {
    try {
      if (!isValidId(req.params.id) || !['approve', 'reject'].includes(req.body.action))
        return res.status(400).json({ success: false, error: 'ข้อมูลไม่ถูกต้อง' });
      const request = await db.skill_requests.findOne({ _id: new ObjectId(req.params.id), status: 'pending' });
      if (!request) return res.status(404).json({ success: false, error: 'ไม่พบคำขอนี้ หรือจัดการไปแล้ว' });
      const resolved = { resolved_by: new ObjectId(req.session.userId), resolved_at: new Date() };

      if (req.body.action === 'reject') {
        await db.skill_requests.updateOne({ _id: request._id }, { $set: { status: 'rejected', ...resolved } });
        for (const r of request.requests) notify(r.user_id, { type: 'skill_rejected', skill_name: request.name });
        return res.json({ success: true });
      }

      const { name, error } = normalizeSkillName(req.body.name ?? request.name);
      if (error) return res.status(400).json({ success: false, error });
      const category = CATEGORIES.includes(req.body.category) ? req.body.category : request.category;
      let skill = await db.skills.findOne({ name }, { collation: CI });
      if (!skill) {
        skill = { name, category, created_at: new Date(), suggested: true };
        skill._id = (await db.skills.insertOne(skill)).insertedId;
      }
      await db.skill_requests.updateOne(
        { _id: request._id }, { $set: { status: 'approved', skill_id: skill._id, name: skill.name, category: skill.category, ...resolved } }
      );

      // เพิ่มเข้าโปรไฟล์คนที่เสนอ (ถ้ายังไม่มีทักษะนี้ และยังไม่ครบโควตาในประเภทนั้น)
      let added = 0;
      for (const r of request.requests) {
        const mine = await db.user_skills.find({ user_id: r.user_id }).toArray();
        const canAdd = !mine.some(s => s.skill_id.equals(skill._id)) && mine.filter(s => s.type === r.type).length < MAX_SKILLS_PER_TYPE;
        if (canAdd) {
          await db.user_skills.insertOne({ user_id: r.user_id, skill_id: skill._id, type: r.type });
          added++;
        }
        notify(r.user_id, { type: 'skill_approved', skill_name: skill.name, added: canAdd });
      }
      res.json({ success: true, skill: { _id: skill._id, name: skill.name, category: skill.category }, added });
    } catch (e) {
      console.error('resolve skill request error:', e);
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  return router;
};
