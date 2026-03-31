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
    document.getElementById('btn-login-nav').style.display = 'none';
    document.getElementById('btn-logout').style.display = 'inline';
    document.getElementById('nav-dashboard').style.display = 'inline';
  } else {
    document.getElementById('login-error').textContent = data.error;
  }
}

async function register() {
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password })
  });
  const data = await res.json();
  if (data.success) {
    closeModal();
    alert('สมัครสมาชิกสำเร็จ! ยินดีต้อนรับสู่ KnowBridge 🌉');
    document.getElementById('btn-login-nav').style.display = 'none';
    document.getElementById('btn-logout').style.display = 'inline';
  } else {
    document.getElementById('reg-error').textContent = data.error;
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
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
    container.innerHTML = '<p style="color:#64748B;margin-top:1rem">ไม่พบผู้ใช้ที่ตรงกัน ลองค้นหาใหม่อีกครั้ง</p>';
    return;
  }
  container.innerHTML = results.map(user => `
    <div class="card">
      <span class="badge">${user.category}</span>
      <h3>👤 ${user.username}</h3>
      <p><strong>สอน:</strong> ${user.skill_name}</p>
      <p style="margin-top:0.5rem">${user.bio || 'ยังไม่มีคำอธิบาย'}</p>
      <button class="btn-primary" style="margin-top:1rem;width:100%" onclick="sendRequest(${user.id})">
        ขอแลกเปลี่ยน
      </button>
    </div>
  `).join('');
}

async function sendRequest(receiverId) {
  alert(`ส่งคำขอไปหาผู้ใช้เรียบร้อยแล้ว! 🎉`);
}

// โหลดผลค้นหาตอนเปิดหน้า
searchSkills();