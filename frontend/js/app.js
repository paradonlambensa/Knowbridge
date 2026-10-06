// ป้องกัน XSS: escape ข้อความจากผู้ใช้ก่อนใส่ลง innerHTML
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const CATEGORY_TH = { IT: 'ไอที', Language: 'ภาษา', Art: 'ศิลปะ', Music: 'ดนตรี', Other: 'อื่น ๆ' };
const categoryLabel = (c) => CATEGORY_TH[c] || c;

// การ์ดโปรไฟล์เป็นรูป SVG จากบริการ PHP แยก (card-service/) — ว่าง = ยังไม่ได้ตั้ง CARD_SERVICE_URL
const CARD_URL = (document.querySelector('meta[name="kb-card-url"]')?.content || '').replace(/^__CARD_URL__$/, '');
const cardLink = (userId) => `${CARD_URL}/card.php?user=${encodeURIComponent(userId)}`;

// วงกลมตัวอักษรแรกของชื่อ แทนรูปโปรไฟล์
// สีรูปโปรไฟล์คำนวณจากชื่อ — คนเดิมได้สีเดิมทุกครั้ง แต่ละคนสีต่างกัน
const AVATAR_HUES = [217, 152, 330, 268, 28, 190, 45, 0, 290, 170];
function hueFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

function avatar(name, size = '', attrs = '') {
  const first = [...String(name || '?')][0].toUpperCase();
  return `<div class="avatar ${size}" style="--h:${hueFor(name)}" ${attrs}>${esc(first)}</div>`;
}

// ===== Skeleton ระหว่างโหลด =====
const repeat = (n, html) => Array.from({ length: n }, () => html).join('');
const skeletonCards = (n) => repeat(n, `
  <div class="person-card skeleton" aria-hidden="true">
    <div class="person"><span class="sk circle"></span><div style="flex:1"><span class="sk w60"></span><span class="sk w40"></span></div></div>
    <span class="sk w80"></span><span class="sk w100"></span>
    <div class="card-actions"><span class="sk btn-h"></span><span class="sk btn-h"></span></div>
  </div>`);
const skeletonPosts = (n) => repeat(n, `
  <div class="post skeleton" aria-hidden="true"><span class="sk circle"></span>
    <div class="post-body"><span class="sk w40"></span><span class="sk w100"></span><span class="sk w80"></span></div>
  </div>`);
const skeletonRequests = (n) => repeat(n, `
  <div class="request skeleton" aria-hidden="true"><div class="request-top"><span class="sk circle"></span>
    <div style="flex:1"><span class="sk w40"></span><span class="sk w80"></span></div></div>
  </div>`);

// ===== Dark mode =====
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

// ถ้ายังไม่เคยกดเลือก ใช้ตามการตั้งค่าของเครื่อง
function effectiveTheme() {
  return document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');
}

function renderThemeToggle() {
  const dark = effectiveTheme() === 'dark';
  const btn = document.getElementById('theme-toggle');
  btn.innerHTML = dark ? ICON_SUN : ICON_MOON;
  btn.title = dark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด';
  btn.setAttribute('aria-label', btn.title);
}

function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('kb-theme', next); } catch (e) { /* โหมดส่วนตัว/บล็อก storage: ใช้ได้แค่รอบนี้ */ }
  renderThemeToggle();
}
systemDark.addEventListener('change', renderThemeToggle);

// ===== ตัวเลขจริงบนหน้าแรก =====
async function loadStats() {
  const res = await fetch('/api/stats');
  if (!res.ok) return;
  applyStats(await res.json());
}

// นับจากค่าที่แสดงอยู่ไปค่าใหม่ใน 0.8 วินาที — ค่าเปลี่ยนระหว่างเปิดหน้าอยู่จะกระพริบให้เห็น
function animateNumber(el, to, highlight = false) {
  const from = Number(el.dataset.value || 0);
  el.dataset.value = to;
  if (from === to) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (highlight) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  if (reduceMotion) { el.textContent = to.toLocaleString('th-TH'); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / 800, 1);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))).toLocaleString('th-TH');
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let statsShown = false;
function applyStats(stats) {
  document.getElementById('stats').hidden = false;
  document.querySelectorAll('#stats [data-stat]').forEach(el => animateNumber(el, stats[el.dataset.stat] || 0, statsShown));
  statsShown = true;
  if (typeof stats.online === 'number') setOnlineCount(stats.online);
}

function setOnlineCount(n) {
  document.getElementById('online-pill').hidden = !n;
  if (n) animateNumber(document.getElementById('online-count'), n);
}

function ratingHtml(avg, count) {
  return avg
    ? `<span class="stars">★</span> ${avg} · ${count} รีวิว`
    : 'ยังไม่มีรีวิว';
}

function renderReviews(reviews) {
  if (!reviews.length) return '<p class="muted" style="font-size:0.9rem">ยังไม่มีรีวิว</p>';
  return reviews.map(r => `
    <div class="review">
      <div class="review-head">
        <b>${esc(r.reviewer_name)}</b>
        <span class="rating"><span class="stars">${'★'.repeat(r.rating)}</span>${'☆'.repeat(5 - r.rating)}</span>
      </div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
      <time>${new Date(r.created_at).toLocaleDateString('th-TH')}</time>
    </div>
  `).join('');
}

// ===== Navbar (มือถือ) =====
function toggleNav(force) {
  const open = document.getElementById('navbar').classList.toggle('open', force);
  const btn = document.getElementById('nav-toggle');
  btn.setAttribute('aria-expanded', open);
  btn.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
  btn.firstChild.textContent = open ? '✕' : '☰';
}
// เลือกเมนูแล้ว หรือแตะนอก navbar → หุบเมนู
document.getElementById('nav-links').addEventListener('click', (e) => {
  if (e.target.closest('a, button')) toggleNav(false);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#navbar')) toggleNav(false);
});

// ===== Login / Register =====
const AUTH_FORMS = { login: 'login-email', register: 'reg-username', forgot: 'forgot-email', reset: 'reset-password' };

function showModal(type) {
  document.getElementById('modal-overlay').style.display = 'flex';
  for (const name of Object.keys(AUTH_FORMS)) {
    document.getElementById('modal-' + name).style.display = name === type ? 'block' : 'none';
  }
  setTimeout(() => document.getElementById(AUTH_FORMS[type]).focus(), 50);
}

// ===== ลืมรหัสผ่าน / ตั้งรหัสใหม่ =====
let resetToken = null;

function openForgot() {
  document.getElementById('forgot-email').value = document.getElementById('login-email').value;
  document.getElementById('forgot-msg').textContent = '';
  showModal('forgot');
}

async function requestReset() {
  const email = document.getElementById('forgot-email').value.trim();
  const msg = document.getElementById('forgot-msg');
  if (!email) { msg.className = 'form-msg error-msg'; msg.textContent = 'กรุณาใส่อีเมล'; return; }
  const res = await fetch('/api/password/forgot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
  });
  const data = await res.json();
  if (!data.success) { msg.className = 'form-msg error-msg'; msg.textContent = data.error || 'ส่งไม่สำเร็จ'; return; }
  msg.className = 'form-msg';
  msg.textContent = data.delivery === 'email'
    ? 'ถ้ามีบัญชีที่ใช้อีเมลนี้ เราส่งลิงก์ตั้งรหัสใหม่ไปแล้ว (ใช้ได้ 30 นาที) อย่าลืมดูในโฟลเดอร์สแปมด้วย — ไม่ได้รับภายใน 10 นาที ติดต่อแอดมินได้'
    : 'ระบบส่งอีเมลยังไม่เปิดใช้งาน กรุณาติดต่อแอดมินเพื่อขอลิงก์ตั้งรหัสผ่านใหม่';
}

async function submitReset() {
  const password = document.getElementById('reset-password').value;
  const msg = document.getElementById('reset-msg');
  if (password.length < 8) return (msg.textContent = 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (password !== document.getElementById('reset-password2').value) return (msg.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
  const res = await fetch('/api/password/reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password })
  });
  const data = await res.json();
  if (!data.success) return (msg.textContent = data.error || 'ตั้งรหัสใหม่ไม่สำเร็จ');
  resetToken = null;
  // server ออกจากระบบทุกเครื่องของบัญชีนี้แล้ว — ถ้าหน้านี้ login อยู่ก็ต้องโหลดใหม่
  if (currentUsername) { location.reload(); return; }
  showModal('login');
  showToast('✅ ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสใหม่ได้เลย');
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

async function login() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (data.success) {
    closeModal();
    reconnectSocket();
    showLoggedIn(data.username);
    await loadProfile();
    searchSkills();
  } else {
    document.getElementById('login-error').textContent = data.error;
  }
}

async function register() {
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const error = document.getElementById('reg-error');
  // เช็กเบื้องต้นก่อนส่ง (server เช็กซ้ำอีกรอบ)
  if (!username || !email || !password) return (error.textContent = 'กรุณากรอกข้อมูลให้ครบ');
  if (!/^[\p{L}\p{M}\p{N}_.-]{3,20}$/u.test(username)) return (error.textContent = 'ชื่อผู้ใช้ต้องยาว 3–20 ตัว ใช้ได้เฉพาะตัวอักษร ตัวเลข และ _ . -');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (error.textContent = 'รูปแบบอีเมลไม่ถูกต้อง');
  if (password.length < 8) return (error.textContent = 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (!document.getElementById('reg-accept').checked) return (error.textContent = 'กรุณาอ่านและยอมรับนโยบายความเป็นส่วนตัวก่อนสมัคร');
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, accept_privacy: true })
  });
  const data = await res.json();
  if (data.success) {
    closeModal();
    reconnectSocket();
    showLoggedIn(username);
    await loadProfile();
    searchSkills();
    showProfile();
    if (data.verify_email_sent) showToast(`📧 ส่งลิงก์ยืนยันไปที่ ${esc(email)} แล้ว<small>กดลิงก์ในอีเมลเพื่อยืนยัน (ใช้ได้ 24 ชั่วโมง)</small>`);
    else if (data.verify_email_failed) showToast('สมัครเรียบร้อย แต่ส่งอีเมลยืนยันไม่สำเร็จ<small>ลองกด "ส่งลิงก์ยืนยัน" ในโปรไฟล์อีกครั้งภายหลัง</small>');
  } else {
    document.getElementById('reg-error').textContent = data.error;
  }
}

function showLoggedIn(username) {
  document.getElementById('btn-login-nav').style.display = 'none';
  document.getElementById('btn-logout').style.display = '';
  document.getElementById('nav-dashboard').style.display = '';
  document.getElementById('nav-profile').style.display = '';
  document.getElementById('bell-wrap').hidden = false;
  currentUsername = username;
  updateHero(username);
  loadMatches();
  ensureSocket();
  refreshBadge();
  refreshBell();
  renderComposer();
  // ฟีดที่โหลดไว้ตอนยังไม่ login ไม่รู้ว่าเรากดถูกใจอะไร/โพสต์ไหนเป็นของเรา
  if (feedLoaded) loadFeed(true);
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('pw-msg');
  const current = document.getElementById('pw-current').value;
  const next = document.getElementById('pw-new').value;
  if (!current || !next) return (msg.textContent = 'กรุณากรอกให้ครบ');
  if (next.length < 8) return (msg.textContent = 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (next !== document.getElementById('pw-new2').value) return (msg.textContent = 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
  const res = await fetch('/api/account/password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: current, new_password: next })
  });
  const data = await res.json();
  if (!data.success) return (msg.textContent = data.error || 'เปลี่ยนรหัสไม่สำเร็จ');
  e.target.reset();
  msg.textContent = '';
  document.getElementById('pw-section').open = false;
  showToast('🔒 เปลี่ยนรหัสผ่านแล้ว' + (data.other_sessions_ended ? `<small>ออกจากระบบเครื่องอื่นให้แล้ว ${data.other_sessions_ended} เครื่อง</small>` : ''));
});

