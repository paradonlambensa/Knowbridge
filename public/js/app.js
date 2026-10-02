// ป้องกัน XSS: escape ข้อความจากผู้ใช้ก่อนใส่ลง innerHTML
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function ratingText(avg, count) {
  return avg ? `⭐ ${avg} (${count} รีวิว)` : '⭐ ยังไม่มีรีวิว';
}

function renderReviews(reviews) {
  if (!reviews.length) return '<p style="color:#64748B;font-size:0.88rem">ยังไม่มีรีวิว</p>';
  return reviews.map(r => `
    <div style="background:#F4F6F9;border-radius:12px;padding:0.85rem 1rem;margin-bottom:0.6rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;color:#0B1628;font-size:0.9rem">👤 ${esc(r.reviewer_name)}</span>
        <span style="color:#F59E0B;font-size:0.85rem">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
      </div>
      ${r.comment ? `<p style="color:#475569;font-size:0.88rem;margin-top:0.35rem">${esc(r.comment)}</p>` : ''}
      <p style="color:#94A3B8;font-size:0.72rem;margin-top:0.35rem">${new Date(r.created_at).toLocaleDateString('th-TH')}</p>
    </div>
  `).join('');
}

function showModal(type) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal-login').style.display = type === 'login' ? 'block' : 'none';
  document.getElementById('modal-register').style.display = type === 'register' ? 'block' : 'none';
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
  document.getElementById('btn-logout').style.display = 'inline';
  document.getElementById('nav-dashboard').style.display = 'inline';
  document.getElementById('nav-profile').style.display = 'inline';
  updateHero(username);
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
}

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

  const teachSel = document.getElementById('profile-teach-skill');
  const learnSel = document.getElementById('profile-learn-skill');
  teachSel.innerHTML = '<option value="">เลือกทักษะที่คุณสอนได้</option>';
  learnSel.innerHTML = '<option value="">เลือกทักษะที่คุณอยากเรียน</option>';

  skills.forEach(s => {
    const isTeach = currentTeach && s._id === currentTeach.toString() ? 'selected' : '';
    const isLearn = currentLearn && s._id === currentLearn.toString() ? 'selected' : '';
    teachSel.innerHTML += `<option value="${s._id}" ${isTeach}>[${esc(s.category)}] ${esc(s.name)}</option>`;
    learnSel.innerHTML += `<option value="${s._id}" ${isLearn}>[${esc(s.category)}] ${esc(s.name)}</option>`;
  });
}

async function loadProfile() {
  const res = await fetch('/api/profile');
  if (res.status === 401) return;
  const data = await res.json();
  if (data.user) {
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
  document.getElementById('profile-rating-summary').textContent = ratingText(data.rating.avg, data.rating.count);
  document.getElementById('profile-reviews').innerHTML = renderReviews(data.reviews);
}

// ===== Public Profile =====
async function showUserProfile(userId) {
  const body = document.getElementById('user-profile-body');
  body.innerHTML = '<p style="color:#64748B">กำลังโหลด...</p>';
  document.getElementById('modal-user').style.display = 'flex';
  const res = await fetch(`/api/user/${userId}/profile`);
  if (!res.ok) {
    body.innerHTML = '<p style="color:#EF4444">ไม่พบผู้ใช้</p>';
    return;
  }
  const { user, skills, rating, reviews } = await res.json();
  const skillTag = (s) => `
    <span style="display:inline-block;padding:0.3rem 0.75rem;border-radius:999px;font-size:0.8rem;margin:0 0.35rem 0.35rem 0;
      background:${s.type === 'teach' ? '#FBF3DD' : '#E6F2FB'};color:${s.type === 'teach' ? '#8A6D1F' : '#1E5A85'}">
      ${s.type === 'teach' ? '🎓 สอน' : '📚 อยากเรียน'} ${esc(s.skill_name)}
    </span>`;
  body.innerHTML = `
    <h2>👤 ${esc(user.username)}</h2>
    <p style="color:#F59E0B;font-size:0.95rem;margin-bottom:0.75rem">${ratingText(rating.avg, rating.count)}</p>
    <p style="color:#475569;margin-bottom:1rem">${esc(user.bio || 'ยังไม่มีคำอธิบาย')}</p>
    <div style="margin-bottom:1rem">${skills.map(skillTag).join('') || '<span style="color:#94A3B8;font-size:0.85rem">ยังไม่ได้ระบุทักษะ</span>'}</div>
    <button class="btn-gold" style="width:100%;margin-bottom:1.25rem" onclick="sendRequest('${esc(user._id)}')">ขอแลกเปลี่ยน</button>
    <h3 style="font-size:1rem;font-weight:700;color:#0B1628;margin-bottom:0.75rem">รีวิว (${reviews.length})</h3>
    ${renderReviews(reviews)}
  `;
}

function closeUserProfile() {
  document.getElementById('modal-user').style.display = 'none';
}

async function showProfile() {
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
    document.getElementById('profile-msg').textContent = '✅ บันทึกสำเร็จ!';
    setTimeout(() => document.getElementById('profile-msg').textContent = '', 2000);
    closeProfile();
    searchSkills();
  }
}

