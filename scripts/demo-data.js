// ===== ข้อมูลตัวอย่างสำหรับวันพรีเซนต์ =====
//   npm run demo:add -- --db=knowbridge      เพิ่มผู้ใช้ โพสต์ การแลกเปลี่ยน แชท รีวิว ตัวอย่าง
//   npm run demo:remove -- --db=knowbridge   ลบข้อมูลตัวอย่างทิ้งทั้งหมด (ข้อมูลจริงไม่ถูกแตะ)
// เชื่อมด้วย MONGODB_URI ใน .env และต้องบอกชื่อฐานข้อมูลด้วย --db ทุกครั้ง กันเขียนผิดที่
//
// - ผู้ใช้ตัวอย่าง login ไม่ได้ (รหัสผ่านสุ่ม ไม่มีใครรู้)
// - ถ้ามีบัญชีทดลอง (Lxzywinn / Opie / Chwwy) จะได้คำขอ แชท นัด และรีวิวรออยู่ด้วย
//   เปิด DEMO_ACCOUNTS=on แล้ว login ด้วย lxzy@demo.com / demo1234 เพื่อโชว์ได้ทันที
// - ทุกอย่างที่สร้างมี demo_seed: true และ remove ลบตามผู้ใช้ตัวอย่างแบบเดียวกับการลบบัญชีจริง
//   (คำขอ แชท รีวิว ความคิดเห็น ถูกใจ แจ้งเตือน ที่คนจริงทำกับข้อมูลตัวอย่างก็หายไปด้วย)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const { extractTags } = require('../routes/posts');
const { PRIVACY_VERSION, deleteUserData } = require('../lib/accountData');
const { DEMO_EMAILS } = require('../lib/demoAccounts');
const { connectWithDnsFallback } = require('../lib/dnsFallback');

const COLLECTIONS = ['users', 'skills', 'user_skills', 'exchange_requests', 'reviews', 'messages',
  'posts', 'comments', 'reports', 'blocks', 'notifications', 'password_resets'];
const CI = { locale: 'en', strength: 2 };
const SEED = { demo_seed: true };

const HOUR = 60 * 60 * 1000;
const ago = (days, hours = 0) => new Date(Date.now() - (days * 24 + hours) * HOUR);
// _id ของโพสต์/ความคิดเห็นต้องตรงกับเวลาโพสต์ (ฟีดเรียงตาม _id)
const idAt = (date) => new ObjectId(ObjectId.generate(Math.floor(date.getTime() / 1000)));
// วันถัดไปตามเวลาไทย (UTC+7)
function thaiTime(daysAhead, hour) {
  const d = new Date(Date.now() + 7 * HOUR);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour - 7, 0, 0, 0);
  return d;
}

