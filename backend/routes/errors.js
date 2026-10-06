// ===== ข้อผิดพลาด: หน้าเว็บส่ง error ฝั่ง JavaScript มาเก็บ / แอดมินดูและล้าง =====
const express = require('express');

// error ที่ไม่ได้มาจากโค้ดเรา (สคริปต์ของ extension, เบราว์เซอร์แจ้งเตือนทั่วไป) ไม่ต้องเก็บ
const IGNORE = [/^Script error\.?$/i, /ResizeObserver loop/i, /^Load failed$/i, /NetworkError/i, /Failed to fetch/i];

module.exports = function errorsRouter({ db, ObjectId, requireLogin, requireAdmin, isValidId, limits, errorLog }) {
  const router = express.Router();

  router.post('/client-errors', limits.clientErrors, async (req, res) => {
    const message = String(req.body.message || '').slice(0, 500);
    if (!message || IGNORE.some(re => re.test(message))) return res.status(204).end();
    const where = req.body.source ? `\n${String(req.body.source).slice(0, 200)}:${Number(req.body.line) || 0}:${Number(req.body.col) || 0}` : '';
    await errorLog.record({
      source: 'client',
      kind: 'js',
      message,
      stack: String(req.body.stack || '').slice(0, 2000) + where,
      path: String(req.body.page || '').split(/[?#]/)[0].slice(0, 100)
    });
    res.status(204).end();
  });

  router.get('/admin/errors', requireLogin, requireAdmin, async (req, res) => {
    try {
      const rows = await db.error_logs.find({}).sort({ last_seen: -1 }).limit(100).toArray();
      res.json(rows.map(({ key, ...r }) => r));
    } catch (e) {
      res.status(500).json([]);
    }
  });

  // แก้แล้ว → ลบออกจากรายการ (ถ้าเกิดอีกจะขึ้นมาใหม่)
  router.post('/admin/errors/:id/resolve', requireLogin, requireAdmin, async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false });
    const { deletedCount } = await db.error_logs.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: deletedCount === 1 });
  });

  router.post('/admin/errors/clear', requireLogin, requireAdmin, async (req, res) => {
    const { deletedCount } = await db.error_logs.deleteMany({});
    res.json({ success: true, deleted: deletedCount });
  });

  return router;
};
