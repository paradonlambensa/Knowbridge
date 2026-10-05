// ===== กติกาแคตตาล็อกทักษะ — ใช้ร่วมกันระหว่างโปรไฟล์ และการเสนอทักษะใหม่ =====
const CATEGORIES = ['IT', 'Language', 'Art', 'Music', 'Other'];
const MAX_SKILLS_PER_TYPE = 5;

// ตัดช่องว่างซ้ำ/หัวท้าย แล้วตรวจความยาว (นับตัวอักษรแบบ Unicode)
function normalizeSkillName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  const len = [...name].length;
  if (len < 2 || len > 40) return { error: 'ชื่อทักษะต้องยาว 2–40 ตัวอักษร' };
  if (/[<>{}\\]/.test(name)) return { error: 'ชื่อทักษะมีอักขระที่ใช้ไม่ได้' };
  return { name };
}

module.exports = { CATEGORIES, MAX_SKILLS_PER_TYPE, normalizeSkillName };
