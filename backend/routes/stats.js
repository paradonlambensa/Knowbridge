// ===== ตัวเลขบนหน้าแรก =====
const express = require('express');

module.exports = function statsRouter({ db, ACTIVE_STATUSES }) {
  const router = express.Router();

  // cache 60 วินาที ไม่ต้องนับใหม่ทุกครั้งที่มีคนเปิดเว็บ
  let statsCache = { at: 0, data: null };
  router.get('/stats', async (req, res) => {
    try {
      if (!statsCache.data || Date.now() - statsCache.at > 60 * 1000) {
        const [users, skills, posts, exchanges] = await Promise.all([
          db.users.estimatedDocumentCount(),
          db.skills.estimatedDocumentCount(),
          db.posts.estimatedDocumentCount(),
          db.exchange_requests.countDocuments({ status: { $in: ACTIVE_STATUSES } })
        ]);
        statsCache = { at: Date.now(), data: { users, skills, posts, exchanges } };
      }
      res.json(statsCache.data);
    } catch (e) {
      res.json({ users: 0, skills: 0, posts: 0, exchanges: 0 });
    }
  });

  return router;
};