const PEOPLE = [
  { key: 'nat', username: 'Nat_dev', days: 40, teach: ['Python Programming', 'JavaScript', 'Node.js'], learn: ['Japanese', 'Guitar'],
    bio: 'นักศึกษาวิศวะคอมฯ ปี 3 ชอบสอนเขียนโปรแกรมให้เพื่อน ว่างเย็นวันธรรมดา' },
  { key: 'mai', username: 'Mai.english', days: 38, teach: ['English', 'Public Speaking'], learn: ['UI/UX Design', 'Figma'],
    bio: 'เรียนอักษรฯ เอกภาษาอังกฤษ เคยติวสอบ IELTS ให้รุ่นน้อง อยากหัดออกแบบแอป' },
  { key: 'pim', username: 'Pim_draws', days: 35, teach: ['Drawing & Illustration', 'Digital Art'], learn: ['English'],
    bio: 'วาดรูปดิจิทัลเป็นงานอดิเรก รับสอนพื้นฐานการวาดคน อยากพูดภาษาอังกฤษให้คล่อง' },
  { key: 'ton', username: 'TonGuitar', days: 33, teach: ['Guitar', 'Singing & Vocal'], learn: ['Python Programming'],
    bio: 'เล่นกีตาร์มา 6 ปี สอนตั้งแต่จับคอร์ดแรก อยากเขียนโปรแกรมเป็นบ้าง' },
  { key: 'fah', username: 'Fah_nihongo', days: 30, teach: ['Japanese'], learn: ['Photography', 'Video Editing'],
    bio: 'เคยไปแลกเปลี่ยนที่ญี่ปุ่น 1 ปี สอนภาษาญี่ปุ่นเบื้องต้น ชอบถ่ายรูปแต่ยังถ่ายไม่สวย' },
  { key: 'beam', username: 'BeamBakes', days: 27, teach: ['Cooking & Baking'], learn: ['Guitar'],
    bio: 'ชอบทำขนม เปิดร้านออนไลน์เล็ก ๆ อยากเล่นกีตาร์ร้องเพลงให้ลูกค้าฟัง' },
  { key: 'ploy', username: 'Ploy.ux', days: 25, teach: ['UI/UX Design', 'Figma', 'Graphic Design'], learn: ['Korean'],
    bio: 'ฝึกงานเป็น UX designer สอน Figma ได้ตั้งแต่ศูนย์ กำลังเรียนภาษาเกาหลี' },
  { key: 'korn', username: 'Korn_chess', days: 22, teach: ['Chess', 'Piano'], learn: ['Web Development', 'JavaScript'],
    bio: 'นักหมากรุกของโรงเรียน เล่นเปียโนด้วย อยากทำเว็บไซต์เป็นของตัวเอง' },
  { key: 'jane', username: 'Jane.kr', days: 20, teach: ['Korean'], learn: ['Drawing & Illustration'],
    bio: 'ติดซีรีส์เกาหลีจนพูดได้ สอนเกาหลีเบื้องต้นแบบสนุก ๆ อยากวาดรูปเป็น' },
  { key: 'mew', username: 'Mew_photo', days: 18, teach: ['Photography', 'Video Editing'], learn: ['Japanese'],
    bio: 'รับถ่ายรูปงานรับปริญญาเป็นงานเสริม สอนถ่ายรูปด้วยมือถือและกล้อง อยากพูดญี่ปุ่นได้' }
];

// [ผู้ส่ง, ผู้รับ, ข้อความคำขอ, สถานะ, กี่วันก่อน, รีวิว { คนรีวิว: [ดาว, ความเห็น] }, แชท [[คนส่ง, ข้อความ]], นัด]
const EXCHANGES = [
  ['ton', 'nat', 'สวัสดีครับ อยากเรียน Python ตั้งแต่พื้นฐาน แลกกับสอนกีตาร์ได้นะครับ', 'completed', 12, {
    nat: [5, 'สอนกีตาร์ใจเย็นมาก ตอนนี้เล่นเพลงแรกได้แล้ว'],
    ton: [5, 'อธิบาย Python เข้าใจง่าย มีแบบฝึกหัดให้ทำทุกครั้ง'] }],
  ['pim', 'mai', 'อยากฝึกพูดภาษาอังกฤษค่ะ แลกกับสอนวาดรูปได้นะคะ', 'completed', 11, {
    pim: [5, 'ฝึกพูดกับพี่ใหม่ทุกสัปดาห์ กล้าพูดขึ้นเยอะมาก'],
    mai: [5, 'สอนวาดสนุกมาก ได้เทคนิคใหม่เยอะ'] }],
  ['ploy', 'jane', 'สวัสดีค่ะ อยากเรียนภาษาเกาหลีเบื้องต้น สอน Figma ให้แลกได้ค่ะ', 'completed', 10, {
    ploy: [5, 'สอนเกาหลีสนุก มีศัพท์จากซีรีส์ด้วย จำง่ายมาก'],
    jane: [4, 'สอนละเอียดดี แต่บางทีเร็วไปนิดนึง'] }],
  ['beam', 'ton', 'อยากหัดกีตาร์ครับ แลกกับสอนทำขนม', 'completed', 8, {
    beam: [4, 'สอนดีครับ อยากได้แบบฝึกเพิ่มอีกนิด'],
    ton: [5, 'ขนมอร่อยมาก ได้สูตรไปทำเองที่บ้านแล้ว'] }],
  ['mew', 'fah', 'สวัสดีครับ อยากเรียนญี่ปุ่น แลกกับสอนถ่ายรูปพอดีเลยครับ', 'accepted', 3, null, [
    ['mew', 'สวัสดีครับพี่ฟ้า ยินดีที่ได้แลกกันนะครับ'],
    ['fah', 'สวัสดีค่ะ! อยากเริ่มจากการถ่ายรูปด้วยมือถือก่อนได้ไหม'],
    ['mew', 'ได้เลยครับ แล้วผมขอเริ่มจากฮิรางานะนะครับ 😄'],
    ['fah', 'โอเคค่ะ มะรืนนี้บ่ายสองที่สวนสาธารณะดีไหม จะได้ถ่ายรูปไปด้วย']
  ], { by: 'fah', daysAhead: 2, hour: 14, note: 'สวนสาธารณะใกล้มหาลัย ประตูทางเข้าหลัก' }],
  ['korn', 'nat', 'อยากทำเว็บแนะนำชมรมหมากรุกครับ แลกกับสอนหมากรุก', 'accepted', 2, null, [
    ['korn', 'พี่นัทครับ อยากทำเว็บแนะนำชมรมหมากรุก เริ่มจากตรงไหนดีครับ'],
    ['nat', 'เริ่มจาก HTML กับ CSS ก่อนเลย เดี๋ยวพี่ส่งแบบฝึกให้ แล้วสอนหมากรุกพี่ด้วยนะ ♟️']
  ]],
  ['mai', 'ploy', 'สวัสดีค่ะ อยากหัดออกแบบแอปด้วย Figma แลกกับฝึกภาษาอังกฤษให้ได้ค่ะ', 'pending', 1]
];

