// ===== ข้อมูลส่วนบุคคลของผู้ใช้ตาม PDPA: ขอสำเนาข้อมูล (export) / ลบบัญชี =====

// เปลี่ยนวันที่นี้ทุกครั้งที่แก้เนื้อหาหน้านโยบาย (#privacy ใน frontend/index.html)
// ผู้ใช้ที่รับทราบเวอร์ชันเก่าไว้จะเห็นแถบให้กดรับทราบใหม่
const PRIVACY_VERSION = '2026-10-05';
const DELETED_NAME = 'ผู้ใช้ที่ลบบัญชีแล้ว';

// รวมข้อมูลทั้งหมดที่เกี่ยวกับผู้ใช้เป็น JSON ให้ดาวน์โหลด
// ข้อความแชทให้เฉพาะที่ผู้ใช้ส่งเอง — ข้อความของอีกฝ่ายเป็นข้อมูลของเขา
async function exportUserData({ db }, uid) {
  const idStr = uid.toString();
  const user = await db.users.findOne({ _id: uid }, { projection: { password: 0, disabled: 0 } });
  if (!user) return null;
  const [userSkills, requests, reviewsWritten, reviewsReceived, posts, comments, liked, blocks, reports, notifications, suggestions] = await Promise.all([
    db.user_skills.find({ user_id: uid }).toArray(),
    db.exchange_requests.find({ $or: [{ sender_id: uid }, { receiver_id: uid }] }).sort({ created_at: 1 }).toArray(),
    db.reviews.find({ reviewer_id: uid }).sort({ created_at: 1 }).toArray(),
    db.reviews.find({ reviewee_id: uid }).sort({ created_at: 1 }).toArray(),
    db.posts.find({ author_id: uid }).sort({ _id: 1 }).toArray(),
    db.comments.find({ author_id: uid }).sort({ _id: 1 }).toArray(),
    db.posts.find({ likes: uid }, { projection: { _id: 1 } }).toArray(),
    db.blocks.find({ blocker_id: uid }).toArray(),
    db.reports.find({ reporter_id: uid }).sort({ _id: 1 }).toArray(),
    db.notifications.find({ user_id: uid }).sort({ _id: 1 }).toArray(),
    db.skill_requests.find({ 'requests.user_id': uid }).sort({ _id: 1 }).toArray()
  ]);
  const messages = await db.messages.find(
    { request_id: { $in: requests.map(r => r._id) }, sender_id: idStr }
  ).sort({ created_at: 1 }).toArray();

  const otherIds = [
    ...requests.map(r => (r.sender_id.equals(uid) ? r.receiver_id : r.sender_id)),
    ...reviewsWritten.map(r => r.reviewee_id),
    ...reviewsReceived.map(r => r.reviewer_id).filter(Boolean),
    ...blocks.map(b => b.blocked_id)
  ];
  const [others, skills] = await Promise.all([
    db.users.find({ _id: { $in: otherIds } }, { projection: { username: 1 } }).toArray(),
    db.skills.find({ _id: { $in: userSkills.map(s => s.skill_id) } }).toArray()
  ]);
  const nameOf = (id) => (id && others.find(u => u._id.equals(id))?.username) || DELETED_NAME;

  return {
    service: 'KnowBridge',
    exported_at: new Date(),
    note: 'ข้อมูลทั้งหมดที่ KnowBridge เก็บเกี่ยวกับคุณ (ไม่รวมรหัสผ่าน ซึ่งเก็บแบบเข้ารหัสทางเดียวและอ่านย้อนกลับไม่ได้)',
    account: {
      id: user._id,
      username: user.username,
      email: user.email,
      email_verified: !!user.email_verified,
      bio: user.bio || '',
      created_at: user.created_at || user._id.getTimestamp(),
      privacy_version: user.privacy_version || null,
      privacy_accepted_at: user.privacy_accepted_at || null
    },
    skills: userSkills.map(us => {
      const s = skills.find(x => x._id.equals(us.skill_id));
      return { type: us.type === 'teach' ? 'สอนได้' : 'อยากเรียน', skill: s?.name, category: s?.category };
    }),
    exchange_requests: requests.map(r => ({
      id: r._id,
      role: r.sender_id.equals(uid) ? 'ผู้ส่งคำขอ' : 'ผู้รับคำขอ',
      other_user: nameOf(r.sender_id.equals(uid) ? r.receiver_id : r.sender_id),
      message: r.message,
      status: r.status,
      schedule: r.schedule ? { at: r.schedule.at, note: r.schedule.note } : null,
      created_at: r.created_at,
      completed_at: r.completed_at || null
    })),
    messages_sent: messages.map(m => ({ request_id: m.request_id, text: m.text, created_at: m.created_at })),
    reviews_written: reviewsWritten.map(r => ({ about: nameOf(r.reviewee_id), rating: r.rating, comment: r.comment, created_at: r.created_at })),
    reviews_received: reviewsReceived.map(r => ({ from: nameOf(r.reviewer_id), rating: r.rating, comment: r.comment, created_at: r.created_at })),
    posts: posts.map(p => ({
      id: p._id, text: p.text, tags: p.tags, like_count: p.likes?.length || 0,
      comment_count: p.comment_count || 0, hidden: !!p.hidden, created_at: p.created_at
    })),
    comments: comments.map(c => ({ post_id: c.post_id, text: c.text, created_at: c.created_at })),
    liked_post_ids: liked.map(p => p._id),
    blocked_users: blocks.map(b => nameOf(b.blocked_id)),
    reports_filed: reports.map(r => ({
      type: r.type, target_id: r.target_id, reason: r.reason, detail: r.detail, status: r.status, created_at: r.created_at
    })),
    notifications: notifications.map(({ _id, user_id, ...n }) => n),
    skill_suggestions: suggestions.map(r => ({
      name: r.name, category: r.category, status: r.status,
      type: r.requests.find(x => x.user_id.equals(uid))?.type, created_at: r.created_at
    }))
  };
}