async function searchSkills() {
  const skill = document.getElementById('search-input').value;
  const category = document.getElementById('category-filter').value;
  const params = new URLSearchParams();
  if (skill) params.append('skill', skill);
  if (category) params.append('category', category);
  const res = await fetch(`/api/search?${params}`);
  const results = await res.json();
  const container = document.getElementById('search-results');
  if (results.length === 0) {
    container.innerHTML = '<p style="color:#64748B;margin-top:1rem">ไม่พบผู้ใช้ที่ตรงกัน</p>';
    return;
  }
  container.innerHTML = results.map(user => `
    <div class="card">
      <span class="badge">${esc(user.category)}</span>
      <h3 style="cursor:pointer" onclick="showUserProfile('${esc(user.id)}')" title="ดูโปรไฟล์และรีวิว">👤 ${esc(user.username)}</h3>
      <p style="color:#F59E0B;font-size:0.85rem;margin:0.25rem 0">${ratingText(user.avg_rating, user.review_count)}</p>
      <p><strong>สอน:</strong> ${esc(user.skill_name)}</p>
      <p style="margin-top:0.5rem">${esc(user.bio || 'ยังไม่มีคำอธิบาย')}</p>
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-outline" style="flex:1;padding:0.6rem 0.5rem;white-space:nowrap" onclick="showUserProfile('${esc(user.id)}')">ดูโปรไฟล์</button>
        <button class="btn-gold" style="flex:1;padding:0.6rem 0.5rem;font-size:0.9rem;white-space:nowrap" onclick="sendRequest('${esc(user.id)}')">ขอแลกเปลี่ยน</button>
      </div>
    </div>
  `).join('');
}

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
  if (data.success) alert('ส่งคำขอเรียบร้อยแล้ว! 🎉 ดูสถานะได้ที่ Dashboard');
  else alert(data.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
}

async function checkSession() {
  const res = await fetch('/api/profile');
  if (res.ok) {
    const data = await res.json();
    if (data.user) {
      showLoggedIn(data.user.username);
      document.getElementById('profile-username').textContent = data.user.username;
      document.getElementById('profile-email').textContent = data.user.email;
      document.getElementById('profile-bio').value = data.user.bio || '';
      updateHero(data.user.username);
    }
  }
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    const overlay = document.getElementById('modal-overlay');
    const loginModal = document.getElementById('modal-login');
    const registerModal = document.getElementById('modal-register');
    if (overlay && overlay.style.display !== 'none') {
      if (loginModal && loginModal.style.display !== 'none') {
        login();
      } else if (registerModal && registerModal.style.display !== 'none') {
        register();
      }
    }
  }
});

// ===== Dashboard =====
let dashboardRequests = {};

const BTN_DELETE = (id) => `<button class="btn-outline" style="padding:0.3rem 0.75rem;font-size:0.8rem;border-color:#EF4444;color:#EF4444" onclick="deleteRequest('${id}')">🗑️ ลบ</button>`;

