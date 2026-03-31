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

    await seedSkills();
    await seedUsers();
    console.log('🚀 Database ready!');
  } catch (err) {
    console.error('❌ MongoDB Error:', err);
  }
}

async function seedSkills() {
  const count = await db.skills.countDocuments();
  if (count === 0) {
    const sampleSkills = [
      { name: 'Python Programming', category: 'IT' },
      { name: 'JavaScript', category: 'IT' },
      { name: 'Web Development', category: 'IT' },
      { name: 'React.js', category: 'IT' },
      { name: 'Node.js', category: 'IT' },
      { name: 'Java Programming', category: 'IT' },
      { name: 'SQL & Database', category: 'IT' },
      { name: 'UI/UX Design', category: 'IT' },
      { name: 'Figma', category: 'IT' },
      { name: 'English', category: 'Language' },
      { name: 'Japanese', category: 'Language' },
      { name: 'Chinese (Mandarin)', category: 'Language' },
      { name: 'Korean', category: 'Language' },
      { name: 'French', category: 'Language' },
      { name: 'Drawing & Illustration', category: 'Art' },
      { name: 'Digital Art', category: 'Art' },
      { name: 'Photography', category: 'Art' },
      { name: 'Video Editing', category: 'Art' },
      { name: 'Graphic Design', category: 'Art' },
      { name: 'Guitar', category: 'Music' },
      { name: 'Piano', category: 'Music' },
      { name: 'Singing & Vocal', category: 'Music' },
      { name: 'Cooking & Baking', category: 'Other' },
      { name: 'Public Speaking', category: 'Other' },
      { name: 'Chess', category: 'Other' },
    ];
    await db.skills.insertMany(sampleSkills);
    console.log('✅ Skills seeded!');
  }
}

async function seedUsers() {
  const count = await db.users.countDocuments();
  if (count === 0) {
    const users = [
      { username: 'Lxzywinn', email: 'ake@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'นักศึกษา IT ชอบเขียนโปรแกรม' },
      { username: 'Opie',     email: 'bee@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'นักศึกษาอักษรศาสตร์ ภาษาอังกฤษเก่ง' },
      { username: 'Chwwy',    email: 'cee@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'ชอบวาดรูปและดีไซน์' },
    ];
    const result = await db.users.insertMany(users);
    const insertedIds = Object.values(result.insertedIds);

    const allSkills = await db.skills.find().toArray();
    const findSkillId = (name) => allSkills.find(s => s.name === name)?._id;

    const userSkills = [
      { user_id: insertedIds[0], skill_id: findSkillId('Python Programming'), type: 'teach' },
      { user_id: insertedIds[0], skill_id: findSkillId('English'),            type: 'learn' },
      { user_id: insertedIds[1], skill_id: findSkillId('English'),            type: 'teach' },
      { user_id: insertedIds[1], skill_id: findSkillId('JavaScript'),         type: 'learn' },
      { user_id: insertedIds[2], skill_id: findSkillId('Drawing & Illustration'), type: 'teach' },
      { user_id: insertedIds[2], skill_id: findSkillId('Python Programming'), type: 'learn' },
    ];
    await db.user_skills.insertMany(userSkills);
    console.log('✅ Demo users seeded!');
  }
}

connectDB();
module.exports = { db, ObjectId };