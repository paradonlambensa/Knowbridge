// ===== ส่งอีเมล (ใช้ Resend — https://resend.com มีแพ็กเกจฟรี) =====
// ตั้ง RESEND_API_KEY และ MAIL_FROM (เช่น "KnowBridge <noreply@yourdomain.com>") ถ้าไม่ตั้ง:
//   - ตอนรันในเครื่อง: พิมพ์อีเมลออก console แทน (ใช้ทดสอบได้)
//   - บนเว็บจริง: ส่งไม่ได้ → ให้แอดมินสร้างลิงก์รีเซ็ตรหัสให้แทน
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

function canSendEmail() {
  return !!process.env.RESEND_API_KEY;
}

// ฟีเจอร์ที่ต้องส่งอีเมลถึงผู้ใช้ (ยืนยันอีเมล) — เปิดเมื่อส่งได้จริง หรือรันในเครื่อง (พิมพ์ออก console)
function emailFeaturesEnabled() {
  return canSendEmail() || !isProduction;
}

async function sendMail({ to, subject, text, html }) {
  if (!canSendEmail()) {
    if (!isProduction) console.log(`\n📧 [อีเมลทดสอบ — ยังไม่ได้ตั้ง RESEND_API_KEY]\nถึง: ${to}\nเรื่อง: ${subject}\n${text}\n`);
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'KnowBridge <onboarding@resend.dev>', to: [to], subject, text, html })
  });
  if (!res.ok) {
    console.error('ส่งอีเมลไม่สำเร็จ:', res.status, await res.text());
    return false;
  }
  return true;
}

module.exports = { sendMail, canSendEmail, emailFeaturesEnabled };
