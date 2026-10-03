// ===== ศูนย์รวมแจ้งเตือน (กระดิ่ง) =====
const express = require('express');

module.exports = function notificationsRouter({ db, ObjectId, requireLogin, isValidId }) {
  const router = express.Router();

  router.get('/notifications/list', requireLogin, async (req, res) => {
    try {
      const me = new ObjectId(req.session.userId);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
      const [items, unread] = await Promise.all([
        db.notifications.find({ user_id: me }).sort({ _id: -1 }).limit(limit).toArray(),
        db.notifications.countDocuments({ user_id: me, read: false })
      ]);
      res.json({ unread, items: items.map(({ user_id, ...n }) => n) });
    } catch (e) {
      res.json({ unread: 0, items: [] });
    }
  });

  router.post('/notifications/read-all', requireLogin, async (req, res) => {
    await db.notifications.updateMany({ user_id: new ObjectId(req.session.userId), read: false }, { $set: { read: true } });
    res.json({ success: true });
  });

  router.post('/notifications/:id/read', requireLogin, async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false });
    await db.notifications.updateOne(
      { _id: new ObjectId(req.params.id), user_id: new ObjectId(req.session.userId) },
      { $set: { read: true } }
    );
    res.json({ success: true });
  });

  return router;
};
