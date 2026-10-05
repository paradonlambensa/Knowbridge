// ===== ตัวช่วยเรื่องคำขอแลกเปลี่ยน / แชท / คะแนน ที่หลาย route ใช้ร่วมกัน =====
const { DELETED_NAME } = require('./accountData');

module.exports = function createExchangeHelpers({ db, ObjectId, isValidId }) {
  // จำนวนข้อความที่ยังไม่อ่านของ userId ในแต่ละคำขอ → { requestId: count }
  async function getUnreadCounts(requests, userId) {
    const counts = {};
    await Promise.all(requests.map(async r => {
      const lastRead = r.last_read?.[userId];
      const query = { request_id: r._id, sender_id: { $ne: userId } };
      if (lastRead) query.created_at = { $gt: lastRead };
      counts[r._id.toString()] = await db.messages.countDocuments(query);
    }));
    return counts;
  }

  function markChatRead(requestId, userId) {
    return db.exchange_requests.updateOne(
      { _id: new ObjectId(requestId) },
      { $set: { [`last_read.${userId}`]: new Date() } }
    );
  }

  // คำขอที่ accepted แล้ว และ user เป็นคู่กรณี (ใช้ตรวจสิทธิ์แชท/รีวิว)
  const ACTIVE_STATUSES = ['accepted', 'completed'];

  async function findAcceptedRequestForUser(requestId, userId) {
    if (!isValidId(requestId) || !userId) return null;
    return db.exchange_requests.findOne({
      _id: new ObjectId(requestId),
      status: { $in: ACTIVE_STATUSES },
      $or: [{ sender_id: new ObjectId(userId) }, { receiver_id: new ObjectId(userId) }]
    });
  }

  // คะแนนเฉลี่ยของหลาย user ในครั้งเดียว → { userId: { avg, count } }
  async function getRatings(userIds) {
    if (userIds.length === 0) return {};
    const rows = await db.reviews.aggregate([
      { $match: { reviewee_id: { $in: userIds } } },
      { $group: { _id: '$reviewee_id', avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]).toArray();
    const map = {};
    for (const r of rows) map[r._id.toString()] = { avg: Math.round(r.avg * 10) / 10, count: r.count };
    return map;
  }

  async function getReviewsFor(userId) {
    const reviews = await db.reviews.find({ reviewee_id: userId }).sort({ created_at: -1 }).toArray();
    const reviewers = await db.users.find(
      { _id: { $in: reviews.map(r => r.reviewer_id) } },
      { projection: { username: 1 } }
    ).toArray();
    return reviews.map(r => ({
      rating: r.rating,
      comment: r.comment,
      created_at: r.created_at,
      // คนเขียนลบบัญชีไปแล้ว → รีวิวยังอยู่แต่ไม่ระบุชื่อ
      reviewer_name: (r.reviewer_id && reviewers.find(u => u._id.equals(r.reviewer_id))?.username) || DELETED_NAME
    }));
  }

  return { ACTIVE_STATUSES, getUnreadCounts, markChatRead, findAcceptedRequestForUser, getRatings, getReviewsFor };
};
