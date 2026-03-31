const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'knowbridge-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'กรุณา Login ก่อน' });
  }
  next();
}

// --- Auth ---
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ' });
  try {
    const existing = await db.users.findOne({ $or: [{ email }, { username }] });
    if (existing)
      return res.json({ success: false, error: 'Username หรือ Email ซ้ำ' });
    const hashed = bcrypt.hashSync(password, 10);
    const user = await db.users.insert({ username, email, password: hashed, bio: '' });
    req.session.userId = user._id;
    req.session.username = username;
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.users.findOne({ email });
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.json({ success: false, error: 'Email หรือรหัสผ่านไม่ถูกต้อง' });
  req.session.userId = user._id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- Skills ---
app.get('/api/skills', async (req, res) => {
  const skills = await db.skills.find({});
  res.json(skills);
});

app.get('/api/search', async (req, res) => {
  const { skill, category } = req.query;
  let query = {};
  if (category) query.category = category;
  if (skill) query.name = new RegExp(skill, 'i');
  const skills = await db.skills.find(query);
  const skillIds = skills.map(s => s._id);

  let userSkillQuery = { type: 'teach', skill_id: { $in: skillIds } };
  const userSkills = await db.user_skills.find(userSkillQuery);

  const results = [];
  for (const us of userSkills) {
    const user = await db.users.findOne({ _id: us.user_id });
    const skillInfo = await db.skills.findOne({ _id: us.skill_id });
    if (user && skillInfo) {
      results.push({
        id: user._id,
        username: user.username,
        bio: user.bio,
        skill_name: skillInfo.name,
        category: skillInfo.category,
      });
    }
  }
  res.json(results);
});

// --- Profile ---
app.get('/api/profile', requireLogin, async (req, res) => {
  const user = await db.users.findOne({ _id: req.session.userId });
  const skills = await db.user_skills.find({ user_id: req.session.userId });
  res.json({ user, skills });
});

app.post('/api/profile/update', requireLogin, async (req, res) => {
  const { bio, teach_skills, learn_skills } = req.body;
  await db.users.update({ _id: req.session.userId }, { $set: { bio } });
  await db.user_skills.remove({ user_id: req.session.userId }, { multi: true });
  for (const id of (teach_skills || [])) {
    await db.user_skills.insert({ user_id: req.session.userId, skill_id: id, type: 'teach' });
  }
  for (const id of (learn_skills || [])) {
    await db.user_skills.insert({ user_id: req.session.userId, skill_id: id, type: 'learn' });
  }
  res.json({ success: true });
});

// --- Exchange ---
app.post('/api/exchange/request', requireLogin, async (req, res) => {
  const { receiver_id, offer_skill_id, want_skill_id, message } = req.body;
  await db.exchange_requests.insert({
    sender_id: req.session.userId,
    receiver_id, offer_skill_id, want_skill_id,
    message, status: 'pending',
    created_at: new Date()
  });
  res.json({ success: true });
});

app.get('/api/dashboard', requireLogin, async (req, res) => {
  const received = await db.exchange_requests.find({ receiver_id: req.session.userId });
  const sent = await db.exchange_requests.find({ sender_id: req.session.userId });
  res.json({ received, sent });
});

app.post('/api/exchange/respond', requireLogin, async (req, res) => {
  const { request_id, status } = req.body;
  await db.exchange_requests.update(
    { _id: request_id, receiver_id: req.session.userId },
    { $set: { status } }
  );
  res.json({ success: true });
});

// --- Reviews ---
app.post('/api/review', requireLogin, async (req, res) => {
  const { request_id, reviewee_id, rating, comment } = req.body;
  await db.reviews.insert({
    request_id, reviewer_id: req.session.userId,
    reviewee_id, rating, comment,
    created_at: new Date()
  });
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🌉 KnowBridge running at http://localhost:${PORT}`);
});