function renderRequestCard(r, isReceived) {
  const id = esc(r._id);
  let actions;
  if (r.status === 'pending') {
    actions = isReceived ? `
      <button class="btn-gold" style="padding:0.4rem 1rem;font-size:0.85rem" onclick="respondRequest('${id}','accepted')">✅ ยอมรับ</button>
      <button class="btn-outline" style="padding:0.4rem 1rem;font-size:0.85rem" onclick="respondRequest('${id}','rejected')">❌ ปฏิเสธ</button>
    ` : `
      <span style="color:#F59E0B;font-weight:600;font-size:0.85rem">⏳ รอการตอบรับ</span>
      ${BTN_DELETE(id)}
    `;
  } else if (r.status === 'accepted') {
    actions = `
      <span style="color:#10B981;font-weight:600;font-size:0.85rem">✅ ยอมรับแล้ว</span>
      <button class="btn-gold" style="padding:0.4rem 1rem;font-size:0.85rem" onclick="openChat('${id}')">💬 แชท</button>
      ${r.reviewed
        ? '<span style="color:#94A3B8;font-size:0.8rem">⭐ รีวิวแล้ว</span>'
        : `<button class="btn-outline" style="padding:0.3rem 0.75rem;font-size:0.8rem" onclick="openRating('${id}')">⭐ ให้คะแนน</button>`}
      ${BTN_DELETE(id)}
    `;
  } else {
    actions = `
      <span style="color:#EF4444;font-weight:600;font-size:0.85rem">❌ ${isReceived ? 'ปฏิเสธแล้ว' : 'ถูกปฏิเสธ'}</span>
      ${BTN_DELETE(id)}
    `;
  }
  return `
    <div style="background:#F4F6F9;border-radius:12px;padding:1rem;margin-bottom:0.75rem">
      <p style="font-weight:700;color:#0B1628;cursor:pointer" onclick="showUserProfile('${esc(r.other_user_id)}')">👤 ${esc(r.other_username)}</p>
      <p style="font-size:0.85rem;color:#64748B;margin:0.25rem 0">${esc(r.message || 'ไม่มีข้อความ')}</p>
      <div style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:center;flex-wrap:wrap">${actions}</div>
    </div>
  `;
}