// ===== ข้อมูลส่วนบุคคล (PDPA) =====
// ผู้ใช้ที่สมัครก่อนมีนโยบาย หรือนโยบายเปลี่ยนเวอร์ชัน → แถบให้กดรับทราบ
function updatePrivacyBar(profile) {
  const outdated = !!profile?.user && !!profile.privacy_current && profile.user.privacy_version !== profile.privacy_current;
  const bar = document.getElementById('privacy-bar');
  bar.hidden = !outdated;
  if (outdated) {
    bar.querySelector('p').innerHTML = profile.user.privacy_version
      ? `เราปรับปรุง<a href="#privacy">นโยบายความเป็นส่วนตัว</a> — ${esc(document.getElementById('privacy-change').textContent)}`
      : 'เราเพิ่ม<a href="#privacy">นโยบายความเป็นส่วนตัว</a> อธิบายว่าเก็บข้อมูลอะไร ใช้ทำอะไร และคุณดาวน์โหลดหรือลบข้อมูลของตัวเองได้อย่างไร';
  }
}

async function ackPrivacy() {
  document.getElementById('privacy-bar').hidden = true;
  await fetch('/api/account/privacy', { method: 'POST' });
}

// ลิงก์ "ข้อมูลของฉัน" ในหน้านโยบาย → เปิดโปรไฟล์ แล้วเลื่อนไปส่วนข้อมูล
async function openMyData() {
  if (!currentUserId) return showModal('login');
  await showProfile();
  document.getElementById('my-data').scrollIntoView({ block: 'start' });
}

document.getElementById('delete-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('delete-msg');
  const password = document.getElementById('delete-password').value;
  if (!password) return (msg.textContent = 'กรุณาใส่รหัสผ่านเพื่อยืนยัน');
  if (!document.getElementById('delete-confirm').checked) return (msg.textContent = 'กรุณาติ๊กยืนยันว่าเข้าใจว่าลบแล้วกู้คืนไม่ได้');
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  const res = await fetch('/api/account/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password })
  });
  const data = await res.json().catch(() => ({}));
  btn.disabled = false;
  if (!data.success) return (msg.textContent = data.error || 'ลบบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง');
  // โหลดหน้าใหม่ให้สถานะทุกอย่างกลับเป็นยังไม่ login แล้วค่อยบอกผล
  try { sessionStorage.setItem('kb-deleted', '1'); } catch (err) {}
  location.href = '/';
});

function showDeletedNotice() {
  let deleted = false;
  let notice = null;
  try {
    deleted = sessionStorage.getItem('kb-deleted') === '1';
    notice = sessionStorage.getItem('kb-notice');
    sessionStorage.removeItem('kb-deleted');
    sessionStorage.removeItem('kb-notice');
  } catch (e) {}
  if (deleted) showToast('ลบบัญชีและข้อมูลของคุณเรียบร้อยแล้ว<small>ขอบคุณที่ใช้ KnowBridge</small>');
  // ข้อความที่เราเขียนเอง แต่มีอีเมลที่ผู้ใช้พิมพ์ปนอยู่ — escape ก่อนแสดง ยกเว้นแท็ก <small>
  if (notice) showToast(esc(notice).replace(/&lt;(\/?)small&gt;/g, '<$1small>'));
}

// ===== ยืนยันอีเมล / เปลี่ยนชื่อผู้ใช้และอีเมล =====
function renderEmailStatus(profile) {
  const el = document.getElementById('email-status');
  if (profile.user.email_verified) {
    el.innerHTML = '<span class="verified-badge">✓ ยืนยันแล้ว</span>';
  } else if (profile.email_verification_enabled) {
    el.innerHTML = '<span class="unverified-badge">ยังไม่ยืนยัน</span> <button type="button" class="btn btn-ghost btn-sm" onclick="resendVerification(this)">ส่งลิงก์ยืนยัน</button>';
  } else {
    el.innerHTML = '';
  }
  document.getElementById('identity-email-hint').hidden = !profile.email_verification_enabled;
}

async function resendVerification(btn) {
  btn.disabled = true;
  const res = await fetch('/api/account/verify-email/send', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (data.already) { showToast('อีเมลนี้ยืนยันแล้ว'); return loadProfile(); }
  if (!data.success) { btn.disabled = false; return showToast(esc(data.error || 'ส่งลิงก์ไม่สำเร็จ')); }
  btn.textContent = 'ส่งแล้ว';
  showToast('📧 ส่งลิงก์ยืนยันแล้ว<small>เช็กกล่องจดหมาย (และโฟลเดอร์สแปม) ลิงก์ใช้ได้ 24 ชั่วโมง</small>');
}

async function verifyEmailToken(token) {
  const res = await fetch('/api/account/verify-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
  });
  const data = await res.json().catch(() => ({}));
  showToast(data.success ? `✅ ยืนยันอีเมล ${esc(data.email)} แล้ว` : esc(data.error || 'ยืนยันอีเมลไม่สำเร็จ'));
  if (data.success && currentUserId) loadProfile();
}

document.getElementById('identity-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('identity-msg');
  const username = document.getElementById('identity-username').value.trim();
  const email = document.getElementById('identity-email').value.trim();
  const password = document.getElementById('identity-password').value;
  if (!username || !email) return (msg.textContent = 'กรุณากรอกชื่อผู้ใช้และอีเมล');
  if (!password) return (msg.textContent = 'กรุณาใส่รหัสผ่านปัจจุบันเพื่อยืนยัน');
  const res = await fetch('/api/account/identity', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) return (msg.textContent = data.error || 'บันทึกไม่สำเร็จ');
  // ชื่อเดิมยังค้างอยู่ทั้งหน้า (navbar, แชท, socket) — โหลดหน้าใหม่ให้ทุกอย่างใช้ชื่อใหม่
  try {
    sessionStorage.setItem('kb-notice', data.verify_email_sent
      ? `บันทึกแล้ว<small>ส่งลิงก์ยืนยันไปที่ ${data.email} แล้ว</small>`
      : data.verify_email_failed
        ? 'บันทึกแล้ว แต่ส่งอีเมลยืนยันไม่สำเร็จ<small>ลองกด "ส่งลิงก์ยืนยัน" ในโปรไฟล์อีกครั้งภายหลัง</small>'
        : 'บันทึกชื่อผู้ใช้/อีเมลใหม่แล้ว');
  } catch (err) {}
  location.reload();
});

document.getElementById('presence-toggle').addEventListener('change', async (e) => {
  const visible = e.target.checked;
  const res = await fetch('/api/account/presence', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible })
  });
  if (!res.ok) { e.target.checked = !visible; return showToast('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  showToast(visible ? 'คู่แลกเปลี่ยนจะเห็นว่าคุณออนไลน์อยู่' : 'ซ่อนสถานะออนไลน์แล้ว<small>คู่แลกเปลี่ยนจะไม่เห็นว่าคุณออนไลน์หรือใช้งานล่าสุดเมื่อไร</small>');
});

// ===== เสนอทักษะใหม่ =====
async function loadMySuggestions() {
  const res = await fetch('/api/skills/suggestions/mine');
  const list = res.ok ? await res.json() : [];
  document.getElementById('my-suggestions').innerHTML = list.length
    ? `<span class="muted">รอแอดมินตรวจ:</span> ${list.map(r => `
        <span class="skill-pill pending-pill ${r.type}">⏳ ${esc(r.name)} <small>${r.type === 'teach' ? 'สอนได้' : 'อยากเรียน'}</small></span>`).join('')}`
    : '';
}

document.getElementById('suggest-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('suggest-msg');
  const name = document.getElementById('suggest-name').value.trim();
  const category = document.getElementById('suggest-category').value;
  const type = e.target.querySelector('input[name="suggest-type"]:checked').value;
  if ([...name].length < 2) return (msg.textContent = 'กรุณาพิมพ์ชื่อทักษะ (อย่างน้อย 2 ตัวอักษร)');
  if (!category) return (msg.textContent = 'กรุณาเลือกหมวด');
  const res = await fetch('/api/skills/suggest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, category, type })
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) return (msg.textContent = data.error || 'ส่งไม่สำเร็จ');
  msg.textContent = '';
  e.target.reset();
  document.getElementById('suggest-section').open = false;
  showToast(`🧩 ส่ง "${esc(data.request.name)}" ให้แอดมินตรวจแล้ว` +
    (data.joined ? '<small>มีคนเสนอทักษะนี้ไว้แล้ว นับเป็นอีกเสียงให้</small>' : '<small>อนุมัติแล้วจะเพิ่มเข้าโปรไฟล์ให้เลย</small>'));
  loadMySuggestions();
});

let privacyInfoLoaded = false;
async function loadPrivacyInfo() {
  if (privacyInfoLoaded) return;
  privacyInfoLoaded = true;
  const info = await fetch('/api/privacy').then(r => r.json()).catch(() => null);
  if (!info) return;
  const updated = new Date(info.version + 'T00:00:00');
  if (!isNaN(updated)) document.getElementById('privacy-updated').textContent = updated.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  if (info.contact_email) {
    const a = document.createElement('a');
    a.href = 'mailto:' + info.contact_email;
    a.textContent = info.contact_email;
    document.getElementById('privacy-contact').replaceChildren(a);
  }
}

// ===== กระดิ่งแจ้งเตือน (เก็บย้อนหลัง 30 วัน) =====
let bellItems = [];

async function refreshBell() {
  const res = await fetch('/api/notifications/list');
  if (!res.ok) return;
  const data = await res.json();
  bellItems = data.items;
  document.getElementById('bell-badge').textContent = data.unread ? (data.unread > 99 ? '99+' : data.unread) : '';
  renderBell();
}

function renderBell() {
  document.getElementById('bell-list').innerHTML = bellItems.length
    ? bellItems.map((n, i) => `
        <button class="bell-item ${n.read ? '' : 'unread'}" data-i="${i}">
          ${avatar(n.from)}
          <span style="flex:1;min-width:0">
            <span class="bell-text">${notificationHtml(n)}</span>
            <span class="bell-time">${timeAgo(n.created_at)}</span>
          </span>
        </button>`).join('')
    : '<div class="bell-empty">ยังไม่มีการแจ้งเตือน</div>';
}

function toggleBell(force) {
  const panel = document.getElementById('bell-panel');
  panel.hidden = force === undefined ? !panel.hidden : !force;
  document.getElementById('bell-btn').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) refreshBell();
}
document.addEventListener('click', (e) => { if (!e.target.closest('.bell-wrap')) toggleBell(false); });

async function readAllNotifications() {
  await fetch('/api/notifications/read-all', { method: 'POST' });
  refreshBell();
}

document.getElementById('bell-list').addEventListener('click', async (e) => {
  const item = e.target.closest('[data-i]');
  if (!item) return;
  const n = bellItems[item.dataset.i];
  toggleBell(false);
  if (!n.read) fetch(`/api/notifications/${n._id}/read`, { method: 'POST' }).then(refreshBell);
  openNotification(n);
});

// ===== Notifications =====
const fmtDateTime = (d) => new Date(d).toLocaleString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const NOTIFY_TEXT = {
  request:  (n) => `📬 <b>${esc(n.from)}</b> ส่งคำขอแลกเปลี่ยนมา`,
  accepted: (n) => `✅ <b>${esc(n.from)}</b> ยอมรับคำขอของคุณแล้ว เริ่มแชทได้เลย`,
  rejected: (n) => `<b>${esc(n.from)}</b> ปฏิเสธคำขอของคุณ`,
  message:  (n) => `💬 <b>${esc(n.from)}</b><small>${esc(n.preview)}</small>`,
  like:     (n) => `❤️ <b>${esc(n.from)}</b>${n.count > 1 ? ` และอีก ${n.count - 1} คน` : ''} ถูกใจโพสต์ของคุณ`,
  comment:  (n) => `💬 <b>${esc(n.from)}</b> แสดงความคิดเห็นในโพสต์ของคุณ<small>${esc(n.preview)}</small>`,
  schedule: (n) => n.schedule_at
    ? `📅 <b>${esc(n.from)}</b> นัดเรียน ${esc(fmtDateTime(n.schedule_at))}${n.preview ? `<small>${esc(n.preview)}</small>` : ''}`
    : `📅 <b>${esc(n.from)}</b> ยกเลิกนัดเรียน`,
  complete_request: (n) => `🎓 <b>${esc(n.from)}</b> ยืนยันว่าแลกเปลี่ยนเสร็จแล้ว<small>กดยืนยันด้วย แล้วให้คะแนนกันได้</small>`,
  completed: (n) => `🎉 การแลกเปลี่ยนกับ <b>${esc(n.from)}</b> เสร็จสมบูรณ์<small>ให้คะแนนกันได้เลย</small>`,
  skill_approved: (n) => `🧩 ทักษะ <b>${esc(n.skill_name)}</b> ที่คุณเสนอได้รับอนุมัติแล้ว` +
    `<small>${n.added ? 'เพิ่มเข้าโปรไฟล์ให้แล้ว' : 'เลือกเพิ่มในโปรไฟล์ได้เลย'}</small>`,
  skill_rejected: (n) => `ทักษะ <b>${esc(n.skill_name)}</b> ที่คุณเสนอไม่ได้รับอนุมัติ<small>อาจซ้ำกับทักษะที่มีอยู่ หรือกว้าง/แคบเกินไป</small>`
};

