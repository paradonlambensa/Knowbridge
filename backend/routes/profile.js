// ===== โปรไฟล์ของฉัน / โปรไฟล์สาธารณะ / คะแนนและรีวิวของผู้ใช้ =====
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { PRIVACY_VERSION } = require("../lib/accountData");
const { MAX_SKILLS_PER_TYPE } = require("../lib/skillCatalog");
const { emailFeaturesEnabled } = require("../lib/mailer");

// 1. ตั้งค่า Multer เพื่ออัปโหลดไฟล์รูปภาพ[cite: 9]
const uploadDir = path.join(__dirname, "../../frontend/uploads/avatars");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // ใช้ชื่อไฟล์เป็นเวลาปัจจุบัน + นามสกุลไฟล์เดิม
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});

// กรองให้รับเฉพาะไฟล์รูปภาพ ไม่เกิน 2MB
const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("รับเฉพาะไฟล์รูปภาพเท่านั้น"));
    }
  },
});

module.exports = function profileRouter({
  db,
  ObjectId,
  requireLogin,
  isValidId,
  moderation,
  getRatings,
  getReviewsFor,
}) {
  const router = express.Router();

  router.get("/profile", requireLogin, async (req, res) => {
    try {
      const user = await db.users.findOne(
        { _id: new ObjectId(req.session.userId) },
        { projection: { password: 0 } },
      );
      const userSkills = await db.user_skills
        .find({ user_id: new ObjectId(req.session.userId) })
        .toArray();
      const skillsWithInfo = await Promise.all(
        userSkills.map(async (us) => {
          const skill = await db.skills.findOne({ _id: us.skill_id });
          return {
            ...us,
            skill_id: us.skill_id.toString(),
            skill_name: skill?.name,
            category: skill?.category,
          };
        }),
      );
      req.session.isAdmin = moderation.isAdminEmail(user?.email);
      res.json({
        user,
        skills: skillsWithInfo,
        is_admin: req.session.isAdmin,
        privacy_current: PRIVACY_VERSION,
        email_verification_enabled: emailFeaturesEnabled(),
      });
    } catch (e) {
      res.json({ user: null, skills: [] });
    }
  });

  // 2. ใช้เครื่องมือ upload.single('avatar') เพื่อดักจับไฟล์[cite: 9]
  router.post(
    "/profile/update",
    requireLogin,
    upload.single("avatar"),
    async (req, res) => {
      try {
        const me = new ObjectId(req.session.userId);
        const clean = (list) => [
          ...new Set((Array.isArray(list) ? list : []).filter(isValidId)),
        ];

        // 3. แปลงค่าทักษะที่ส่งมาในรูปแบบ JSON String ให้กลายเป็น Array ก่อนใช้งาน[cite: 9]
        let teachArray = [];
        let learnArray = [];
        try {
          if (req.body.teach_skills)
            teachArray = JSON.parse(req.body.teach_skills);
          if (req.body.learn_skills)
            learnArray = JSON.parse(req.body.learn_skills);
        } catch (err) {
          console.error("Error parsing skills", err);
        }

        const teach = clean(teachArray);
        const learn = clean(learnArray).filter((id) => !teach.includes(id));

        if (
          teach.length > MAX_SKILLS_PER_TYPE ||
          learn.length > MAX_SKILLS_PER_TYPE
        )
          return res.json({
            success: false,
            error: `เลือกได้ไม่เกิน ${MAX_SKILLS_PER_TYPE} ทักษะต่อประเภท`,
          });

        const existing = await db.skills
          .find(
            {
              _id: { $in: [...teach, ...learn].map((id) => new ObjectId(id)) },
            },
            { projection: { _id: 1 } },
          )
          .toArray();
        const valid = new Set(existing.map((s) => s._id.toString()));
        const docs = [
          ...teach
            .filter((id) => valid.has(id))
            .map((id) => ({
              user_id: me,
              skill_id: new ObjectId(id),
              type: "teach",
            })),
          ...learn
            .filter((id) => valid.has(id))
            .map((id) => ({
              user_id: me,
              skill_id: new ObjectId(id),
              type: "learn",
            })),
        ];

        // 4. จัดเตรียมข้อมูลที่จะอัปเดต โดยเพิ่ม URL รูปภาพ (ถ้ามีไฟล์แนบมา)[cite: 9]
        const updateData = {
          bio: String(req.body.bio || "").slice(0, 500),
        };

        if (req.file) {
          // เก็บ Path หรือ URL เพื่อไปแสดงบนหน้าเว็บ (ตามโครงสร้างโฟลเดอร์ของโปรเจกต์คุณ)
          updateData.avatar_url = `/uploads/avatars/${req.file.filename}`;
        }

        await db.users.updateOne({ _id: me }, { $set: updateData });
        await db.user_skills.deleteMany({ user_id: me });
        if (docs.length) await db.user_skills.insertMany(docs);
        res.json({ success: true });
      } catch (e) {
        console.error(e);
        res.json({ success: false, error: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
      }
    },
  );

  router.get("/user/:userId/rating", async (req, res) => {
    try {
      if (!isValidId(req.params.userId))
        return res.json({ avg: null, count: 0 });
      const ratings = await getRatings([new ObjectId(req.params.userId)]);
      res.json(ratings[req.params.userId] || { avg: null, count: 0 });
    } catch (e) {
      res.json({ avg: null, count: 0 });
    }
  });

  router.get("/user/:userId/reviews", async (req, res) => {
    try {
      if (!isValidId(req.params.userId)) return res.json([]);
      res.json(await getReviewsFor(new ObjectId(req.params.userId)));
    } catch (e) {
      res.json([]);
    }
  });

  router.get("/user/:userId/profile", async (req, res) => {
    try {
      if (!isValidId(req.params.userId))
        return res.status(404).json({ error: "ไม่พบผู้ใช้" });
      const userId = new ObjectId(req.params.userId);
      const user = await db.users.findOne(
        { _id: userId },
        {
          projection: { username: 1, bio: 1, email_verified: 1, avatar_url: 1 },
        },
      );
      const { blockedByMe, blockedMe } = await moderation.blockSets(
        req.session.userId,
      );
      const isBanned = moderation.banned.has(req.params.userId);
      if (
        !user ||
        ((isBanned || blockedMe.has(req.params.userId)) && !req.session.isAdmin)
      )
        return res.status(404).json({ error: "ไม่พบผู้ใช้" });
      user.blocked_by_me = blockedByMe.has(req.params.userId);
      user.banned = isBanned;
      const userSkills = await db.user_skills
        .find({ user_id: userId })
        .toArray();
      const skillDocs = await db.skills
        .find({ _id: { $in: userSkills.map((us) => us.skill_id) } })
        .toArray();
      const skills = userSkills.map((us) => {
        const sk = skillDocs.find((s) => s._id.equals(us.skill_id));
        return { type: us.type, skill_name: sk?.name, category: sk?.category };
      });
      const rating = (await getRatings([userId]))[req.params.userId] || {
        avg: null,
        count: 0,
      };
      res.json({ user, skills, rating, reviews: await getReviewsFor(userId) });
    } catch (e) {
      res.status(500).json({ error: "เกิดข้อผิดพลาด" });
    }
  });

  return router;
};
