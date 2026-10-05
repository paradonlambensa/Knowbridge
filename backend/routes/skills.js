// ===== แคตตาล็อกทักษะ / ค้นหาผู้สอน / คู่แลกเปลี่ยนที่แนะนำ =====
const express = require('express');

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = function skillsRouter({ db, ObjectId, requireLogin, moderation, getRatings }) {
  const router = express.Router();

  router.get('/skills', async (req, res) => {
    const skills = await db.skills.find({}).toArray();
    res.json(skills);
  });

  router.get('/search', async (req, res) => {
    try {
      const { skill, category } = req.query;
      let query = {};
      if (category) query.category = String(category);
      if (skill) query.name = new RegExp(escapeRegex(skill), 'i');
      const skills = await db.skills.find(query).toArray();
      const skillById = new Map(skills.map(s => [s._id.toString(), s]));
      const userSkills = await db.user_skills.find({ type: 'teach', skill_id: { $in: skills.map(s => s._id) } }).toArray();
      const hidden = await moderation.hiddenUserIds(req.session.userId);

      // รวมเป็น 1 การ์ดต่อคน พร้อมรายการทักษะที่ตรงกับคำค้น (คนสอนหลายอย่างจะไม่ขึ้นซ้ำ)
      const skillsByUser = new Map();
      for (const us of userSkills) {
        const uid = us.user_id.toString();
        if (uid === req.session.userId || hidden.has(uid)) continue;
        if (!skillsByUser.has(uid)) skillsByUser.set(uid, []);
        skillsByUser.get(uid).push(skillById.get(us.skill_id.toString()));
      }
      const users = await db.users.find(
        { _id: { $in: [...skillsByUser.keys()].map(id => new ObjectId(id)) } },
        { projection: { username: 1, bio: 1 } }
      ).toArray();
      const ratings = await getRatings(users.map(u => u._id));

      const results = users.map(u => {
        const sk = skillsByUser.get(u._id.toString());
        const rt = ratings[u._id.toString()];
        return {
          id: u._id,
          username: u.username,
          bio: u.bio,
          skills: sk.map(s => ({ name: s.name, category: s.category })),
          skill_name: sk[0].name,       // เก็บไว้ให้โค้ดเดิมที่อ่านทักษะเดียว
          category: sk[0].category,
          avg_rating: rt?.avg ?? null,
          review_count: rt?.count ?? 0
        };
      });
      // คะแนนสูงก่อน แล้วค่อยเรียงตามชื่อ
      results.sort((a, b) => (b.avg_rating ?? -1) - (a.avg_rating ?? -1) || a.username.localeCompare(b.username));
      res.json(results);
    } catch (e) {
      res.json([]);
    }
  });

  // --- คู่แลกเปลี่ยนที่แนะนำ ---
  // "พอดี" = เขาสอนสิ่งที่เราอยากเรียน และอยากเรียนสิ่งที่เราสอน
  router.get('/matches', requireLogin, async (req, res) => {
    try {
      const me = new ObjectId(req.session.userId);
      const mine = await db.user_skills.find({ user_id: me }).toArray();
      const myTeach = mine.filter(s => s.type === 'teach').map(s => s.skill_id);
      const myLearn = mine.filter(s => s.type === 'learn').map(s => s.skill_id);
      const base = { has_teach: myTeach.length > 0, has_learn: myLearn.length > 0, matches: [] };
      if (!myTeach.length && !myLearn.length) return res.json(base);

      const candidates = await db.user_skills.find({
        user_id: { $ne: me },
        $or: [
          { type: 'teach', skill_id: { $in: myLearn } },
          { type: 'learn', skill_id: { $in: myTeach } }
        ]
      }).toArray();

      const hidden = await moderation.hiddenUserIds(req.session.userId);
      const byUser = new Map();
      for (const us of candidates) {
        const uid = us.user_id.toString();
        if (hidden.has(uid)) continue;
        if (!byUser.has(uid)) byUser.set(uid, { canTeachMe: [], wantsFromMe: [] });
        byUser.get(uid)[us.type === 'teach' ? 'canTeachMe' : 'wantsFromMe'].push(us.skill_id);
      }
      if (!byUser.size) return res.json(base);

      const userIds = [...byUser.keys()].map(id => new ObjectId(id));
      const [users, skills, ratings, requests] = await Promise.all([
        db.users.find({ _id: { $in: userIds } }, { projection: { username: 1, bio: 1 } }).toArray(),
        db.skills.find({ _id: { $in: candidates.map(c => c.skill_id) } }).toArray(),
        getRatings(userIds),
        db.exchange_requests.find({
          status: { $in: ['pending', 'accepted'] },
          $or: [
            { sender_id: me, receiver_id: { $in: userIds } },
            { receiver_id: me, sender_id: { $in: userIds } }
          ]
        }).toArray()
      ]);
      const skillInfo = (id) => {
        const s = skills.find(x => x._id.equals(id));
        return { id: s._id, name: s.name, category: s.category };
      };
      // สถานะกับแต่ละคน: ส่งคำขอไปแล้ว / เขาส่งมา / กำลังแลกเปลี่ยน
      const statusWith = {};
      for (const r of requests) {
        const sentByMe = r.sender_id.equals(me);
        const other = (sentByMe ? r.receiver_id : r.sender_id).toString();
        const status = r.status === 'accepted' ? 'accepted' : sentByMe ? 'pending_sent' : 'pending_received';
        if (statusWith[other] !== 'accepted') statusWith[other] = status;
      }

      const matches = users.map(u => {
        const m = byUser.get(u._id.toString());
        const rt = ratings[u._id.toString()];
        const perfect = m.canTeachMe.length > 0 && m.wantsFromMe.length > 0;
        return {
          id: u._id,
          username: u.username,
          bio: u.bio,
          perfect,
          can_teach_me: m.canTeachMe.map(skillInfo),
          wants_from_me: m.wantsFromMe.map(skillInfo),
          avg_rating: rt?.avg ?? null,
          review_count: rt?.count ?? 0,
          request_status: statusWith[u._id.toString()] || null,
          score: (perfect ? 100 : 0) + m.canTeachMe.length * 10 + m.wantsFromMe.length * 5 + (rt?.avg || 0)
        };
      }).sort((a, b) => b.score - a.score).slice(0, 12).map(({ score, ...m }) => m);

      res.json({ ...base, matches });
    } catch (e) {
      console.error('matches error:', e);
      res.status(500).json({ has_teach: false, has_learn: false, matches: [] });
    }
  });

  return router;
};
