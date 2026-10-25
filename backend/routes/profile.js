// ===== โปรไฟล์ของฉัน / โปรไฟล์สาธารณะ / คะแนนและรีวิวของผู้ใช้ =====
const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { PRIVACY_VERSION } = require("../lib/accountData");
const { MAX_SKILLS_PER_TYPE } = require("../lib/skillCatalog");
const { emailFeaturesEnabled } = require("../lib/mailer");

// รูปโปรไฟล์เก็บที่ Cloudinary (ดิสก์ของ Render แบบฟรีหายทุกครั้งที่ deploy/restart)
// ตั้ง CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET ใน Render
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: new CloudinaryStorage({
    cloudinary,
    params: {
      folder: "avatars",
      allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
      transformation: [{ width: 400, height: 400, crop: "limit" }],
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // ไม่เกิน 2MB
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith("image/")
      ? cb(null, true)
      : cb(new Error("รับเฉพาะไฟล์รูปภาพเท่านั้น")),
});

// อัปโหลดไม่ผ่าน (ไฟล์ใหญ่ / ไม่ใช่รูป / ยังไม่ได้ตั้ง Cloudinary) → ตอบเป็นข้อความให้ผู้ใช้ ไม่ใช่ 500
function avatarUpload(req, res, next) {
  upload.single("avatar")(req, res, (err) => {
    if (!err) return next();
    if (err.code !== "LIMIT_FILE_SIZE") console.error("avatar upload:", err);
    res.json({
      success: false,
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "รูปต้องมีขนาดไม่เกิน 2MB"
          : "อัปโหลดรูปไม่สำเร็จ — รับเฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)",
    });
  });
}

// หน้าเว็บส่งทักษะมาเป็น JSON string ใน FormData / ส่งเป็น JSON ปกติก็ได้ (เช่นในชุดทดสอบ)
function toList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

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

  router.post(
    "/profile/update",
    requireLogin,
    avatarUpload,
    async (req, res) => {
      try {
        const me = new ObjectId(req.session.userId);
        const clean = (list) => [...new Set(list.filter(isValidId))];
        const teach = clean(toList(req.body.teach_skills));
        // ทักษะเดียวกันจะ "สอน" และ "อยากเรียน" พร้อมกันไม่ได้ — ให้ฝั่งสอนชนะ
        const learn = clean(toList(req.body.learn_skills)).filter(
          (id) => !teach.includes(id),
        );
        if (
          teach.length > MAX_SKILLS_PER_TYPE ||
          learn.length > MAX_SKILLS_PER_TYPE
        )
          return res.json({
            success: false,
            error: `เลือกได้ไม่เกิน ${MAX_SKILLS_PER_TYPE} ทักษะต่อประเภท`,
          });

        // เก็บเฉพาะทักษะที่มีอยู่จริงในแคตตาล็อก
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

        const updateData = { bio: String(req.body.bio || "").slice(0, 500) };
        // multer-storage-cloudinary ใส่ URL ของรูปที่อัปโหลดแล้วไว้ใน req.file.path
        if (req.file) updateData.avatar_url = req.file.path;

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
