const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { db, ObjectId, client, dbName, ready, CI } = require('./database');
const postsRouter = require('./routes/posts');
const moderationRouter = require('./routes/moderation');
const createModeration = require('./lib/moderation');
const limits = require('./lib/limits');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;
const SESSION_TTL = 24 * 60 * 60; // วินาที
const moderation = createModeration({ db, ObjectId });
ready.then(() => moderation.loadBanned());
if ((process.env.RENDER || process.env.NODE_ENV === 'production') && !process.env.SESSION_SECRET) {
  console.warn('⚠️ ยังไม่ได้ตั้ง SESSION_SECRET — ค่าเริ่มต้นอยู่ในโค้ดสาธารณะ ใครก็ปลอม session ได้');
}

// Render/โฮสต์ส่วนใหญ่อยู่หลัง proxy ที่ทำ HTTPS ให้ — ต้องเชื่อ proxy ถึงจะตั้งคุกกี้ secure ได้
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'knowbridge-secret-2024',
  resave: false,
  saveUninitialized: false,
  // เก็บ session ใน MongoDB ไม่หลุด login ตอน server restart หรือ Render free หลับ
  store: MongoStore.create({
    clientPromise: ready.then(() => client),
    dbName,
    collectionName: 'sessions',
    ttl: SESSION_TTL,
    touchAfter: 60 * 60
  }),
  cookie: { maxAge: SESSION_TTL * 1000, httpOnly: true, sameSite: 'lax', secure: 'auto' }
});
app.use(sessionMiddleware);
// ให้ socket.io ใช้ session เดียวกับ express เพื่อรู้ว่าใครเป็นคนส่งข้อความ
io.engine.use(sessionMiddleware);
app.use('/api', limits.api);

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'กรุณา Login ก่อน' });
  // ถูกระงับระหว่างที่ยัง login อยู่ → ตัด session ทิ้งทันที
  if (moderation.banned.has(req.session.userId)) {
    return req.session.destroy(() => res.status(401).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน' }));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(403).json({ success: false, error: 'สำหรับแอดมินเท่านั้น' });
  next();
}

// ทุก socket ของผู้ใช้ join ห้อง user:<id> ไว้ ส่งแจ้งเตือนถึงทุกแท็บที่เปิดอยู่ได้ในครั้งเดียว
function notify(userId, payload) {
  io.to('user:' + userId.toString()).emit('notify', { ...payload, at: new Date() });
}

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
// กติกาบัญชี — ต้องตรงกับที่บอกผู้ใช้ในหน้าสมัคร (public/index.html)
const USERNAME_RE = /^[\p{L}\p{M}\p{N}_.-]{3,20}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEAK_PASSWORDS = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'qwertyui', '11111111', '00000000', 'abcdefgh']);

function validateAccount({ username, email, password }) {
  if (!USERNAME_RE.test(username)) return 'ชื่อผู้ใช้ต้องยาว 3–20 ตัว ใช้ได้เฉพาะตัวอักษร ตัวเลข และ _ . -';
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'รูปแบบอีเมลไม่ถูกต้อง';
  if (password.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
  if (Buffer.byteLength(password) > 72) return 'รหัสผ่านยาวเกินไป';
  if (WEAK_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) return 'รหัสผ่านนี้เดาง่ายเกินไป ลองตั้งใหม่';
  return null;
}

function startSession(req, user) {
  req.session.userId = user._id.toString();
  req.session.username = user.username;
  req.session.isAdmin = moderation.isAdminEmail(user.email);
}

app.post('/api/register', limits.register, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !email || !password)
    return res.status(400).json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ' });
  const invalid = validateAccount({ username, email, password });
  if (invalid) return res.status(400).json({ success: false, error: invalid });
  try {
    const existing = await db.users.findOne({ $or: [{ email }, { username }] }, { collation: CI });
    if (existing) return res.status(409).json({ success: false, error: 'ชื่อผู้ใช้หรืออีเมลนี้มีคนใช้แล้ว' });
    const hashed = bcrypt.hashSync(password, 10);
    const user = { username, email, password: hashed, bio: '' };
    const result = await db.users.insertOne(user);
    startSession(req, { ...user, _id: result.insertedId });
    res.json({ success: true });
  } catch (e) {
    // สมัครพร้อมกันสองคนด้วยอีเมลเดียวกัน → unique index กันไว้
    if (e.code === 11000) return res.status(409).json({ success: false, error: 'ชื่อผู้ใช้หรืออีเมลนี้มีคนใช้แล้ว' });
    console.error('Register error:', e);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/login', limits.login, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    // อีเมลไม่สนตัวพิมพ์เล็ก-ใหญ่ (รองรับบัญชีเก่าที่สมัครด้วยตัวพิมพ์ใหญ่ด้วย)
    const user = email && await db.users.findOne({ email }, { collation: CI });
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ success: false, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    if (user.disabled) return res.status(403).json({ success: false, error: 'บัญชีนี้ถูกระงับการใช้งาน' });
    startSession(req, user);
    res.json({ success: true, username: user.username });
  } catch (e) {
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/logout', (req, res) => {
  // รอให้ลบ session ออกจาก MongoDB เสร็จก่อนตอบ ไม่งั้นหน้าเว็บที่ reload ทันทีอาจยังเห็นว่า login อยู่
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
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
app.get('/api/matches', requireLogin, async (req, res) => {
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

// --- Profile ---
app.get('/api/profile', requireLogin, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: new ObjectId(req.session.userId) }, { projection: { password: 0 } });
    const userSkills = await db.user_skills.find({ user_id: new ObjectId(req.session.userId) }).toArray();
    const skillsWithInfo = await Promise.all(userSkills.map(async (us) => {
      const skill = await db.skills.findOne({ _id: us.skill_id });
      return { ...us, skill_id: us.skill_id.toString(), skill_name: skill?.name, category: skill?.category };
    }));
    req.session.isAdmin = moderation.isAdminEmail(user?.email);
    res.json({ user, skills: skillsWithInfo, is_admin: req.session.isAdmin });
  } catch (e) {
    res.json({ user: null, skills: [] });
  }
});

