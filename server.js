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
app.use(session({
  secret: process.env.SESSION_SECRET || 'knowbridge-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'กรุณา Login ก่อน' });
  next();
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
    if (category) query.category = category;
    if (skill) query.name = new RegExp(skill, 'i');
    const skills = await db.skills.find(query).toArray();
    const skillIds = skills.map(s => s._id);
    const currentUserId = req.session.userId ? new ObjectId(req.session.userId) : null;
    const userSkills = await db.user_skills.find({ type: 'teach', skill_id: { $in: skillIds } }).toArray();
    const results = [];
    for (const us of userSkills) {
      const user = await db.users.findOne({ _id: us.user_id });
      const skillInfo = await db.skills.findOne({ _id: us.skill_id });
      if (user && skillInfo && user._id.toString() !== req.session.userId) {
        results.push({ id: user._id, username: user.username, bio: user.bio, skill_name: skillInfo.name, category: skillInfo.category });
      }
    }
    res.json(results);
  } catch (e) {
    res.json([]);
  }
});

// --- Profile ---
app.get('/api/profile', requireLogin, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: new ObjectId(req.session.userId) });
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
    await db.users.updateOne({ _id: new ObjectId(req.session.userId) }, { $set: { bio } });
    await db.user_skills.deleteMany({ user_id: new ObjectId(req.session.userId) });
    for (const id of (teach_skills || [])) {
      await db.user_skills.insertOne({ user_id: new ObjectId(req.session.userId), skill_id: new ObjectId(id), type: 'teach' });
    }
    for (const id of (learn_skills || [])) {
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
    await db.exchange_requests.insertOne({
      sender_id: new ObjectId(req.session.userId),
      receiver_id: new ObjectId(receiver_id),
      message: message || '',
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

    // ดึงชื่อ user มาด้วย
    const enriched = async (list, idField) => Promise.all(list.map(async r => {
      const user = await db.users.findOne({ _id: r[idField] });
      return { ...r, other_username: user?.username || 'ไม่ทราบชื่อ' };
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
    await db.exchange_requests.updateOne(
      { _id: new ObjectId(request_id), receiver_id: new ObjectId(req.session.userId) },
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
    const messages = await db.messages.find({
      request_id: new ObjectId(req.params.requestId)
    }).sort({ created_at: 1 }).toArray();
    res.json(messages);
  } catch (e) {
    res.json([]);
  }
});

// --- Socket.io ---
const onlineUsers = {};

io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    onlineUsers[userId] = socket.id;
  });

  socket.on('joinRoom', (requestId) => {
    socket.join(requestId);
  });

  socket.on('sendMessage', async ({ requestId, senderId, senderName, text }) => {
    const msg = {
      request_id: new ObjectId(requestId),
      sender_id: senderId,
      sender_name: senderName,
      text,
      created_at: new Date()
    };
    await db.messages.insertOne(msg);
    io.to(requestId).emit('newMessage', { ...msg, request_id: requestId });
  });

  socket.on('disconnect', () => {
    for (const [uid, sid] of Object.entries(onlineUsers)) {
      if (sid === socket.id) delete onlineUsers[uid];
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🌉 KnowBridge running at http://localhost:${PORT}`);
});

// --- Socket.io ---
app.delete('/api/exchange/request/:id', requireLogin, async (req, res) => {
  try {
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