const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { db, ObjectId } = require('./database');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'knowbridge-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
});
app.use(sessionMiddleware);
// ให้ socket.io ใช้ session เดียวกับ express เพื่อรู้ว่าใครเป็นคนส่งข้อความ
io.engine.use(sessionMiddleware);

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'กรุณา Login ก่อน' });
  next();
}

function isValidId(id) {
  return typeof id === 'string' && ObjectId.isValid(id);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// คำขอที่ accepted แล้ว และ user เป็นคู่กรณี (ใช้ตรวจสิทธิ์แชท/รีวิว)
async function findAcceptedRequestForUser(requestId, userId) {
  if (!isValidId(requestId) || !userId) return null;
  return db.exchange_requests.findOne({
    _id: new ObjectId(requestId),
    status: 'accepted',
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
    reviewer_name: reviewers.find(u => u._id.equals(r.reviewer_id))?.username || 'ไม่ทราบชื่อ'
  }));
}

// --- Auth ---
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ' });
  try {
    const existing = await db.users.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.json({ success: false, error: 'Username หรือ Email ซ้ำ' });
    const hashed = bcrypt.hashSync(password, 10);
    const result = await db.users.insertOne({ username, email, password: hashed, bio: '' });
    req.session.userId = result.insertedId.toString();
    req.session.username = username;
    res.json({ success: true });
  } catch (e) {
    console.error('Register error:', e);
    res.json({ success: false, error: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.users.findOne({ email });
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.json({ success: false, error: 'Email หรือรหัสผ่านไม่ถูกต้อง' });
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    res.json({ success: true, username: user.username });
  } catch (e) {
    res.json({ success: false, error: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- Skills ---
app.get('/api/skills', async (req, res) => {
  const skills = await db.skills.find({}).toArray();
  res.json(skills);
});

app.get('/api/search', async (req, res) => {
  try {
    const { skill, category } = req.query;
    let query = {};
    if (category) query.category = String(category);
    if (skill) query.name = new RegExp(escapeRegex(skill), 'i');
    const skills = await db.skills.find(query).toArray();
    const skillIds = skills.map(s => s._id);
    const userSkills = await db.user_skills.find({ type: 'teach', skill_id: { $in: skillIds } }).toArray();
    const results = [];
    for (const us of userSkills) {
      const user = await db.users.findOne({ _id: us.user_id });
      const skillInfo = await db.skills.findOne({ _id: us.skill_id });
      if (user && skillInfo && user._id.toString() !== req.session.userId) {
        results.push({ id: user._id, username: user.username, bio: user.bio, skill_name: skillInfo.name, category: skillInfo.category });
      }
    }
    const ratings = await getRatings(results.map(r => r.id));
    for (const r of results) {
      const rt = ratings[r.id.toString()];
      r.avg_rating = rt?.avg ?? null;
      r.review_count = rt?.count ?? 0;
    }
    res.json(results);
  } catch (e) {
    res.json([]);
  }
});

// --- Profile ---
app.get('/api/profile', requireLogin, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: new ObjectId(req.session.userId) }, { projection: { password: 0 } });
    const userSkills = await db.user_skills.find({ user_id: new ObjectId(req.session.userId) }).toArray();
    const skillsWithInfo = await Promise.all(userSkills.map(async (us) => {
      const skill = await db.skills.findOne({ _id: us.skill_id });
      return { ...us, skill_id: us.skill_id.toString(), skill_name: skill?.name, category: skill?.category };
    }));
    res.json({ user, skills: skillsWithInfo });
  } catch (e) {
    res.json({ user: null, skills: [] });
  }
});

app.post('/api/profile/update', requireLogin, async (req, res) => {
  try {
    const { bio, teach_skills, learn_skills } = req.body;
    await db.users.updateOne({ _id: new ObjectId(req.session.userId) }, { $set: { bio: String(bio || '').slice(0, 500) } });
    await db.user_skills.deleteMany({ user_id: new ObjectId(req.session.userId) });
    for (const id of (teach_skills || []).filter(isValidId)) {
      await db.user_skills.insertOne({ user_id: new ObjectId(req.session.userId), skill_id: new ObjectId(id), type: 'teach' });
    }
    for (const id of (learn_skills || []).filter(isValidId)) {
      await db.user_skills.insertOne({ user_id: new ObjectId(req.session.userId), skill_id: new ObjectId(id), type: 'learn' });
    }
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false });
  }
});