const notificationHtml = (n) => (NOTIFY_TEXT[n.type] || (() => esc(n.type)))(n);

// กดแจ้งเตือน (toast หรือในกระดิ่ง) → ไปยังสิ่งที่เกี่ยวข้อง
async function openNotification(n) {
  if (n.type === 'message') { await showDashboard(); openChat(n.request_id); }
  else if (n.type === 'like' || n.type === 'comment') goToPost(n.post_id);
  else if (n.type === 'skill_approved' || n.type === 'skill_rejected') showProfile();
  else showDashboard();
}

function showToast(html, onClick) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  const dismiss = () => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); };
  el.onclick = () => { dismiss(); onClick?.(); };
  document.getElementById('toast-container').appendChild(el);
  setTimeout(dismiss, 6000);
}

async function refreshBadge() {
  const res = await fetch('/api/notifications');
  if (!res.ok) return;
  const { pending_requests, unread_messages } = await res.json();
  const total = pending_requests + unread_messages;
  const label = total > 0 ? (total > 99 ? '99+' : total) : '';
  // บนมือถือเมนูซ่อนอยู่หลัง ☰ จึงต้องโชว์ตัวเลขที่ปุ่ม ☰ ด้วย
  document.getElementById('nav-badge').textContent = label;
  document.getElementById('nav-toggle-badge').textContent = label;
  document.title = (total > 0 ? `(${total}) ` : '') + 'KnowBridge — เชื่อมความรู้ เชื่อมคน';
}

function isChatOpen(requestId) {
  return currentRequestId === requestId && document.getElementById('modal-chat').style.display !== 'none';
}

function markChatRead(requestId) {
  return fetch(`/api/chat/${requestId}/read`, { method: 'POST' });
}

async function handleNotify(n) {
  // ทักษะที่เสนอผ่านแล้ว → โปรไฟล์ที่เปิดอยู่ต้องเห็นทักษะใหม่ในรายการ
  if ((n.type === 'skill_approved' || n.type === 'skill_rejected') && document.getElementById('modal-profile').style.display !== 'none') {
    loadSkillOptions();
    loadMySuggestions();
  }
  if (n.type === 'message' && isChatOpen(n.request_id)) {
    // กำลังเปิดแชทนี้อยู่ ข้อความขึ้นในหน้าต่างแล้ว แค่บันทึกว่าอ่านแล้ว
    await markChatRead(n.request_id);
  } else {
    const onClick = () => {
      if (n._id) fetch(`/api/notifications/${n._id}/read`, { method: 'POST' }).then(refreshBell);
      openNotification(n);
    };
    showToast(notificationHtml(n), onClick);
    if (document.getElementById('modal-dashboard').style.display !== 'none') showDashboard();
  }
  refreshBadge();
  if (n.type !== 'message') refreshBell();
}

function ensureSocket() {
  if (socket) return socket;
  socket = io();
  socket.on('newMessage', (msg) => {
    if (msg.request_id !== currentRequestId) return;
    if (msg.sender_id !== currentUserId) hideTyping();
    appendMessage(msg);
  });
  socket.on('notify', handleNotify);
  socket.on('feed:new', onFeedNew);
  socket.on('feed:counts', onFeedCounts);
  socket.on('feed:delete', onFeedDelete);
  socket.on('stats', applyStats);
  socket.on('presence:count', ({ online }) => setOnlineCount(online));
  socket.on('presence', updatePresence);
  socket.on('typing', onTyping);
  socket.on('chat:read', onChatRead);
  socket.on('chatError', (message) => showToast(esc(message)));
  // หลุดแล้วต่อใหม่ (เช่น server restart) ต้อง join ห้องแชทที่เปิดค้างไว้อีกครั้ง
  socket.on('connect', () => {
    if (currentRequestId) socket.emit('joinRoom', currentRequestId);
    document.getElementById('feed-live').hidden = false;
  });
  socket.on('disconnect', () => { document.getElementById('feed-live').hidden = true; });
  return socket;
}

// ต่อ socket ครั้งแรกก่อน login → ต่อใหม่หลัง login ให้ server รู้ว่าเราเป็นใคร (คุกกี้ session ใหม่)
function reconnectSocket() {
  if (!socket) return ensureSocket();
  socket.disconnect();
  socket.connect();
}

// ===== สถานะออนไลน์ของคู่แลกเปลี่ยน =====
const presenceOf = {}; // userId → { online, last_seen, hidden }

function presenceText(p) {
  if (!p || p.hidden) return '';
  if (p.online) return '<span class="online-text">● ออนไลน์อยู่</span>';
  if (!p.last_seen) return '';
  const s = (Date.now() - new Date(p.last_seen)) / 1000;
  return s < 60 ? 'ใช้งานล่าสุดเมื่อสักครู่' : s < 7 * 86400 ? `ใช้งานล่าสุด ${esc(timeAgo(p.last_seen))}ที่แล้ว` : '';
}

// วงกลมโปรไฟล์ + จุดเขียวเมื่อออนไลน์ (อัปเดตเองเมื่อสถานะเปลี่ยน)
function avatarWithPresence(name, userId) {
  const on = presenceOf[userId]?.online ? ' on' : '';
  return `<span class="presence-wrap">${avatar(name)}<i class="presence-dot${on}" data-presence="${esc(userId)}" aria-hidden="true"></i></span>`;
}

function updatePresence(p) {
  presenceOf[p.user_id] = p;
  document.querySelectorAll(`[data-presence="${CSS.escape(p.user_id)}"]`).forEach(el => el.classList.toggle('on', !!p.online));
  const req = currentRequestId && dashboardRequests[currentRequestId];
  if (req && String(req.other_user_id) === p.user_id) renderChatPresence();
}

function renderChatPresence() {
  const el = document.getElementById('chat-presence');
  const req = dashboardRequests[currentRequestId];
  if (!el || !req) return;
  el.innerHTML = presenceText(presenceOf[req.other_user_id]);
  el.hidden = !el.innerHTML;
}

// ===== กำลังพิมพ์… =====
let typingTimer = null;
let lastTypingSent = 0;

function onTyping({ request_id, user_id, name }) {
  if (request_id !== currentRequestId || user_id === currentUserId) return;
  document.getElementById('chat-typing-name').textContent = name;
  document.getElementById('chat-typing').hidden = false;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(hideTyping, 3500);
}

function hideTyping() {
  clearTimeout(typingTimer);
  document.getElementById('chat-typing').hidden = true;
}

document.getElementById('chat-input').addEventListener('input', (e) => {
  if (!currentRequestId || !socket || !e.target.value.trim()) return;
  if (Date.now() - lastTypingSent < 1500) return;
  lastTypingSent = Date.now();
  socket.emit('typing', currentRequestId);
});

// ===== อ่านแล้ว: ขึ้นใต้ข้อความล่าสุดของเราที่อีกฝ่ายอ่านแล้ว =====
let partnerLastRead = null;

function onChatRead({ request_id, user_id, at }) {
  if (request_id !== currentRequestId || user_id === currentUserId) return;
  partnerLastRead = new Date(at);
  renderReadReceipt();
}

function renderReadReceipt() {
  const container = document.getElementById('chat-messages');
  container.querySelectorAll('.read-receipt').forEach(el => el.remove());
  if (!partnerLastRead) return;
  const read = [...container.querySelectorAll('.msg.mine')].filter(m => new Date(m.dataset.at) <= partnerLastRead);
  read.at(-1)?.insertAdjacentHTML('beforeend', '<span class="read-receipt">อ่านแล้ว</span>');
}

// ===== Profile =====
let skillCatalog = [];
let profileSkills = { teach: [], learn: [] };
const MAX_SKILLS = 5;

async function loadSkillOptions() {
  const [skillsRes, profileRes] = await Promise.all([fetch('/api/skills'), fetch('/api/profile')]);
  skillCatalog = await skillsRes.json();
  const userSkills = profileRes.ok ? (await profileRes.json()).skills || [] : [];
  profileSkills = {
    teach: userSkills.filter(s => s.type === 'teach').map(s => s.skill_id),
    learn: userSkills.filter(s => s.type === 'learn').map(s => s.skill_id)
  };
  renderPickers();
}

// ทักษะที่เลือกแล้วเป็นป้ายกด ✕ ลบได้ + dropdown เพิ่ม (ไม่แสดงทักษะที่เลือกไปแล้วทั้งสองฝั่ง)
function renderPicker(type) {
  const chosen = profileSkills[type];
  const taken = new Set([...profileSkills.teach, ...profileSkills.learn]);
  const pills = chosen.map(id => {
    const s = skillCatalog.find(x => x._id === id);
    return s ? `
      <span class="skill-pill ${type}"><span class="dot cat-${esc(s.category)}"></span>${esc(s.name)}
        <button type="button" class="pill-x" data-remove="${esc(id)}" aria-label="ลบ ${esc(s.name)}">✕</button>
      </span>` : '';
  }).join('');
  let adder;
  if (chosen.length >= MAX_SKILLS) {
    adder = `<span class="picker-full">ครบ ${MAX_SKILLS} ทักษะแล้ว</span>`;
  } else {
    const byCategory = {};
    skillCatalog.filter(s => !taken.has(s._id)).forEach(s => (byCategory[s.category] ||= []).push(s));
    adder = `
      <select class="input" aria-label="${type === 'teach' ? 'เพิ่มทักษะที่สอนได้' : 'เพิ่มทักษะที่อยากเรียน'}">
        <option value="">+ เพิ่มทักษะ</option>
        ${Object.entries(byCategory).map(([cat, list]) => `
          <optgroup label="${esc(categoryLabel(cat))}">
            ${list.map(s => `<option value="${s._id}">${esc(s.name)}</option>`).join('')}
          </optgroup>`).join('')}
      </select>`;
  }
  document.getElementById('picker-' + type).innerHTML = pills + adder;
}

function renderPickers() {
  renderPicker('teach');
  renderPicker('learn');
}

for (const type of ['teach', 'learn']) {
  const el = document.getElementById('picker-' + type);
  el.addEventListener('change', (e) => {
    if (e.target.tagName !== 'SELECT' || !e.target.value) return;
    profileSkills[type].push(e.target.value);
    renderPickers(); // อีกฝั่งต้องตัดทักษะนี้ออกจากตัวเลือกด้วย
  });
  el.addEventListener('click', (e) => {
    const x = e.target.closest('[data-remove]');
    if (!x) return;
    profileSkills[type] = profileSkills[type].filter(id => id !== x.dataset.remove);
    renderPickers();
  });
}

async function loadProfile() {
  const res = await fetch('/api/profile');
  if (res.status === 401) return;
  const data = await res.json();
  if (data.user) {
    currentUserId = data.user._id;
    setAdmin(data.is_admin);
    document.getElementById('profile-username').textContent = data.user.username;
    document.getElementById('profile-email').textContent = data.user.email;
    document.getElementById('profile-bio').value = data.user.bio || '';
    updatePrivacyBar(data);
    renderEmailStatus(data);
    document.getElementById('presence-toggle').checked = !data.user.hide_presence;
    document.getElementById('my-card').hidden = !CARD_URL;
    if (CARD_URL) document.getElementById('my-card-link').href = cardLink(data.user._id);
    document.getElementById('identity-username').value = data.user.username;
    document.getElementById('identity-email').value = data.user.email;
    // รอให้รีวิว/รายการบล็อกโหลดเสร็จ ความสูงของโปรไฟล์จะได้นิ่ง (openMyData เลื่อนลงไปส่วนล่างต่อ)
    await Promise.all([loadMyReviews(data.user._id), loadBlockedList(), loadMySuggestions()]);
  }
}