// ถ้ามีบัญชีทดลอง: ให้ Lxzywinn มีของรอโชว์ครบ (คำขอใหม่ / แชท+นัด / แลกเสร็จรอให้คะแนน)
const DEMO_EXCHANGES = [
  ['ton', 'lxzy@demo.com', 'สวัสดีครับ อยากเรียน Python แลกกับสอนกีตาร์ได้นะครับ ว่างเสาร์-อาทิตย์', 'pending', 0.1],
  ['lxzy@demo.com', 'mai', 'สวัสดีครับ อยากฝึกพูดภาษาอังกฤษ แลกกับสอน Python ได้ครับ', 'accepted', 2, null, [
    ['lxzy@demo.com', 'สวัสดีครับ ขอบคุณที่รับคำขอนะครับ'],
    ['mai', 'ยินดีค่ะ อยากเน้นพูดหรือเขียนก่อนดี'],
    ['lxzy@demo.com', 'เน้นพูดครับ เดือนหน้าจะสัมภาษณ์ฝึกงาน'],
    ['mai', 'ได้เลย พรุ่งนี้สี่โมงเย็นที่ห้องสมุดนะ เตรียมแนะนำตัวมา 1 นาทีค่ะ 😊']
  ], { by: 'mai', daysAhead: 1, hour: 16, note: 'ห้องสมุดคณะ ชั้น 2' }],
  ['korn', 'lxzy@demo.com', 'อยากเรียนเขียนโปรแกรมครับ แลกกับสอนเปียโน', 'completed', 9, {
    korn: [5, 'สอน Python เข้าใจง่ายมาก ใจเย็นสุด ๆ'] }],
  ['nat', 'opie@demo.com', 'อยากฝึกภาษาอังกฤษครับ สอน JavaScript ให้แลกได้', 'completed', 7, {
    nat: [5, 'สำเนียงดีมาก ฝึกแล้วมั่นใจขึ้นเยอะ'],
    'opie@demo.com': [5, 'สอน JavaScript เป็นขั้นเป็นตอน ทำตามได้ง่าย'] }],
  ['jane', 'chwwy@demo.com', 'สวัสดีค่ะ อยากเรียนวาดรูป แลกกับสอนภาษาเกาหลีได้ค่ะ', 'pending', 0.5]
];

