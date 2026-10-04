// ===== กติกาบัญชี — ใช้ทั้งตอนสมัคร เปลี่ยนรหัส และรีเซ็ตรหัส =====
// ต้องตรงกับคำแนะนำในหน้าสมัคร (public/index.html) และการเช็กฝั่ง client (public/js/app.js)
const USERNAME_RE = /^[\p{L}\p{M}\p{N}_.-]{3,20}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEAK_PASSWORDS = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'qwertyui', '11111111', '00000000', 'abcdefgh']);

function validatePassword(password) {
  if (password.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
  if (Buffer.byteLength(password) > 72) return 'รหัสผ่านยาวเกินไป';
  if (WEAK_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) return 'รหัสผ่านนี้เดาง่ายเกินไป ลองตั้งใหม่';
  return null;
}

function validateUsername(username) {
  return USERNAME_RE.test(username) ? null : 'ชื่อผู้ใช้ต้องยาว 3–20 ตัว ใช้ได้เฉพาะตัวอักษร ตัวเลข และ _ . -';
}

function validateEmail(email) {
  return email.length <= 254 && EMAIL_RE.test(email) ? null : 'รูปแบบอีเมลไม่ถูกต้อง';
}

function validateAccount({ username, email, password }) {
  return validateUsername(username) || validateEmail(email) || validatePassword(password);
}

module.exports = { validateAccount, validatePassword, validateUsername, validateEmail };