async function loadMyReviews(userId) {
  const res = await fetch(`/api/user/${userId}/profile`);
  if (!res.ok) return;
  const data = await res.json();
  document.getElementById('profile-rating-summary').innerHTML = ratingHtml(data.rating.avg, data.rating.count);
  document.getElementById('profile-reviews').innerHTML = renderReviews(data.reviews);
}

async function showProfile() {
  document.getElementById('profile-msg').textContent = '';
  document.getElementById('modal-profile').style.display = 'flex';
  await loadSkillOptions();
  await loadProfile();
}

function closeProfile() {
  document.getElementById('modal-profile').style.display = 'none';
}

async function saveProfile() {
  const bio = document.getElementById('profile-bio').value;
  const res = await fetch('/api/profile/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bio, teach_skills: profileSkills.teach, learn_skills: profileSkills.learn })
  });
  const data = await res.json();
  if (data.success) {
    closeProfile();
    showToast('✅ บันทึกโปรไฟล์แล้ว');
    updateHero(document.getElementById('profile-username').textContent);
    searchSkills();
    loadMatches();
  } else {
    const msg = document.getElementById('profile-msg');
    msg.textContent = data.error || 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง';
    msg.className = 'form-msg error-msg';
  }
}

// ===== Public Profile =====
async function showUserProfile(userId) {
  const body = document.getElementById('user-profile-body');
  body.innerHTML = '<p class="muted">กำลังโหลด...</p>';
  document.getElementById('modal-user').style.display = 'flex';
  const res = await fetch(`/api/user/${userId}/profile`);
  if (!res.ok) {
    body.innerHTML = '<p class="error-msg">ไม่พบผู้ใช้</p>';
    return;
  }
  const { user, skills, rating, reviews } = await res.json();
  viewingUser = { id: user._id, username: user.username, blocked: user.blocked_by_me, banned: user.banned };
  const skillTag = (s) => `
    <span class="skill-pill ${s.type}">${s.type === 'teach' ? 'สอน' : 'อยากเรียน'} · <b>${esc(s.skill_name)}</b></span>`;
  const isMe = user._id === currentUserId;
  const mainAction = isMe ? ''
    : user.blocked_by_me
      ? '<div class="blocked-note"><span>คุณบล็อกผู้ใช้นี้อยู่</span><button class="btn btn-ghost btn-sm" onclick="blockViewingUser()">เลิกบล็อก</button></div>'
      : `<button class="btn btn-primary btn-block" onclick="sendRequest('${esc(user._id)}')">ขอแลกเปลี่ยน</button>`;
  const footer = isMe || !currentUsername ? '' : `
    <div class="profile-actions">
      ${user.blocked_by_me ? '' : '<button class="btn btn-ghost btn-sm" onclick="blockViewingUser()">บล็อก</button>'}
      <button class="btn btn-ghost btn-sm" onclick="openReport('user', viewingUser.id)">รายงานผู้ใช้</button>
      ${currentIsAdmin ? `<button class="btn btn-ghost btn-sm" onclick="adminResetLink(viewingUser.id)">ลิงก์ตั้งรหัสใหม่</button>` : ''}
      ${currentIsAdmin ? `<button class="btn btn-danger btn-sm" onclick="adminBan(viewingUser.id, ${!user.banned})">${user.banned ? 'ปลดระงับบัญชี' : 'ระงับบัญชี'}</button>` : ''}
    </div>`;
  body.innerHTML = `
    <div class="profile-head">
      ${avatar(user.username, 'lg')}
      <div>
        <h2>${esc(user.username)} ${user.email_verified ? '<span class="verified-badge" title="ยืนยันอีเมลแล้ว">✓ ยืนยันอีเมล</span>' : ''} ${user.banned ? '<span class="banned-badge">ถูกระงับ</span>' : ''}</h2>
        <p class="rating">${ratingHtml(rating.avg, rating.count)}</p>
      </div>
    </div>
    <p class="profile-bio">${esc(user.bio || 'ยังไม่ได้เขียนแนะนำตัว')}</p>
    <div class="skill-list">${skills.map(skillTag).join('') || '<span class="muted">ยังไม่ได้ระบุทักษะ</span>'}</div>
    ${CARD_URL ? `<p class="card-row">🪪 <a href="${esc(cardLink(user._id))}" target="_blank" rel="noopener">ดูการ์ดโปรไฟล์ (รูปภาพ)</a></p>` : ''}
    ${mainAction}
    <div id="user-recent-posts"></div>
    <hr class="divider" />
    <h3 class="subheading">รีวิว (${reviews.length})</h3>
    ${renderReviews(reviews)}
    ${footer}
  `;

  const { posts } = await (await fetch(`/api/posts?author=${encodeURIComponent(userId)}&limit=3`)).json();
  const box = document.getElementById('user-recent-posts');
  if (box && posts.length) {
    box.innerHTML = `
      <hr class="divider" />
      <h3 class="subheading">โพสต์ล่าสุด</h3>
      ${posts.map(p => `
        <div class="mini-post">
          <div class="post-text">${formatPostText(p.text)}</div>
          <div class="post-meta">${timeAgo(p.created_at)} · ♥ ${p.like_count} · ความคิดเห็น ${p.comment_count}
            <a href="#community" class="btn btn-ghost" onclick="closeUserProfile(); goToPost('${esc(p._id)}'); return false;">ดูโพสต์</a>
          </div>
        </div>`).join('')}
    `;
  }
}

function closeUserProfile() {
  document.getElementById('modal-user').style.display = 'none';
}

// ===== Search =====
let searchTimer = null;

function currentCategory() {
  return document.querySelector('#category-chips .chip.active')?.dataset.cat || '';
}