// [คนโพสต์, กี่ชั่วโมงก่อน, ข้อความ, ความคิดเห็น [[คน, ข้อความ]]]
const POSTS = [
  ['nat', 120, 'แชร์เทคนิคเรียน #Python ให้ไว: เขียนโค้ดทุกวันวันละ 20 นาที ดีกว่าอัดทีเดียว 5 ชั่วโมงตอนเสาร์ 🐍\nใครเพิ่งเริ่ม แนะนำ https://docs.python.org/3/tutorial/ อ่านง่ายมาก',
    [['ton', 'ขอบคุณครับ เพิ่งเริ่มพอดีเลย'], ['korn', 'ลิงก์นี้ดีจริงครับ']]],
  ['mai', 116, '5 ประโยคภาษาอังกฤษที่ใช้บ่อยตอนประชุมออนไลน์ 👇\n• Could you repeat that, please?\n• Let me share my screen.\n• I\'ll follow up by email.\n• Sorry, you\'re on mute.\n• Let\'s wrap up here.\n#ภาษาอังกฤษ #English',
    [['pim', 'จดไว้แล้วค่ะ ขอบคุณพี่ใหม่ 🙏']]],
  ['ton', 96, 'มือใหม่หัดกีตาร์ เจ็บนิ้วเป็นเรื่องปกตินะครับ 🎸 ซ้อมวันละ 15 นาทีพอ อีก 2 สัปดาห์ปลายนิ้วจะด้านเอง\nเริ่มจากคอร์ด C G Am F เล่นได้เป็นร้อยเพลง #กีตาร์ #มือใหม่',
    [['beam', 'ตอนนี้เจ็บนิ้วมากครับ 555 จะอดทน']]],
  ['ploy', 84, 'ทริค #Figma ที่ใช้ทุกวัน: กด Shift+A ทำ Auto Layout ประหยัดเวลาไปครึ่งหนึ่ง ✨ ใครอยากลองออกแบบหน้าแอปแรก ทักมาแลกกันได้ #UXUI', []],
  ['fah', 72, 'วันนี้สอนน้องเรื่องฮิรางานะครบ 46 ตัวแล้ว 🎉 เคล็ดลับคือจำเป็นภาพ เช่น し (shi) หน้าตาเหมือนเบ็ดตกปลา #ภาษาญี่ปุ่น #เคล็ดลับ',
    [['mew', 'เทคนิคนี้ดีมาก ขอไปใช้บ้างครับ']]],
  ['beam', 66, 'ใครอยากทำบราวนี่หน้าฟิล์ม เคล็ดลับคือตีไข่กับน้ำตาลจนขึ้นฟูสีอ่อนก่อนใส่ช็อกโกแลต 🍫 อยากแลกสอนทำขนมกับคนสอนกีตาร์ครับ #ทำขนม', []],
  ['korn', 54, 'เพิ่งรู้ว่าการเล่นหมากรุกช่วยฝึกคิดแบบ algorithm ได้ดีมาก ♟️ ตอนนี้กำลังเรียน #JavaScript กับพี่ใน KnowBridge ใครมีไอเดียโปรเจกต์เว็บง่าย ๆ แนะนำหน่อยครับ', []],
  ['jane', 44, 'คำเกาหลีจากซีรีส์ที่ใช้ได้จริง 🇰🇷\n괜찮아 (คเวนชานา) = ไม่เป็นไร\n화이팅 (ฮวาอิติง) = สู้ ๆ\n#ภาษาเกาหลี #เคล็ดลับ',
    [['ploy', '괜찮아 ใช้บ่อยมากจริง ๆ']]],
  ['mew', 32, 'ถ่ายรูปด้วยมือถือให้สวยขึ้นทันที 📸 เปิดเส้นตาราง แล้ววางจุดสนใจตรงจุดตัด + ถ่ายช่วง golden hour ก่อนพระอาทิตย์ตก 1 ชั่วโมง #ถ่ายรูป #เคล็ดลับ', []],
  ['pim', 20, 'แจกวิธีฝึกวาดมือ ✋ วาดเป็นกล่องสี่เหลี่ยมก่อน แล้วค่อยแตกนิ้วเป็นทรงกระบอก สัดส่วนจะไม่เพี้ยน ใครอยากแลกเรียนวาดรูปกับภาษาอังกฤษทักมาได้นะ #วาดรูป', []],
  ['nat', 9, 'ใครเรียน #Python อยู่ ลองโจทย์นี้ดู: เขียนฟังก์ชันนับคำที่ซ้ำกันในประโยค ใช้ dict หรือ collections.Counter ก็ได้ ตอบในคอมเมนต์ได้เลย 😄',
    [['ton', 'from collections import Counter แล้วใช้ Counter(text.split()) ใช่ไหมครับ'], ['nat', 'ถูกต้องครับ 👍']]],
  ['ploy', 3, 'แลกเรียนเกาหลีกับ Jane ครบ 4 ครั้งแล้ว ตอนนี้อ่านเมนูร้านเกาหลีออกแล้ว 555 ขอบคุณ KnowBridge ที่ทำให้เจอกัน 💙 #ภาษาเกาหลี',
    [['jane', 'ดีใจด้วยน้า สัปดาห์หน้าเรียนต่อ!']]]
];

