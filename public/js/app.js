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
    teachSel.innerHTML += `<option value="${s._id}" ${isTeach}>[${s.category}] ${s.name}</option>`;
    learnSel.innerHTML += `<option value="${s._id}" ${isLearn}>[${s.category}] ${s.name}</option>`;
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
  }
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
      <span class="badge">${user.category}</span>
      <h3>👤 ${user.username}</h3>
      <p><strong>สอน:</strong> ${user.skill_name}</p>
      <p style="margin-top:0.5rem">${user.bio || 'ยังไม่มีคำอธิบาย'}</p>
      <button class="btn-gold" style="margin-top:1rem;width:100%" onclick="sendRequest('${user.id}')">
        ขอแลกเปลี่ยน
      </button>
    </div>
  `).join('');
}

async function sendRequest(receiverId) {
  const res = await fetch('/api/exchange/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiver_id: receiverId, message: 'สวัสดี อยากแลกเปลี่ยนทักษะกันครับ/ค่ะ' })
  });
  const data = await res.json();
  if (data.success) alert('ส่งคำขอเรียบร้อยแล้ว! 🎉 ดูสถานะได้ที่ Dashboard');
  else alert('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
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
async function showDashboard() {
  document.getElementById('modal-dashboard').style.display = 'flex';
  const res = await fetch('/api/dashboard');
  const data = await res.json();

  const receivedEl = document.getElementById('dashboard-received');
  const sentEl = document.getElementById('dashboard-sent');

  if (data.received.length === 0) {
    receivedEl.innerHTML = '<p style="color:#64748B;font-size:0.88rem">ยังไม่มีคำขอ</p>';
  } else {
    receivedEl.innerHTML = data.received.map(r => `
      <div style="background:#F4F6F9;border-radius:12px;padding:1rem;margin-bottom:0.75rem">
        <p style="font-weight:700;color:#0B1628">👤 ${r.other_username}</p>
        <p style="font-size:0.85rem;color:#64748B;margin:0.25rem 0">${r.message || 'ไม่มีข้อความ'}</p>
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:center;flex-wrap:wrap">
          ${r.status === 'pending' ? `
            <button class="btn-gold" style="padding:0.4rem 1rem;font-size:0.85rem" onclick="respondRequest('${r._id}','accepted')">✅ ยอมรับ</button>
            <button class="btn-outline" style="padding:0.4rem 1rem;font-size:0.85rem" onclick="respondRequest('${r._id}','rejected')">❌ ปฏิเสธ</button>
          ` : r.status === 'accepted' ? `
            <span style="color:#10B981;font-weight:600;font-size:0.85rem">✅ ยอมรับแล้ว</span>
            <button class="btn-gold" style="padding:0.4rem 1rem;font-size:0.85rem" onclick="openChat('${r._id}','${r.other_username}')">💬 แชท</button>
            <button class="btn-outline" style="padding:0.3rem 0.75rem;font-size:0.8rem;border-color:#EF4444;color:#EF4444" onclick="deleteRequest('${r._id}')">🗑️ ลบ</button>
          ` : `
            <span style="color:#EF4444;font-weight:600;font-size:0.85rem">❌ ปฏิเสธแล้ว</span>
            <button class="btn-outline" style="padding:0.3rem 0.75rem;font-size:0.8rem;border-color:#EF4444;color:#EF4444" onclick="deleteRequest('${r._id}')">🗑️ ลบ</button>
          `}
        </div>
      </div>
    `).join('');
  }

  if (data.sent.length === 0) {
    sentEl.innerHTML = '<p style="color:#64748B;font-size:0.88rem">ยังไม่ได้ส่งคำขอ</p>';
  } else {
    sentEl.innerHTML = data.sent.map(r => `
      <div style="background:#F4F6F9;border-radius:12px;padding:1rem;margin-bottom:0.75rem">
        <p style="font-weight:700;color:#0B1628">👤 ${r.other_username}</p>
        <p style="font-size:0.85rem;color:#64748B;margin:0.25rem 0">${r.message || 'ไม่มีข้อความ'}</p>
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:center;flex-wrap:wrap">
          ${r.status === 'pending' ? `
            <span style="color:#F59E0B;font-weight:600;font-size:0.85rem">⏳ รอการตอบรับ</span>
            <button class="btn-outline" style="padding:0.3rem 0.75rem;font-size:0.8rem;border-color:#EF4444;color:#EF4444" onclick="deleteRequest('${r._id}')">🗑️ ลบ</button>
          ` : r.status === 'accepted' ? `
            <span style="color:#10B981;font-weight:600;font-size:0.85rem">✅ ยอมรับแล้ว</span>
            <button class="btn-gold" style="padding:0.4rem 1rem;font-size:0.85rem" onclick="openChat('${r._id}','${r.other_username}')">💬 แชท</button>
            <button class="btn-outline" style="padding:0.3rem 0.75rem;font-size:0.8rem;border-color:#EF4444;color:#EF4444" onclick="deleteRequest('${r._id}')">🗑️ ลบ</button>
          ` : `
            <span style="color:#EF4444;font-weight:600;font-size:0.85rem">❌ ถูกปฏิเสธ</span>
            <button class="btn-outline" style="padding:0.3rem 0.75rem;font-size:0.8rem;border-color:#EF4444;color:#EF4444" onclick="deleteRequest('${r._id}')">🗑️ ลบ</button>
          `}
        </div>
      </div>
    `).join('');
  }
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
let currentUsername = null;
let socket = null;

async function openChat(requestId, otherUsername) {
  currentRequestId = requestId;
  document.getElementById('chat-title').textContent = `💬 แชทกับ ${otherUsername}`;
  document.getElementById('modal-chat').style.display = 'flex';
  document.getElementById('modal-dashboard').style.display = 'none';

  const chatInput = document.getElementById('chat-input');
  chatInput.value = '';
  chatInput.disabled = false;
  chatInput.onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  setTimeout(() => chatInput.focus(), 150);

  if (!socket) {
    socket = io();
    socket.on('newMessage', (msg) => appendMessage(msg));
  }

  try {
    const profileRes = await fetch('/api/profile');
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      currentUserId = profileData.user?._id;
      currentUsername = profileData.user?.username;
    }
  } catch (e) {
    console.error('Profile fetch failed:', e);
  }

  if (currentUserId) socket.emit('join', currentUserId);
  socket.emit('joinRoom', requestId);

  try {
    const res = await fetch(`/api/chat/${requestId}`);
    const messages = await res.json();
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    messages.forEach(msg => appendMessage(msg));
  } catch (e) {
    console.error('Chat load failed:', e);
  }
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  const isMine = msg.sender_id === currentUserId || msg.sender_id?.toString() === currentUserId?.toString();
  const div = document.createElement('div');
  div.style.cssText = `display:flex;flex-direction:column;align-items:${isMine ? 'flex-end' : 'flex-start'}`;
  div.innerHTML = `
    <span style="font-size:0.72rem;color:#94A3B8;margin-bottom:0.2rem">${msg.sender_name}</span>
    <div style="background:${isMine ? '#C9A84C' : '#fff'};color:${isMine ? '#0B1628' : '#1E293B'};
      padding:0.6rem 1rem;border-radius:${isMine ? '12px 12px 2px 12px' : '12px 12px 12px 2px'};
      max-width:75%;font-size:0.9rem;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
      ${msg.text}
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !currentRequestId) return;
  socket.emit('sendMessage', {
    requestId: currentRequestId,
    senderId: currentUserId,
    senderName: currentUsername,
    text
  });
  input.value = '';
}