async function searchSkills(scrollToResults = false, showSkeleton = false) {
  const resultsEl = document.getElementById('search-results');
  // ตอนพิมพ์ค้นหาไม่ล้างผลเดิม (กันกระพริบ) — โชว์โครงการ์ดเฉพาะตอนยังว่างหรือเปลี่ยนหมวด
  if (showSkeleton || !resultsEl.children.length) resultsEl.innerHTML = skeletonCards(3);
  const skill = document.getElementById('search-input').value.trim();
  const category = currentCategory();
  const params = new URLSearchParams();
  if (skill) params.append('skill', skill);
  if (category) params.append('category', category);
  const res = await fetch(`/api/search?${params}`);
  const results = await res.json();
  const container = document.getElementById('search-results');
  document.getElementById('result-count').textContent = results.length ? `${results.length} คน` : '';

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <b>ไม่พบผู้สอนที่ตรงกัน</b>
        ลองค้นหาด้วยคำอื่น หรือเลือกหมวด "ทั้งหมด"
      </div>`;
  } else {
    container.innerHTML = results.map(user => `
      <article class="person-card">
        <div class="person" onclick="showUserProfile('${esc(user.id)}')" title="ดูโปรไฟล์และรีวิว">
          ${avatar(user.username)}
          <div>
            <h3>${esc(user.username)}</h3>
            <p class="rating">${ratingHtml(user.avg_rating, user.review_count)}</p>
          </div>
        </div>
        <p class="teaches">สอน ${(user.skills || [{ name: user.skill_name, category: user.category }])
          .map(s => `<span class="tag cat-${esc(s.category)}" title="${esc(categoryLabel(s.category))}">${esc(s.name)}</span>`).join('')}</p>
        ${user.bio ? `<p class="bio">${esc(user.bio)}</p>` : ''}
        <div class="card-actions">
          <button class="btn btn-outline btn-sm" onclick="showUserProfile('${esc(user.id)}')">ดูโปรไฟล์</button>
          <button class="btn btn-primary btn-sm" onclick="sendRequest('${esc(user.id)}')">ขอแลกเปลี่ยน</button>
        </div>
      </article>
    `).join('');
  }
  if (scrollToResults) document.getElementById('search').scrollIntoView({ behavior: 'smooth' });
}

// ค้นหาทันทีที่พิมพ์ (หน่วงเล็กน้อยไม่ให้ยิง API ทุกตัวอักษร)
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchSkills(), 300);
});

document.getElementById('category-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#category-chips .chip').forEach(c => c.classList.toggle('active', c === chip));
  searchSkills(false, true);
});

async function sendRequest(receiverId, message = 'สวัสดี อยากแลกเปลี่ยนทักษะกันครับ/ค่ะ') {
  const res = await fetch('/api/exchange/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiver_id: receiverId, message })
  });
  if (res.status === 401) {
    closeUserProfile();
    showModal('login');
    return;
  }
  const data = await res.json();
  if (data.success) {
    showToast('📬 ส่งคำขอแล้ว — ดูสถานะได้ที่ <b>คำขอของฉัน</b>', showDashboard);
    loadMatches();
  }
  else showToast(esc(data.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'));
}

async function checkSession() {
  const res = await fetch('/api/profile');
  if (res.ok) {
    const data = await res.json();
    if (data.user) {
      currentUserId = data.user._id;
      setAdmin(data.is_admin);
      showLoggedIn(data.user.username);
      document.getElementById('profile-username').textContent = data.user.username;
      document.getElementById('profile-email').textContent = data.user.email;
      document.getElementById('profile-bio').value = data.user.bio || '';
      updatePrivacyBar(data);
    }
  }
}

// ===== Dashboard (คำขอของฉัน) =====
let dashboardRequests = {};
let dashboardTab = 'received';

const STATUS_LABEL = {
  pending:  (isReceived) => isReceived ? 'รอคุณตอบ' : 'รอตอบรับ',
  accepted: () => 'กำลังแลกเปลี่ยน',
  completed: () => 'เสร็จสิ้น',
  rejected: (isReceived) => isReceived ? 'ปฏิเสธแล้ว' : 'ถูกปฏิเสธ'
};

function scheduleLine(r) {
  if (!r.schedule?.at) return '';
  const past = new Date(r.schedule.at) < Date.now();
  return `<p class="schedule-line ${past ? 'past' : ''}">📅 ${past ? 'นัดเมื่อ' : 'นัดครั้งถัดไป'} ${esc(fmtDateTime(r.schedule.at))}${r.schedule.note ? ` · ${formatPostText(r.schedule.note)}` : ''}</p>`;
}

function renderRequestCard(r, isReceived) {
  const id = esc(r._id);
  const del = `<button class="btn btn-danger btn-sm" onclick="deleteRequest('${id}')">ลบ</button>`;
  let actions;
  if (r.status === 'pending') {
    actions = isReceived ? `
      <button class="btn btn-primary btn-sm" onclick="respondRequest('${id}','accepted')">ยอมรับ</button>
      <button class="btn btn-outline btn-sm" onclick="respondRequest('${id}','rejected')">ปฏิเสธ</button>
    ` : `<span class="spacer"></span>${del}`;
  } else if (r.status === 'accepted' || r.status === 'completed') {
    const chat = `<button class="btn btn-primary btn-sm" onclick="openChat('${id}')">แชท${r.unread ? `<span class="nav-badge">${r.unread}</span>` : ''}</button>`;
    const schedule = `<button class="btn btn-ghost btn-sm" onclick="openSchedule('${id}')">${r.schedule ? 'แก้นัด' : 'นัดเวลา'}</button>`;
    // ให้คะแนนได้หลังทั้งสองฝ่ายยืนยันว่าแลกเปลี่ยนเสร็จแล้ว
    const step = r.status === 'completed'
      ? (r.reviewed ? '<span class="done-note">★ ให้คะแนนแล้ว</span>' : `<button class="btn btn-outline btn-sm" onclick="openRating('${id}')">ให้คะแนน</button>`)
      : r.completed_by_me
        ? '<span class="done-note">รออีกฝ่ายยืนยันว่าเสร็จ</span>'
        : `<button class="btn btn-outline btn-sm" onclick="completeExchange('${id}')">${r.completed_by_other ? 'ยืนยันว่าเสร็จแล้ว' : 'แลกเปลี่ยนเสร็จแล้ว'}</button>`;
    actions = `${chat}${schedule}${step}<span class="spacer"></span>${del}`;
  } else {
    actions = `<span class="spacer"></span>${del}`;
  }
  return `
    <div class="request">
      <div class="request-top">
        <div class="person" onclick="showUserProfile('${esc(r.other_user_id)}')">
          ${r.other_presence ? avatarWithPresence(r.other_username, r.other_user_id) : avatar(r.other_username)}
          <div style="min-width:0">
            <h3>${esc(r.other_username)}</h3>
            <p class="request-msg">${esc(r.message || 'ไม่มีข้อความ')}</p>
          </div>
        </div>
        <span class="status ${r.status}">${STATUS_LABEL[r.status]?.(isReceived) || esc(r.status)}</span>
      </div>
      ${scheduleLine(r)}
      <div class="request-actions">${actions}</div>
    </div>
  `;
}

function switchDashTab(tab) {
  dashboardTab = tab;
  document.querySelectorAll('#modal-dashboard .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('dashboard-received').hidden = tab !== 'received';
  document.getElementById('dashboard-sent').hidden = tab !== 'sent';
}

async function showDashboard() {
  const modal = document.getElementById('modal-dashboard');
  if (modal.style.display === 'none') {
    document.getElementById('dashboard-received').innerHTML = skeletonRequests(2);
    document.getElementById('dashboard-sent').innerHTML = skeletonRequests(2);
  }
  modal.style.display = 'flex';
  const res = await fetch('/api/dashboard');
  const data = await res.json();

  dashboardRequests = {};
  [...data.received, ...data.sent].forEach(r => {
    dashboardRequests[r._id] = r;
    if (r.other_presence) presenceOf[r.other_user_id] = { user_id: r.other_user_id, ...r.other_presence };
  });

  const empty = (text) => `<div class="empty"><b>${text}</b>ลองค้นหาผู้สอนจากหน้าแรก แล้วกด "ขอแลกเปลี่ยน"</div>`;
  document.getElementById('dashboard-received').innerHTML = data.received.length
    ? data.received.map(r => renderRequestCard(r, true)).join('')
    : empty('ยังไม่มีใครส่งคำขอมา');
  document.getElementById('dashboard-sent').innerHTML = data.sent.length
    ? data.sent.map(r => renderRequestCard(r, false)).join('')
    : empty('คุณยังไม่ได้ส่งคำขอ');
  document.getElementById('count-received').textContent = data.received.length || '';
  document.getElementById('count-sent').textContent = data.sent.length || '';
  switchDashTab(dashboardTab);
  // ตอบรับ/ปฏิเสธ/ลบ/ปิดแชท ล้วนกลับมาที่นี่ — อัปเดต badge ให้ตรงทุกครั้ง
  refreshBadge();
}

function closeDashboard() {
  document.getElementById('modal-dashboard').style.display = 'none';
}

async function respondRequest(requestId, status) {
  await fetch('/api/exchange/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, status })
  });
  showDashboard();
  loadMatches();
}

async function completeExchange(requestId) {
  const r = dashboardRequests[requestId];
  if (!confirm(`ยืนยันว่าแลกเปลี่ยนทักษะกับ ${r?.other_username || 'อีกฝ่าย'} เสร็จแล้ว?\nเมื่อทั้งสองฝ่ายยืนยัน จะให้คะแนนกันได้`)) return;
  const res = await fetch(`/api/exchange/${requestId}/complete`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) return showToast(esc(data.error || 'ทำรายการไม่สำเร็จ'));
  await showDashboard();
  if (data.completed) {
    showToast('🎉 แลกเปลี่ยนเสร็จสมบูรณ์ ให้คะแนนกันได้เลย');
    openRating(requestId);
  } else {
    showToast('บันทึกแล้ว รออีกฝ่ายยืนยัน');
  }
}

// ===== นัดเวลาเรียน =====
let scheduleRequestId = null;
const pad2 = (n) => String(n).padStart(2, '0');
// ค่าสำหรับ <input type="datetime-local"> ต้องเป็นเวลาท้องถิ่น ไม่ใช่ UTC
const toLocalInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function openSchedule(requestId) {
  const r = dashboardRequests[requestId];
  scheduleRequestId = requestId;
  const atInput = document.getElementById('schedule-at');
  atInput.min = toLocalInput(new Date());
  // ยังไม่มีนัด → เสนอพรุ่งนี้เวลาเดิมปัดเป็นชั่วโมง
  const suggest = new Date(Date.now() + 24 * 60 * 60 * 1000);
  suggest.setMinutes(0, 0, 0);
  atInput.value = toLocalInput(r?.schedule?.at ? new Date(r.schedule.at) : suggest);
  document.getElementById('schedule-note').value = r?.schedule?.note || '';
  document.getElementById('schedule-with').textContent = `กับ ${r?.other_username || ''} — อีกฝ่ายจะได้รับแจ้งเตือน`;
  document.getElementById('schedule-cancel').hidden = !r?.schedule;
  document.getElementById('schedule-msg').textContent = '';
  document.getElementById('modal-schedule').style.display = 'flex';
}

function closeSchedule() {
  document.getElementById('modal-schedule').style.display = 'none';
}

async function saveSchedule(at, note) {
  const res = await fetch(`/api/exchange/${scheduleRequestId}/schedule`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at, note })
  });
  const data = await res.json();
  if (!data.success) return (document.getElementById('schedule-msg').textContent = data.error || 'บันทึกไม่สำเร็จ');
  closeSchedule();
  showToast(at ? '📅 บันทึกนัดแล้ว แจ้งอีกฝ่ายให้แล้ว' : 'ยกเลิกนัดแล้ว');
  showDashboard();
}

document.getElementById('schedule-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = document.getElementById('schedule-at').value;
  if (!value) return (document.getElementById('schedule-msg').textContent = 'กรุณาเลือกวันและเวลา');
  saveSchedule(new Date(value).toISOString(), document.getElementById('schedule-note').value);
});
document.getElementById('schedule-cancel').addEventListener('click', () => {
  if (confirm('ยกเลิกนัดนี้?')) saveSchedule(null, '');
});

async function deleteRequest(requestId) {
  if (!confirm('ลบคำขอนี้?')) return;
  await fetch(`/api/exchange/request/${requestId}`, { method: 'DELETE' });
  showDashboard();
  loadMatches();
}

// ===== Chat =====
let currentRequestId = null;
let currentUserId = null;
let currentUsername = null;
let socket = null;

async function openChat(requestId) {
  currentRequestId = requestId;
  const req = dashboardRequests[requestId];

  if (!currentUserId) {
    const profileRes = await fetch('/api/profile');
    if (profileRes.ok) currentUserId = (await profileRes.json()).user?._id;
  }

  const name = req?.other_username || '';
  const next = req?.schedule?.at && new Date(req.schedule.at) > Date.now()
    ? `<p class="chat-sub">📅 นัดครั้งถัดไป ${esc(fmtDateTime(req.schedule.at))}</p>` : '';
  document.getElementById('chat-title').innerHTML = `${req ? avatarWithPresence(name, req.other_user_id) : avatar(name)}
    <div style="min-width:0"><h3>${esc(name)}</h3><p class="chat-sub" id="chat-presence" hidden></p>${next}</div>`;
  renderChatPresence();
  hideTyping();
  partnerLastRead = req?.other_last_read ? new Date(req.other_last_read) : null;
  const rateBtn = document.getElementById('chat-rate-btn');
  rateBtn.hidden = !req || req.status !== 'completed' || req.reviewed;
  rateBtn.onclick = () => openRating(requestId);

  document.getElementById('modal-chat').style.display = 'flex';
  document.getElementById('modal-dashboard').style.display = 'none';

  const chatInput = document.getElementById('chat-input');
  chatInput.value = '';
  setTimeout(() => chatInput.focus(), 150);

  ensureSocket().emit('joinRoom', requestId);

  const container = document.getElementById('chat-messages');
  container.innerHTML = '';
  try {
    // server บันทึกว่าอ่านแล้วตอนโหลดประวัติ
    const res = await fetch(`/api/chat/${requestId}`);
    const messages = await res.json();
    if (messages.length === 0) container.innerHTML = '<p class="chat-empty">ยังไม่มีข้อความ — ทักทายกันได้เลย 👋</p>';
    messages.forEach(msg => appendMessage(msg));
    renderReadReceipt();
    if (req) req.unread = 0;
    refreshBadge();
  } catch (e) {
    console.error('Chat load failed:', e);
  }
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  container.querySelector('.chat-empty')?.remove();
  const isMine = msg.sender_id?.toString() === currentUserId?.toString();
  const div = document.createElement('div');
  div.className = 'msg' + (isMine ? ' mine' : '');
  div.dataset.at = msg.created_at;
  div.innerHTML = `
    ${isMine ? '' : `<span class="msg-name">${esc(msg.sender_name)}</span>`}
    <div class="msg-bubble">${esc(msg.text)}</div>
  `;
  container.appendChild(div);
  if (isMine) renderReadReceipt();
  container.scrollTop = container.scrollHeight;
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !currentRequestId) return;
  // ตัวตนผู้ส่งมาจาก session ฝั่ง server ไม่ต้องส่งไป
  socket.emit('sendMessage', { requestId: currentRequestId, text });
  input.value = '';
}

function closeChat() {
  document.getElementById('modal-chat').style.display = 'none';
  currentRequestId = null;
  partnerLastRead = null;
  hideTyping();
  showDashboard();
}

// ===== Hero หลัง login =====
async function updateHero(username) {
  const res = await fetch('/api/profile');
  if (!res.ok) return;
  const data = await res.json();
  const teach = data.skills?.filter(s => s.type === 'teach') || [];
  const learn = data.skills?.filter(s => s.type === 'learn') || [];

  // แสดงสูงสุด 3 ชื่อ ที่เหลือเป็น +N
  const names = (list) => list.slice(0, 3).map(s => s.skill_name).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');
  const pill = (list, type, label, addText) => list.length
    ? `<span class="skill-pill ${type}">${label} · <b>${esc(names(list))}</b></span>`
    : `<button class="skill-pill add" onclick="showProfile()">+ ${addText}</button>`;

  document.getElementById('hero-greeting').innerHTML = `
    <p class="eyebrow">สวัสดี ${esc(username)} 👋</p>
    <h1>วันนี้อยาก<span class="accent">เรียนอะไร</span>?</h1>
    <div class="my-skills">
      ${pill(teach, 'teach', 'ฉันสอน', 'เพิ่มทักษะที่สอนได้')}
      ${pill(learn, 'learn', 'อยากเรียน', 'เพิ่มทักษะที่อยากเรียน')}
    </div>
  `;
}

// ===== Rating =====
let currentRating = 0;
let ratingRequestId = null;

function selectStar(val) {
  currentRating = val;
  document.querySelectorAll('#star-selector .star').forEach(s => {
    s.classList.toggle('on', parseInt(s.dataset.val) <= val);
  });
}

async function openRating(requestId) {
  const res = await fetch(`/api/review/check/${requestId}`);
  const data = await res.json();
  if (data.reviewed) {
    showToast('คุณให้คะแนนการแลกเปลี่ยนนี้ไปแล้ว');
    return;
  }
  ratingRequestId = requestId;
  selectStar(0);
  document.getElementById('rating-comment').value = '';
  document.getElementById('rating-msg').textContent = '';
  document.getElementById('modal-rating').style.display = 'flex';
}

function closeRating() {
  document.getElementById('modal-rating').style.display = 'none';
}

async function submitRating() {
  const msg = document.getElementById('rating-msg');
  if (!currentRating) {
    msg.textContent = 'กรุณาเลือกจำนวนดาวก่อน';
    msg.className = 'form-msg error-msg';
    return;
  }
  const comment = document.getElementById('rating-comment').value;
  const res = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: ratingRequestId,
      rating: currentRating,
      comment
    })
  });
  const data = await res.json();
  if (data.success) {
    closeRating();
    showToast('⭐ ขอบคุณสำหรับคะแนน!');
    // ปิดปุ่มให้คะแนนใน dashboard/แชท หลังรีวิวสำเร็จ
    if (dashboardRequests[ratingRequestId]) dashboardRequests[ratingRequestId].reviewed = true;
    if (document.getElementById('modal-dashboard').style.display !== 'none') showDashboard();
    if (ratingRequestId === currentRequestId) document.getElementById('chat-rate-btn').hidden = true;
  } else {
    msg.textContent = data.error || 'เกิดข้อผิดพลาด';
    msg.className = 'form-msg error-msg';
  }
}

// ===== ดูแลเนื้อหา: เมนู ⋯ / รายงาน / บล็อก / แอดมิน =====
let currentIsAdmin = false;
let viewingUser = null;   // ผู้ใช้ที่เปิดโปรไฟล์อยู่ (ปุ่มในโปรไฟล์อ้างถึงตัวนี้ ไม่ฝังชื่อลงใน onclick)
let reportTarget = null;

function setAdmin(isAdmin) {
  currentIsAdmin = !!isAdmin;
  document.getElementById('nav-admin').style.display = currentIsAdmin ? '' : 'none';
  if (currentIsAdmin) refreshAdminBadge();
}

function closeMenus(except) {
  document.querySelectorAll('.post-menu-wrap .menu').forEach(m => {
    if (m === except) return;
    m.hidden = true;
    m.previousElementSibling.setAttribute('aria-expanded', 'false');
  });
}

function toggleMenu(btn) {
  const menu = btn.nextElementSibling;
  closeMenus(menu);
  menu.hidden = !menu.hidden;
  btn.setAttribute('aria-expanded', String(!menu.hidden));
}
document.addEventListener('click', (e) => { if (!e.target.closest('.post-menu-wrap')) closeMenus(); });

function openReport(type, id) {
  if (!currentUsername) return showModal('login');
  reportTarget = { type, id };
  document.getElementById('report-what').textContent = { post: 'โพสต์', comment: 'ความคิดเห็น', user: 'ผู้ใช้' }[type];
  document.getElementById('report-form').reset();
  document.getElementById('report-msg').textContent = '';
  document.getElementById('modal-report').style.display = 'flex';
}

function closeReport() {
  document.getElementById('modal-report').style.display = 'none';
}

document.getElementById('report-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = new FormData(e.target).get('reason');
  if (!reason) return (document.getElementById('report-msg').textContent = 'กรุณาเลือกเหตุผล');
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: reportTarget.type, target_id: reportTarget.id, reason, detail: document.getElementById('report-detail').value })
  });
  const data = await res.json();
  if (!data.success) return (document.getElementById('report-msg').textContent = data.error || 'ส่งรายงานไม่สำเร็จ');
  closeReport();
  showToast(data.already ? 'คุณรายงานเรื่องนี้ไปแล้ว ทีมงานกำลังตรวจสอบ' : '🙏 ขอบคุณที่รายงาน ทีมงานจะตรวจสอบโดยเร็ว');
});

// บล็อก / เลิกบล็อก — รีเฟรชทุกส่วนที่อาจแสดงคนนี้อยู่
async function toggleBlock(userId, name, isBlocked = false) {
  if (!currentUsername) return showModal('login');
  if (!isBlocked && !confirm(`บล็อก ${name}?\nคุณกับเขาจะไม่เห็นโพสต์ของกันและกัน และส่งคำขอหรือแชทหากันไม่ได้`)) return;
  const res = await fetch(`/api/blocks/${userId}`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) return showToast(esc(data.error || 'ทำรายการไม่สำเร็จ'));
  showToast(`${data.blocked ? 'บล็อก' : 'เลิกบล็อก'} ${esc(name)} แล้ว`);
  if (feedLoaded) loadFeed(true);
  searchSkills();
  loadMatches();
  if (document.getElementById('modal-user').style.display !== 'none' && viewingUser?.id === userId) showUserProfile(userId);
  if (document.getElementById('modal-profile').style.display !== 'none') loadBlockedList();
}

function blockViewingUser() {
  toggleBlock(viewingUser.id, viewingUser.username, viewingUser.blocked);
}

async function loadBlockedList() {
  const res = await fetch('/api/blocks');
  if (!res.ok) return;
  const users = await res.json();
  document.getElementById('blocked-section').hidden = !users.length;
  document.getElementById('blocked-list').innerHTML = users.map(u => `
    <div class="blocked-row">${avatar(u.username)}<span>${esc(u.username)}</span>
      <button class="btn btn-ghost btn-sm" data-unblock="${esc(u.id)}" data-name="${esc(u.username)}">เลิกบล็อก</button>
    </div>`).join('');
}

document.getElementById('blocked-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-unblock]');
  if (btn) toggleBlock(btn.dataset.unblock, btn.dataset.name, true);
});

// ===== แอดมิน =====
const TYPE_LABEL = { post: 'โพสต์', comment: 'ความคิดเห็น', user: 'ผู้ใช้' };
let adminItems = [];

let adminSkillRequests = [];
let adminTab = 'reports';

async function refreshAdminBadge() {
  const [reportsRes, skillsRes] = await Promise.all([fetch('/api/admin/reports'), fetch('/api/admin/skill-requests')]);
  if (!reportsRes.ok) return;
  adminItems = await reportsRes.json();
  adminSkillRequests = skillsRes.ok ? await skillsRes.json() : [];
  document.getElementById('admin-badge').textContent = (adminItems.length + adminSkillRequests.length) || '';
  document.getElementById('count-reports').textContent = adminItems.length || '';
  document.getElementById('count-skills').textContent = adminSkillRequests.length || '';
  return adminItems;
}

function switchAdminTab(tab) {
  adminTab = tab;
  document.querySelectorAll('#modal-admin .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('admin-list').hidden = tab !== 'reports';
  document.getElementById('admin-skills').hidden = tab !== 'skills';
}

const CATEGORY_KEYS = ['IT', 'Language', 'Art', 'Music', 'Other'];

function renderSkillRequest(r, i) {
  return `
    <div class="request" data-i="${i}">
      <div class="request-top">
        <span class="status pending">${r.count} เสียง</span>
        <div style="flex:1;min-width:0">
          <b>${esc(r.name)}</b> <span class="muted">· ${esc(categoryLabel(r.category))}</span>
          <p class="report-preview">เสนอโดย ${r.users.map(esc).join(', ') || '—'}</p>
        </div>
      </div>
      <div class="suggest-row admin-skill-edit">
        <label class="field"><span>ชื่อที่จะเพิ่ม</span><input class="input" data-field="name" maxlength="40" value="${esc(r.name)}" /></label>
        <label class="field"><span>หมวด</span><select class="input" data-field="category">
          ${CATEGORY_KEYS.map(c => `<option value="${c}" ${c === r.category ? 'selected' : ''}>${esc(categoryLabel(c))}</option>`).join('')}
        </select></label>
      </div>
      <div class="request-actions">
        <button class="btn btn-primary btn-sm" data-skill="approve">อนุมัติ</button>
        <button class="btn btn-ghost btn-sm" data-skill="reject">ไม่อนุมัติ</button>
      </div>
    </div>`;
}

document.getElementById('admin-skills').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-skill]');
  if (!btn) return;
  const item = btn.closest('[data-i]');
  const r = adminSkillRequests[item.dataset.i];
  const action = btn.dataset.skill;
  const body = { action };
  if (action === 'approve') {
    body.name = item.querySelector('[data-field="name"]').value.trim();
    body.category = item.querySelector('[data-field="category"]').value;
  } else if (!confirm(`ไม่อนุมัติ "${r.name}"?`)) return;
  btn.disabled = true;
  const res = await fetch(`/api/admin/skill-requests/${r._id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) { btn.disabled = false; return showToast(esc(data.error || 'ทำรายการไม่สำเร็จ')); }
  showToast(action === 'approve'
    ? `เพิ่มทักษะ "${esc(data.skill.name)}" แล้ว<small>ใส่ในโปรไฟล์คนเสนอให้ ${data.added} คน</small>`
    : 'ไม่อนุมัติแล้ว แจ้งคนเสนอให้แล้ว');
  showAdmin();
});

