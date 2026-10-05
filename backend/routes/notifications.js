// ===== ศูนย์รวมแจ้งเตือน (กระดิ่ง) =====
const express = require('express');

module.exports = function notificationsRouter({ db, ObjectId, requireLogin, isValidId, ACTIVE_STATUSES, getUnreadCounts }) {
  const router = express.Router();

  // ตัวเลขบน badge ของ Dashboard: คำขอที่รอเราตอบ + ข้อความที่ยังไม่อ่าน
  router.get('/notifications', requireLogin, async (req, res) => {
    try {
      const me = req.session.userId;
      const pending = await db.exchange_requests.countDocuments({ receiver_id: new ObjectId(me), status: 'pending' });
      const accepted = await db.exchange_requests.find({
        status: { $in: ACTIVE_STATUSES },
        $or: [{ sender_id: new ObjectId(me) }, { receiver_id: new ObjectId(me) }]
      }).toArray();
      const unread = Object.values(await getUnreadCounts(accepted, me)).reduce((a, b) => a + b, 0);
      const unreadNotifications = await db.notifications.countDocuments({ user_id: new ObjectId(me), read: false });
      res.json({ pending_requests: pending, unread_messages: unread, unread_notifications: unreadNotifications });
    } catch (e) {
      res.json({ pending_requests: 0, unread_messages: 0, unread_notifications: 0 });
    }
  });

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
