const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
// ตั้ง MONGODB_DB เป็นชื่ออื่น (เช่น knowbridge_dev) ตอนรันในเครื่อง จะได้ไม่ปนกับข้อมูลเว็บจริง
const dbName = process.env.MONGODB_DB || 'knowbridge';
const client = new MongoClient(uri);
const db = {};

// บัญชีทดลอง (รหัส demo1234 อยู่ใน README) — บนเว็บจริงปิดไว้ก่อน เปิดได้ด้วย DEMO_ACCOUNTS=on
// Render ตั้ง RENDER=true ให้อัตโนมัติ
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
const { DEMO_EMAILS } = require('./lib/demoAccounts');
const { connectWithDnsFallback } = require('./lib/dnsFallback');
const demoEnabled = process.env.DEMO_ACCOUNTS ? process.env.DEMO_ACCOUNTS === 'on' : !isProduction;
// เทียบอีเมล/ชื่อผู้ใช้แบบไม่สนตัวพิมพ์เล็ก-ใหญ่
const CI = { locale: 'en', strength: 2 };

async function connectDB() {
  try {
    await connectWithDnsFallback(client);
    console.log(`✅ Connected to MongoDB Atlas (db: ${dbName})`);
    const database = client.db(dbName);

    db.users             = database.collection('users');
    db.skills            = database.collection('skills');
    db.user_skills       = database.collection('user_skills');
    db.exchange_requests = database.collection('exchange_requests');
    db.reviews           = database.collection('reviews');
    db.messages          = database.collection('messages');
    db.posts             = database.collection('posts');
    db.comments          = database.collection('comments');
    db.reports           = database.collection('reports');
    db.blocks            = database.collection('blocks');
    db.notifications     = database.collection('notifications');
    db.password_resets   = database.collection('password_resets');
    db.sessions          = database.collection('sessions'); // ของ connect-mongo — ใช้ลบ session ตอนเปลี่ยนรหัส

    await Promise.all([
      db.messages.createIndex({ request_id: 1, created_at: 1 }),
      db.reviews.createIndex({ request_id: 1, reviewer_id: 1 }, { unique: true }),
      db.reviews.createIndex({ reviewee_id: 1 }),
      db.exchange_requests.createIndex({ receiver_id: 1 }),
      db.exchange_requests.createIndex({ sender_id: 1 }),
      // ฟีดเรียงตาม _id (ObjectId เรียงตามเวลาสร้างอยู่แล้ว)
      db.posts.createIndex({ tags: 1, _id: -1 }),
      db.posts.createIndex({ author_id: 1, _id: -1 }),
      db.comments.createIndex({ post_id: 1, _id: 1 }),
      db.reports.createIndex({ status: 1, _id: -1 }),
      db.reports.createIndex({ reporter_id: 1, type: 1, target_id: 1 }),
      db.blocks.createIndex({ blocker_id: 1, blocked_id: 1 }, { unique: true }),
      db.blocks.createIndex({ blocked_id: 1 }),
      db.notifications.createIndex({ user_id: 1, _id: -1 }),
      db.notifications.createIndex({ user_id: 1, type: 1, post_id: 1, read: 1 }),
      // ลบแจ้งเตือนเก่ากว่า 30 วัน และลิงก์รีเซ็ตรหัสที่หมดอายุ ให้เองอัตโนมัติ (TTL index)
      db.notifications.createIndex({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }),
      db.password_resets.createIndex({ token_hash: 1 }, { unique: true }),
      db.password_resets.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    ]);
    // อีเมล/ชื่อซ้ำกันไม่ได้ (Test@x กับ test@x นับเป็นอันเดียวกัน) — ถ้าข้อมูลเก่ามีซ้ำอยู่แล้ว
    // index จะสร้างไม่ได้ แต่ระบบยังทำงานต่อ (ฝั่ง register เช็กซ้ำให้อยู่แล้ว)
    for (const field of ['email', 'username']) {
      await db.users.createIndex({ [field]: 1 }, { unique: true, collation: CI, name: `${field}_ci_unique` })
        .catch(e => console.warn(`⚠️ สร้าง unique index ของ ${field} ไม่ได้ (มีข้อมูลซ้ำอยู่?):`, e.message));
    }

    // ✅ รัน seed แยกกันทีละตัว ไม่ผูกกัน
    await seedSkills();
    await seedUsers();
    await seedUserSkills();  // ← เพิ่มใหม่ แยกออกมา
    // เปิด/ปิดบัญชีทดลองตามการตั้งค่า (ไม่ลบ — ข้อมูลยังอยู่ เปิดกลับได้)
    const { modifiedCount } = await db.users.updateMany(
      { email: { $in: DEMO_EMAILS }, disabled: { $ne: !demoEnabled } },
      { $set: { disabled: !demoEnabled } }
    );
    console.log(`👤 บัญชีทดลอง: ${demoEnabled ? 'เปิด' : 'ปิด'}${modifiedCount ? ` (เปลี่ยน ${modifiedCount} บัญชี)` : ''}`);
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
  if (!demoEnabled) return;
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

const ready = connectDB();
module.exports = { db, ObjectId, client, dbName, ready, CI, DEMO_EMAILS };