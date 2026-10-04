// ===== Socket.IO: ห้องแจ้งเตือนของผู้ใช้ + แชทของแต่ละคำขอ =====
module.exports = function setupSocket({ io, db, ObjectId, moderation, notify, findAcceptedRequestForUser }) {
  io.on('connection', (socket) => {
    const sess = socket.request.session;
    const userId = sess?.userId;
    if (!userId || moderation.banned.has(userId)) return socket.disconnect(true);
    socket.join('user:' + userId);
    const chatPeers = {}; // requestId → userId ของอีกฝ่าย (ไว้ส่งแจ้งเตือนข้อความใหม่)
    let sentTimes = [];   // กันสแปมแชท: ไม่เกิน 20 ข้อความต่อ 10 วินาที

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