// ลบบัญชีและข้อมูลที่ผูกกับบัญชีทั้งหมด (session ลบแยกใน routes/account.js)
// - รีวิวที่เขียนให้คนอื่น และรายงานที่เคยส่ง: เก็บไว้แต่ตัดตัวตนออก
//   คะแนนของอีกฝ่ายจะได้ไม่หาย และรายงานที่ค้างอยู่ยังให้แอดมินตรวจต่อได้
async function deleteUserData({ db, ObjectId }, user) {
  const uid = user._id;
  const idStr = uid.toString();

  const postIds = (await db.posts.find({ author_id: uid }, { projection: { _id: 1 } }).toArray()).map(p => p._id);
  // ความคิดเห็นของคนอื่นในโพสต์ของเรา หายไปพร้อมโพสต์ → รายงานที่ชี้ไปหาความคิดเห็นพวกนั้นก็ลบด้วย
  const commentsOnMyPosts = (await db.comments.find({ post_id: { $in: postIds } }, { projection: { _id: 1 } }).toArray()).map(c => c._id);
  // ความคิดเห็นของเราในโพสต์คนอื่น → ลดตัวนับความคิดเห็นของโพสต์นั้น
  const myComments = await db.comments.find({ author_id: uid, post_id: { $nin: postIds } }, { projection: { post_id: 1 } }).toArray();
  const perPost = {};
  for (const c of myComments) perPost[c.post_id.toString()] = (perPost[c.post_id.toString()] || 0) + 1;
  if (myComments.length) {
    await db.posts.bulkWrite(Object.entries(perPost).map(([id, n]) => ({
      updateOne: { filter: { _id: new ObjectId(id) }, update: { $inc: { comment_count: -n } } }
    })));
  }
  const requestIds = (await db.exchange_requests.find(
    { $or: [{ sender_id: uid }, { receiver_id: uid }] }, { projection: { _id: 1 } }
  ).toArray()).map(r => r._id);

  const [comments, posts, , messages, requests, reviews, , , notifications] = await Promise.all([
    db.comments.deleteMany({ $or: [{ author_id: uid }, { post_id: { $in: postIds } }] }),
    db.posts.deleteMany({ author_id: uid }),
    db.posts.updateMany({ likes: uid }, { $pull: { likes: uid } }),
    db.messages.deleteMany({ $or: [{ request_id: { $in: requestIds } }, { sender_id: idStr }] }),
    db.exchange_requests.deleteMany({ _id: { $in: requestIds } }),
    db.reviews.deleteMany({ reviewee_id: uid }),
    db.reviews.updateMany({ reviewer_id: uid }, { $set: { reviewer_id: null } }),
    db.user_skills.deleteMany({ user_id: uid }),
    db.notifications.deleteMany({ $or: [
      { user_id: uid }, { from: user.username }, { request_id: { $in: requestIds } }, { post_id: { $in: postIds } }
    ] }),
    db.blocks.deleteMany({ $or: [{ blocker_id: uid }, { blocked_id: uid }] }),
    db.reports.deleteMany({ $or: [{ owner_id: uid }, { target_id: { $in: [uid, ...commentsOnMyPosts] } }] }),
    db.reports.updateMany({ reporter_id: uid }, { $set: { reporter_id: null } }),
    db.password_resets.deleteMany({ user_id: uid }),
    db.email_verifications.deleteMany({ user_id: uid }),
    // ทักษะที่เคยเสนอ: เอาชื่อเราออก (ทักษะที่อนุมัติแล้วยังอยู่ในแคตตาล็อกให้คนอื่นใช้)
    db.skill_requests.updateMany({ 'requests.user_id': uid }, { $pull: { requests: { user_id: uid } } })
  ]);
  await db.skill_requests.deleteMany({ status: 'pending', requests: { $size: 0 } });
  await db.users.deleteOne({ _id: uid });
  return {
    posts: posts.deletedCount,
    comments: comments.deletedCount,
    exchange_requests: requests.deletedCount,
    messages: messages.deletedCount,
    reviews: reviews.deletedCount,
    notifications: notifications.deletedCount
  };
}

module.exports = { PRIVACY_VERSION, DELETED_NAME, exportUserData, deleteUserData };
