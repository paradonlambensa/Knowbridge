// ป้องกัน XSS: escape ข้อความจากผู้ใช้ก่อนใส่ลง innerHTML
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const CATEGORY_TH = { IT: 'ไอที', Language: 'ภาษา', Art: 'ศิลปะ', Music: 'ดนตรี', Other: 'อื่น ๆ' };
const categoryLabel = (c) => CATEGORY_TH[c] || c;

// วงกลมตัวอักษรแรกของชื่อ แทนรูปโปรไฟล์
function avatar(name, size = '') {
  const first = [...String(name || '?')][0].toUpperCase();
  return `<div class="avatar ${size}">${esc(first)}</div>`;
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
function showModal(type) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal-login').style.display = type === 'login' ? 'block' : 'none';
  document.getElementById('modal-register').style.display = type === 'register' ? 'block' : 'none';
  setTimeout(() => document.getElementById(type === 'login' ? 'login-email' : 'reg-username').focus(), 50);
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
    showLoggedIn(data.username);
    await loadProfile();
    searchSkills();
  } else {
    document.getElementById('login-error').textContent = data.error;
  }
}

async function register() {
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  if (!username || !email || !password) {
    document.getElementById('reg-error').textContent = 'กรุณากรอกข้อมูลให้ครบ';
    return;
  }
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password })
  });
  const data = await res.json();
  if (data.success) {
    closeModal();
    showLoggedIn(username);
    await loadProfile();
    searchSkills();
    showProfile();
  } else {
    document.getElementById('reg-error').textContent = data.error;
  }
}

function showLoggedIn(username) {
  document.getElementById('btn-login-nav').style.display = 'none';
  document.getElementById('btn-logout').style.display = '';
  document.getElementById('nav-dashboard').style.display = '';
  document.getElementById('nav-profile').style.display = '';
  updateHero(username);
  ensureSocket();
  refreshBadge();
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}

// ===== Notifications =====
const NOTIFY_TEXT = {
  request:  (n) => `📬 <b>${esc(n.from)}</b> ส่งคำขอแลกเปลี่ยนมา`,
  accepted: (n) => `✅ <b>${esc(n.from)}</b> ยอมรับคำขอของคุณแล้ว เริ่มแชทได้เลย`,
  rejected: (n) => `<b>${esc(n.from)}</b> ปฏิเสธคำขอของคุณ`,
  message:  (n) => `💬 <b>${esc(n.from)}</b><small>${esc(n.preview)}</small>`
};

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
  if (n.type === 'message' && isChatOpen(n.request_id)) {
    // กำลังเปิดแชทนี้อยู่ ข้อความขึ้นในหน้าต่างแล้ว แค่บันทึกว่าอ่านแล้ว
    await markChatRead(n.request_id);
  } else {
    const onClick = n.type === 'message'
      ? async () => { await showDashboard(); openChat(n.request_id); }
      : showDashboard;
    showToast((NOTIFY_TEXT[n.type] || (() => esc(n.type)))(n), onClick);
    if (document.getElementById('modal-dashboard').style.display !== 'none') showDashboard();
  }
  refreshBadge();
}

function ensureSocket() {
  if (socket) return socket;
  socket = io();
  socket.on('newMessage', (msg) => {
    if (msg.request_id === currentRequestId) appendMessage(msg);
  });
  socket.on('notify', handleNotify);
  // หลุดแล้วต่อใหม่ (เช่น server restart) ต้อง join ห้องแชทที่เปิดค้างไว้อีกครั้ง
  socket.on('connect', () => {
    if (currentRequestId) socket.emit('joinRoom', currentRequestId);
  });
  return socket;
}

