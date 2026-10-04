// ===== สำรอง / กู้คืนฐานข้อมูล MongoDB เป็นไฟล์ JSON =====
//   npm run backup -- --db=knowbridge
//       → backups/knowbridge-2026-10-05-1530/ (ไฟล์ละ 1 collection + meta.json)
//   npm run restore -- --from=backups/knowbridge-2026-10-05-1530 --db=knowbridge_restore
//       → ใส่ข้อมูลกลับลงฐานข้อมูลที่ระบุ (ต้องว่าง) — ใส่ --replace เพื่อลบข้อมูลเดิมใน collection เหล่านั้นก่อน
// เชื่อมด้วย MONGODB_URI ใน .env และต้องบอกชื่อฐานข้อมูลด้วย --db ทุกครั้ง
//
// ⚠️ ไฟล์สำรองมีอีเมลและ hash ของรหัสผ่านผู้ใช้ — โฟลเดอร์ backups/ ถูก .gitignore ไว้ ห้ามอัปขึ้นที่สาธารณะ
//    และลบไฟล์เก่าที่ไม่ใช้แล้วทิ้ง (PDPA: เก็บเท่าที่จำเป็น)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { MongoClient, BSON } = require('mongodb');
const { connectWithDnsFallback } = require('../lib/dnsFallback');

// session / ลิงก์ชั่วคราว ไม่ต้องสำรอง (หมดอายุเอง และไม่ควรกู้กลับมา)
const SKIP = new Set(['sessions', 'password_resets', 'email_verifications']);
const BATCH = 1000;

function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const stamp = () => {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000); // เวลาไทย
  return d.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
};

async function backup(database, dbName) {
  const dir = path.join(__dirname, '..', 'backups', `${dbName}-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  const names = (await database.listCollections({}, { nameOnly: true }).toArray())
    .map(c => c.name).filter(n => !SKIP.has(n) && !n.startsWith('system.')).sort();
  const counts = {};
  for (const name of names) {
    const docs = await database.collection(name).find().toArray();
    // canonical EJSON เก็บชนิดข้อมูลไว้ครบ (ObjectId, Date) กู้คืนแล้วได้ของเดิม
    fs.writeFileSync(path.join(dir, `${name}.json`), BSON.EJSON.stringify(docs, { relaxed: false }));
    counts[name] = docs.length;
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ db: dbName, created_at: new Date(), collections: counts }, null, 2));
  console.log(`✅ สำรองแล้ว → ${path.relative(process.cwd(), dir)}`);
  console.log(Object.entries(counts).map(([k, v]) => `   ${k}: ${v}`).join('\n'));
}

async function restore(database, dbName) {
  const from = arg('from');
  const dir = from && path.resolve(from);
  if (!dir || !fs.existsSync(path.join(dir, 'meta.json'))) {
    console.log('ไม่พบโฟลเดอร์สำรอง — ใส่ --from=backups/<ชื่อโฟลเดอร์> (ต้องมีไฟล์ meta.json)');
    process.exitCode = 1;
    return;
  }
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const names = Object.keys(meta.collections);
  const replace = process.argv.includes('--replace');

  // เช็กก่อนเขียนอะไรทั้งนั้น: ถ้าไม่ใส่ --replace ปลายทางต้องว่าง
  if (!replace) {
    const notEmpty = [];
    for (const name of names) if (await database.collection(name).estimatedDocumentCount()) notEmpty.push(name);
    if (notEmpty.length) {
      console.log(`ฐานข้อมูล ${dbName} มีข้อมูลอยู่แล้วใน: ${notEmpty.join(', ')}`);
      console.log('ยกเลิก — ใส่ --replace ถ้าต้องการลบข้อมูลใน collection เหล่านี้แล้วแทนที่ด้วยไฟล์สำรอง');
      process.exitCode = 1;
      return;
    }
  }
  console.log(`กู้คืนจาก ${meta.db} (สำรองเมื่อ ${meta.created_at}) → ${dbName}${replace ? ' (แทนที่ข้อมูลเดิม)' : ''}`);
  for (const name of names) {
    const docs = BSON.EJSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    const coll = database.collection(name);
    if (replace) await coll.deleteMany({});
    for (let i = 0; i < docs.length; i += BATCH) await coll.insertMany(docs.slice(i, i + BATCH), { ordered: false });
    console.log(`   ${name}: ${docs.length}`);
  }
  console.log('✅ กู้คืนแล้ว — ถ้าเป็นฐานข้อมูลของเว็บ ให้ restart server (Render: Manual Deploy) เพื่อโหลดสถานะใหม่');
}

(async () => {
  const cmd = process.argv[2];
  const dbName = arg('db');
  if (!['backup', 'restore'].includes(cmd) || !dbName) {
    console.log('วิธีใช้: npm run backup -- --db=<ชื่อฐานข้อมูล>');
    console.log('       npm run restore -- --from=backups/<โฟลเดอร์> --db=<ชื่อฐานข้อมูล> [--replace]');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.log('ไม่พบ MONGODB_URI ใน .env');
    process.exit(1);
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await connectWithDnsFallback(client);
    const database = client.db(dbName);
    if (cmd === 'backup') await backup(database, dbName); else await restore(database, dbName);
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
