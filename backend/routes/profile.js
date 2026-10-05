// ===== โปรไฟล์ของฉัน / โปรไฟล์สาธารณะ / คะแนนและรีวิวของผู้ใช้ =====
const express = require('express');
const { PRIVACY_VERSION } = require('../lib/accountData');
const { MAX_SKILLS_PER_TYPE } = require('../lib/skillCatalog');
const { emailFeaturesEnabled } = require('../lib/mailer');

module.exports = function profileRouter({ db, ObjectId, requireLogin, isValidId, moderation, getRatings, getReviewsFor }) {
  const router = express.Router();

  router.get('/profile', requireLogin, async (req, res) => {
    try {
      const user = await db.users.findOne({ _id: new ObjectId(req.session.userId) }, { projection: { password: 0 } });
      const userSkills = await db.user_skills.find({ user_id: new ObjectId(req.session.userId) }).toArray();
      const skillsWithInfo = await Promise.all(userSkills.map(async (us) => {
        const skill = await db.skills.findOne({ _id: us.skill_id });
        return { ...us, skill_id: us.skill_id.toString(), skill_name: skill?.name, category: skill?.category };
      }));
      req.session.isAdmin = moderation.isAdminEmail(user?.email);
      res.json({
        user, skills: skillsWithInfo, is_admin: req.session.isAdmin,
        privacy_current: PRIVACY_VERSION, email_verification_enabled: emailFeaturesEnabled()
      });
    } catch (e) {
      res.json({ user: null, skills: [] });
    }
  });

  router.post('/profile/update', requireLogin, async (req, res) => {
    try {
      const me = new ObjectId(req.session.userId);
      const clean = (list) => [...new Set((Array.isArray(list) ? list : []).filter(isValidId))];
      const teach = clean(req.body.teach_skills);
      // ทักษะเดียวกันจะ "สอน" และ "อยากเรียน" พร้อมกันไม่ได้ — ให้ฝั่งสอนชนะ
      const learn = clean(req.body.learn_skills).filter(id => !teach.includes(id));
      if (teach.length > MAX_SKILLS_PER_TYPE || learn.length > MAX_SKILLS_PER_TYPE)
        return res.json({ success: false, error: `เลือกได้ไม่เกิน ${MAX_SKILLS_PER_TYPE} ทักษะต่อประเภท` });

      // เก็บเฉพาะทักษะที่มีอยู่จริงในแคตตาล็อก
      const existing = await db.skills.find(
        { _id: { $in: [...teach, ...learn].map(id => new ObjectId(id)) } }, { projection: { _id: 1 } }
      ).toArray();
      const valid = new Set(existing.map(s => s._id.toString()));
      const docs = [
        ...teach.filter(id => valid.has(id)).map(id => ({ user_id: me, skill_id: new ObjectId(id), type: 'teach' })),
        ...learn.filter(id => valid.has(id)).map(id => ({ user_id: me, skill_id: new ObjectId(id), type: 'learn' }))
      ];

      await db.users.updateOne({ _id: me }, { $set: { bio: String(req.body.bio || '').slice(0, 500) } });
      await db.user_skills.deleteMany({ user_id: me });
      if (docs.length) await db.user_skills.insertMany(docs);
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false });
    }
  });

  router.get('/user/:userId/rating', async (req, res) => {
    try {
      if (!isValidId(req.params.userId)) return res.json({ avg: null, count: 0 });
      const ratings = await getRatings([new ObjectId(req.params.userId)]);
      res.json(ratings[req.params.userId] || { avg: null, count: 0 });
    } catch (e) {
      res.json({ avg: null, count: 0 });
    }
  });

  router.get('/user/:userId/reviews', async (req, res) => {
    try {
      if (!isValidId(req.params.userId)) return res.json([]);
      res.json(await getReviewsFor(new ObjectId(req.params.userId)));
    } catch (e) {
      res.json([]);
    }
  });

  // โปรไฟล์สาธารณะ: ข้อมูลผู้ใช้ + ทักษะ + คะแนน + รีวิว
  router.get('/user/:userId/profile', async (req, res) => {
    try {
      if (!isValidId(req.params.userId)) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
      const userId = new ObjectId(req.params.userId);
      const user = await db.users.findOne({ _id: userId }, { projection: { username: 1, bio: 1, email_verified: 1 } });
      // ถูกระงับ หรือเขาบล็อกเราอยู่ → ทำเหมือนไม่มีผู้ใช้นี้ (แอดมินยังเห็น)
      const { blockedByMe, blockedMe } = await moderation.blockSets(req.session.userId);
      const isBanned = moderation.banned.has(req.params.userId);
      if (!user || ((isBanned || blockedMe.has(req.params.userId)) && !req.session.isAdmin))
        return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
      user.blocked_by_me = blockedByMe.has(req.params.userId);
      user.banned = isBanned;
      const userSkills = await db.user_skills.find({ user_id: userId }).toArray();
      const skillDocs = await db.skills.find({ _id: { $in: userSkills.map(us => us.skill_id) } }).toArray();
      const skills = userSkills.map(us => {
        const sk = skillDocs.find(s => s._id.equals(us.skill_id));
        return { type: us.type, skill_name: sk?.name, category: sk?.category };
      });
      const rating = (await getRatings([userId]))[req.params.userId] || { avg: null, count: 0 };
      res.json({ user, skills, rating, reviews: await getReviewsFor(userId) });
    } catch (e) {
      res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
    }
  });

  return router;
};