function parseArgs() {
  const cmd = process.argv[2];
  const dbArg = process.argv.find(a => a.startsWith('--db='));
  if (!['add', 'remove'].includes(cmd) || !dbArg) {
    console.log('วิธีใช้: npm run demo:add -- --db=<ชื่อฐานข้อมูล>  หรือ  npm run demo:remove -- --db=<ชื่อฐานข้อมูล>');
    console.log('ฐานข้อมูลของเว็บจริงบน Render ชื่อ knowbridge (ถ้าไม่ได้ตั้ง MONGODB_DB ไว้)');
    process.exit(1);
  }
  return { cmd, dbName: dbArg.slice('--db='.length) };
}

async function add(db) {
  if (await db.users.countDocuments(SEED)) {
    console.log('มีข้อมูลตัวอย่างอยู่แล้ว — ลบก่อนด้วย npm run demo:remove -- --db=...');
    return;
  }
  const taken = await db.users.find(
    { username: { $in: PEOPLE.map(p => p.username) } }, { collation: CI, projection: { username: 1 } }
  ).toArray();
  if (taken.length) {
    console.log('ชื่อผู้ใช้ตัวอย่างซ้ำกับผู้ใช้จริง:', taken.map(u => u.username).join(', '), '— ยกเลิก');
    return;
  }

  // ผู้ใช้ + ทักษะ
  const skills = await db.skills.find().toArray();
  const skillId = (name) => skills.find(s => s.name === name)?._id;
  const ids = {};   // key/อีเมลบัญชีทดลอง → { _id, username }
  for (const p of PEOPLE) {
    const created = ago(p.days);
    const user = {
      username: p.username,
      email: `${p.username.toLowerCase().replace(/[^a-z0-9]/g, '')}@seed.example.com`,
      password: bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10),
      bio: p.bio, created_at: created, privacy_version: PRIVACY_VERSION, privacy_accepted_at: created, ...SEED
    };
    const { insertedId } = await db.users.insertOne(user);
    ids[p.key] = { _id: insertedId, username: p.username };
    const docs = [
      ...p.teach.map(n => ({ user_id: insertedId, skill_id: skillId(n), type: 'teach', ...SEED })),
      ...p.learn.map(n => ({ user_id: insertedId, skill_id: skillId(n), type: 'learn', ...SEED }))
    ].filter(d => d.skill_id);
    if (docs.length) await db.user_skills.insertMany(docs);
  }
  const demoUsers = await db.users.find({ email: { $in: DEMO_EMAILS } }, { projection: { username: 1, email: 1 } }).toArray();
  for (const u of demoUsers) ids[u.email] = { _id: u._id, username: u.username };

  // คำขอแลกเปลี่ยน + แชท + นัด + รีวิว
  const list = [...EXCHANGES, ...DEMO_EXCHANGES].filter(([a, b]) => ids[a] && ids[b]);
  let messageCount = 0;
  let reviewCount = 0;
  for (const [from, to, message, status, days, reviews, chat, schedule] of list) {
    const created = ago(days);
    const req = { sender_id: ids[from]._id, receiver_id: ids[to]._id, message, status, created_at: created, ...SEED };
    if (status === 'completed') {
      req.completed_by = [ids[from]._id, ids[to]._id];
      req.completed_at = ago(Math.max(days - 3, 0.2));
    }
    if (schedule) {
      req.schedule = { at: thaiTime(schedule.daysAhead, schedule.hour), note: schedule.note, by: ids[schedule.by]._id, updated_at: ago(0, 5) };
    }
    const { insertedId: requestId } = await db.exchange_requests.insertOne(req);

    if (chat?.length) {
      // ข้อความห่างกันทีละ 40 นาที — ข้อความสุดท้ายของอีกฝ่ายยังไม่ได้อ่าน (โชว์ตัวเลขบนปุ่มแชท)
      const msgs = chat.map(([who, text], i) => ({
        request_id: requestId, sender_id: ids[who]._id.toString(), sender_name: ids[who].username,
        text, created_at: new Date(Date.now() - (chat.length - i) * 40 * 60 * 1000), ...SEED
      }));
      await db.messages.insertMany(msgs);
      messageCount += msgs.length;
      const last = msgs[msgs.length - 1];
      const lastRead = {};
      for (const key of [from, to]) {
        const uid = ids[key]._id.toString();
        lastRead[uid] = uid === last.sender_id ? new Date() : new Date(last.created_at.getTime() - 60 * 1000);
      }
      await db.exchange_requests.updateOne({ _id: requestId }, { $set: { last_read: lastRead } });
    }
    for (const [who, [rating, comment]] of Object.entries(reviews || {})) {
      const other = who === from ? to : from;
      await db.reviews.insertOne({
        request_id: requestId, reviewer_id: ids[who]._id, reviewee_id: ids[other]._id,
        rating, comment, created_at: ago(Math.max(days - 4, 0.1)), ...SEED
      });
      reviewCount++;
    }
    // คำขอใหม่ที่รอบัญชีทดลองตอบ → ขึ้นในกระดิ่งด้วย
    if (status === 'pending' && DEMO_EMAILS.includes(to)) {
      await db.notifications.insertOne({
        user_id: ids[to]._id, type: 'request', from: ids[from].username, request_id: requestId,
        read: false, created_at: created, ...SEED
      });
    }
  }

  // โพสต์ + ความคิดเห็น + ถูกใจ
  const seedIds = PEOPLE.map(p => ids[p.key]._id);
  let commentCount = 0;
  for (const [i, [who, hours, text, comments]] of POSTS.entries()) {
    const created = ago(0, hours);
    const postId = idAt(created);
    // คนกดถูกใจต่างกันไปในแต่ละโพสต์ (ไม่รวมคนโพสต์)
    const likes = seedIds.filter((id, j) => (i * 3 + j) % 4 !== 0 && !id.equals(ids[who]._id));
    await db.posts.insertOne({
      _id: postId, author_id: ids[who]._id, text, tags: extractTags(text), likes,
      comment_count: comments.length, created_at: created, ...SEED
    });
    for (const [k, [commenter, ctext]] of comments.entries()) {
      const at = new Date(created.getTime() + (k + 1) * 25 * 60 * 1000);
      await db.comments.insertOne({ _id: idAt(at), post_id: postId, author_id: ids[commenter]._id, text: ctext, created_at: at, ...SEED });
      commentCount++;
    }
  }

  console.log(`✅ เพิ่มข้อมูลตัวอย่างแล้ว: ผู้ใช้ ${PEOPLE.length} คน, คำขอ ${list.length}, ข้อความแชท ${messageCount}, ` +
    `รีวิว ${reviewCount}, โพสต์ ${POSTS.length}, ความคิดเห็น ${commentCount}`);
  console.log(demoUsers.length
    ? `👤 บัญชีทดลองที่มีของรอโชว์: ${demoUsers.map(u => u.username).join(', ')} (ต้องตั้ง DEMO_ACCOUNTS=on ถึงจะ login ได้)`
    : '👤 ไม่พบบัญชีทดลองในฐานข้อมูลนี้ — มีแค่ข้อมูลระหว่างผู้ใช้ตัวอย่างด้วยกัน');
}

