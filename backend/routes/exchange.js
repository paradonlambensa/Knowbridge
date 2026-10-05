// ===== คำขอแลกเปลี่ยน / นัดเรียน / ยืนยันเสร็จ / แชท / รีวิว =====
const express = require('express');

module.exports = function exchangeRouter({
  db, ObjectId, notify, requireLogin, isValidId, moderation, limits,
  ACTIVE_STATUSES, getUnreadCounts, markChatRead, findAcceptedRequestForUser
}) {
  const router = express.Router();

  router.post('/exchange/request', requireLogin, limits.exchange, async (req, res) => {
    try {
      const { receiver_id, message } = req.body;
      if (!isValidId(receiver_id) || receiver_id === req.session.userId || moderation.banned.has(receiver_id))
        return res.json({ success: false, error: 'ผู้รับไม่ถูกต้อง' });
      if (await moderation.isBlockedBetween(req.session.userId, receiver_id))
        return res.status(403).json({ success: false, error: 'ส่งคำขอถึงผู้ใช้นี้ไม่ได้' });
      const duplicate = await db.exchange_requests.findOne({
        sender_id: new ObjectId(req.session.userId),
        receiver_id: new ObjectId(receiver_id),
        status: 'pending'
      });
      if (duplicate) return res.json({ success: false, error: 'คุณส่งคำขอถึงผู้ใช้นี้แล้ว กรุณารอการตอบรับ' });
      const { insertedId } = await db.exchange_requests.insertOne({
        sender_id: new ObjectId(req.session.userId),
        receiver_id: new ObjectId(receiver_id),
        message: String(message || '').slice(0, 500),
        status: 'pending',
        created_at: new Date()
      });
      notify(receiver_id, { type: 'request', from: req.session.username, request_id: insertedId });
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false });
    }
  });

  router.get('/dashboard', requireLogin, async (req, res) => {
    try {
      const me = req.session.userId;
      const newestFirst = { created_at: -1 };
      const received = await db.exchange_requests.find({ receiver_id: new ObjectId(me) }).sort(newestFirst).toArray();
      const sent = await db.exchange_requests.find({ sender_id: new ObjectId(me) }).sort(newestFirst).toArray();
      const myReviews = await db.reviews.find({ reviewer_id: new ObjectId(me) }).toArray();
      const reviewedIds = new Set(myReviews.map(r => r.request_id.toString()));
      const unread = await getUnreadCounts([...received, ...sent].filter(r => ACTIVE_STATUSES.includes(r.status)), me);

      const enriched = async (list, idField) => Promise.all(list.map(async ({ last_read, completed_by = [], ...r }) => {
        const user = await db.users.findOne({ _id: r[idField] });
        return {
          ...r,
          other_user_id: r[idField],
          other_username: user?.username || 'ไม่ทราบชื่อ',
          reviewed: reviewedIds.has(r._id.toString()),
          unread: unread[r._id.toString()] || 0,
          completed_by_me: completed_by.some(id => id.toString() === me),
          completed_by_other: completed_by.some(id => id.toString() !== me)
        };
      }));

      res.json({
        received: await enriched(received, 'sender_id'),
        sent: await enriched(sent, 'receiver_id')
      });
    } catch (e) {
      res.json({ received: [], sent: [] });
    }
  });

  router.post('/exchange/respond', requireLogin, async (req, res) => {
    try {
      const { request_id, status } = req.body;
      if (!isValidId(request_id) || !['accepted', 'rejected'].includes(status))
        return res.json({ success: false });
      const updated = await db.exchange_requests.findOneAndUpdate(
        { _id: new ObjectId(request_id), status: 'pending', receiver_id: new ObjectId(req.session.userId) },
        { $set: { status } }
      );
      if (updated) notify(updated.sender_id, { type: status, from: req.session.username, request_id: updated._id });
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false });
    }
  });

  // นัดเวลาเรียน (ส่ง at = null เพื่อยกเลิกนัด)
  router.post('/exchange/:id/schedule', requireLogin, async (req, res) => {
    try {
      const request = await findAcceptedRequestForUser(req.params.id, req.session.userId);
      if (!request) return res.status(404).json({ success: false, error: 'ไม่พบการแลกเปลี่ยนนี้' });
      const at = req.body.at ? new Date(req.body.at) : null;
      const yearAhead = Date.now() + 366 * 24 * 60 * 60 * 1000;
      if (at && (isNaN(at) || at.getTime() < Date.now() - 60 * 1000 || at.getTime() > yearAhead))
        return res.status(400).json({ success: false, error: 'กรุณาเลือกวันเวลาในอนาคต (ไม่เกิน 1 ปี)' });
      const note = String(req.body.note || '').trim().slice(0, 200);
      const me = new ObjectId(req.session.userId);
      const schedule = at ? { at, note, by: me, updated_at: new Date() } : null;
      await db.exchange_requests.updateOne({ _id: request._id }, at ? { $set: { schedule } } : { $unset: { schedule: '' } });
      const other = request.sender_id.equals(me) ? request.receiver_id : request.sender_id;
      notify(other, { type: 'schedule', from: req.session.username, request_id: request._id, schedule_at: at, preview: note });
      res.json({ success: true, schedule });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  // แต่ละฝ่ายกด "แลกเปลี่ยนเสร็จแล้ว" — ครบทั้งสองฝ่าย = เสร็จสมบูรณ์ แล้วจึงให้คะแนนกันได้
  router.post('/exchange/:id/complete', requireLogin, async (req, res) => {
    try {
      if (!isValidId(req.params.id)) return res.status(404).json({ success: false });
      const me = new ObjectId(req.session.userId);
      const request = await db.exchange_requests.findOneAndUpdate(
        { _id: new ObjectId(req.params.id), status: 'accepted', $or: [{ sender_id: me }, { receiver_id: me }] },
        { $addToSet: { completed_by: me } },
        { returnDocument: 'after' }
      );
      if (!request) return res.status(400).json({ success: false, error: 'ยืนยันได้เฉพาะการแลกเปลี่ยนที่กำลังดำเนินอยู่' });
      const bothDone = [request.sender_id, request.receiver_id].every(id => request.completed_by.some(c => c.equals(id)));
      if (bothDone) await db.exchange_requests.updateOne({ _id: request._id }, { $set: { status: 'completed', completed_at: new Date() } });
      const other = request.sender_id.equals(me) ? request.receiver_id : request.sender_id;
      notify(other, { type: bothDone ? 'completed' : 'complete_request', from: req.session.username, request_id: request._id });
      res.json({ success: true, completed: bothDone });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  // --- Chat ---
  router.get('/chat/:requestId', requireLogin, async (req, res) => {
    try {
      const request = await findAcceptedRequestForUser(req.params.requestId, req.session.userId);
      if (!request) return res.status(403).json([]);
      const messages = await db.messages.find({
        request_id: new ObjectId(req.params.requestId)
      }).sort({ created_at: 1 }).toArray();
      await markChatRead(req.params.requestId, req.session.userId);
      res.json(messages);
    } catch (e) {
      res.json([]);
    }
  });

  // เรียกตอนแชทเปิดค้างอยู่แล้วมีข้อความใหม่เข้ามา หรือตอนปิดแชท
  router.post('/chat/:requestId/read', requireLogin, async (req, res) => {
    try {
      const request = await findAcceptedRequestForUser(req.params.requestId, req.session.userId);
      if (!request) return res.status(403).json({ success: false });
      await markChatRead(req.params.requestId, req.session.userId);
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false });
    }
  });

  // --- Reviews ---
  router.post('/review', requireLogin, async (req, res) => {
    try {
      const { request_id, comment } = req.body;
      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5)
        return res.json({ success: false, error: 'คะแนนต้องอยู่ระหว่าง 1-5' });
      const request = await findAcceptedRequestForUser(request_id, req.session.userId);
      if (!request) return res.json({ success: false, error: 'ไม่พบคำขอ' });
      // กันรีวิวปลอม: ต้องยืนยันว่าแลกเปลี่ยนกันจริงครบทั้งสองฝ่ายก่อน
      if (request.status !== 'completed')
        return res.json({ success: false, error: 'ให้คะแนนได้หลังทั้งสองฝ่ายกด "แลกเปลี่ยนเสร็จแล้ว"' });
      // ผู้ถูกรีวิวคืออีกฝ่ายของคำขอเสมอ ไม่เชื่อค่าจาก client
      const reviewee_id = request.sender_id.toString() === req.session.userId
        ? request.receiver_id : request.sender_id;

      const existing = await db.reviews.findOne({
        request_id: new ObjectId(request_id),
        reviewer_id: new ObjectId(req.session.userId)
      });
      if (existing) return res.json({ success: false, error: 'คุณรีวิวไปแล้ว' });

      await db.reviews.insertOne({
        request_id: new ObjectId(request_id),
        reviewer_id: new ObjectId(req.session.userId),
        reviewee_id,
        rating,
        comment: String(comment || '').slice(0, 500),
        created_at: new Date()
      });
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  router.get('/review/check/:requestId', requireLogin, async (req, res) => {
    try {
      if (!isValidId(req.params.requestId)) return res.json({ reviewed: false });
      const existing = await db.reviews.findOne({
        request_id: new ObjectId(req.params.requestId),
        reviewer_id: new ObjectId(req.session.userId)
      });
      res.json({ reviewed: !!existing });
    } catch (e) {
      res.json({ reviewed: false });
    }
  });

  // --- Delete Exchange ---
  router.delete('/exchange/request/:id', requireLogin, async (req, res) => {
    try {
      if (!isValidId(req.params.id)) return res.json({ success: false });
      await db.exchange_requests.deleteOne({
        _id: new ObjectId(req.params.id),
        $or: [
          { sender_id: new ObjectId(req.session.userId) },
          { receiver_id: new ObjectId(req.session.userId) }
        ]
      });
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false });
    }
  });

  return router;
};
