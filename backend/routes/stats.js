// ===== ตัวเลขบนหน้าแรก (อัปเดตสดผ่าน socket ด้วย — lib/liveStats.js) =====
const express = require('express');

module.exports = function statsRouter({ liveStats }) {
  const router = express.Router();

  router.get('/stats', async (req, res) => {
    try {
      res.json(await liveStats.get());
    } catch (e) {
      res.json({ users: 0, skills: 0, posts: 0, exchanges: 0, online: 0 });
    }
  });

  return router;
};
