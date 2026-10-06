// ===== ตัวเลขบนหน้าแรกแบบเรียลไทม์ =====
// get(): ตัวเลขล่าสุด (นับใหม่อย่างมากทุก 60 วินาที) + จำนวนคนที่ออนไลน์ตอนนี้
// changed(): มีคนสมัคร / โพสต์ / แลกเปลี่ยน → นับใหม่แล้วส่งให้ทุกหน้าที่เปิดอยู่ (รวบเป็นครั้งเดียวทุก 2 วินาที)
const CACHE_MS = 60 * 1000;
const BROADCAST_DELAY_MS = 2000;

module.exports = function createLiveStats({ db, io, presence, ACTIVE_STATUSES }) {
  let cache = { at: 0, data: null };
  let timer = null;

  async function count() {
    const [users, skills, posts, exchanges] = await Promise.all([
      db.users.estimatedDocumentCount(),
      db.skills.estimatedDocumentCount(),
      db.posts.estimatedDocumentCount(),
      db.exchange_requests.countDocuments({ status: { $in: ACTIVE_STATUSES } })
    ]);
    cache = { at: Date.now(), data: { users, skills, posts, exchanges } };
    return cache.data;
  }

  async function get() {
    const data = !cache.data || Date.now() - cache.at > CACHE_MS ? await count() : cache.data;
    return { ...data, online: presence.onlineCount() };
  }

  function changed() {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      try {
        io.emit('stats', { ...(await count()), online: presence.onlineCount() });
      } catch (e) {
        console.error('live stats error:', e);
      }
    }, BROADCAST_DELAY_MS);
  }

  return { get, changed };
};
