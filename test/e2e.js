// ทดสอบ flow หลักทั้งหมดกับฐานข้อมูลแยก (ค่าเริ่มต้น knowbridge_test) ไม่แตะข้อมูลเว็บจริง
//   npm test                         → เปิด server ให้เอง แล้วทดสอบ (รวมเทส restart server)
//   BASE_URL=http://... npm test     → ทดสอบกับ server ที่เปิดอยู่แล้ว (ข้ามเทส restart)
// สร้างบัญชีใหม่ทุกครั้งที่รัน จึงรันซ้ำได้โดยไม่ต้องล้างข้อมูล
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.TEST_PORT || 3999;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const TEST_DB = process.env.TEST_DB || 'knowbridge_test';
const ownServer = !process.env.BASE_URL;
const ADMIN_EMAIL = 'admin-e2e@test.local';

const results = [];
const check = (name, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', name, extra]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- server ----------
let server = null;
let serverLog = ''; // อีเมลทดสอบถูกพิมพ์ออก console ของ server (ยังไม่ได้ตั้ง RESEND_API_KEY) — ใช้ดึงลิงก์ยืนยัน
// ปิด rate limit ไว้ก่อน (เทสยิง request เยอะ) — ช่วงท้ายเปิดเพื่อเทสตัวมันเอง
function startServer(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, ['backend/server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT, MONGODB_DB: TEST_DB, RATE_LIMIT: 'off', ADMIN_EMAILS: ADMIN_EMAIL, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    const onData = (d) => {
      log += d;
      serverLog += d;
      if (log.includes('Database ready')) resolve();
      if (log.includes('MongoDB Error')) reject(new Error('เชื่อม MongoDB ไม่ได้:\n' + log));
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', (code) => reject(new Error(`server ปิดตัว (code ${code})\n` + log)));
    setTimeout(() => reject(new Error('server เปิดไม่ขึ้นภายใน 60 วินาที\n' + log)), 60000);
  });
}
function stopServer() {
  return new Promise((resolve) => {
    if (!server || server.exitCode !== null) return resolve();
    server.removeAllListeners('exit');
    server.once('exit', resolve);
    server.kill();
  });
}

// ---------- HTTP ----------
function api(user, p, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user?.cookie) headers.Cookie = user.cookie;
  return fetch(BASE + p, { ...opts, headers });
}
const post = (user, p, body) => api(user, p, { method: 'POST', body: JSON.stringify(body) });
const json = async (resPromise) => (await resPromise).json();

async function loginRaw(email, password) {
  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  // express-session บันทึก session ลง MongoDB เสร็จก่อนส่งไบต์สุดท้าย — อ่านให้จบก่อน
  // ไม่งั้น request ถัดไปที่ยิงทันทีอาจหา session ไม่เจอ
  await r.arrayBuffer();
  return r;
}

async function withProfile(user) {
  user.profile = await json(api(user, '/api/profile'));
  user.id = user.profile.user?._id;
  return user;
}

// บัญชีแอดมินอีเมลตายตัว: รอบแรกสมัครใหม่ รอบต่อไป login
async function adminAccount() {
  let r = await fetch(BASE + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'AdminE2E', email: ADMIN_EMAIL, password: 'test-password', accept_privacy: true })
  });
  if (r.status === 409) r = await loginRaw(ADMIN_EMAIL, 'test-password');
  return withProfile({ username: 'AdminE2E', cookie: r.headers.get('set-cookie')?.split(';')[0] });
}

async function register(name) {
  const email = `${name.toLowerCase()}@test.local`;
  const r = await fetch(BASE + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, email, password: 'test-password', accept_privacy: true })
  });
  const user = { username: name, cookie: r.headers.get('set-cookie')?.split(';')[0], ...(await r.json()) };
  user.profile = await json(api(user, '/api/profile'));
  user.id = user.profile.user?._id;
  return user;
}

// ---------- socket.io v4 ผ่าน WebSocket ดิบ ----------
function sio(user) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket',
      { headers: user?.cookie ? { Cookie: user.cookie } : {} });
    const s = { ws, events: [], closed: false, emit: (...a) => ws.send('42' + JSON.stringify(a)) };
    s.of = (name) => s.events.filter(e => e[0] === name).map(e => e[1]);
    ws.onmessage = (e) => {
      const d = String(e.data);
      if (d[0] === '0') ws.send('40');
      else if (d === '2') ws.send('3');
      else if (d.startsWith('40')) resolve(s);
      else if (d.startsWith('41')) { s.closed = true; resolve(s); }
      else if (d.startsWith('42')) s.events.push(JSON.parse(d.slice(2)));
    };
    ws.onclose = () => { s.closed = true; resolve(s); };
    ws.onerror = reject;
  });
}

