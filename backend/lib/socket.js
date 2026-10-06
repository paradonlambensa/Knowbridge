// ===== Socket.IO: แจ้งเตือนของผู้ใช้ / แชท / สถานะออนไลน์ / กำลังพิมพ์ / อัปเดตหน้าเว็บแบบสด =====
// คนที่ยังไม่ login ต่อได้ แต่ได้แค่อัปเดตสาธารณะ (ตัวเลขในฟีด ตัวเลขหน้าแรก) — เข้าห้องแชทหรือส่งข้อความไม่ได้
const TYPING_GAP_MS = 1000;      // ส่ง "กำลังพิมพ์" ได้ไม่ถี่กว่านี้ต่อ socket
const ONLINE_COUNT_DELAY_MS = 1500;

module.exports = function setupSocket({ io, db, ObjectId, moderation, notify, presence, realtime, ACTIVE_STATUSES, findAcceptedRequestForUser }) {
  // คนที่เห็นสถานะออนไลน์ของเรา = คู่แลกเปลี่ยนที่ตอบรับกันแล้ว
  async function partnersOf(userId) {
    const me = new ObjectId(userId);
    const rows = await db.exchange_requests.find(
      { status: { $in: ACTIVE_STATUSES }, $or: [{ sender_id: me }, { receiver_id: me }] },
      { projection: { sender_id: 1, receiver_id: 1 } }
    ).toArray();
    return [...new Set(rows.map(r => (r.sender_id.equals(me) ? r.receiver_id : r.sender_id).toString()))];
  }

  // บอกคู่แลกเปลี่ยนว่าเราออนไลน์/ออฟไลน์ — คนที่ซ่อนสถานะไม่ส่ง (ยกเว้นตอนเพิ่งกดซ่อน/เลิกซ่อน: always)
  async function announce(userId, { always = false } = {}) {
    if (presence.hidden.has(userId) && !always) return;
    const status = { user_id: userId, ...presence.statusOf(userId) };
    for (const id of await partnersOf(userId)) io.to('user:' + id).emit('presence', status);
  }
  realtime.announcePresence = announce; // ให้ route เปลี่ยนการตั้งค่าซ่อนสถานะแล้วแจ้งคู่แลกเปลี่ยนได้

  // จำนวนคนออนไลน์บนหน้าแรก — รวบการเข้า/ออกที่เกิดติด ๆ กันเป็นการส่งครั้งเดียว
  let countTimer = null;
  function broadcastOnlineCount() {
    if (countTimer) return;
    countTimer = setTimeout(() => {
      countTimer = null;
      io.emit('presence:count', { online: presence.onlineCount() });
    }, ONLINE_COUNT_DELAY_MS);
  }

  io.on('connection', (socket) => {
    const sess = socket.request.session;
    const userId = sess?.userId;
    if (userId && moderation.banned.has(userId)) return socket.disconnect(true);
    if (!userId) return; // ผู้เยี่ยมชม: รับ io.emit ทั่วไปได้อย่างเดียว

    socket.join('user:' + userId);
    if (presence.connect(userId)) {
      announce(userId).catch(e => console.error('presence error:', e));
      broadcastOnlineCount();
    }
    socket.on('disconnect', () => {
      if (presence.disconnect(userId)) {
        announce(userId).catch(e => console.error('presence error:', e));
        broadcastOnlineCount();
      }
    });

    const chatPeers = {}; // requestId → userId ของอีกฝ่าย (ไว้ส่งแจ้งเตือนข้อความใหม่)
    let sentTimes = [];   // กันสแปมแชท: ไม่เกิน 20 ข้อความต่อ 10 วินาที
    let lastTyping = 0;

    socket.on('joinRoom', async (requestId) => {
      try {
        const request = await findAcceptedRequestForUser(requestId, userId);
        if (!request) return;
        socket.join(requestId);
        chatPeers[requestId] = request.sender_id.toString() === userId ? request.receiver_id : request.sender_id;
      } catch (e) {
        console.error('joinRoom error:', e);
      }
    });

    // "กำลังพิมพ์…" ส่งให้อีกฝ่ายในห้องแชท (ไม่ส่งกลับมาหาตัวเอง)
    socket.on('typing', (requestId) => {
      const now = Date.now();
      if (typeof requestId !== 'string' || !socket.rooms.has(requestId) || now - lastTyping < TYPING_GAP_MS) return;
      lastTyping = now;
      socket.to(requestId).emit('typing', { request_id: requestId, user_id: userId, name: sess.username });
    });

    socket.on('sendMessage', async ({ requestId, text } = {}) => {
      try {
        text = String(text || '').trim().slice(0, 2000);
        if (!text || !socket.rooms.has(requestId)) return;
        const now = Date.now();
        sentTimes = sentTimes.filter(t => now - t < 10000);
        if (sentTimes.length >= 20 && process.env.RATE_LIMIT !== 'off')
          return socket.emit('chatError', 'ส่งข้อความถี่เกินไป กรุณารอสักครู่');
        sentTimes.push(now);
        if (moderation.banned.has(userId) || await moderation.isBlockedBetween(userId, chatPeers[requestId]))
          return socket.emit('chatError', 'ส่งข้อความไม่ได้ เนื่องจากมีการบล็อกกันอยู่');
        const msg = {
          request_id: new ObjectId(requestId),
          sender_id: userId,
          sender_name: sess.username,
          text,
          created_at: new Date()
        };
        await db.messages.insertOne(msg);
        io.to(requestId).emit('newMessage', { ...msg, request_id: requestId });
        notify(chatPeers[requestId], {
          type: 'message',
          request_id: requestId,
          from: sess.username,
          preview: text.slice(0, 80)
        });
      } catch (e) {
        console.error('sendMessage error:', e);
      }
    });
  });
};
