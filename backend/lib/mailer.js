// ===== ส่งอีเมล (ใช้ Resend — https://resend.com มีแพ็กเกจฟรี) =====
// ตั้ง RESEND_API_KEY และ MAIL_FROM (เช่น "KnowBridge <noreply@yourdomain.com>") ถ้าไม่ตั้ง:
//   - ตอนรันในเครื่อง: พิมพ์อีเมลออก console แทน (ใช้ทดสอบได้)
//   - บนเว็บจริง: ส่งไม่ได้ → ให้แอดมินสร้างลิงก์รีเซ็ตรหัสให้แทน
// ⚠️ ถ้ายังไม่ได้ยืนยันโดเมนกับ Resend จะส่งได้เฉพาะอีเมลเจ้าของบัญชี Resend — ส่งถึงคนอื่น Resend จะปฏิเสธ
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
// เปลี่ยนปลายทางได้เฉพาะตอนเทส (test/e2e.js จำลอง Resend ที่ปฏิเสธการส่ง)
const RESEND_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails';

function canSendEmail() {
  return !!process.env.RESEND_API_KEY;
}

// ฟีเจอร์ที่ต้องส่งอีเมลถึงผู้ใช้ (ยืนยันอีเมล) — เปิดเมื่อส่งได้จริง หรือรันในเครื่อง (พิมพ์ออก console)
function emailFeaturesEnabled() {
  return canSendEmail() || !isProduction;
}

// คืน true เมื่อส่งถึงมือผู้ให้บริการอีเมลแล้ว (หรือพิมพ์ออก console ตอนรันในเครื่อง)
// คืน false เมื่อส่งไม่ได้ — สาเหตุจริงอยู่ใน log ของ server
async function sendMail({ to, subject, text, html }) {
  if (!canSendEmail()) {
    if (isProduction) return false;
    console.log(`\n📧 [อีเมลทดสอบ — ยังไม่ได้ตั้ง RESEND_API_KEY]\nถึง: ${to}\nเรื่อง: ${subject}\n${text}\n`);
    return true;
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'KnowBridge <onboarding@resend.dev>', to: [to], subject, text, html })
    });
    if (!res.ok) {
      console.error(`ส่งอีเมลถึง ${to} ไม่สำเร็จ (Resend ${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error(`ส่งอีเมลถึง ${to} ไม่สำเร็จ (เชื่อม Resend ไม่ได้):`, e.message);
    return false;
  }
}

module.exports = { sendMail, canSendEmail, emailFeaturesEnabled };
