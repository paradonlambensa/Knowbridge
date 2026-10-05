// ===== ฟีดชุมชน: โพสต์ / ถูกใจ / ความคิดเห็น =====
const express = require('express');

const POST_MAX = 500;
const COMMENT_MAX = 300;
const PAGE_MAX = 50;
// ต้องตรงกับฝั่ง client (frontend/js/app.js) — \p{M} สำหรับสระ/วรรณยุกต์ภาษาไทย
// แท็กต้องขึ้นต้นบรรทัดหรือตามหลังช่องว่าง/เครื่องหมาย (ไม่นับ #frag ใน URL หรือ &#39;)
// และต้องมีตัวอักษรอย่างน้อย 1 ตัว (#2024 ไม่นับ)
const HASHTAG_RE = /(^|[^\p{L}\p{M}\p{N}_&/#])#([\p{L}\p{M}\p{N}_]*[\p{L}\p{M}][\p{L}\p{M}\p{N}_]*)/gu;

function extractTags(text) {
  const tags = new Set();
  for (const m of text.matchAll(HASHTAG_RE)) {
    if (m[2].length <= 50) tags.add(m[2].toLowerCase());
    if (tags.size >= 10) break;
  }
  return [...tags];
}

module.exports = function postsRouter({ db, ObjectId, io, notify, requireLogin, isValidId, moderation, limits }) {
  const router = express.Router();

  // เนื้อหาที่ถูกซ่อน (รายงานครบ) เห็นได้แค่เจ้าของกับแอดมิน
  function visibleTo(req) {
    if (req.session.isAdmin) return {};
    const or = [{ hidden: { $ne: true } }];
    if (req.session.userId) or.push({ author_id: new ObjectId(req.session.userId) });
    return { $or: or };
  }

  // แปลงโพสต์จาก DB เป็นรูปที่ส่งให้ client (ไม่ส่งรายชื่อคนกดถูกใจออกไปทั้งหมด)
  async function present(posts, meId) {
    const authors = await db.users.find(
      { _id: { $in: [...new Set(posts.map(p => p.author_id.toString()))].map(id => new ObjectId(id)) } },
      { projection: { username: 1 } }
    ).toArray();
    const nameOf = (id) => authors.find(a => a._id.equals(id))?.username || 'ไม่ทราบชื่อ';
    return posts.map(p => ({
      _id: p._id,
      author_id: p.author_id,
      author_name: nameOf(p.author_id),
      text: p.text,
      tags: p.tags,
      like_count: p.likes?.length || 0,
      liked: !!meId && (p.likes || []).some(id => id.toString() === meId),
      comment_count: p.comment_count || 0,
      created_at: p.created_at,
      mine: !!meId && p.author_id.toString() === meId,
      hidden: !!p.hidden
    }));
  }

  // GET /api/posts?limit=20&before=<postId>&tag=python&author=<userId>
  router.get('/posts', async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), PAGE_MAX);
      const query = {};
      if (isValidId(req.query.before)) query._id = { $lt: new ObjectId(req.query.before) };
      if (req.query.tag) query.tags = String(req.query.tag).toLowerCase().replace(/^#/, '');
      // ไม่แสดงโพสต์ของคนที่ถูกระงับ หรือบล็อกกันอยู่
      const hiddenAuthors = [...await moderation.hiddenUserIds(req.session.userId)].map(id => new ObjectId(id));
      query.author_id = { $nin: hiddenAuthors };
      if (isValidId(req.query.author)) query.author_id.$eq = new ObjectId(req.query.author);
      Object.assign(query, visibleTo(req));
      // ดึงเกิน 1 ตัวเพื่อรู้ว่ายังมีหน้าถัดไปไหม
      const rows = await db.posts.find(query).sort({ _id: -1 }).limit(limit + 1).toArray();
      const page = rows.slice(0, limit);
      res.json({
        posts: await present(page, req.session.userId),
        next: rows.length > limit ? page[page.length - 1]._id : null
      });
    } catch (e) {
      console.error('feed error:', e);
      res.status(500).json({ posts: [], next: null });
    }
  });

  // แท็กที่ถูกใช้มากที่สุดใน 7 วันล่าสุด
  router.get('/posts/trending-tags', async (req, res) => {
    try {
      const since = ObjectId.createFromTime(Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60);
      const rows = await db.posts.aggregate([
        { $match: { _id: { $gte: since }, tags: { $ne: [] }, hidden: { $ne: true } } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 8 }
      ]).toArray();
      res.json(rows.map(r => ({ tag: r._id, count: r.count })));
    } catch (e) {
      res.json([]);
    }
  });

  router.post('/posts', requireLogin, limits.post, async (req, res) => {
    try {
      const text = String(req.body.text || '').trim();
      if (!text) return res.status(400).json({ success: false, error: 'กรุณาพิมพ์ข้อความก่อนโพสต์' });
      if ([...text].length > POST_MAX)
        return res.status(400).json({ success: false, error: `โพสต์ยาวได้ไม่เกิน ${POST_MAX} ตัวอักษร` });
      const post = {
        author_id: new ObjectId(req.session.userId),
        text,
        tags: extractTags(text),
        likes: [],
        comment_count: 0,
        created_at: new Date()
      };
      const { insertedId } = await db.posts.insertOne(post);
      post._id = insertedId;
      // ให้ทุกคนที่เปิดฟีดอยู่เห็นปุ่ม "มีโพสต์ใหม่"
      io.emit('feed:new', { post_id: insertedId, author_id: req.session.userId });
      res.json({ success: true, post: (await present([post], req.session.userId))[0] });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  router.delete('/posts/:id', requireLogin, async (req, res) => {
    try {
      if (!isValidId(req.params.id)) return res.status(404).json({ success: false });
      // เจ้าของลบได้ แอดมินลบได้ทุกโพสต์
      const { deletedCount } = await db.posts.deleteOne({
        _id: new ObjectId(req.params.id),
        ...(req.session.isAdmin ? {} : { author_id: new ObjectId(req.session.userId) })
      });
      if (!deletedCount) return res.status(403).json({ success: false, error: 'ลบได้เฉพาะโพสต์ของตัวเอง' });
      await db.comments.deleteMany({ post_id: new ObjectId(req.params.id) });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  // กดซ้ำ = ยกเลิกถูกใจ
  router.post('/posts/:id/like', requireLogin, async (req, res) => {
    try {
      if (!isValidId(req.params.id)) return res.status(404).json({ success: false });
      const me = new ObjectId(req.session.userId);
      const postId = new ObjectId(req.params.id);
      const post = await db.posts.findOne({ _id: postId }, { projection: { likes: 1, author_id: 1 } });
      if (!post) return res.status(404).json({ success: false });
      if (await moderation.isBlockedBetween(me, post.author_id)) return res.status(403).json({ success: false });
      const alreadyLiked = (post.likes || []).some(id => id.equals(me));
      const updated = await db.posts.findOneAndUpdate(
        { _id: postId },
        alreadyLiked ? { $pull: { likes: me } } : { $addToSet: { likes: me } },
        { returnDocument: 'after', projection: { likes: 1 } }
      );
      if (!alreadyLiked && !post.author_id.equals(me)) {
        notify(post.author_id, { type: 'like', from: req.session.username, post_id: postId, like_count: updated.likes.length });
      }
      res.json({ success: true, liked: !alreadyLiked, like_count: updated.likes.length });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  router.get('/posts/:id/comments', async (req, res) => {
    try {
      if (!isValidId(req.params.id)) return res.json([]);
      const hiddenAuthors = [...await moderation.hiddenUserIds(req.session.userId)].map(id => new ObjectId(id));
      const comments = await db.comments.find({
        post_id: new ObjectId(req.params.id),
        author_id: { $nin: hiddenAuthors },
        ...visibleTo(req)
      }).sort({ _id: 1 }).toArray();
      const authors = await db.users.find(
        { _id: { $in: comments.map(c => c.author_id) } }, { projection: { username: 1 } }
      ).toArray();
      res.json(comments.map(c => ({
        _id: c._id,
        author_id: c.author_id,
        author_name: authors.find(a => a._id.equals(c.author_id))?.username || 'ไม่ทราบชื่อ',
        text: c.text,
        created_at: c.created_at,
        mine: c.author_id.toString() === req.session.userId,
        hidden: !!c.hidden
      })));
    } catch (e) {
      res.json([]);
    }
  });

  router.post('/posts/:id/comments', requireLogin, limits.comment, async (req, res) => {
    try {
      if (!isValidId(req.params.id)) return res.status(404).json({ success: false });
      const text = String(req.body.text || '').trim();
      if (!text) return res.status(400).json({ success: false, error: 'กรุณาพิมพ์ความคิดเห็น' });
      if ([...text].length > COMMENT_MAX)
        return res.status(400).json({ success: false, error: `ความคิดเห็นยาวได้ไม่เกิน ${COMMENT_MAX} ตัวอักษร` });
      const postId = new ObjectId(req.params.id);
      const target = await db.posts.findOne({ _id: postId }, { projection: { author_id: 1 } });
      if (!target) return res.status(404).json({ success: false, error: 'ไม่พบโพสต์' });
      if (await moderation.isBlockedBetween(req.session.userId, target.author_id))
        return res.status(403).json({ success: false, error: 'แสดงความคิดเห็นในโพสต์นี้ไม่ได้' });
      const post = await db.posts.findOneAndUpdate(
        { _id: postId }, { $inc: { comment_count: 1 } }, { projection: { author_id: 1, comment_count: 1 }, returnDocument: 'after' }
      );
      if (!post) return res.status(404).json({ success: false, error: 'ไม่พบโพสต์' });
      const comment = { post_id: postId, author_id: new ObjectId(req.session.userId), text, created_at: new Date() };
      const { insertedId } = await db.comments.insertOne(comment);
      if (post.author_id.toString() !== req.session.userId) {
        notify(post.author_id, { type: 'comment', from: req.session.username, post_id: postId, preview: text.slice(0, 80), comment_count: post.comment_count });
      }
      res.json({
        success: true,
        comment_count: post.comment_count,
        comment: { _id: insertedId, author_id: comment.author_id, author_name: req.session.username, text, created_at: comment.created_at, mine: true }
      });
    } catch (e) {
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
    }
  });

  router.delete('/comments/:id', requireLogin, async (req, res) => {
    try {
      if (!isValidId(req.params.id)) return res.status(404).json({ success: false });
      const comment = await db.comments.findOneAndDelete({
        _id: new ObjectId(req.params.id),
        ...(req.session.isAdmin ? {} : { author_id: new ObjectId(req.session.userId) })
      });
      if (!comment) return res.status(403).json({ success: false, error: 'ลบได้เฉพาะความคิดเห็นของตัวเอง' });
      const post = await db.posts.findOneAndUpdate(
        { _id: comment.post_id }, { $inc: { comment_count: -1 } }, { projection: { comment_count: 1 }, returnDocument: 'after' }
      );
      res.json({ success: true, comment_count: post?.comment_count ?? 0 });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  return router;
};

module.exports.extractTags = extractTags;