const MAX_SKILLS_PER_TYPE = 5;

app.post('/api/profile/update', requireLogin, async (req, res) => {
  try {
    const me = new ObjectId(req.session.userId);
    const clean = (list) => [...new Set((Array.isArray(list) ? list : []).filter(isValidId))];
    const teach = clean(req.body.teach_skills);
    // ทักษะเดียวกันจะ "สอน" และ "อยากเรียน" พร้อมกันไม่ได้ — ให้ฝั่งสอนชนะ
    const learn = clean(req.body.learn_skills).filter(id => !teach.includes(id));
    if (teach.length > MAX_SKILLS_PER_TYPE || learn.length > MAX_SKILLS_PER_TYPE)
      return res.json({ success: false, error: `เลือกได้ไม่เกิน ${MAX_SKILLS_PER_TYPE} ทักษะต่อประเภท` });

    // เก็บเฉพาะทักษะที่มีอยู่จริงในแคตตาล็อก
    const existing = await db.skills.find(
      { _id: { $in: [...teach, ...learn].map(id => new ObjectId(id)) } }, { projection: { _id: 1 } }
    ).toArray();
    const valid = new Set(existing.map(s => s._id.toString()));
    const docs = [
      ...teach.filter(id => valid.has(id)).map(id => ({ user_id: me, skill_id: new ObjectId(id), type: 'teach' })),
      ...learn.filter(id => valid.has(id)).map(id => ({ user_id: me, skill_id: new ObjectId(id), type: 'learn' }))
    ];

    await db.users.updateOne({ _id: me }, { $set: { bio: String(req.body.bio || '').slice(0, 500) } });
    await db.user_skills.deleteMany({ user_id: me });
    if (docs.length) await db.user_skills.insertMany(docs);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false });
  }
});