function closeChat() {
  document.getElementById('modal-chat').style.display = 'none';
  document.getElementById('modal-dashboard').style.display = 'flex';
}
async function updateHero(username) {
  // ดึงข้อมูล profile + skills
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
      <span class="gold-text">${username}</span>
    </h1>
    <div style="display:flex;gap:1rem;margin:1.5rem 0;flex-wrap:wrap">
      ${teach ? `<div style="background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:12px;padding:0.85rem 1.25rem">
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);letter-spacing:1px;text-transform:uppercase;margin-bottom:0.3rem">🎓 ฉันสอนได้</div>
        <div style="color:var(--gold-light);font-weight:700;font-size:1rem">${teach.skill_name}</div>
      </div>` : `<div style="background:rgba(255,255,255,0.05);border:1px dashed rgba(201,168,76,0.3);border-radius:12px;padding:0.85rem 1.25rem;cursor:pointer" onclick="showProfile()">
        <div style="color:rgba(255,255,255,0.4);font-size:0.88rem">+ เพิ่มทักษะที่สอนได้</div>
      </div>`}
      ${learn ? `<div style="background:rgba(99,179,237,0.08);border:1px solid rgba(99,179,237,0.25);border-radius:12px;padding:0.85rem 1.25rem">
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);letter-spacing:1px;text-transform:uppercase;margin-bottom:0.3rem">📚 ฉันอยากเรียน</div>
        <div style="color:#90CDF4;font-weight:700;font-size:1rem">${learn.skill_name}</div>
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

checkSession();
searchSkills();