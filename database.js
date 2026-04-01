const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
const db = {};

async function connectDB() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');
    const database = client.db('knowbridge');

    db.users             = database.collection('users');
    db.skills            = database.collection('skills');
    db.user_skills       = database.collection('user_skills');
    db.exchange_requests = database.collection('exchange_requests');
    db.reviews           = database.collection('reviews');
    db.messages          = database.collection('messages');

    // ✅ รัน seed แยกกันทีละตัว ไม่ผูกกัน
    await seedSkills();
    await seedUsers();
    await seedUserSkills();  // ← เพิ่มใหม่ แยกออกมา
    console.log('🚀 Database ready!');
  } catch (err) {
    console.error('❌ MongoDB Error:', err);
  }
}

// ===== Seed Skills =====
async function seedSkills() {
  const count = await db.skills.countDocuments();
  if (count > 0) return;
  const sampleSkills = [
    { name: 'Python Programming', category: 'IT' },
    { name: 'JavaScript',         category: 'IT' },
    { name: 'Web Development',    category: 'IT' },
    { name: 'React.js',           category: 'IT' },
    { name: 'Node.js',            category: 'IT' },
    { name: 'Java Programming',   category: 'IT' },
    { name: 'SQL & Database',     category: 'IT' },
    { name: 'UI/UX Design',       category: 'IT' },
    { name: 'Figma',              category: 'IT' },
    { name: 'English',            category: 'Language' },
    { name: 'Japanese',           category: 'Language' },
    { name: 'Chinese (Mandarin)', category: 'Language' },
    { name: 'Korean',             category: 'Language' },
    { name: 'French',             category: 'Language' },
    { name: 'Drawing & Illustration', category: 'Art' },
    { name: 'Digital Art',        category: 'Art' },
    { name: 'Photography',        category: 'Art' },
    { name: 'Video Editing',      category: 'Art' },
    { name: 'Graphic Design',     category: 'Art' },
    { name: 'Guitar',             category: 'Music' },
    { name: 'Piano',              category: 'Music' },
    { name: 'Singing & Vocal',    category: 'Music' },
    { name: 'Cooking & Baking',   category: 'Other' },
    { name: 'Public Speaking',    category: 'Other' },
    { name: 'Chess',              category: 'Other' },
  ];
  await db.skills.insertMany(sampleSkills);
  console.log('✅ Skills seeded!');
}

// ===== Seed Users (เฉพาะถ้าไม่มี user เลย) =====
async function seedUsers() {
  const count = await db.users.countDocuments();
  if (count > 0) return;
  const users = [
    { username: 'Lxzywinn', email: 'lxzy@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'นักศึกษา IT ชอบเขียนโปรแกรม' },
    { username: 'Opie',     email: 'opie@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'นักศึกษาอักษรศาสตร์ ภาษาอังกฤษเก่ง' },
    { username: 'Chwwy',    email: 'chwwy@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'ชอบวาดรูปและดีไซน์' },
  ];
  await db.users.insertMany(users);
  console.log('✅ Demo users seeded!');
}

// ===== Seed UserSkills แยกออกมา (ทำงานได้แม้มี users อยู่แล้ว) =====
async function seedUserSkills() {
  const count = await db.user_skills.countDocuments();
  if (count > 0) return;  // มีข้อมูลแล้ว ข้ามได้

  const allSkills = await db.skills.find().toArray();
  if (allSkills.length === 0) {
    console.log('⚠️ ยังไม่มี skills ใน DB, ข้าม seedUserSkills');
    return;
  }

  const findSkillId = (name) => allSkills.find(s => s.name === name)?._id;

  // ค้นหา users ที่มีอยู่ใน DB จริงๆ
  const lxzywinn = await db.users.findOne({ username: 'Lxzywinn' });
  const opie     = await db.users.findOne({ username: 'Opie' });
  const chwwy    = await db.users.findOne({ username: 'Chwwy' });

  const userSkills = [];

  if (lxzywinn) {
    userSkills.push({ user_id: lxzywinn._id, skill_id: findSkillId('Python Programming'), type: 'teach' });
    userSkills.push({ user_id: lxzywinn._id, skill_id: findSkillId('English'),            type: 'learn'  });
  }
  if (opie) {
    userSkills.push({ user_id: opie._id, skill_id: findSkillId('English'),      type: 'teach' });
    userSkills.push({ user_id: opie._id, skill_id: findSkillId('JavaScript'),  type: 'learn'  });
  }
  if (chwwy) {
    userSkills.push({ user_id: chwwy._id, skill_id: findSkillId('Drawing & Illustration'), type: 'teach' });
    userSkills.push({ user_id: chwwy._id, skill_id: findSkillId('Python Programming'),    type: 'learn'  });
  }

  if (userSkills.length > 0) {
    await db.user_skills.insertMany(userSkills);
    console.log(`✅ User skills seeded! (${userSkills.length} records)`);
  } else {
    console.log('⚠️ ไม่พบ demo users ใน DB');
  }
}

connectDB();
module.exports = { db, ObjectId };