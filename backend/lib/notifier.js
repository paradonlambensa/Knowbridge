// ===== แจ้งเตือน: เก็บลง DB (ให้กระดิ่งเปิดดูย้อนหลังได้) + ส่งแบบเรียลไทม์ทาง Socket.IO =====
// ข้อความแชทไม่เก็บ — แชทมีตัวนับข้อความที่ยังไม่อ่านของมันเองอยู่แล้ว
module.exports = function createNotifier({ db, io, ObjectId }) {
  return async function notify(userId, payload) {
    if (!userId) return;
    const uid = new ObjectId(String(userId));
    const at = new Date();
    let id = null;
    try {
      if (payload.type === 'like' && payload.post_id) {
        // หลายคนกดถูกใจโพสต์เดียวกัน → รวมเป็นแจ้งเตือนเดียว "A และอีก 2 คนถูกใจโพสต์ของคุณ"
        const doc = await db.notifications.findOneAndUpdate(
          { user_id: uid, type: 'like', post_id: new ObjectId(String(payload.post_id)), read: false },
          { $set: { from: payload.from, created_at: at }, $inc: { count: 1 } },
          { upsert: true, returnDocument: 'after' }
        );
        id = doc._id;
        payload = { ...payload, count: doc.count };
      } else if (payload.type !== 'message') {
        const { like_count, comment_count, ...stored } = payload; // ตัวเลขพวกนี้ใช้แค่อัปเดตหน้าจอทันที
        for (const key of ['request_id', 'post_id']) if (stored[key]) stored[key] = new ObjectId(String(stored[key]));
        const r = await db.notifications.insertOne({ ...stored, user_id: uid, read: false, created_at: at });
        id = r.insertedId;
      }
    } catch (e) {
      console.error('notify store error:', e);
    }
    io.to('user:' + uid.toString()).emit('notify', { ...payload, _id: id, at });
  };
};