function renderReportItem(r, i) {
  const owner = r.owner;
  return `
    <div class="request" data-i="${i}">
      <div class="request-top">
        <span class="status pending">${TYPE_LABEL[r.type]}</span>
        <div style="flex:1;min-width:0">
          <b>${esc(owner?.username || 'ไม่ทราบชื่อ')}</b> ${owner?.banned ? '<span class="banned-badge">ถูกระงับ</span>' : ''}
          <p class="report-preview">${esc(r.preview || '—')}</p>
        </div>
      </div>
      <div class="report-meta">
        <span class="tag">${r.count} รายงาน</span>
        ${Object.entries(r.reasons).map(([k, v]) => `<span class="tag">${esc(k)}${v > 1 ? ` ×${v}` : ''}</span>`).join('')}
        ${r.hidden ? '<span class="tag">ซ่อนอยู่</span>' : ''}
      </div>
      ${r.details.length ? `<p class="report-detail">“${r.details.map(esc).join('” · “')}”</p>` : ''}
      <div class="request-actions">
        <button class="btn btn-outline btn-sm" data-admin="dismiss">ไม่ผิด</button>
        ${r.type !== 'user' && r.exists ? '<button class="btn btn-danger btn-sm" data-admin="remove">ลบเนื้อหา</button>' : ''}
        <span class="spacer"></span>
        ${owner ? `<button class="btn btn-ghost btn-sm" data-admin="${owner.banned ? 'unban' : 'ban'}">${owner.banned ? 'ปลดระงับ' : 'ระงับบัญชี'}</button>` : ''}
      </div>
    </div>`;
}

async function showAdmin() {
  const list = document.getElementById('admin-list');
  list.innerHTML = skeletonRequests(2);
  document.getElementById('modal-admin').style.display = 'flex';
  const items = await refreshAdminBadge() || [];
  list.innerHTML = items.length
    ? items.map(renderReportItem).join('')
    : '<div class="empty"><b>ไม่มีรายงานค้างอยู่ 🎉</b>ชุมชนเรียบร้อยดี</div>';
  document.getElementById('admin-skills').innerHTML = adminSkillRequests.length
    ? adminSkillRequests.map(renderSkillRequest).join('')
    : '<div class="empty"><b>ไม่มีทักษะที่รอตรวจ</b>ผู้ใช้เสนอทักษะใหม่ได้จากหน้าโปรไฟล์</div>';
  switchAdminTab(adminTab);
}

function closeAdmin() {
  document.getElementById('modal-admin').style.display = 'none';
}

// ผู้ใช้ลืมรหัสแต่ยังไม่ได้ตั้งระบบส่งอีเมล → แอดมินสร้างลิงก์แล้วส่งให้ทางแชท/LINE แทน
async function adminResetLink(userId) {
  const res = await fetch(`/api/admin/users/${userId}/reset-link`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) return showToast(esc(data.error || 'สร้างลิงก์ไม่สำเร็จ'));
  try {
    await navigator.clipboard.writeText(data.link);
    showToast(`🔗 คัดลอกลิงก์แล้ว ส่งให้ผู้ใช้ได้เลย<small>ใช้ได้ ${data.expires_in_minutes} นาที ใช้ได้ครั้งเดียว</small>`);
  } catch (e) {
    prompt(`คัดลอกลิงก์นี้ส่งให้ผู้ใช้ (ใช้ได้ ${data.expires_in_minutes} นาที)`, data.link);
  }
}

async function adminBan(userId, banned) {
  if (!confirm(banned ? 'ระงับบัญชีนี้? เขาจะ login ไม่ได้ และโพสต์ทั้งหมดจะถูกซ่อน' : 'ปลดระงับบัญชีนี้?')) return;
  const res = await fetch(`/api/admin/users/${userId}/ban`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ banned })
  });
  const data = await res.json();
  if (!data.success) return showToast(esc(data.error || 'ทำรายการไม่สำเร็จ'));
  showToast(banned ? 'ระงับบัญชีแล้ว' : 'ปลดระงับแล้ว');
  if (document.getElementById('modal-user').style.display !== 'none') showUserProfile(userId);
  if (feedLoaded) loadFeed(true);
  searchSkills();
}

document.getElementById('admin-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-admin]');
  if (!btn) return;
  const r = adminItems[btn.closest('[data-i]').dataset.i];
  const action = btn.dataset.admin;
  if (action === 'ban' || action === 'unban') {
    await adminBan(r.owner.id, action === 'ban');
  } else {
    if (action === 'remove' && !confirm(`ลบ${TYPE_LABEL[r.type]}นี้ถาวร?`)) return;
    const res = await fetch('/api/admin/reports/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: r.type, target_id: r.target_id, action })
    });
    if (!res.ok) return showToast('ทำรายการไม่สำเร็จ');
    showToast(action === 'remove' ? 'ลบเนื้อหาแล้ว' : 'ปิดรายงานแล้ว');
    if (feedLoaded) loadFeed(true);
  }
  showAdmin();
});

