// ป้องกัน XSS: escape ข้อความจากผู้ใช้ก่อนใส่ลง innerHTML
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const CATEGORY_TH = { IT: 'ไอที', Language: 'ภาษา', Art: 'ศิลปะ', Music: 'ดนตรี', Other: 'อื่น ๆ' };
const categoryLabel = (c) => CATEGORY_TH[c] || c;

// วงกลมตัวอักษรแรกของชื่อ แทนรูปโปรไฟล์
function avatar(name, size = '', attrs = '') {
  const first = [...String(name || '?')][0].toUpperCase();
  return `<div class="avatar ${size}" ${attrs}>${esc(first)}</div>`;
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
  currentUsername = username;
  updateHero(username);
  ensureSocket();
  refreshBadge();
  renderComposer();
  // ฟีดที่โหลดไว้ตอนยังไม่ login ไม่รู้ว่าเรากดถูกใจอะไร/โพสต์ไหนเป็นของเรา
  if (feedLoaded) loadFeed(true);
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
  message:  (n) => `💬 <b>${esc(n.from)}</b><small>${esc(n.preview)}</small>`,
  like:     (n) => `❤️ <b>${esc(n.from)}</b> ถูกใจโพสต์ของคุณ`,
  comment:  (n) => `💬 <b>${esc(n.from)}</b> แสดงความคิดเห็นในโพสต์ของคุณ<small>${esc(n.preview)}</small>`
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
  if (n.type === 'like' || n.type === 'comment') bumpPostCount(n);
  if (n.type === 'message' && isChatOpen(n.request_id)) {
    // กำลังเปิดแชทนี้อยู่ ข้อความขึ้นในหน้าต่างแล้ว แค่บันทึกว่าอ่านแล้ว
    await markChatRead(n.request_id);
  } else {
    const onClick = n.type === 'message'
      ? async () => { await showDashboard(); openChat(n.request_id); }
      : (n.type === 'like' || n.type === 'comment')
        ? () => goToPost(n.post_id)
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
  socket.on('feed:new', onFeedNew);
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
    <div id="user-recent-posts"></div>
    <hr class="divider" />
    <h3 class="subheading">รีวิว (${reviews.length})</h3>
    ${renderReviews(reviews)}
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
  return `
    <article class="post" id="post-${esc(p._id)}" data-id="${esc(p._id)}">
      ${avatar(p.author_name, '', user)}
      <div class="post-body">
        <div class="post-meta">
          <span class="post-author" ${user}>${esc(p.author_name)}</span>
          <span>·</span>${timeTag(p.created_at)}
          ${p.mine ? '<button class="btn btn-danger" data-action="delete-post">ลบ</button>' : ''}
        </div>
        <div class="post-text">${formatPostText(p.text)}</div>
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
          ${c.mine ? '<button class="btn btn-danger" data-action="delete-comment">ลบ</button>' : ''}
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

function setLike(btn, liked, count) {
  btn.classList.toggle('on', liked);
  btn.setAttribute('aria-pressed', liked);
  btn.querySelector('.n').textContent = count || '';
}

async function toggleLike(postEl) {
  if (!currentUsername) return showModal('login');
  const btn = postEl.querySelector('[data-action="like"]');
  const wasLiked = btn.classList.contains('on');
  const count = parseInt(btn.querySelector('.n').textContent || '0');
  setLike(btn, !wasLiked, count + (wasLiked ? -1 : 1)); // แสดงผลทันที ไม่รอ server
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

// มีคนถูกใจ/แสดงความคิดเห็นในโพสต์ของเรา → อัปเดตตัวเลขบนโพสต์ที่แสดงอยู่ทันที
function bumpPostCount(n) {
  const postEl = document.getElementById('post-' + n.post_id);
  if (!postEl) return;
  const counter = postEl.querySelector(`[data-action="${n.type === 'like' ? 'like' : 'comments'}"] .n`);
  counter.textContent = (n.type === 'like' ? n.like_count : n.comment_count) || '';
  const box = postEl.querySelector('.comments');
  if (n.type === 'comment' && !box.hidden) { box.hidden = true; toggleComments(postEl, false); }
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

// ===== สลับหน้า: หน้าแรก ↔ ชุมชน (ใช้ #community ใน URL จะได้กด back/แชร์ลิงก์ได้) =====
function route() {
  const view = location.hash.startsWith('#community') ? 'community' : 'home';
  const changed = view !== currentView;
  currentView = view;
  document.getElementById('view-home').hidden = view !== 'home';
  document.getElementById('view-community').hidden = view !== 'community';
  document.querySelectorAll('#nav-links a[data-view="community"]').forEach(a => a.classList.toggle('active', view === 'community'));
  if (view === 'community') {
    if (changed || !feedLoaded) {
      renderComposer();
      window.scrollTo({ top: 0, behavior: 'instant' });
      loadFeed(true);
    }
  } else if (changed) {
    // ลิงก์อย่าง #search ถูกกดตอนหน้าแรกยังซ่อนอยู่ เลยต้องเลื่อนเอง
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: 'instant' }); else window.scrollTo({ top: 0, behavior: 'instant' });
  }
}
window.addEventListener('hashchange', route);

checkSession();
searchSkills();
route();