async function showDashboard() {
  document.getElementById('modal-dashboard').style.display = 'flex';
  const res = await fetch('/api/dashboard');
  const data = await res.json();

  dashboardRequests = {};
  [...data.received, ...data.sent].forEach(r => { dashboardRequests[r._id] = r; });

  document.getElementById('dashboard-received').innerHTML = data.received.length
    ? data.received.map(r => renderRequestCard(r, true)).join('')
    : '<p style="color:#64748B;font-size:0.88rem">ยังไม่มีคำขอ</p>';
  document.getElementById('dashboard-sent').innerHTML = data.sent.length
    ? data.sent.map(r => renderRequestCard(r, false)).join('')
    : '<p style="color:#64748B;font-size:0.88rem">ยังไม่ได้ส่งคำขอ</p>';
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
  if (!confirm('ลบคำขอนี้ออกจาก Dashboard?')) return;
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

  const title = document.getElementById('chat-title');
  title.innerHTML = `💬 แชทกับ ${esc(req?.other_username || '')}`;
  if (req && !req.reviewed) {
    title.innerHTML += `
      <button class="btn-outline" style="margin-left:1rem;padding:0.3rem 0.75rem;font-size:0.8rem"
        onclick="openRating('${esc(requestId)}')">⭐ ให้คะแนน</button>`;
  }

  document.getElementById('modal-chat').style.display = 'flex';
  document.getElementById('modal-dashboard').style.display = 'none';

  const chatInput = document.getElementById('chat-input');
  chatInput.value = '';
  chatInput.disabled = false;
  chatInput.onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  setTimeout(() => chatInput.focus(), 150);

  if (!socket) {
    socket = io();
    socket.on('newMessage', (msg) => {
      if (msg.request_id === currentRequestId) appendMessage(msg);
    });
  }
  socket.emit('joinRoom', requestId);

  const container = document.getElementById('chat-messages');
  container.innerHTML = '';
  try {
    const res = await fetch(`/api/chat/${requestId}`);
    const messages = await res.json();
    messages.forEach(msg => appendMessage(msg));
  } catch (e) {
    console.error('Chat load failed:', e);
  }
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  const isMine = msg.sender_id?.toString() === currentUserId?.toString();
  const div = document.createElement('div');
  div.style.cssText = `display:flex;flex-direction:column;align-items:${isMine ? 'flex-end' : 'flex-start'}`;
  div.innerHTML = `
    <span style="font-size:0.72rem;color:#94A3B8;margin-bottom:0.2rem">${esc(msg.sender_name)}</span>
    <div style="background:${isMine ? '#C9A84C' : '#fff'};color:${isMine ? '#0B1628' : '#1E293B'};
      padding:0.6rem 1rem;border-radius:${isMine ? '12px 12px 2px 12px' : '12px 12px 12px 2px'};
      max-width:75%;font-size:0.9rem;box-shadow:0 1px 4px rgba(0,0,0,0.08);word-break:break-word">
      ${esc(msg.text)}
    </div>
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
  document.getElementById('modal-dashboard').style.display = 'flex';
}

async function updateHero(username) {
  const res = await fetch('/api/profile');
  if (!res.ok) return;
  const data = await res.json();
  const teach = data.skills?.find(s => s.type === 'teach');
  const learn = data.skills?.find(s => s.type === 'learn');

  const heroContent = document.querySelector('.hero-content');
  if (!heroContent) return;

  heroContent.innerHTML = `
    <p class="hero-sub animate-up">เข้าสู่ระบบสำเร็จ</p>
    <h1 class="animate-up delay-1" style="font-size:2.8rem">
      ยินดีต้อนรับเข้าสู่<br>
      สะพานแห่งการแบ่งปัน<br>
      <span class="gold-text">${esc(username)}</span>
    </h1>
    <div style="display:flex;gap:1rem;margin:1.5rem 0;flex-wrap:wrap">
      ${teach ? `<div style="background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:12px;padding:0.85rem 1.25rem">
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);letter-spacing:1px;text-transform:uppercase;margin-bottom:0.3rem">🎓 ฉันสอนได้</div>
        <div style="color:var(--gold-light);font-weight:700;font-size:1rem">${esc(teach.skill_name)}</div>
      </div>` : `<div style="background:rgba(255,255,255,0.05);border:1px dashed rgba(201,168,76,0.3);border-radius:12px;padding:0.85rem 1.25rem;cursor:pointer" onclick="showProfile()">
        <div style="color:rgba(255,255,255,0.4);font-size:0.88rem">+ เพิ่มทักษะที่สอนได้</div>
      </div>`}
      ${learn ? `<div style="background:rgba(99,179,237,0.08);border:1px solid rgba(99,179,237,0.25);border-radius:12px;padding:0.85rem 1.25rem">
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);letter-spacing:1px;text-transform:uppercase;margin-bottom:0.3rem">📚 ฉันอยากเรียน</div>
        <div style="color:#90CDF4;font-weight:700;font-size:1rem">${esc(learn.skill_name)}</div>
      </div>` : `<div style="background:rgba(255,255,255,0.05);border:1px dashed rgba(99,179,237,0.25);border-radius:12px;padding:0.85rem 1.25rem;cursor:pointer" onclick="showProfile()">
        <div style="color:rgba(255,255,255,0.4);font-size:0.88rem">+ เพิ่มทักษะที่อยากเรียน</div>
      </div>`}
    </div>
    <div class="hero-btns animate-up delay-3">
      <button class="btn-gold" onclick="showDashboard()">📬 Dashboard</button>
      <button class="btn-ghost" onclick="document.getElementById('search').scrollIntoView({behavior:'smooth'})">ค้นหาทักษะ</button>
    </div>
  `;
}

// ===== Rating =====
let currentRating = 0;
let ratingRequestId = null;

function selectStar(val) {
  currentRating = val;
  document.querySelectorAll('.star').forEach(s => {
    s.style.opacity = parseInt(s.dataset.val) <= val ? '1' : '0.3';
  });
}

async function openRating(requestId) {
  const res = await fetch(`/api/review/check/${requestId}`);
  const data = await res.json();
  if (data.reviewed) {
    alert('คุณให้คะแนนการแลกเปลี่ยนนี้ไปแล้ว');
    return;
  }
  ratingRequestId = requestId;
  currentRating = 0;
  document.querySelectorAll('.star').forEach(s => s.style.opacity = '0.3');
  document.getElementById('rating-comment').value = '';
  document.getElementById('rating-msg').textContent = '';
  document.getElementById('modal-rating').style.display = 'flex';
}

function closeRating() {
  document.getElementById('modal-rating').style.display = 'none';
}

async function submitRating() {
  if (!currentRating) {
    document.getElementById('rating-msg').textContent = '⚠️ กรุณาเลือกคะแนนก่อน';
    document.getElementById('rating-msg').style.color = '#EF4444';
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
    document.getElementById('rating-msg').textContent = '✅ ขอบคุณสำหรับคะแนน!';
    document.getElementById('rating-msg').style.color = '#10B981';
    setTimeout(() => {
      closeRating();
      // ปิดปุ่มให้คะแนนใน dashboard/แชท หลังรีวิวสำเร็จ
      if (dashboardRequests[ratingRequestId]) dashboardRequests[ratingRequestId].reviewed = true;
      if (document.getElementById('modal-dashboard').style.display !== "none") showDashboard();
      if (ratingRequestId === currentRequestId) document.getElementById('chat-title').querySelector("button")?.remove();
    }, 1500);
  } else {
    document.getElementById('rating-msg').textContent = '❌ ' + (data.error || 'เกิดข้อผิดพลาด');
    document.getElementById('rating-msg').style.color = '#EF4444';
  }
}

checkSession();
searchSkills();