// ===== คู่แลกเปลี่ยนที่แนะนำ =====
const MATCHES_PREVIEW = 3;
let matchesById = {};
let matchesExpanded = false;

const matchEmpty = (text, btn) =>
  `<div class="match-empty"><span>${text}</span><button class="btn btn-primary btn-sm" onclick="showProfile()">${btn}</button></div>`;

function renderMatch(m) {
  const pills = (list, type) => list.map(s => `<span class="skill-pill sm ${type}">${esc(s.name)}</span>`).join('');
  const action = {
    pending_sent: '<button class="btn btn-outline btn-sm" disabled>ส่งคำขอแล้ว</button>',
    pending_received: '<button class="btn btn-primary btn-sm" onclick="showDashboard()">ดูคำขอที่เขาส่งมา</button>',
    accepted: '<button class="btn btn-primary btn-sm" onclick="showDashboard()">กำลังแลกเปลี่ยน</button>'
  }[m.request_status] || `<button class="btn btn-primary btn-sm" onclick="requestFromMatch('${esc(m.id)}')">ขอแลกเปลี่ยน</button>`;
  return `
    <article class="person-card match-card ${m.perfect ? 'perfect' : ''}">
      ${m.perfect ? '<span class="match-badge">✨ แลกกันได้พอดี</span>' : ''}
      <div class="person" onclick="showUserProfile('${esc(m.id)}')" title="ดูโปรไฟล์และรีวิว">
        ${avatar(m.username)}
        <div>
          <h3>${esc(m.username)}</h3>
          <p class="rating">${ratingHtml(m.avg_rating, m.review_count)}</p>
        </div>
      </div>
      ${m.can_teach_me.length ? `<div class="match-row"><span class="match-label">สอนคุณได้</span>${pills(m.can_teach_me, 'teach')}</div>` : ''}
      ${m.wants_from_me.length ? `<div class="match-row"><span class="match-label">อยากเรียนจากคุณ</span>${pills(m.wants_from_me, 'learn')}</div>` : ''}
      <div class="card-actions">
        <button class="btn btn-outline btn-sm" onclick="showUserProfile('${esc(m.id)}')">ดูโปรไฟล์</button>
        ${action}
      </div>
    </article>`;
}

async function loadMatches() {
  const section = document.getElementById('matches');
  if (!currentUsername) { section.hidden = true; return; }
  section.hidden = false;
  const list = document.getElementById('match-list');
  if (!list.children.length) list.innerHTML = skeletonCards(3);
  const res = await fetch('/api/matches');
  if (!res.ok) { section.hidden = true; return; }
  const data = await res.json();
  matchesById = Object.fromEntries(data.matches.map(m => [m.id, m]));

  if (!data.has_teach && !data.has_learn) {
    list.innerHTML = matchEmpty('บอกเราว่าคุณสอนอะไรได้ และอยากเรียนอะไร แล้วระบบจะหาคู่แลกเปลี่ยนให้', 'ตั้งทักษะ');
  } else if (!data.matches.length) {
    const hint = !data.has_learn ? 'เพิ่มทักษะที่อยากเรียน จะได้เจอคนที่สอนได้'
      : !data.has_teach ? 'เพิ่มทักษะที่คุณสอนได้ จะได้เจอคนที่อยากแลกด้วย'
      : 'ยังไม่มีคู่ที่ตรงกัน ลองเพิ่มทักษะอื่น ๆ ดู';
    list.innerHTML = matchEmpty(hint, 'แก้ไขทักษะ');
  } else {
    // โชว์แถวแรกก่อน ไม่ให้ดันผลค้นหาลงไปไกล — ที่เหลือกด "ดูทั้งหมด"
    const shown = matchesExpanded ? data.matches : data.matches.slice(0, MATCHES_PREVIEW);
    const more = data.matches.length - shown.length;
    list.innerHTML = shown.map(renderMatch).join('') + (more > 0
      ? `<button class="btn btn-ghost match-more" onclick="matchesExpanded = true; loadMatches()">ดูคู่ที่แนะนำทั้งหมด (${data.matches.length})</button>`
      : '');
  }
}

// ข้อความคำขอเขียนให้จากทักษะที่ตรงกัน
async function requestFromMatch(id) {
  const m = matchesById[id];
  if (!m) return;
  const names = (list) => list.map(s => s.name).join(', ');
  let message = 'สวัสดีครับ/ค่ะ';
  if (m.can_teach_me.length) message += ` อยากเรียน ${names(m.can_teach_me)} จากคุณ`;
  if (m.wants_from_me.length) message += `${m.can_teach_me.length ? ' และ' : ''} สอน ${names(m.wants_from_me)} ให้ได้`;
  await sendRequest(id, message + ' แลกเปลี่ยนกันไหม?');
}

// ===== ชุมชน (ฟีดสาธารณะ) =====
const POST_MAX = 500;
// ลิงก์ หรือ #แท็ก — ส่วนแท็กต้องตรงกับ HASHTAG_RE ใน routes/posts.js
const TOKEN_RE = /(https?:\/\/[^\s<>"']+)|(^|[^\p{L}\p{M}\p{N}_&/#])#([\p{L}\p{M}\p{N}_]*[\p{L}\p{M}][\p{L}\p{M}\p{N}_]*)/gu;
const ICON_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
const ICON_COMMENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>';

let currentView = 'home';
let feedLoaded = false;
let feedLoading = false;
let feedNext = null;
let feedTag = '';
let feedPending = 0;
let pendingFocusPost = null;

// escape ทีละชิ้นก่อนแปลงลิงก์/แท็ก — ไม่ regex ทับ HTML ที่ escape แล้ว
function formatPostText(text) {
  let html = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const [, url, prefix, tag] = m;
    html += esc(text.slice(last, m.index));
    if (url) {
      const clean = url.replace(/[.,!?;:)\]]+$/, ''); // วงเล็บ/จุดท้ายประโยคไม่ใช่ส่วนของลิงก์
      html += `<a href="${esc(clean)}" target="_blank" rel="noopener noreferrer nofollow">${esc(clean)}</a>`;
      last = m.index + clean.length;
    } else {
      html += esc(prefix) + `<a href="#community" class="hashtag" data-tag="${esc(tag.toLowerCase())}">#${esc(tag)}</a>`;
      last = m.index + m[0].length;
    }
  }
  return html + esc(text.slice(last));
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return `${Math.floor(s / 60)} นาที`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม.`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} วัน`;
  return new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

function timeTag(date) {
  return `<time datetime="${esc(date)}" title="${esc(new Date(date).toLocaleString('th-TH'))}">${timeAgo(date)}</time>`;
}

function renderPost(p) {
  const user = `data-action="profile" data-user="${esc(p.author_id)}"`;
  const items = p.mine
    ? ['<button data-action="delete-post" class="danger">ลบโพสต์</button>']
    : [
        '<button data-action="report-post">รายงานโพสต์</button>',
        `<button data-action="block-user" data-user="${esc(p.author_id)}" data-name="${esc(p.author_name)}">บล็อก ${esc(p.author_name)}</button>`,
        ...(currentIsAdmin ? ['<button data-action="delete-post" class="danger">ลบโพสต์ (แอดมิน)</button>'] : [])
      ];
  return `
    <article class="post" id="post-${esc(p._id)}" data-id="${esc(p._id)}">
      ${avatar(p.author_name, '', user)}
      <div class="post-body">
        <div class="post-meta">
          <span class="post-author" ${user}>${esc(p.author_name)}</span>
          <span>·</span>${timeTag(p.created_at)}
          <div class="post-menu-wrap">
            <button class="menu-btn" data-action="menu" aria-label="ตัวเลือกเพิ่มเติม" aria-haspopup="true" aria-expanded="false">⋯</button>
            <div class="menu" hidden>${items.join('')}</div>
          </div>
        </div>
        <div class="post-text">${formatPostText(p.text)}</div>
        ${p.hidden ? '<span class="hidden-note">ถูกซ่อนชั่วคราวเพราะมีผู้รายงาน — รอแอดมินตรวจสอบ</span>' : ''}
        <div class="post-actions">
          <button class="action like ${p.liked ? 'on' : ''}" data-action="like" aria-pressed="${p.liked}" aria-label="ถูกใจ">${ICON_HEART}<span class="n">${p.like_count || ''}</span></button>
          <button class="action" data-action="comments" aria-label="ความคิดเห็น">${ICON_COMMENT}<span class="n">${p.comment_count || ''}</span></button>
        </div>
        <div class="comments" hidden></div>
      </div>
    </article>`;
}

function renderComment(c) {
  const user = `data-action="profile" data-user="${esc(c.author_id)}"`;
  return `
    <div class="comment" data-comment="${esc(c._id)}">
      ${avatar(c.author_name, '', user)}
      <div class="comment-body">
        <div class="post-meta">
          <span class="post-author" ${user}>${esc(c.author_name)}</span>
          <span>·</span>${timeTag(c.created_at)}
          ${c.mine || currentIsAdmin ? '<button class="btn btn-danger" data-action="delete-comment">ลบ</button>' : ''}
          ${c.mine ? '' : '<button class="btn btn-ghost" data-action="report-comment">รายงาน</button>'}
        </div>
        <div class="post-text">${formatPostText(c.text)}</div>
      </div>
    </div>`;
}

function emptyFeedHtml() {
  return `<div class="empty"><b>${feedTag ? `ยังไม่มีโพสต์ใน #${esc(feedTag)}` : 'ยังไม่มีโพสต์'}</b>เริ่มแชร์ความรู้เป็นคนแรกได้เลย</div>`;
}

async function loadFeed(reset = true) {
  if (feedLoading) return;
  feedLoading = true;
  try {
    const params = new URLSearchParams({ limit: 15 });
    if (!reset && feedNext) params.set('before', feedNext);
    if (feedTag) params.set('tag', feedTag);
    if (reset) document.getElementById('feed-list').innerHTML = skeletonPosts(3);
    const data = await (await fetch(`/api/posts?${params}`)).json();
    const list = document.getElementById('feed-list');
    const html = data.posts.map(renderPost).join('');
    if (reset) {
      list.innerHTML = html || emptyFeedHtml();
      feedPending = 0;
      updateNewPill();
      loadTrendingTags();
    } else {
      list.insertAdjacentHTML('beforeend', html);
    }
    feedNext = data.next;
    feedLoaded = true;
    document.getElementById('feed-more').hidden = !feedNext;
    renderFeedFilter();
    if (pendingFocusPost && !focusPendingPost()) pendingFocusPost = null;
  } finally {
    feedLoading = false;
  }
}

async function loadTrendingTags() {
  const tags = await (await fetch('/api/posts/trending-tags')).json();
  document.getElementById('feed-tags').innerHTML = tags.map(t => `
    <button class="chip ${t.tag === feedTag ? 'active' : ''}" data-tag="${esc(t.tag)}">#${esc(t.tag)}<span class="count">${t.count}</span></button>
  `).join('');
}

function renderFeedFilter() {
  const el = document.getElementById('feed-filter');
  el.hidden = !feedTag;
  el.innerHTML = feedTag
    ? `<span>แสดงเฉพาะโพสต์ที่มี <b>#${esc(feedTag)}</b></span><button class="btn btn-ghost btn-sm" onclick="setFeedTag('')">ดูทั้งหมด</button>`
    : '';
  document.querySelectorAll('#feed-tags .chip').forEach(c => c.classList.toggle('active', c.dataset.tag === feedTag));
}

function setFeedTag(tag) {
  feedTag = tag;
  if (currentView !== 'community') location.hash = '#community'; // route() จะโหลดฟีดให้
  else { loadFeed(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }
}

function renderComposer() {
  const el = document.getElementById('composer');
  if (!currentUsername) {
    el.innerHTML = `
      <div class="composer-guest">
        <span>เข้าสู่ระบบเพื่อโพสต์ ถูกใจ และแสดงความคิดเห็น</span>
        <button class="btn btn-primary btn-sm" onclick="showModal('login')">เข้าสู่ระบบ</button>
      </div>`;
    return;
  }
  el.innerHTML = `
    <form class="composer" id="composer-form">
      ${avatar(currentUsername)}
      <div class="composer-main">
        <textarea id="composer-text" rows="2" placeholder="แชร์ความรู้ เคล็ดลับ หรือถามคำถาม..." aria-label="เขียนโพสต์"></textarea>
        <div class="composer-foot">
          <span class="composer-hint">ใส่ #แท็ก เช่น #python ให้คนหาเจอง่าย</span>
          <span class="char-count" id="composer-count"></span>
          <button class="btn btn-primary btn-sm" type="submit" id="composer-submit" disabled>โพสต์</button>
        </div>
      </div>
    </form>`;
  const ta = document.getElementById('composer-text');
  ta.addEventListener('input', updateComposer);
  // Ctrl/⌘ + Enter = โพสต์
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('composer-form').requestSubmit();
  });
  document.getElementById('composer-form').addEventListener('submit', (e) => { e.preventDefault(); submitPost(); });
}

