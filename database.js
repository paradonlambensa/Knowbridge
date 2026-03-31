const Datastore = require('nedb-promises');
const path = require('path');

const db = {
  users: Datastore.create({ 
    filename: path.join(__dirname, 'data', 'users.db'), 
    autoload: true 
  }),
  skills: Datastore.create({ 
    filename: path.join(__dirname, 'data', 'skills.db'), 
    autoload: true 
  }),
  user_skills: Datastore.create({ 
    filename: path.join(__dirname, 'data', 'user_skills.db'), 
    autoload: true 
  }),
  exchange_requests: Datastore.create({ 
    filename: path.join(__dirname, 'data', 'exchange_requests.db'), 
    autoload: true 
  }),
  reviews: Datastore.create({ 
    filename: path.join(__dirname, 'data', 'reviews.db'), 
    autoload: true 
  }),
};

// เพิ่มทักษะตัวอย่าง
const sampleSkills = [
  // IT & Programming
  ['Python Programming', 'IT'],
  ['JavaScript', 'IT'],
  ['Web Development', 'IT'],
  ['React.js', 'IT'],
  ['Node.js', 'IT'],
  ['Java Programming', 'IT'],
  ['C++ Programming', 'IT'],
  ['PHP', 'IT'],
  ['SQL & Database', 'IT'],
  ['Excel & Spreadsheet', 'IT'],
  ['Data Analysis', 'IT'],
  ['Machine Learning', 'IT'],
  ['Cybersecurity', 'IT'],
  ['Networking', 'IT'],
  ['Docker & DevOps', 'IT'],
  ['Mobile App (Flutter)', 'IT'],
  ['UI/UX Design', 'IT'],
  ['Figma', 'IT'],
  ['WordPress', 'IT'],
  ['PowerPoint', 'IT'],

  // Languages
  ['English', 'Language'],
  ['Japanese', 'Language'],
  ['Chinese (Mandarin)', 'Language'],
  ['Korean', 'Language'],
  ['French', 'Language'],
  ['German', 'Language'],
  ['Spanish', 'Language'],
  ['Thai Sign Language', 'Language'],
  ['Arabic', 'Language'],
  ['Malay', 'Language'],

  // Art & Design
  ['Drawing & Illustration', 'Art'],
  ['Digital Art', 'Art'],
  ['Watercolor Painting', 'Art'],
  ['Photography', 'Art'],
  ['Video Editing', 'Art'],
  ['Graphic Design', 'Art'],
  ['Calligraphy', 'Art'],
  ['Pottery & Ceramics', 'Art'],
  ['Fashion Design', 'Art'],
  ['Comic & Manga Drawing', 'Art'],

  // Music
  ['Guitar', 'Music'],
  ['Piano', 'Music'],
  ['Ukulele', 'Music'],
  ['Singing & Vocal', 'Music'],
  ['Music Theory', 'Music'],
  ['Drum', 'Music'],
  ['Violin', 'Music'],
  ['Music Production (DAW)', 'Music'],

  // Other
  ['Cooking & Baking', 'Other'],
  ['Yoga & Meditation', 'Other'],
  ['Public Speaking', 'Other'],
  ['Creative Writing', 'Other'],
  ['Chess', 'Other'],
  ['Gardening', 'Other'],
  ['Financial Planning', 'Other'],
  ['Marketing & Branding', 'Other'],
];

async function seedSkills() {
  const existing = await db.skills.find({});
  if (existing.length === 0) {
    const skillObjects = sampleSkills.map(([name, category]) => ({ name, category }));
    await db.skills.insert(skillObjects);
    console.log('✅ Skills seeded!');
  }
}

seedSkills();
console.log('✅ Database ready!');
module.exports = db;

async function seedUsers() {
  const existing = await db.users.find({});
  if (existing.length === 0) {
    const bcrypt = require('bcryptjs');

    const users = [
      { username: 'Lxzywynn', email: 'ake@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'นักศึกษา IT ชอบเขียนโปรแกรม อยากฝึกภาษาอังกฤษ' },
      { username: 'Opie', email: 'bee@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'นักศึกษาอักษรศาสตร์ ภาษาอังกฤษเก่ง อยากเรียนเขียนโค้ด' },
      { username: 'Chwwy', email: 'cee@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'ชอบวาดรูปและดีไซน์ อยากเรียน Python วิเคราะห์ข้อมูล' },
      { username: 'Vito', email: 'dee@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'เล่นกีตาร์มา 5 ปี อยากเรียนภาษาญี่ปุ่น' },
      { username: 'Peace', email: 'ee@demo.com', password: bcrypt.hashSync('demo1234', 10), bio: 'เรียนภาษาญี่ปุ่นมา 3 ปี อยากหัดถ่ายภาพ' },
    ];

    const insertedUsers = await db.users.insert(users);

    // ดึง skills มาใส่ให้แต่ละ user
    const allSkills = await db.skills.find({});
    const find = (name) => allSkills.find(s => s.name === name)?._id;

    const userSkills = [
      { user_id: insertedUsers[0]._id, skill_id: find('Python Programming'), type: 'teach' },
      { user_id: insertedUsers[0]._id, skill_id: find('English'), type: 'learn' },

      { user_id: insertedUsers[1]._id, skill_id: find('English'), type: 'teach' },
      { user_id: insertedUsers[1]._id, skill_id: find('JavaScript'), type: 'learn' },

      { user_id: insertedUsers[2]._id, skill_id: find('Drawing & Illustration'), type: 'teach' },
      { user_id: insertedUsers[2]._id, skill_id: find('Python Programming'), type: 'learn' },

      { user_id: insertedUsers[3]._id, skill_id: find('Guitar'), type: 'teach' },
      { user_id: insertedUsers[3]._id, skill_id: find('Japanese'), type: 'learn' },

      { user_id: insertedUsers[4]._id, skill_id: find('Japanese'), type: 'teach' },
      { user_id: insertedUsers[4]._id, skill_id: find('Photography'), type: 'learn' },
    ];

    await db.user_skills.insert(userSkills);
    console.log('✅ Demo users seeded!');
  }
}

seedUsers();