async function run() {
  const tag = Date.now().toString(36);
  const A = await register('Alice_' + tag);
  const B = await register('Bob_' + tag);
  const C = await register('Carol_' + tag); // คนนอก
  check('สมัครสมาชิก 3 บัญชี', A.success && B.success && C.success && A.id && B.id && C.id);
  check('/api/profile ไม่ส่ง password hash', A.profile.user && !('password' in A.profile.user));

  // --- กติกาบัญชี ---
  const tryRegister = async (body) => (await fetch(BASE + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })).json();
  const okBody = { username: 'Valid_' + tag, email: `valid_${tag}@test.local`, password: 'good-pass-123', accept_privacy: true };
  check('สมัคร: รหัสผ่านสั้นกว่า 8 ตัวไม่ได้', !(await tryRegister({ ...okBody, password: 'ab12' })).success);
  check('สมัคร: รหัสผ่านเดาง่ายไม่ได้', !(await tryRegister({ ...okBody, password: '12345678' })).success);
  check('สมัคร: อีเมลผิดรูปแบบไม่ได้', !(await tryRegister({ ...okBody, email: 'not-an-email' })).success);
  check('สมัคร: ชื่อผู้ใช้มีช่องว่าง/สั้นเกินไม่ได้', !(await tryRegister({ ...okBody, username: 'a b' })).success);
  check('สมัคร: อีเมลซ้ำแม้ตัวพิมพ์ต่างกันไม่ได้', !(await tryRegister({ ...okBody, email: A.profile.user.email.toUpperCase() })).success);
  check('สมัคร: ชื่อซ้ำแม้ตัวพิมพ์ต่างกันไม่ได้', !(await tryRegister({ ...okBody, username: A.username.toUpperCase() })).success);
  check('login: อีเมลไม่สนตัวพิมพ์เล็ก-ใหญ่', (await loginRaw(A.profile.user.email.toUpperCase(), 'test-password')).ok);
  check('login: รหัสผิดได้ 401', (await loginRaw(A.profile.user.email, 'wrong-password')).status === 401);

  const skills = await json(api(null, '/api/skills'));
  const skillId = (name) => skills.find(s => s.name === name)._id;
  await post(A, '/api/profile/update', { bio: 'A', teach_skills: [skillId('Python Programming'), skillId('JavaScript')], learn_skills: [skillId('English')] });
  await post(B, '/api/profile/update', { bio: '<script>x</script>', teach_skills: [skillId('English')], learn_skills: [skillId('Python Programming')] });

  // --- หลายทักษะ ---
  const pA = await json(api(A, '/api/profile'));
  check('ตั้งทักษะที่สอนได้หลายอย่าง', pA.skills.filter(s => s.type === 'teach').map(s => s.skill_name).sort().join() === 'JavaScript,Python Programming');
  let j0 = await json(post(C, '/api/profile/update', {
    teach_skills: [skillId('Guitar'), skillId('Guitar'), 'not-an-id', '000000000000000000000000'],
    learn_skills: [skillId('Guitar'), skillId('Piano')]
  }));
  const pC = await json(api(C, '/api/profile'));
  check('ตัดทักษะซ้ำ/ไม่มีจริง และสอน+เรียนทักษะเดียวกันไม่ได้',
    j0.success && pC.skills.length === 2 &&
    pC.skills.find(s => s.type === 'teach')?.skill_name === 'Guitar' && pC.skills.find(s => s.type === 'learn')?.skill_name === 'Piano',
    JSON.stringify(pC.skills.map(s => s.type + ':' + s.skill_name)));
  j0 = await json(post(C, '/api/profile/update', { teach_skills: skills.slice(0, 6).map(s => s._id) }));
  check('เลือกเกิน 5 ทักษะต่อประเภทไม่ได้', !j0.success && /5/.test(j0.error), j0.error);
  await post(C, '/api/profile/update', { teach_skills: [], learn_skills: [] });

  // --- ค้นหา ---
  let res = await json(api(A, '/api/search?skill=English'));
  const bCard = res.find(r => r.username === B.username);
  check('ค้นหา English เจอ B พร้อมฟิลด์คะแนน', bCard && bCard.avg_rating === null && bCard.review_count === 0);
  check('ผลค้นหาไม่มีตัวเอง', !res.some(r => r.username === A.username));
  const r = await api(A, '/api/search?skill=' + encodeURIComponent('C++ (*'));
  check('ค้นหาด้วยอักขระพิเศษไม่พัง', r.status === 200 && Array.isArray(await r.json()));
  res = await json(api(B, '/api/search'));
  const aCards = res.filter(x => x.username === A.username);
  check('คนที่สอนหลายทักษะขึ้นการ์ดเดียว พร้อมรายการทักษะ', aCards.length === 1 && aCards[0].skills.length === 2);
  res = await json(api(B, '/api/search?skill=java'));
  check('การ์ดแสดงเฉพาะทักษะที่ตรงคำค้น', res.find(x => x.username === A.username)?.skills.map(s => s.name).join() === 'JavaScript');

  // --- แนะนำคู่ ---
  check('ยังไม่ login ดูคู่แนะนำไม่ได้ (401)', (await api(null, '/api/matches')).status === 401);
  let m = await json(api(A, '/api/matches'));
  let mB = m.matches.find(x => x.id === B.id);
  check('แนะนำคู่: B แลกกับ A ได้พอดีทั้งสองทาง',
    m.has_teach && m.has_learn && mB?.perfect &&
    mB.can_teach_me.map(s => s.name).join() === 'English' &&
    mB.wants_from_me.map(s => s.name).join() === 'Python Programming' && mB.request_status === null,
    JSON.stringify(mB));
  const firstPartial = m.matches.findIndex(x => !x.perfect);
  const lastPerfect = m.matches.map(x => x.perfect).lastIndexOf(true);
  check('คู่ที่พอดีขึ้นก่อนคู่ที่ตรงทางเดียว', firstPartial === -1 || lastPerfect < firstPartial);
  check('ไม่แนะนำตัวเอง', !m.matches.some(x => x.id === A.id));
  const mC = await json(api(C, '/api/matches'));
  check('ยังไม่ตั้งทักษะ: บอกให้ไปตั้งโปรไฟล์', !mC.has_teach && !mC.has_learn && mC.matches.length === 0);

  // --- socket + แจ้งเตือน ---
  const anon = await sio(null);
  await sleep(300);
  check('socket ที่ไม่ได้ login ถูกตัดการเชื่อมต่อ', anon.closed);
  const [sA, sB, sC] = await Promise.all([sio(A), sio(B), sio(C)]);

  // --- คำขอแลกเปลี่ยน ---
  check('ยังไม่ login เข้า dashboard ไม่ได้ (401)', (await api(null, '/api/dashboard')).status === 401);
  let j = await json(post(A, '/api/exchange/request', { receiver_id: B.id, message: 'ขอเรียน English' }));
  check('A ส่งคำขอถึง B', j.success);
  m = await json(api(A, '/api/matches'));
  const mA = (await json(api(B, '/api/matches'))).matches.find(x => x.id === A.id);
  check('แนะนำคู่บอกสถานะคำขอ (ส่งไปแล้ว / เขาส่งมา)',
    m.matches.find(x => x.id === B.id)?.request_status === 'pending_sent' && mA?.request_status === 'pending_received');
  await sleep(500);
  const nReq = sB.of('notify').find(n => n.type === 'request');
  check('B ได้แจ้งเตือนคำขอใหม่แบบเรียลไทม์', nReq?.from === A.username);
  check('คนอื่นไม่ได้แจ้งเตือนนี้', sA.of('notify').length === 0 && sC.of('notify').length === 0);
  let nB = await json(api(B, '/api/notifications'));
  check('badge ของ B: คำขอรอตอบ 1', nB.pending_requests === 1 && nB.unread_messages === 0, JSON.stringify(nB));

  j = await json(post(A, '/api/exchange/request', { receiver_id: B.id }));
  check('ส่งคำขอซ้ำระหว่างรอถูกปฏิเสธ', !j.success, j.error);
  j = await json(post(A, '/api/exchange/request', { receiver_id: A.id }));
  check('ส่งคำขอถึงตัวเองถูกปฏิเสธ', !j.success);

  const req = (await json(api(B, '/api/dashboard'))).received.find(x => x.other_username === A.username);
  check('B เห็นคำขอใน dashboard (pending)', req?.status === 'pending');
  const reqId = req._id;
  check('dashboard ไม่ส่ง last_read ของคนอื่นออกไป', !('last_read' in req));

  await post(A, '/api/exchange/respond', { request_id: reqId, status: 'accepted' });
  let st = (await json(api(B, '/api/dashboard'))).received.find(x => x._id === reqId).status;
  check('ผู้ส่งกดยอมรับคำขอตัวเองไม่ได้', st === 'pending', st);
  j = await json(post(B, '/api/exchange/respond', { request_id: reqId, status: 'hacked' }));
  check('status แปลก ๆ ถูกปฏิเสธ', !j.success);
  j = await json(post(B, '/api/exchange/respond', { request_id: reqId, status: 'accepted' }));
  await sleep(500);
  check('B ยอมรับคำขอ', j.success);
  check('A ได้แจ้งเตือนว่าถูกยอมรับ', sA.of('notify').some(n => n.type === 'accepted' && n.from === B.username));
  m = await json(api(A, '/api/matches'));
  check('แนะนำคู่บอกว่ากำลังแลกเปลี่ยนกันอยู่', m.matches.find(x => x.id === B.id)?.request_status === 'accepted');
  nB = await json(api(B, '/api/notifications'));
  check('badge ของ B: คำขอรอตอบเหลือ 0', nB.pending_requests === 0);

  // --- แชท ---
  check('คนนอกอ่านประวัติแชทไม่ได้ (403)', (await api(C, '/api/chat/' + reqId)).status === 403);
  check('คนนอก mark read ไม่ได้ (403)', (await api(C, `/api/chat/${reqId}/read`, { method: 'POST' })).status === 403);
  [sA, sB, sC].forEach(s => s.emit('joinRoom', reqId));
  await sleep(800);
  sA.emit('sendMessage', { requestId: reqId, text: 'สวัสดี <b>Bob</b>', senderId: C.id, senderName: 'FAKE' });
  sC.emit('sendMessage', { requestId: reqId, text: 'แอบส่งจากคนนอก' });
  await sleep(1500);
  const gotB = sB.of('newMessage');
  check('B ได้รับข้อความแบบเรียลไทม์', gotB.length === 1 && gotB[0].text === 'สวัสดี <b>Bob</b>', JSON.stringify(gotB.map(m => m.text)));
  check('ชื่อ/ID ผู้ส่งมาจาก session ปลอมไม่ได้', gotB[0]?.sender_name === A.username && gotB[0]?.sender_id === A.id);
  check('คนนอกไม่ได้รับข้อความในห้อง', sC.of('newMessage').length === 0);
  const nMsg = sB.of('notify').find(n => n.type === 'message');
  check('B ได้แจ้งเตือนข้อความใหม่พร้อมตัวอย่างข้อความ', nMsg?.request_id === reqId && nMsg?.preview === 'สวัสดี <b>Bob</b>');
  check('ผู้ส่งไม่ได้แจ้งเตือนข้อความของตัวเอง', !sA.of('notify').some(n => n.type === 'message'));

  nB = await json(api(B, '/api/notifications'));
  check('badge ของ B: ข้อความยังไม่อ่าน 1', nB.unread_messages === 1, JSON.stringify(nB));
  const dReq = (await json(api(B, '/api/dashboard'))).received.find(x => x._id === reqId);
  check('dashboard ของ B: ปุ่มแชทมีตัวเลขยังไม่อ่าน 1', dReq.unread === 1);
  const hist = await json(api(B, '/api/chat/' + reqId));
  check('ประวัติแชทบันทึกแค่ข้อความของคู่กรณี', hist.length === 1 && hist[0].sender_name === A.username);
  nB = await json(api(B, '/api/notifications'));
  check('เปิดแชทแล้วข้อความยังไม่อ่านกลับเป็น 0', nB.unread_messages === 0, JSON.stringify(nB));
  const nA = await json(api(A, '/api/notifications'));
  check('ข้อความของตัวเองไม่นับเป็นยังไม่อ่าน', nA.unread_messages === 0);
  [sA, sB, sC].forEach(s => s.ws.close());

  // --- นัดเวลา / แลกเปลี่ยนเสร็จ ---
  const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  check('นัดวันเวลาในอดีตไม่ได้', (await post(A, `/api/exchange/${reqId}/schedule`, { at: '2020-01-01T10:00:00Z' })).status === 400);
  check('คนนอกนัดแทนไม่ได้', (await post(C, `/api/exchange/${reqId}/schedule`, { at: inAnHour })).status === 404);
  j = await json(post(A, `/api/exchange/${reqId}/schedule`, { at: inAnHour, note: 'ห้องสมุดชั้น 2' }));
  const dSched = (await json(api(B, '/api/dashboard'))).received.find(x => x._id === reqId);
  check('A นัดเวลาได้ และ B เห็นนัดใน dashboard',
    j.success && dSched.schedule?.note === 'ห้องสมุดชั้น 2' && new Date(dSched.schedule.at).toISOString() === inAnHour);
  j = await json(post(A, '/api/review', { request_id: reqId, rating: 5 }));
  check('ยังไม่ยืนยันว่าเสร็จ → ให้คะแนนไม่ได้', !j.success && /เสร็จ/.test(j.error), j.error);
  check('คนนอกกดเสร็จแทนไม่ได้', (await post(C, `/api/exchange/${reqId}/complete`, {})).status === 400);
  j = await json(post(A, `/api/exchange/${reqId}/complete`, {}));
  const jAgain = await json(post(A, `/api/exchange/${reqId}/complete`, {}));
  let dA = (await json(api(A, '/api/dashboard'))).sent.find(x => x._id === reqId);
  check('A ยืนยันว่าเสร็จ (กดซ้ำไม่นับเพิ่ม) แต่ยังรอ B',
    j.success && !j.completed && jAgain.success && !jAgain.completed && dA.completed_by_me && !dA.completed_by_other && dA.status === 'accepted');
  j = await json(post(B, `/api/exchange/${reqId}/complete`, {}));
  dA = (await json(api(A, '/api/dashboard'))).sent.find(x => x._id === reqId);
  check('B ยืนยันด้วย → เสร็จสมบูรณ์', j.success && j.completed && dA.status === 'completed');
  check('เสร็จแล้วยังแชทกันได้', (await api(A, '/api/chat/' + reqId)).status === 200);

  // --- กระดิ่งแจ้งเตือน ---
  let nl = await json(api(B, '/api/notifications/list'));
  const types = nl.items.map(n => n.type);
  check('กระดิ่งของ B: มีคำขอใหม่ นัดเรียน และคำขอยืนยันเสร็จ', ['request', 'schedule', 'complete_request'].every(t => types.includes(t)), types.join());
  check('กระดิ่งไม่เก็บข้อความแชท (แชทมีตัวนับของมันเอง)', !types.includes('message'));
  check('badge กระดิ่งตรงกับจำนวนที่ยังไม่อ่าน', nl.unread >= 3 && (await json(api(B, '/api/notifications'))).unread_notifications === nl.unread);
  const firstId = nl.items[0]._id;
  await post(B, `/api/notifications/${firstId}/read`, {});
  let nl2 = await json(api(B, '/api/notifications/list'));
  check('อ่านทีละรายการได้', nl2.unread === nl.unread - 1 && nl2.items.find(n => n._id === firstId).read === true);
  const otherUnread = nl2.items.find(n => !n.read)._id;
  await post(A, `/api/notifications/${otherUnread}/read`, {});
  check('กดอ่านแจ้งเตือนของคนอื่นไม่มีผล', (await json(api(B, '/api/notifications/list'))).unread === nl2.unread);
  await post(B, '/api/notifications/read-all', {});
  check('อ่านทั้งหมดได้', (await json(api(B, '/api/notifications/list'))).unread === 0);
  const nlA = await json(api(A, '/api/notifications/list'));
  check('กระดิ่งของ A: ถูกตอบรับ และแลกเปลี่ยนเสร็จสมบูรณ์', nlA.items.some(n => n.type === 'accepted') && nlA.items.some(n => n.type === 'completed'));

  // --- รีวิว ---
  check('ก่อนรีวิว check = false', !(await json(api(A, '/api/review/check/' + reqId))).reviewed);
  j = await json(post(A, '/api/review', { request_id: reqId, rating: 7 }));
  check('คะแนน 7 ถูกปฏิเสธ', !j.success, j.error);
  j = await json(post(A, '/api/review', { request_id: reqId, rating: 5, comment: 'สอนดีมาก', reviewee_id: C.id }));
  check('A รีวิว 5 ดาว', j.success);
  j = await json(post(A, '/api/review', { request_id: reqId, rating: 1 }));
  check('รีวิวซ้ำไม่ได้', !j.success, j.error);
  j = await json(post(C, '/api/review', { request_id: reqId, rating: 1 }));
  check('คนนอกรีวิวคำขอของคนอื่นไม่ได้', !j.success, j.error);
  const sentA = (await json(api(A, '/api/dashboard'))).sent.find(x => x._id === reqId);
  check('dashboard ของ A ขึ้นว่ารีวิวแล้ว', sentA?.reviewed === true);

  const pB = await json(api(null, `/api/user/${B.id}/profile`));
  check('คะแนนไปที่ B ไม่ใช่ reviewee_id ปลอม', pB.rating.avg === 5 && pB.rating.count === 1);
  check('C ไม่ได้คะแนน', (await json(api(null, `/api/user/${C.id}/rating`))).count === 0);
  check('โปรไฟล์สาธารณะมีรีวิวพร้อมชื่อผู้รีวิว', pB.reviews[0]?.reviewer_name === A.username);
  check('โปรไฟล์สาธารณะไม่เปิดเผย email/password', !('email' in pB.user) && !('password' in pB.user));
  res = await json(api(C, '/api/search?skill=English'));
  check('ผลค้นหาแสดงคะแนนใหม่', res.find(x => x.username === B.username)?.avg_rating === 5);

  // --- ชุมชน (ฟีด) ---
  const [fA, fB] = await Promise.all([sio(A), sio(B)]);
  const feedTag = 'feed' + tag; // แท็กไม่ซ้ำกันในแต่ละรอบ
  check('โพสต์ว่างไม่ได้', (await post(A, '/api/posts', { text: '   ' })).status === 400);
  check('โพสต์เกิน 500 ตัวอักษรไม่ได้', (await post(A, '/api/posts', { text: 'ก'.repeat(501) })).status === 400);
  check('ยังไม่ login โพสต์ไม่ได้ (401)', (await post(null, '/api/posts', { text: 'hi' })).status === 401);
  j = await json(post(A, '/api/posts', { text: `แชร์เทคนิค #${feedTag} และ #Python <b>x</b> https://x.com/a#frag` }));
  check('A โพสต์ได้ พร้อมดึงแท็ก (ไม่นับ #frag ในลิงก์)', j.success && JSON.stringify(j.post.tags) === JSON.stringify([feedTag, 'python']) && j.post.mine, JSON.stringify(j.post?.tags));
  const postId = j.post._id;
  await sleep(500);
  check('คนอื่นได้ feed:new แบบเรียลไทม์', fB.of('feed:new').some(e => e.post_id === postId && e.author_id === A.id));

  let feed = await json(api(null, '/api/posts?tag=' + feedTag));
  check('คนที่ไม่ได้ login อ่านฟีดได้ และกรองตามแท็กได้', feed.posts.length === 1 && feed.posts[0]._id === postId && feed.posts[0].author_name === A.username);
  check('ข้อความเก็บตามจริง (escape ตอนแสดงผลฝั่ง client)', feed.posts[0].text.includes('<b>x</b>'));
  check('ฟีดไม่ส่งรายชื่อคนกดถูกใจออกไป', !('likes' in feed.posts[0]));

  j = await json(post(B, `/api/posts/${postId}/like`, {}));
  await sleep(400);
  check('B กดถูกใจ', j.success && j.liked && j.like_count === 1);
  check('A ได้แจ้งเตือนถูกใจ', fA.of('notify').some(n => n.type === 'like' && n.from === B.username && n.post_id === postId));
  feed = await json(api(B, '/api/posts?tag=' + feedTag));
  check('ฟีดของ B บอกว่ากดถูกใจแล้ว', feed.posts[0].liked === true && feed.posts[0].like_count === 1 && !feed.posts[0].mine);
  j = await json(post(B, `/api/posts/${postId}/like`, {}));
  check('กดซ้ำ = ยกเลิกถูกใจ', j.success && !j.liked && j.like_count === 0);
  j = await json(post(A, `/api/posts/${postId}/like`, {}));
  await sleep(300);
  check('ถูกใจโพสต์ตัวเองไม่แจ้งเตือนหาตัวเอง', j.liked && fA.of('notify').filter(n => n.type === 'like').length === 1);
  await post(B, `/api/posts/${postId}/like`, {});
  await post(C, `/api/posts/${postId}/like`, {});
  await sleep(300);
  const likeNotis = (await json(api(A, '/api/notifications/list'))).items.filter(n => n.type === 'like' && n.post_id === postId);
  check('หลายคนถูกใจโพสต์เดียวกัน → รวมเป็นแจ้งเตือนเดียว', likeNotis.length === 1 && likeNotis[0].count === 3 && likeNotis[0].from === C.username,
    JSON.stringify(likeNotis.map(n => [n.count, n.from])));

  check('ความคิดเห็นว่างไม่ได้', (await post(B, `/api/posts/${postId}/comments`, { text: '' })).status === 400);
  j = await json(post(B, `/api/posts/${postId}/comments`, { text: 'ขอบคุณครับ' }));
  await sleep(400);
  check('B แสดงความคิดเห็น', j.success && j.comment_count === 1 && j.comment.mine);
  const commentId = j.comment._id;
  check('A ได้แจ้งเตือนความคิดเห็น', fA.of('notify').some(n => n.type === 'comment' && n.preview === 'ขอบคุณครับ'));
  let comments = await json(api(null, `/api/posts/${postId}/comments`));
  check('อ่านความคิดเห็นได้ พร้อมชื่อผู้เขียน', comments.length === 1 && comments[0].author_name === B.username && !comments[0].mine);
  check('A ลบความคิดเห็นของ B ไม่ได้ (403)', (await api(A, `/api/comments/${commentId}`, { method: 'DELETE' })).status === 403);
  j = await json(api(B, `/api/comments/${commentId}`, { method: 'DELETE' }));
  check('B ลบความคิดเห็นตัวเองได้ และนับใหม่', j.success && j.comment_count === 0);
  await post(C, `/api/posts/${postId}/comments`, { text: 'ความคิดเห็นที่ต้องหายไปพร้อมโพสต์' });

  for (let i = 0; i < 3; i++) await post(B, '/api/posts', { text: `หน้า ${i} #${feedTag}` });
  const p1 = await json(api(null, `/api/posts?tag=${feedTag}&limit=2`));
  const p2 = await json(api(null, `/api/posts?tag=${feedTag}&limit=2&before=${p1.next}`));
  const ids = [...p1.posts, ...p2.posts].map(p => p._id);
  check('ฟีดแบ่งหน้าได้ ใหม่สุดก่อน ไม่ซ้ำ',
    p1.posts.length === 2 && p1.next && p2.posts.length === 2 && p2.next === null &&
    new Set(ids).size === 4 && p1.posts[0].text.startsWith('หน้า 2') && ids[3] === postId);
  const trending = await json(api(null, '/api/posts/trending-tags'));
  check('แท็กยอดนิยมเรียงจากมากไปน้อย', Array.isArray(trending) && trending.length > 0 &&
    trending.every((t, i) => t.tag && t.count >= (trending[i + 1]?.count ?? 0)));
  const byA = await json(api(null, `/api/posts?author=${A.id}`));
  check('ดูโพสต์ของผู้ใช้คนเดียวได้ (ใช้ในโปรไฟล์)', byA.posts.length >= 1 && byA.posts.every(p => p.author_id === A.id));

  check('B ลบโพสต์ของ A ไม่ได้ (403)', (await api(B, `/api/posts/${postId}`, { method: 'DELETE' })).status === 403);
  j = await json(api(A, `/api/posts/${postId}`, { method: 'DELETE' }));
  comments = await json(api(null, `/api/posts/${postId}/comments`));
  check('A ลบโพสต์ตัวเองได้ ความคิดเห็นถูกลบตามไปด้วย', j.success && comments.length === 0);
  fA.ws.close(); fB.ws.close();

  // --- รายงาน / บล็อก / แอดมิน ---
  const D = await register('Dan_' + tag);
  const admin = await adminAccount();
  const hasAdmin = admin.profile.is_admin === true;
  if (ownServer) check('บัญชีที่อยู่ใน ADMIN_EMAILS เป็นแอดมิน', hasAdmin);
  check('คนทั่วไปเข้า API แอดมินไม่ได้ (403)', (await api(A, '/api/admin/reports')).status === 403);

  j = await json(post(A, '/api/posts', { text: `โพสต์ทดสอบรายงาน #${feedTag}` }));
  const badPostId = j.post._id;
  check('รายงานของตัวเองไม่ได้', (await post(A, '/api/reports', { type: 'post', target_id: badPostId, reason: 'spam' })).status === 400);
  check('เหตุผลรายงานต้องอยู่ในรายการ', (await post(B, '/api/reports', { type: 'post', target_id: badPostId, reason: 'xxx' })).status === 400);
  j = await json(post(B, '/api/reports', { type: 'post', target_id: badPostId, reason: 'spam' }));
  const again = await json(post(B, '/api/reports', { type: 'post', target_id: badPostId, reason: 'spam' }));
  check('รายงานได้ และรายงานซ้ำไม่นับเพิ่ม', j.success && !j.already && again.already);
  await post(C, '/api/reports', { type: 'post', target_id: badPostId, reason: 'inappropriate' });
  const inFeed = async (user, id) => (await json(api(user, `/api/posts?tag=${feedTag}`))).posts.find(p => p._id === id);
  check('รายงาน 2 คนยังไม่ซ่อน', !!(await inFeed(null, badPostId)));
  await post(D, '/api/reports', { type: 'post', target_id: badPostId, reason: 'spam', detail: 'ขายของ' });
  check('รายงานครบ 3 คน → ซ่อนจากฟีด (เจ้าของยังเห็นพร้อมสถานะ)',
    !(await inFeed(null, badPostId)) && (await inFeed(A, badPostId))?.hidden === true);
  if (hasAdmin) {
    let reports = await json(api(admin, '/api/admin/reports'));
    const item = reports.find(x => x.type === 'post' && x.target_id === badPostId);
    check('แอดมินเห็นรายงานรวมเป็นรายการเดียว พร้อมเหตุผล',
      item?.count === 3 && item.reasons['สแปม / โฆษณา'] === 2 && item.owner?.username === A.username && item.details.includes('ขายของ'),
      JSON.stringify(item));
    check('แอดมินเห็นโพสต์ที่ถูกซ่อน', !!(await inFeed(admin, badPostId)));
    j = await json(post(admin, '/api/admin/reports/resolve', { type: 'post', target_id: badPostId, action: 'dismiss' }));
    reports = await json(api(admin, '/api/admin/reports'));
    check('แอดมินกด "ไม่ผิด" → โพสต์กลับมา รายงานปิด',
      j.success && !!(await inFeed(null, badPostId)) && !reports.some(x => x.target_id === badPostId));
    await post(B, '/api/reports', { type: 'post', target_id: badPostId, reason: 'spam' });
    j = await json(post(admin, '/api/admin/reports/resolve', { type: 'post', target_id: badPostId, action: 'remove' }));
    check('แอดมินลบโพสต์ที่ถูกรายงานได้', j.success && !(await inFeed(A, badPostId)));
  }

  j = await json(post(A, '/api/posts', { text: `โพสต์จาก A #${feedTag}` }));
  const aPostId = j.post._id;
  j = await json(post(B, `/api/blocks/${A.id}`, {}));
  check('B บล็อก A', j.success && j.blocked);
  check('บล็อกแล้ว: ไม่เห็นโพสต์ของอีกฝ่าย', !(await json(api(B, `/api/posts?tag=${feedTag}`))).posts.some(p => p.author_id === A.id));
  check('บล็อกแล้ว: อีกฝ่ายก็ไม่เห็นโพสต์เรา', !(await json(api(A, `/api/posts?tag=${feedTag}`))).posts.some(p => p.author_id === B.id));
  check('บล็อกแล้ว: ส่งคำขอหากันไม่ได้', (await post(A, '/api/exchange/request', { receiver_id: B.id })).status === 403);
  check('บล็อกแล้ว: แสดงความคิดเห็นในโพสต์ของอีกฝ่ายไม่ได้', (await post(B, `/api/posts/${aPostId}/comments`, { text: 'hi' })).status === 403);
  check('บล็อกแล้ว: ไม่ขึ้นในผลค้นหา', !(await json(api(B, '/api/search'))).some(x => x.username === A.username));
  check('บล็อกแล้ว: ไม่ขึ้นในคู่แนะนำ', !(await json(api(B, '/api/matches'))).matches.some(x => x.id === A.id));
  check('บล็อกแล้ว: คนถูกบล็อกเปิดโปรไฟล์คนบล็อกไม่ได้', (await api(A, `/api/user/${B.id}/profile`)).status === 404);
  check('คนบล็อกยังเปิดโปรไฟล์ได้ พร้อมสถานะบล็อก', (await json(api(B, `/api/user/${A.id}/profile`))).user?.blocked_by_me === true);
  check('รายการผู้ใช้ที่บล็อก', (await json(api(B, '/api/blocks'))).some(u => u.id === A.id));
  const [bA, bB] = await Promise.all([sio(A), sio(B)]);
  [bA, bB].forEach(x => x.emit('joinRoom', reqId));
  await sleep(600);
  bB.emit('sendMessage', { requestId: reqId, text: 'ข้อความหลังบล็อก' });
  await sleep(800);
  check('บล็อกแล้ว: แชทหากันไม่ได้', bB.of('chatError').length === 1 && bA.of('newMessage').length === 0);
  [bA, bB].forEach(x => x.ws.close());
  j = await json(post(B, `/api/blocks/${A.id}`, {}));
  check('เลิกบล็อกได้ แล้วเห็นโพสต์อีกครั้ง', j.success && !j.blocked && (await json(api(B, `/api/posts?tag=${feedTag}`))).posts.some(p => p.author_id === A.id));

  if (hasAdmin) {
    const dEmail = D.profile.user.email;
    j = await json(post(admin, `/api/admin/users/${D.id}/ban`, { banned: true }));
    check('แอดมินระงับบัญชีได้', j.success && j.banned);
    check('ถูกระงับแล้ว session เดิมใช้ไม่ได้ทันที', (await api(D, '/api/profile')).status === 401);
    check('ถูกระงับแล้ว login ไม่ได้', (await loginRaw(dEmail, 'test-password')).status === 403);
    check('คนทั่วไปเปิดโปรไฟล์คนที่ถูกระงับไม่ได้', (await api(A, `/api/user/${D.id}/profile`)).status === 404);
    check('ระงับบัญชีตัวเอง/แอดมินไม่ได้', (await post(admin, `/api/admin/users/${admin.id}/ban`, {})).status === 400);
    j = await json(post(admin, `/api/admin/users/${D.id}/ban`, { banned: false }));
    check('ปลดระงับแล้ว login ได้อีก', j.success && !j.banned && (await loginRaw(dEmail, 'test-password')).ok);
  }

  // --- เปลี่ยนรหัสผ่าน ---
  const aEmail = A.profile.user.email;
  const A2 = { cookie: (await loginRaw(aEmail, 'test-password')).headers.get('set-cookie').split(';')[0] };
  check('เปลี่ยนรหัส: รหัสเดิมผิดไม่ได้', (await post(A, '/api/account/password', { current_password: 'wrong', new_password: 'new-pass-456' })).status === 400);
  check('เปลี่ยนรหัส: รหัสใหม่เดาง่ายไม่ได้', (await post(A, '/api/account/password', { current_password: 'test-password', new_password: '12345678' })).status === 400);
  j = await json(post(A, '/api/account/password', { current_password: 'test-password', new_password: 'new-pass-456' }));
  check('เปลี่ยนรหัสได้ และออกจากระบบเครื่องอื่นให้', j.success && j.other_sessions_ended >= 1);
  check('เครื่องที่กดเปลี่ยนรหัสยัง login อยู่', (await api(A, '/api/profile')).status === 200);
  check('เครื่องอื่นถูก logout', (await api(A2, '/api/profile')).status === 401);
  check('login ด้วยรหัสใหม่ได้ รหัสเก่าไม่ได้', (await loginRaw(aEmail, 'new-pass-456')).ok && (await loginRaw(aEmail, 'test-password')).status === 401);

  // --- ลืมรหัสผ่าน ---
  const jUnknown = await json(post(null, '/api/password/forgot', { email: `nobody_${tag}@test.local` }));
  const jKnown = await json(post(null, '/api/password/forgot', { email: D.profile.user.email }));
  check('ลืมรหัส: ตอบเหมือนกันไม่ว่าอีเมลจะมีบัญชีหรือไม่', jUnknown.success && jKnown.success && jUnknown.delivery === jKnown.delivery);
  check('ตั้งรหัสใหม่: ลิงก์มั่วไม่ได้', (await post(null, '/api/password/reset', { token: 'abc', password: 'reset-pass-789' })).status === 400);
  if (hasAdmin) {
    const dEmail = D.profile.user.email;
    const D2 = { cookie: (await loginRaw(dEmail, 'test-password')).headers.get('set-cookie').split(';')[0] };
    j = await json(post(admin, `/api/admin/users/${D.id}/reset-link`, {}));
    const token = j.link?.split('#reset=')[1];
    check('แอดมินสร้างลิงก์ตั้งรหัสใหม่ได้', j.success && /^[0-9a-f]{64}$/.test(token || ''));
    check('คนทั่วไปสร้างลิงก์ให้คนอื่นไม่ได้ (403)', (await post(A, `/api/admin/users/${D.id}/reset-link`, {})).status === 403);
    check('ตั้งรหัสใหม่: รหัสเดาง่ายไม่ได้ (ลิงก์ยังไม่ถูกใช้)', (await post(null, '/api/password/reset', { token, password: '11111111' })).status === 400);
    j = await json(post(null, '/api/password/reset', { token, password: 'reset-pass-789' }));
    check('ตั้งรหัสใหม่จากลิงก์ได้ และเครื่องที่ login ค้างไว้ถูก logout', j.success && (await api(D2, '/api/profile')).status === 401);
    check('ลิงก์ใช้ซ้ำไม่ได้', (await post(null, '/api/password/reset', { token, password: 'another-pass-1' })).status === 400);
    check('login ด้วยรหัสใหม่ได้', (await loginRaw(dEmail, 'reset-pass-789')).ok);
  }

  // --- เสนอทักษะใหม่ ---
  const suggest = (u, body) => post(u, '/api/skills/suggest', body);
  const newSkill = `Excel ${tag}`;
  j = await json(suggest(C, { name: `  excel   ${tag} `, category: 'IT', type: 'teach' }));
  check('เสนอทักษะใหม่ได้ (ตัดช่องว่างเกินให้)', j.success && j.request?.name === `excel ${tag}` && !j.joined, JSON.stringify(j));
  check('เสนอทักษะที่มีอยู่แล้วไม่ได้ (ไม่สนตัวพิมพ์)', (await suggest(C, { name: 'python programming', category: 'IT' })).status === 409);
  check('เสนอทักษะ: ต้องเลือกหมวด และชื่อยาว 2–40 ตัว',
    (await suggest(C, { name: 'Abc', category: 'Food' })).status === 400 && (await suggest(C, { name: 'a', category: 'IT' })).status === 400);
  check('เสนอทักษะชื่อเดิมซ้ำไม่ได้', (await suggest(C, { name: `EXCEL ${tag}`, category: 'IT' })).status === 409);
  j = await json(suggest(B, { name: newSkill, category: 'Other', type: 'learn' })); // D ถูก logout ไปตอนเทสตั้งรหัสใหม่
  check('คนอื่นเสนอชื่อเดียวกัน → รวมเป็นคำขอเดียว', j.success && j.joined);
  check('ดูทักษะที่ตัวเองเสนอและรอตรวจได้', (await json(api(C, '/api/skills/suggestions/mine'))).some(r => r.name === `excel ${tag}` && r.type === 'teach'));
  check('คนทั่วไปดูคำขอทักษะของแอดมินไม่ได้ (403)', (await api(C, '/api/admin/skill-requests')).status === 403);
  if (hasAdmin) {
    const reqs = await json(api(admin, '/api/admin/skill-requests'));
    const sr = reqs.find(r => r.name === `excel ${tag}`);
    check('แอดมินเห็นคำขอทักษะ พร้อมจำนวนและชื่อคนเสนอ', sr?.count === 2 && sr.users.includes(C.username) && sr.users.includes(B.username), JSON.stringify(sr));
    j = await json(post(admin, `/api/admin/skill-requests/${sr._id}`, { action: 'approve', name: newSkill, category: 'IT' }));
    await sleep(300);
    check('แอดมินอนุมัติ (แก้ชื่อก่อนได้) และเพิ่มเข้าโปรไฟล์คนเสนอทั้งสองคน', j.success && j.skill?.name === newSkill && j.added === 2, JSON.stringify(j));
    check('ทักษะใหม่อยู่ในแคตตาล็อก', (await json(api(null, '/api/skills'))).some(x => x.name === newSkill && x.category === 'IT'));
    const pC = await json(api(C, '/api/profile'));
    const pB2s = await json(api(B, '/api/profile'));
    check('ทักษะเข้าโปรไฟล์ตามประเภทที่เสนอ (C สอน / B อยากเรียน)',
      pC.skills.some(x => x.skill_name === newSkill && x.type === 'teach') && pB2s.skills.some(x => x.skill_name === newSkill && x.type === 'learn'));
    check('ค้นหาทักษะใหม่เจอคนสอน', (await json(api(A, '/api/search?skill=' + encodeURIComponent(newSkill)))).some(x => x.username === C.username));
    check('คนเสนอได้แจ้งเตือนว่าอนุมัติแล้ว',
      (await json(api(C, '/api/notifications/list'))).items.some(n => n.type === 'skill_approved' && n.skill_name === newSkill && n.added));
    check('อนุมัติซ้ำไม่ได้', (await post(admin, `/api/admin/skill-requests/${sr._id}`, { action: 'approve' })).status === 404);
    j = await json(suggest(C, { name: `Nope ${tag}`, category: 'Other' }));
    const rid = j.request._id;
    j = await json(post(admin, `/api/admin/skill-requests/${rid}`, { action: 'reject' }));
    await sleep(300);
    check('แอดมินไม่อนุมัติ → คนเสนอได้แจ้งเตือน และหายจากรายการรอตรวจ',
      j.success && (await json(api(C, '/api/notifications/list'))).items.some(n => n.type === 'skill_rejected' && n.skill_name === `Nope ${tag}`) &&
      !(await json(api(C, '/api/skills/suggestions/mine'))).some(r => r._id === rid));
  }

  // --- ยืนยันอีเมล / เปลี่ยนชื่อผู้ใช้และอีเมล ---
  const F = await register('Finn_' + tag);
  const fEmail = F.profile.user.email;
  const verifyLink = (email) => {
    const at = serverLog.lastIndexOf('ถึง: ' + email);
    return at === -1 ? null : serverLog.slice(at).match(/#verify=([0-9a-f]{64})/)?.[1];
  };
  check('สมัครแล้วส่งลิงก์ยืนยันอีเมล (ในเครื่องพิมพ์ออก console)',
    F.verify_email_sent === true && F.profile.email_verification_enabled === true && !F.profile.user.email_verified);
  if (ownServer) {
    const token = verifyLink(fEmail);
    check('ยืนยันอีเมล: ลิงก์มั่วไม่ได้', (await post(null, '/api/account/verify-email', { token: 'x'.repeat(64) })).status === 400);
    j = await json(post(null, '/api/account/verify-email', { token }));
    check('กดลิงก์ยืนยันอีเมลได้', j.success && (await json(api(F, '/api/profile'))).user.email_verified === true, JSON.stringify(j));
    check('ลิงก์ยืนยันใช้ซ้ำไม่ได้', (await post(null, '/api/account/verify-email', { token })).status === 400);
    check('โปรไฟล์สาธารณะบอกว่ายืนยันอีเมลแล้ว (ไม่เปิดเผยอีเมล)',
      (await json(api(null, `/api/user/${F.id}/profile`))).user.email_verified === true && !('email' in (await json(api(null, `/api/user/${F.id}/profile`))).user));
    check('ยืนยันแล้วขอลิงก์ใหม่ → บอกว่ายืนยันแล้ว', (await json(post(F, '/api/account/verify-email/send', {}))).already === true);
  }
  const identity = (u, body) => post(u, '/api/account/identity', { password: 'test-password', ...body });
  check('เปลี่ยนชื่อ/อีเมล: รหัสผ่านผิดไม่ได้', (await identity(F, { username: 'Finn_x' + tag, password: 'wrong' })).status === 400);
  check('เปลี่ยนชื่อ: รูปแบบผิดไม่ได้', (await identity(F, { username: 'a b' })).status === 400);
  check('เปลี่ยนชื่อ: ชื่อซ้ำ (ไม่สนตัวพิมพ์) ไม่ได้', (await identity(F, { username: B.username.toUpperCase() })).status === 409);
  check('เปลี่ยนอีเมล: อีเมลซ้ำไม่ได้', (await identity(F, { email: B.profile.user.email.toUpperCase() })).status === 409);
  check('เปลี่ยนอีเมล: ใช้อีเมลแอดมินไม่ได้', (await identity(F, { email: ADMIN_EMAIL })).status === 400);
  j = await json(post(A, '/api/posts', { text: `โพสต์ให้ Finn ถูกใจ #${feedTag}` }));
  await post(F, `/api/posts/${j.post._id}/like`, {});
  await sleep(300);
  const F2 = { cookie: (await loginRaw(fEmail, 'test-password')).headers.get('set-cookie').split(';')[0] };
  const newName = 'Finn2_' + tag;
  const newEmail = `finn2_${tag}@test.local`;
  j = await json(identity(F, { username: newName, email: newEmail }));
  check('เปลี่ยนชื่อผู้ใช้และอีเมลได้ พร้อมส่งลิงก์ยืนยันอีเมลใหม่', j.success && j.username === newName && j.email === newEmail && j.verify_email_sent === true, JSON.stringify(j));
  const pF = await json(api(F, '/api/profile'));
  check('เครื่องที่เปลี่ยนยัง login อยู่ (ชื่อ/อีเมลใหม่ และอีเมลใหม่ยังไม่ยืนยัน)',
    pF.user?.username === newName && pF.user.email === newEmail && pF.user.email_verified === false);
  check('เครื่องอื่นถูกออกจากระบบ', (await api(F2, '/api/profile')).status === 401);
  check('login ด้วยอีเมลใหม่ได้ อีเมลเก่าไม่ได้', (await loginRaw(newEmail, 'test-password')).ok && (await loginRaw(fEmail, 'test-password')).status === 401);
  const aBell = (await json(api(A, '/api/notifications/list'))).items;
  check('ชื่อในแจ้งเตือนเก่าเปลี่ยนตาม', aBell.some(n => n.from === newName) && !aBell.some(n => n.from === F.username));
  if (ownServer) check('ลิงก์ยืนยันใหม่ถูกส่งไปที่อีเมลใหม่', !!verifyLink(newEmail));

  // --- PDPA: นโยบาย / ขอสำเนาข้อมูล / ลบบัญชี ---
  const privacy = await json(api(null, '/api/privacy'));
  check('มีเวอร์ชันนโยบายความเป็นส่วนตัว', /^\d{4}-\d{2}-\d{2}$/.test(privacy.version || ''), privacy.version);
  j = await tryRegister({ ...okBody, accept_privacy: false });
  check('สมัคร: ไม่ยอมรับนโยบายไม่ได้', !j.success && /นโยบาย/.test(j.error), j.error);
  check('สมัครแล้วบันทึกว่ายอมรับนโยบายเวอร์ชันไหน เมื่อไร',
    A.profile.privacy_current === privacy.version && A.profile.user.privacy_version === privacy.version && !!A.profile.user.privacy_accepted_at);
  check('กดรับทราบนโยบายได้', (await json(post(A, '/api/account/privacy', {}))).success);

  // E มีร่องรอยครบทุกแบบ: ทักษะ โพสต์ ความคิดเห็น/ถูกใจในโพสต์คนอื่น การแลกเปลี่ยนที่เสร็จแล้ว แชท รีวิวสองทาง บล็อก รายงาน
  const E = await register('Erin_' + tag);
  const eEmail = E.profile.user.email;
  await post(E, '/api/profile/update', { teach_skills: [skillId('Chess')], learn_skills: [] });
  j = await json(post(A, '/api/posts', { text: `โพสต์ของ A ที่ E มาคอมเมนต์ #${feedTag}` }));
  const aPost2 = j.post._id;
  await post(E, `/api/posts/${aPost2}/like`, {});
  await post(E, `/api/posts/${aPost2}/comments`, { text: 'ความคิดเห็นของ E' });
  j = await json(post(E, '/api/posts', { text: `โพสต์ของ E #${feedTag}` }));
  const ePostId = j.post._id;
  await post(B, `/api/posts/${ePostId}/comments`, { text: 'B คอมเมนต์ในโพสต์ของ E' });
  await post(E, '/api/exchange/request', { receiver_id: B.id, message: 'ขอเรียนด้วย' });
  const eReq = (await json(api(B, '/api/dashboard'))).received.find(r => r.other_user_id === E.id);
  await post(B, '/api/exchange/respond', { request_id: eReq._id, status: 'accepted' });
  const sE = await sio(E);
  sE.emit('joinRoom', eReq._id);
  await sleep(500);
  sE.emit('sendMessage', { requestId: eReq._id, text: 'ข้อความจาก E' });
  await sleep(600);
  sE.ws.close();
  await post(E, `/api/exchange/${eReq._id}/complete`, {});
  await post(B, `/api/exchange/${eReq._id}/complete`, {});
  await post(E, '/api/review', { request_id: eReq._id, rating: 4, comment: 'รีวิวจาก E' });
  await post(B, '/api/review', { request_id: eReq._id, rating: 5, comment: 'รีวิวถึง E' });
  await post(E, `/api/blocks/${C.id}`, {});
  await post(E, '/api/reports', { type: 'user', target_id: D.id, reason: 'spam', detail: 'รายงานจาก E' });

  check('ยังไม่ login ดาวน์โหลดข้อมูลไม่ได้ (401)', (await api(null, '/api/account/export')).status === 401);
  res = await api(E, '/api/account/export');
  const exp = await res.json();
  check('ดาวน์โหลดข้อมูลของฉันเป็นไฟล์ JSON', res.status === 200 && /attachment/.test(res.headers.get('content-disposition') || ''));
  check('ไฟล์มีข้อมูลครบ: บัญชี ทักษะ คำขอ แชท รีวิว โพสต์ ความคิดเห็น ถูกใจ บล็อก รายงาน',
    exp.account?.email === eEmail && exp.skills.some(x => x.skill === 'Chess') &&
    exp.exchange_requests.some(r => r.other_user === B.username && r.status === 'completed') &&
    exp.messages_sent.some(m => m.text === 'ข้อความจาก E') &&
    exp.reviews_written.some(r => r.about === B.username && r.rating === 4) &&
    exp.reviews_received.some(r => r.from === B.username && r.rating === 5) &&
    exp.posts.some(x => x.id === ePostId) && exp.comments.some(c => c.text === 'ความคิดเห็นของ E') &&
    exp.liked_post_ids.includes(aPost2) && exp.blocked_users.includes(C.username) && exp.reports_filed.length === 1,
    JSON.stringify(Object.fromEntries(Object.entries(exp).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v]))));
  check('ไฟล์ไม่มีรหัสผ่าน (แม้แต่ hash)', !('password' in exp.account) && !/\$2[aby]\$/.test(JSON.stringify(exp)));
  const expB = await json(api(B, '/api/account/export'));
  check('ไฟล์ของ B มีแค่ข้อความแชทที่ B ส่งเอง', !expB.messages_sent.some(m => m.text === 'ข้อความจาก E'));

  const E2 = { cookie: (await loginRaw(eEmail, 'test-password')).headers.get('set-cookie').split(';')[0] };
  const sE2 = await sio(E2);
  check('ลบบัญชี: ยังไม่ login ไม่ได้ (401)', (await post(null, '/api/account/delete', { password: 'test-password' })).status === 401);
  check('ลบบัญชี: รหัสผ่านผิดไม่ได้', (await post(E, '/api/account/delete', { password: 'wrong-password' })).status === 400);
  j = await json(post(E, '/api/account/delete', { password: 'test-password' }));
  await sleep(400);
  check('ลบบัญชีตัวเองได้', j.success && j.deleted?.posts === 1 && j.deleted?.exchange_requests === 1 && j.deleted?.messages === 1, JSON.stringify(j));
  check('ลบแล้ว: session ทุกเครื่องใช้ไม่ได้ และ socket ถูกตัด',
    (await api(E, '/api/profile')).status === 401 && (await api(E2, '/api/profile')).status === 401 && sE2.closed);
  check('ลบแล้ว: login ไม่ได้', (await loginRaw(eEmail, 'test-password')).status === 401);
  check('ลบแล้ว: โปรไฟล์หายไป และไม่ขึ้นในผลค้นหา',
    (await api(null, `/api/user/${E.id}/profile`)).status === 404 && !(await json(api(null, '/api/search?skill=Chess'))).some(x => x.id === E.id));
  feed = await json(api(null, `/api/posts?tag=${feedTag}`));
  const aPost2After = feed.posts.find(p => p._id === aPost2);
  check('ลบแล้ว: โพสต์ของ E หายจากฟีด (รวมความคิดเห็นของคนอื่นในโพสต์นั้น)', !feed.posts.some(p => p._id === ePostId));
  check('ลบแล้ว: ความคิดเห็น/ถูกใจของ E ในโพสต์คนอื่นหายไป ตัวนับถูกต้อง',
    aPost2After?.comment_count === 0 && aPost2After?.like_count === 0 && (await json(api(null, `/api/posts/${aPost2}/comments`))).length === 0,
    JSON.stringify(aPost2After));
  check('ลบแล้ว: คำขอและแชทหายจากฝั่งคู่แลกเปลี่ยน',
    !(await json(api(B, '/api/dashboard'))).received.some(r => r._id === eReq._id) && (await api(B, '/api/chat/' + eReq._id)).status === 403);
  const pB2 = await json(api(null, `/api/user/${B.id}/profile`));
  check('รีวิวที่ E เขียนให้ B ยังอยู่ แต่ไม่ระบุชื่อ (คะแนนของ B ไม่หาย)',
    pB2.rating.count === 2 && pB2.reviews.some(r => r.comment === 'รีวิวจาก E' && r.reviewer_name === 'ผู้ใช้ที่ลบบัญชีแล้ว'),
    JSON.stringify(pB2.reviews.map(r => r.reviewer_name)));
  const fromE = async (u) => (await json(api(u, '/api/notifications/list'))).items.some(n => n.from === E.username);
  check('ลบแล้ว: แจ้งเตือนที่มาจาก E หายจากกระดิ่งของคนอื่น', !(await fromE(A)) && !(await fromE(B)));
  if (hasAdmin) {
    const r = (await json(api(admin, '/api/admin/reports'))).find(x => x.type === 'user' && x.target_id === D.id);
    check('รายงานที่ E เคยส่งยังอยู่ให้แอดมินตรวจ (ไม่ระบุผู้รายงาน)', r?.details.includes('รายงานจาก E'), JSON.stringify(r));
    await post(admin, '/api/admin/reports/resolve', { type: 'user', target_id: D.id, action: 'dismiss' });
  }
  const E3 = await register('Erin_' + tag);
  check('ใช้อีเมล/ชื่อเดิมสมัครใหม่ได้ เป็นบัญชีใหม่ที่ไม่มีข้อมูลเก่า',
    E3.success && E3.id !== E.id && E3.profile.skills.length === 0 && (await json(api(E3, '/api/dashboard'))).sent.length === 0);
  await post(E3, '/api/account/delete', { password: 'test-password' });
  const demo = await loginRaw('lxzy@demo.com', 'demo1234');
  if (demo.ok) {
    const demoUser = { cookie: demo.headers.get('set-cookie').split(';')[0] };
    const r = await post(demoUser, '/api/account/delete', { password: 'demo1234' });
    check('บัญชีทดลองลบไม่ได้', r.status === 403, `${r.status} ${await r.text()}`);
    check('บัญชีทดลองเปลี่ยนชื่อ/อีเมลไม่ได้', (await post(demoUser, '/api/account/identity', { password: 'demo1234', username: 'Hacked_' + tag })).status === 403);
  }

  // --- การ์ดแชร์ลิงก์ ---
  const home = await (await fetch(BASE + '/')).text();
  check('หน้าแรกมี og:image เป็น URL เต็ม', home.includes(`property="og:image" content="${BASE}/image/og-image.jpg"`) && !home.includes('__ORIGIN__'));
  const homeRes = await fetch(BASE + '/');
  const csp = homeRes.headers.get('content-security-policy') || '';
  check('มี security headers (CSP ห้ามฝังใน iframe, nosniff)',
    csp.includes("frame-ancestors 'none'") && csp.includes('fonts.googleapis.com') && homeRes.headers.get('x-content-type-options') === 'nosniff', csp);
  check('รูปการ์ดแชร์โหลดได้', (await fetch(BASE + '/image/og-image.jpg')).headers.get('content-type') === 'image/jpeg');
  const evilHome = await new Promise((resolve, reject) => {
    http.get(BASE + '/', { headers: { Host: 'evil.test"><script>x</script>' } }, (r) => {
      let body = ''; r.on('data', d => (body += d)); r.on('end', () => resolve(body));
    }).on('error', reject);
  });
  check('Host แปลก ๆ ไม่ถูกใส่ลงหน้าเว็บ', !evilHome.includes('<script>x') && !evilHome.includes('__ORIGIN__'));

  // --- id ไม่ถูกต้อง ---
  check('profile id มั่ว → 404', (await api(null, '/api/user/xyz/profile')).status === 404);
  check('ลบด้วย id มั่วไม่พัง', (await json(api(A, '/api/exchange/request/xyz', { method: 'DELETE' }))).success === false);

  // --- session อยู่รอดหลัง restart ---
  if (ownServer) {
    await stopServer();
    // จำลอง Resend ที่ปฏิเสธการส่ง (เหมือนตอนยังไม่ได้ยืนยันโดเมน) — ไม่มีการเรียก Resend จริง
    const mailHits = [];
    const fakeResend = http.createServer((req, res) => {
      let body = '';
      req.on('data', d => (body += d));
      req.on('end', () => {
        mailHits.push(JSON.parse(body || '{}'));
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ statusCode: 403, message: 'You can only send testing emails to your own email address' }));
      });
    });
    await new Promise(r => fakeResend.listen(0, '127.0.0.1', r));
    await startServer({
      RATE_LIMIT: 'on', DEMO_ACCOUNTS: 'off',
      RESEND_API_KEY: 're_test_fake', RESEND_API_URL: `http://127.0.0.1:${fakeResend.address().port}`
    });
    let r = await post(A, '/api/account/verify-email/send', {});
    check('ส่งอีเมลไม่สำเร็จ (Resend ปฏิเสธ) → บอกผู้ใช้ตามจริง ไม่ขึ้นว่าส่งแล้ว',
      r.status === 502 && mailHits.some(m => m.to?.[0] === A.profile.user.email), `${r.status} hits=${mailHits.length}`);
    j = await tryRegister({ username: 'Late_' + tag, email: `late_${tag}@test.local`, password: 'good-pass-123', accept_privacy: true });
    check('สมัครได้แม้ส่งอีเมลยืนยันไม่สำเร็จ และบอกว่าส่งไม่สำเร็จ', j.success && j.verify_email_sent === false && j.verify_email_failed === true, JSON.stringify(j));
    fakeResend.close();
    const stillIn = await api(A, '/api/profile');
    check('restart server แล้วยัง login อยู่ (session เก็บใน MongoDB)', stillIn.status === 200);
    check('ปิดบัญชีทดลอง (DEMO_ACCOUNTS=off) แล้ว login ไม่ได้', (await loginRaw('lxzy@demo.com', 'demo1234')).status === 403);
    let last;
    for (let i = 0; i < 11; i++) last = await loginRaw(`nobody_${tag}@test.local`, 'wrong-password');
    check('ใส่รหัสผิดเกิน 10 ครั้ง → ถูกพักชั่วคราว (429)', last.status === 429);
  }

  await Promise.all([A, B, C, D, F].map(u => post(u, '/api/profile/update', { teach_skills: [], learn_skills: [] })));
  await post(A, '/api/logout', {});
  check('logout แล้ว session ใช้ไม่ได้', (await api(A, '/api/profile')).status === 401);
}

(async () => {
  let crashed = null;
  try {
    if (ownServer) await startServer();
    await run();
  } catch (e) {
    crashed = e;
  } finally {
    await stopServer();
  }
  for (const [s, n, e] of results) console.log(`${s}  ${n}${e ? '  — ' + e : ''}`);
  if (crashed) console.error('\nTEST CRASH:', crashed.message);
  const fails = results.filter(x => x[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} passed (db: ${TEST_DB})`);
  process.exit(fails || crashed ? 1 : 0);
})();