function updateComposer() {
  const ta = document.getElementById('composer-text');
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
  const len = [...ta.value].length;
  const counter = document.getElementById('composer-count');
  // บอกจำนวนที่เหลือเฉพาะตอนใกล้เต็ม จะได้ไม่รก
  counter.textContent = len > POST_MAX - 50 ? `${POST_MAX - len}` : '';
  counter.classList.toggle('over', len > POST_MAX);
  document.getElementById('composer-submit').disabled = !ta.value.trim() || len > POST_MAX;
}

async function submitPost() {
  const ta = document.getElementById('composer-text');
  const btn = document.getElementById('composer-submit');
  btn.disabled = true;
  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: ta.value })
  });
  const data = await res.json();
  if (!data.success) {
    showToast(esc(data.error || 'โพสต์ไม่สำเร็จ'));
    updateComposer();
    return;
  }
  ta.value = '';
  updateComposer();
  if (!feedTag || data.post.tags.includes(feedTag)) {
    const list = document.getElementById('feed-list');
    list.querySelector('.empty')?.remove();
    list.insertAdjacentHTML('afterbegin', renderPost(data.post));
  } else {
    showToast('โพสต์แล้ว (ไม่ได้อยู่ในแท็กที่กำลังดู)');
  }
  loadTrendingTags();
}

function setLike(btn, liked, count, animate = false) {
  if (animate && liked) {
    btn.classList.remove('pop');
    void btn.offsetWidth; // เริ่ม animation ใหม่ทุกครั้งที่กด
    btn.classList.add('pop');
  }
  btn.classList.toggle('on', liked);
  btn.setAttribute('aria-pressed', liked);
  btn.querySelector('.n').textContent = count || '';
}

async function toggleLike(postEl) {
  if (!currentUsername) return showModal('login');
  const btn = postEl.querySelector('[data-action="like"]');
  const wasLiked = btn.classList.contains('on');
  const count = parseInt(btn.querySelector('.n').textContent || '0');
  setLike(btn, !wasLiked, count + (wasLiked ? -1 : 1), true); // แสดงผลทันที ไม่รอ server
  const res = await fetch(`/api/posts/${postEl.dataset.id}/like`, { method: 'POST' });
  if (!res.ok) return setLike(btn, wasLiked, count);
  const data = await res.json();
  setLike(btn, data.liked, data.like_count);
}

async function toggleComments(postEl, focusInput = true) {
  const box = postEl.querySelector('.comments');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<p class="muted" style="font-size:0.85rem">กำลังโหลด...</p>';
  const comments = await (await fetch(`/api/posts/${postEl.dataset.id}/comments`)).json();
  box.innerHTML = `<div class="comment-list">${comments.map(renderComment).join('')}</div>` + (currentUsername
    ? `<form class="comment-form">
         <input class="input" maxlength="300" placeholder="เขียนความคิดเห็น..." aria-label="เขียนความคิดเห็น" autocomplete="off" />
         <button class="btn btn-primary btn-sm" type="submit">ส่ง</button>
       </form>`
    : `<p class="muted" style="font-size:0.85rem;margin-top:0.5rem"><a href="#" data-action="login">เข้าสู่ระบบ</a> เพื่อแสดงความคิดเห็น</p>`);
  if (focusInput) box.querySelector('.comment-form input')?.focus();
}

function setCommentCount(postEl, count) {
  postEl.querySelector('[data-action="comments"] .n').textContent = count || '';
}

async function submitComment(postEl, form) {
  const input = form.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  const res = await fetch(`/api/posts/${postEl.dataset.id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const data = await res.json();
  input.disabled = false;
  if (!data.success) return showToast(esc(data.error || 'ส่งความคิดเห็นไม่สำเร็จ'));
  input.value = '';
  input.focus();
  postEl.querySelector('.comment-list').insertAdjacentHTML('beforeend', renderComment(data.comment));
  setCommentCount(postEl, data.comment_count);
}

async function deletePost(postEl) {
  closeMenus();
  if (!confirm('ลบโพสต์นี้? ความคิดเห็นทั้งหมดจะถูกลบด้วย')) return;
  const res = await fetch(`/api/posts/${postEl.dataset.id}`, { method: 'DELETE' });
  if (!res.ok) return showToast('ลบไม่สำเร็จ');
  postEl.remove();
  const list = document.getElementById('feed-list');
  if (!list.querySelector('.post')) list.innerHTML = emptyFeedHtml();
  loadTrendingTags();
}

async function deleteComment(postEl, commentEl) {
  if (!confirm('ลบความคิดเห็นนี้?')) return;
  const res = await fetch(`/api/comments/${commentEl.dataset.comment}`, { method: 'DELETE' });
  if (!res.ok) return showToast('ลบไม่สำเร็จ');
  const data = await res.json();
  commentEl.remove();
  setCommentCount(postEl, data.comment_count);
}

// ปุ่มทุกปุ่มในฟีดใช้ data-action ตัวเดียว ไม่ต้องผูก onclick ทีละโพสต์
document.getElementById('feed-list').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const postEl = el.closest('.post');
  switch (el.dataset.action) {
    case 'profile': showUserProfile(el.dataset.user); break;
    case 'like': toggleLike(postEl); break;
    case 'comments': toggleComments(postEl); break;
    case 'delete-post': deletePost(postEl); break;
    case 'delete-comment': deleteComment(postEl, el.closest('.comment')); break;
    case 'login': e.preventDefault(); showModal('login'); break;
    case 'menu': toggleMenu(el); break;
    case 'report-post': closeMenus(); openReport('post', postEl.dataset.id); break;
    case 'report-comment': openReport('comment', el.closest('.comment').dataset.comment); break;
    case 'block-user': closeMenus(); toggleBlock(el.dataset.user, el.dataset.name); break;
  }
});

document.getElementById('feed-list').addEventListener('submit', (e) => {
  if (!e.target.matches('.comment-form')) return;
  e.preventDefault();
  submitComment(e.target.closest('.post'), e.target);
});

document.getElementById('feed-tags').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) setFeedTag(chip.dataset.tag === feedTag ? '' : chip.dataset.tag);
});

// กด #แท็ก ที่ไหนก็ได้ (ฟีด หรือโพสต์ในโปรไฟล์) → ไปฟีดที่กรองแท็กนั้น
document.addEventListener('click', (e) => {
  const link = e.target.closest('a.hashtag');
  if (!link) return;
  e.preventDefault();
  closeUserProfile();
  setFeedTag(link.dataset.tag);
});

// ===== ฟีดแบบสด: ใครกดถูกใจ/แสดงความคิดเห็น/ลบโพสต์ ทุกคนที่เปิดฟีดอยู่เห็นทันที =====
function onFeedCounts({ post_id, like_count, comment_count }) {
  const postEl = document.getElementById('post-' + post_id);
  if (!postEl) return;
  if (like_count !== undefined) {
    const n = postEl.querySelector('[data-action="like"] .n');
    if (n.textContent !== String(like_count || '')) { n.textContent = like_count || ''; flash(n); }
  }
  if (comment_count !== undefined) {
    const n = postEl.querySelector('[data-action="comments"] .n');
    if (n.textContent !== String(comment_count || '')) { n.textContent = comment_count || ''; flash(n); }
    const box = postEl.querySelector('.comments');
    // เปิดความคิดเห็นอยู่ → โหลดรายการใหม่ (ไม่ล้างข้อความที่กำลังพิมพ์)
    if (!box.hidden && box.querySelectorAll('.comment').length !== comment_count) refreshCommentList(postEl);
  }
}

function onFeedDelete({ post_id }) {
  const postEl = document.getElementById('post-' + post_id);
  if (!postEl) return;
  postEl.classList.add('removing');
  setTimeout(() => postEl.remove(), 300);
}

async function refreshCommentList(postEl) {
  const list = postEl.querySelector('.comment-list');
  if (!list) return;
  const comments = await (await fetch(`/api/posts/${postEl.dataset.id}/comments`)).json();
  const known = new Set([...list.querySelectorAll('.comment')].map(c => c.dataset.comment));
  list.innerHTML = comments.map(renderComment).join('');
  list.querySelectorAll('.comment').forEach(c => { if (!known.has(c.dataset.comment)) c.classList.add('fresh'); });
}

function flash(el) {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function onFeedNew({ author_id }) {
  if (author_id === currentUserId) return; // โพสต์ของเราขึ้นฟีดไปแล้วตอนกดโพสต์
  feedPending++;
  updateNewPill();
}

function updateNewPill() {
  const pill = document.getElementById('feed-new-pill');
  pill.hidden = !feedPending;
  pill.textContent = `↑ มีโพสต์ใหม่ ${feedPending} โพสต์`;
}

document.getElementById('feed-new-pill').onclick = async () => {
  await loadFeed(true);
  document.querySelector('.feed-head').scrollIntoView({ behavior: 'smooth' });
};

// เปิดโพสต์จากแจ้งเตือน / โปรไฟล์: ไปหน้าชุมชนแล้วเลื่อนไปที่โพสต์นั้น
function goToPost(postId) {
  pendingFocusPost = String(postId);
  closeDashboard();
  closeUserProfile();
  if (currentView !== 'community' || feedTag) {
    feedTag = '';
    if (currentView !== 'community') location.hash = '#community';
    else loadFeed(true);
  } else if (!focusPendingPost()) {
    loadFeed(true);
  }
}

function focusPendingPost() {
  const el = pendingFocusPost && document.getElementById('post-' + pendingFocusPost);
  if (!el) return false;
  pendingFocusPost = null;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('highlight');
  void el.offsetWidth; // เริ่ม animation ใหม่
  el.classList.add('highlight');
  if (el.querySelector('.comments').hidden) toggleComments(el, false);
  return true;
}

// ===== สลับหน้า: หน้าแรก ↔ ชุมชน ↔ นโยบาย (ใช้ # ใน URL จะได้กด back/แชร์ลิงก์ได้) =====
function route() {
  if (location.hash.startsWith('#verify=')) {
    const token = location.hash.slice('#verify='.length);
    history.replaceState(null, '', location.pathname); // ไม่ให้ token ค้างใน URL/ประวัติ
    verifyEmailToken(token);
  }
  if (location.hash.startsWith('#reset=')) {
    resetToken = location.hash.slice('#reset='.length);
    history.replaceState(null, '', location.pathname); // ไม่ให้ token ค้างใน URL/ประวัติ
    document.getElementById('reset-msg').textContent = '';
    showModal('reset');
  }
  const view = location.hash.startsWith('#community') ? 'community'
    : location.hash === '#privacy' ? 'privacy' : 'home';
  const changed = view !== currentView;
  currentView = view;
  document.getElementById('view-home').hidden = view !== 'home';
  document.getElementById('view-community').hidden = view !== 'community';
  document.getElementById('view-privacy').hidden = view !== 'privacy';
  document.querySelectorAll('#nav-links a[data-view="community"]').forEach(a => a.classList.toggle('active', view === 'community'));
  if (view === 'community') {
    if (changed || !feedLoaded) {
      renderComposer();
      window.scrollTo({ top: 0, behavior: 'instant' });
      loadFeed(true);
    }
  } else if (view === 'privacy') {
    loadPrivacyInfo();
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else if (changed) {
    // ลิงก์อย่าง #search ถูกกดตอนหน้าแรกยังซ่อนอยู่ เลยต้องเลื่อนเอง
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: 'instant' }); else window.scrollTo({ top: 0, behavior: 'instant' });
  }
}
window.addEventListener('hashchange', route);

renderThemeToggle();
showDeletedNotice();
ensureSocket();
checkSession();
searchSkills();
loadStats();
route();