// ===== Profile =====
async function loadSkillOptions() {
  const [skillsRes, profileRes] = await Promise.all([
    fetch('/api/skills'),
    fetch('/api/profile')
  ]);
  const skills = await skillsRes.json();
  const profileData = profileRes.ok ? await profileRes.json() : { skills: [] };
  const userSkills = profileData.skills || [];
  const currentTeach = userSkills.find(s => s.type === 'teach')?.skill_id;
  const currentLearn = userSkills.find(s => s.type === 'learn')?.skill_id;

  // จัดกลุ่มตามหมวด ให้เลือกง่ายกว่ารายการยาวรายการเดียว
  const byCategory = {};
  skills.forEach(s => (byCategory[s.category] ||= []).push(s));
  const options = (selectedId, placeholder) =>
    `<option value="">${placeholder}</option>` +
    Object.entries(byCategory).map(([cat, list]) => `
      <optgroup label="${esc(categoryLabel(cat))}">
        ${list.map(s => `<option value="${s._id}" ${s._id === selectedId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </optgroup>`).join('');

  document.getElementById('profile-teach-skill').innerHTML = options(currentTeach, '— ยังไม่ได้เลือก —');
  document.getElementById('profile-learn-skill').innerHTML = options(currentLearn, '— ยังไม่ได้เลือก —');
}

async function loadProfile() {
  const res = await fetch('/api/profile');
  if (res.status === 401) return;
  const data = await res.json();
  if (data.user) {
    currentUserId = data.user._id;
    document.getElementById('profile-username').textContent = data.user.username;
    document.getElementById('profile-email').textContent = data.user.email;
    document.getElementById('profile-bio').value = data.user.bio || '';
    loadMyReviews(data.user._id);
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
  const teachSkill = document.getElementById('profile-teach-skill').value;
  const learnSkill = document.getElementById('profile-learn-skill').value;
  const res = await fetch('/api/profile/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bio,
      teach_skills: teachSkill ? [teachSkill] : [],
      learn_skills: learnSkill ? [learnSkill] : []
    })
  });
  const data = await res.json();
  if (data.success) {
    closeProfile();
    showToast('✅ บันทึกโปรไฟล์แล้ว');
    updateHero(document.getElementById('profile-username').textContent);
    searchSkills();
  } else {
    const msg = document.getElementById('profile-msg');
    msg.textContent = 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง';
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
  const skillTag = (s) => `
    <span class="skill-pill ${s.type}">${s.type === 'teach' ? 'สอน' : 'อยากเรียน'} · <b>${esc(s.skill_name)}</b></span>`;
  const isMe = user._id === currentUserId;
  body.innerHTML = `
    <div class="profile-head">
      ${avatar(user.username, 'lg')}
      <div>
        <h2>${esc(user.username)}</h2>
        <p class="rating">${ratingHtml(rating.avg, rating.count)}</p>
      </div>
    </div>
    <p class="profile-bio">${esc(user.bio || 'ยังไม่ได้เขียนแนะนำตัว')}</p>
    <div class="skill-list">${skills.map(skillTag).join('') || '<span class="muted">ยังไม่ได้ระบุทักษะ</span>'}</div>
    ${isMe ? '' : `<button class="btn btn-primary btn-block" onclick="sendRequest('${esc(user._id)}')">ขอแลกเปลี่ยน</button>`}
    <hr class="divider" />
    <h3 class="subheading">รีวิว (${reviews.length})</h3>
    ${renderReviews(reviews)}
  `;
}

function closeUserProfile() {
  document.getElementById('modal-user').style.display = 'none';
}

// ===== Search =====
let searchTimer = null;

function currentCategory() {
  return document.querySelector('#category-chips .chip.active')?.dataset.cat || '';
}

async function searchSkills(scrollToResults = false) {
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
        <p class="teaches"><span class="tag">${esc(categoryLabel(user.category))}</span>สอน <b>${esc(user.skill_name)}</b></p>
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
  searchSkills();
});

async function sendRequest(receiverId) {
  const res = await fetch('/api/exchange/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiver_id: receiverId, message: 'สวัสดี อยากแลกเปลี่ยนทักษะกันครับ/ค่ะ' })
  });
  if (res.status === 401) {
    closeUserProfile();
    showModal('login');
    return;
  }
  const data = await res.json();
  if (data.success) showToast('📬 ส่งคำขอแล้ว — ดูสถานะได้ที่ <b>คำขอของฉัน</b>', showDashboard);
  else showToast(esc(data.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'));
}

async function checkSession() {
  const res = await fetch('/api/profile');
  if (res.ok) {
    const data = await res.json();
    if (data.user) {
      currentUserId = data.user._id;
      showLoggedIn(data.user.username);
      document.getElementById('profile-username').textContent = data.user.username;
      document.getElementById('profile-email').textContent = data.user.email;
      document.getElementById('profile-bio').value = data.user.bio || '';
    }
  }
}

// ===== Dashboard (คำขอของฉัน) =====
let dashboardRequests = {};
let dashboardTab = 'received';

const STATUS_LABEL = {
  pending:  (isReceived) => isReceived ? 'รอคุณตอบ' : 'รอตอบรับ',
  accepted: () => 'ยอมรับแล้ว',
  rejected: (isReceived) => isReceived ? 'ปฏิเสธแล้ว' : 'ถูกปฏิเสธ'
};

function renderRequestCard(r, isReceived) {
  const id = esc(r._id);
  const del = `<button class="btn btn-danger btn-sm" onclick="deleteRequest('${id}')">ลบ</button>`;
  let actions;
  if (r.status === 'pending') {
    actions = isReceived ? `
      <button class="btn btn-primary btn-sm" onclick="respondRequest('${id}','accepted')">ยอมรับ</button>
      <button class="btn btn-outline btn-sm" onclick="respondRequest('${id}','rejected')">ปฏิเสธ</button>
    ` : `<span class="spacer"></span>${del}`;
  } else if (r.status === 'accepted') {
    actions = `
      <button class="btn btn-primary btn-sm" onclick="openChat('${id}')">แชท${r.unread ? `<span class="nav-badge">${r.unread}</span>` : ''}</button>
      ${r.reviewed
        ? '<span class="done-note">★ ให้คะแนนแล้ว</span>'
        : `<button class="btn btn-ghost btn-sm" onclick="openRating('${id}')">ให้คะแนน</button>`}
      <span class="spacer"></span>${del}
    `;
  } else {
    actions = `<span class="spacer"></span>${del}`;
  }
  return `
    <div class="request">
      <div class="request-top">
        <div class="person" onclick="showUserProfile('${esc(r.other_user_id)}')">
          ${avatar(r.other_username)}
          <div style="min-width:0">
            <h3>${esc(r.other_username)}</h3>
            <p class="request-msg">${esc(r.message || 'ไม่มีข้อความ')}</p>
          </div>
        </div>
        <span class="status ${r.status}">${STATUS_LABEL[r.status]?.(isReceived) || esc(r.status)}</span>
      </div>
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
  document.getElementById('modal-dashboard').style.display = 'flex';
  const res = await fetch('/api/dashboard');
  const data = await res.json();

  dashboardRequests = {};
  [...data.received, ...data.sent].forEach(r => { dashboardRequests[r._id] = r; });

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
}

async function deleteRequest(requestId) {
  if (!confirm('ลบคำขอนี้?')) return;
  await fetch(`/api/exchange/request/${requestId}`, { method: 'DELETE' });
  showDashboard();
}

// ===== Chat =====
let currentRequestId = null;
let currentUserId = null;
let socket = null;

async function openChat(requestId) {
  currentRequestId = requestId;
  const req = dashboardRequests[requestId];

  if (!currentUserId) {
    const profileRes = await fetch('/api/profile');
    if (profileRes.ok) currentUserId = (await profileRes.json()).user?._id;
  }

  const name = req?.other_username || '';
  document.getElementById('chat-title').innerHTML = `${avatar(name)}<h3>${esc(name)}</h3>`;
  const rateBtn = document.getElementById('chat-rate-btn');
  rateBtn.hidden = !req || req.reviewed;
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
  div.innerHTML = `
    ${isMine ? '' : `<span class="msg-name">${esc(msg.sender_name)}</span>`}
    <div class="msg-bubble">${esc(msg.text)}</div>
  `;
  container.appendChild(div);
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
  showDashboard();
}

// ===== Hero หลัง login =====
async function updateHero(username) {
  const res = await fetch('/api/profile');
  if (!res.ok) return;
  const data = await res.json();
  const teach = data.skills?.find(s => s.type === 'teach');
  const learn = data.skills?.find(s => s.type === 'learn');

  const pill = (skill, type, label, addText) => skill
    ? `<span class="skill-pill ${type}">${label} · <b>${esc(skill.skill_name)}</b></span>`
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

checkSession();
searchSkills();