// --- Exchange ---
app.post('/api/exchange/request', requireLogin, async (req, res) => {
  try {
    const { receiver_id, message } = req.body;
    if (!isValidId(receiver_id) || receiver_id === req.session.userId)
      return res.json({ success: false, error: 'ผู้รับไม่ถูกต้อง' });
    const duplicate = await db.exchange_requests.findOne({
      sender_id: new ObjectId(req.session.userId),
      receiver_id: new ObjectId(receiver_id),
      status: 'pending'
    });
    if (duplicate) return res.json({ success: false, error: 'คุณส่งคำขอถึงผู้ใช้นี้แล้ว กรุณารอการตอบรับ' });
    await db.exchange_requests.insertOne({
      sender_id: new ObjectId(req.session.userId),
      receiver_id: new ObjectId(receiver_id),
      message: String(message || '').slice(0, 500),
      status: 'pending',
      created_at: new Date()
    });
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/dashboard', requireLogin, async (req, res) => {
  try {
    const received = await db.exchange_requests.find({ receiver_id: new ObjectId(req.session.userId) }).toArray();
    const sent = await db.exchange_requests.find({ sender_id: new ObjectId(req.session.userId) }).toArray();
    const myReviews = await db.reviews.find({ reviewer_id: new ObjectId(req.session.userId) }).toArray();
    const reviewedIds = new Set(myReviews.map(r => r.request_id.toString()));

    const enriched = async (list, idField) => Promise.all(list.map(async r => {
      const user = await db.users.findOne({ _id: r[idField] });
      return {
        ...r,
        other_user_id: r[idField],
        other_username: user?.username || 'ไม่ทราบชื่อ',
        reviewed: reviewedIds.has(r._id.toString())
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

app.post('/api/exchange/respond', requireLogin, async (req, res) => {
  try {
    const { request_id, status } = req.body;
    if (!isValidId(request_id) || !['accepted', 'rejected'].includes(status))
      return res.json({ success: false });
    await db.exchange_requests.updateOne(
      { _id: new ObjectId(request_id), status: 'pending', receiver_id: new ObjectId(req.session.userId) },
      { $set: { status } }
    );
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false });
  }
});

// --- Chat ---
app.get('/api/chat/:requestId', requireLogin, async (req, res) => {
  try {
    const request = await findAcceptedRequestForUser(req.params.requestId, req.session.userId);
    if (!request) return res.status(403).json([]);
    const messages = await db.messages.find({
      request_id: new ObjectId(req.params.requestId)
    }).sort({ created_at: 1 }).toArray();
    res.json(messages);
  } catch (e) {
    res.json([]);
  }
});

// --- Reviews ---
app.post('/api/review', requireLogin, async (req, res) => {
  try {
    const { request_id, comment } = req.body;
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return res.json({ success: false, error: 'คะแนนต้องอยู่ระหว่าง 1-5' });
    const request = await findAcceptedRequestForUser(request_id, req.session.userId);
    if (!request) return res.json({ success: false, error: 'ไม่พบคำขอ' });
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

app.get('/api/review/check/:requestId', requireLogin, async (req, res) => {
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

app.get('/api/user/:userId/rating', async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.json({ avg: null, count: 0 });
    const ratings = await getRatings([new ObjectId(req.params.userId)]);
    res.json(ratings[req.params.userId] || { avg: null, count: 0 });
  } catch (e) {
    res.json({ avg: null, count: 0 });
  }
});

app.get('/api/user/:userId/reviews', async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.json([]);
    res.json(await getReviewsFor(new ObjectId(req.params.userId)));
  } catch (e) {
    res.json([]);
  }
});

// โปรไฟล์สาธารณะ: ข้อมูลผู้ใช้ + ทักษะ + คะแนน + รีวิว
app.get('/api/user/:userId/profile', async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    const userId = new ObjectId(req.params.userId);
    const user = await db.users.findOne({ _id: userId }, { projection: { username: 1, bio: 1 } });
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
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

// --- Delete Exchange ---
app.delete('/api/exchange/request/:id', requireLogin, async (req, res) => {
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

// --- Socket.io ---
const onlineUsers = {};

io.on('connection', (socket) => {
  const sess = socket.request.session;
  const userId = sess?.userId;
  if (!userId) return socket.disconnect(true);
  onlineUsers[userId] = socket.id;

  socket.on('joinRoom', async (requestId) => {
    try {
      const request = await findAcceptedRequestForUser(requestId, userId);
      if (request) socket.join(requestId);
    } catch (e) {
      console.error('joinRoom error:', e);
    }
  });

  socket.on('sendMessage', async ({ requestId, text } = {}) => {
    try {
      text = String(text || '').trim().slice(0, 2000);
      if (!text || !socket.rooms.has(requestId)) return;
      const msg = {
        request_id: new ObjectId(requestId),
        sender_id: userId,
        sender_name: sess.username,
        text,
        created_at: new Date()
      };
      await db.messages.insertOne(msg);
      io.to(requestId).emit('newMessage', { ...msg, request_id: requestId });
    } catch (e) {
      console.error('sendMessage error:', e);
    }
  });

  socket.on('disconnect', () => {
    if (onlineUsers[userId] === socket.id) delete onlineUsers[userId];
  });
});

httpServer.listen(PORT, () => {
  console.log(`🌉 KnowBridge running at http://localhost:${PORT}`);
});