async function remove(db) {
  const users = await db.users.find(SEED).toArray();
  const total = { users: users.length, posts: 0, comments: 0, exchange_requests: 0, messages: 0, reviews: 0 };
  for (const user of users) {
    // รีวิวที่ผู้ใช้ตัวอย่างเขียน ลบทิ้งเลย (ลบบัญชีจริงจะเก็บไว้แบบไม่ระบุชื่อ)
    total.reviews += (await db.reviews.deleteMany({ reviewer_id: user._id })).deletedCount;
    const d = await deleteUserData({ db, ObjectId }, user);
    for (const k of ['posts', 'comments', 'exchange_requests', 'messages', 'reviews']) total[k] += d[k];
  }
  // เผื่อมีอะไรที่ติดป้ายไว้แต่ไม่ได้ผูกกับผู้ใช้ตัวอย่าง
  for (const name of COLLECTIONS) await db[name].deleteMany(SEED);
  console.log(users.length
    ? `🧹 ลบข้อมูลตัวอย่างแล้ว: ${Object.entries(total).map(([k, v]) => `${k} ${v}`).join(', ')}`
    : 'ไม่มีข้อมูลตัวอย่างในฐานข้อมูลนี้');
}

(async () => {
  const { cmd, dbName } = parseArgs();
  if (!process.env.MONGODB_URI) {
    console.log('ไม่พบ MONGODB_URI ใน .env');
    process.exit(1);
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await connectWithDnsFallback(client);
    const database = client.db(dbName);
    const db = Object.fromEntries(COLLECTIONS.map(n => [n, database.collection(n)]));
    console.log(`ฐานข้อมูล: ${dbName}`);
    if (cmd === 'add') await add(db); else await remove(db);
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
