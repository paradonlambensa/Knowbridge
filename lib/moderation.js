// ===== สถานะการดูแลเนื้อหาที่ใช้ร่วมกันทุก route: ผู้ใช้ที่ถูกระงับ / การบล็อก / แอดมิน =====
module.exports = function createModeration({ db, ObjectId }) {
  // id ของผู้ใช้ที่ถูกระงับ (แบนโดยแอดมิน หรือบัญชีทดลองที่ปิดอยู่) — เก็บในหน่วยความจำ เช็กได้ทุก request โดยไม่ต้องถาม DB
  const banned = new Set();

  async function loadBanned() {
    banned.clear();
    const rows = await db.users.find({ disabled: true }, { projection: { _id: 1 } }).toArray();
    rows.forEach(u => banned.add(u._id.toString()));
  }

  // แอดมินกำหนดด้วยอีเมลใน ADMIN_EMAILS (คั่นด้วย ,)
  function isAdminEmail(email) {
    const admins = String(process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    return admins.includes(String(email || '').toLowerCase());
  }

  // คนที่เราบล็อก + คนที่บล็อกเรา (ซ่อนจากกันทั้งสองทาง)
  async function blockSets(userId) {
    const blockedByMe = new Set();
    const blockedMe = new Set();
    if (userId) {
      const me = new ObjectId(userId);
      const rows = await db.blocks.find({ $or: [{ blocker_id: me }, { blocked_id: me }] }).toArray();
      for (const r of rows) {
        if (r.blocker_id.equals(me)) blockedByMe.add(r.blocked_id.toString());
        else blockedMe.add(r.blocker_id.toString());
      }
    }
    return { blockedByMe, blockedMe };
  }

  // id ของคนที่ไม่ควรเห็น: ถูกระงับ หรือบล็อกกันอยู่
  async function hiddenUserIds(userId) {
    const { blockedByMe, blockedMe } = await blockSets(userId);
    return new Set([...banned, ...blockedByMe, ...blockedMe]);
  }

  async function isBlockedBetween(a, b) {
    const [x, y] = [new ObjectId(String(a)), new ObjectId(String(b))];
    return !!(await db.blocks.findOne({ $or: [{ blocker_id: x, blocked_id: y }, { blocker_id: y, blocked_id: x }] }));
  }

  return { banned, loadBanned, isAdminEmail, blockSets, hiddenUserIds, isBlockedBetween };
};