// --- Exchange ---
app.post('/api/exchange/request', requireLogin, limits.exchange, async (req, res) => {
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
    await db.exchange_requests.insertOne({
      sender_id: new ObjectId(req.session.userId),
      receiver_id: new ObjectId(receiver_id),
      message: String(message || '').slice(0, 500),
      status: 'pending',
      created_at: new Date()
    });
    notify(receiver_id, { type: 'request', from: req.session.username });
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/dashboard', requireLogin, async (req, res) => {
  try {
    const me = req.session.userId;
    const newestFirst = { created_at: -1 };
    const received = await db.exchange_requests.find({ receiver_id: new ObjectId(me) }).sort(newestFirst).toArray();
    const sent = await db.exchange_requests.find({ sender_id: new ObjectId(me) }).sort(newestFirst).toArray();
    const myReviews = await db.reviews.find({ reviewer_id: new ObjectId(me) }).toArray();
    const reviewedIds = new Set(myReviews.map(r => r.request_id.toString()));
    const unread = await getUnreadCounts([...received, ...sent].filter(r => r.status === 'accepted'), me);

    const enriched = async (list, idField) => Promise.all(list.map(async ({ last_read, ...r }) => {
      const user = await db.users.findOne({ _id: r[idField] });
      return {
        ...r,
        other_user_id: r[idField],
        other_username: user?.username || 'ไม่ทราบชื่อ',
        reviewed: reviewedIds.has(r._id.toString()),
        unread: unread[r._id.toString()] || 0
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
    const updated = await db.exchange_requests.findOneAndUpdate(
      { _id: new ObjectId(request_id), status: 'pending', receiver_id: new ObjectId(req.session.userId) },
      { $set: { status } }
    );
    if (updated) notify(updated.sender_id, { type: status, from: req.session.username });
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false });
  }
});

// ตัวเลขบน badge ของ Dashboard: คำขอที่รอเราตอบ + ข้อความที่ยังไม่อ่าน
app.get('/api/notifications', requireLogin, async (req, res) => {
  try {
    const me = req.session.userId;
    const pending = await db.exchange_requests.countDocuments({ receiver_id: new ObjectId(me), status: 'pending' });
    const accepted = await db.exchange_requests.find({
      status: 'accepted',
      $or: [{ sender_id: new ObjectId(me) }, { receiver_id: new ObjectId(me) }]
    }).toArray();
    const unread = Object.values(await getUnreadCounts(accepted, me)).reduce((a, b) => a + b, 0);
    res.json({ pending_requests: pending, unread_messages: unread });
  } catch (e) {
    res.json({ pending_requests: 0, unread_messages: 0 });
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
    await markChatRead(req.params.requestId, req.session.userId);
    res.json(messages);
  } catch (e) {
    res.json([]);
  }
});

// เรียกตอนแชทเปิดค้างอยู่แล้วมีข้อความใหม่เข้ามา หรือตอนปิดแชท
app.post('/api/chat/:requestId/read', requireLogin, async (req, res) => {
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
    // ถูกระงับ หรือเขาบล็อกเราอยู่ → ทำเหมือนไม่มีผู้ใช้นี้ (แอดมินยังเห็น)
    const { blockedByMe, blockedMe } = await moderation.blockSets(req.session.userId);
    const isBanned = moderation.banned.has(req.params.userId);
    if (!user || ((isBanned || blockedMe.has(req.params.userId)) && !req.session.isAdmin))
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    user.blocked_by_me = blockedByMe.has(req.params.userId);
    user.banned = isBanned;
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

// --- ตัวเลขจริงบนหน้าแรก (cache 60 วินาที ไม่ต้องนับใหม่ทุกครั้งที่มีคนเปิดเว็บ) ---
let statsCache = { at: 0, data: null };
app.get('/api/stats', async (req, res) => {
  try {
    if (!statsCache.data || Date.now() - statsCache.at > 60 * 1000) {
      const [users, skills, posts, exchanges] = await Promise.all([
        db.users.estimatedDocumentCount(),
        db.skills.estimatedDocumentCount(),
        db.posts.estimatedDocumentCount(),
        db.exchange_requests.countDocuments({ status: 'accepted' })
      ]);
      statsCache = { at: Date.now(), data: { users, skills, posts, exchanges } };
    }
    res.json(statsCache.data);
  } catch (e) {
    res.json({ users: 0, skills: 0, posts: 0, exchanges: 0 });
  }
});

// --- Community feed (routes/posts.js) + รายงาน/บล็อก/แอดมิน (routes/moderation.js) ---
const routeDeps = { db, ObjectId, io, notify, requireLogin, requireAdmin, isValidId, moderation, limits };
app.use('/api', postsRouter(routeDeps));
app.use('/api', moderationRouter(routeDeps));

// --- Socket.io ---
io.on('connection', (socket) => {
  const sess = socket.request.session;
  const userId = sess?.userId;
  if (!userId || moderation.banned.has(userId)) return socket.disconnect(true);
  socket.join('user:' + userId);
  const chatPeers = {}; // requestId → userId ของอีกฝ่าย (ไว้ส่งแจ้งเตือนข้อความใหม่)
  let sentTimes = [];   // กันสแปมแชท: ไม่เกิน 20 ข้อความต่อ 10 วินาที

  socket.on('joinRoom', async (requestId) => {
    try {
      const request = await findAcceptedRequestForUser(requestId, userId);
      if (!request) return;
      socket.join(requestId);
      chatPeers[requestId] = request.sender_id.toString() === userId ? request.receiver_id : request.sender_id;
    } catch (e) {
      console.error('joinRoom error:', e);
    }
  });

  socket.on('sendMessage', async ({ requestId, text } = {}) => {
    try {
      text = String(text || '').trim().slice(0, 2000);
      if (!text || !socket.rooms.has(requestId)) return;
      const now = Date.now();
      sentTimes = sentTimes.filter(t => now - t < 10000);
      if (sentTimes.length >= 20 && process.env.RATE_LIMIT !== 'off')
        return socket.emit('chatError', 'ส่งข้อความถี่เกินไป กรุณารอสักครู่');
      sentTimes.push(now);
      if (moderation.banned.has(userId) || await moderation.isBlockedBetween(userId, chatPeers[requestId]))
        return socket.emit('chatError', 'ส่งข้อความไม่ได้ เนื่องจากมีการบล็อกกันอยู่');
      const msg = {
        request_id: new ObjectId(requestId),
        sender_id: userId,
        sender_name: sess.username,
        text,
        created_at: new Date()
      };
      await db.messages.insertOne(msg);
      io.to(requestId).emit('newMessage', { ...msg, request_id: requestId });
      notify(chatPeers[requestId], {
        type: 'message',
        request_id: requestId,
        from: sess.username,
        preview: text.slice(0, 80)
      });
    } catch (e) {
      console.error('sendMessage error:', e);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🌉 KnowBridge running at http://localhost:${PORT}`);
});
