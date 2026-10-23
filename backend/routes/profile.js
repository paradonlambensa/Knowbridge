// ===== โปรไฟล์ของฉัน / โปรไฟล์สาธารณะ / คะแนนและรีวิวของผู้ใช้ =====
const express = require("express");
const multer = require("multer");
// ไม่จำเป็นต้องใช้ path และ fs สำหรับการเก็บลงเครื่องแล้ว
const { PRIVACY_VERSION } = require("../lib/accountData");
const { MAX_SKILLS_PER_TYPE } = require("../lib/skillCatalog");
const { emailFeaturesEnabled } = require("../lib/mailer");

// 1. นำเข้าและตั้งค่า Cloudinary
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// นำ API Key จากหน้า Dashboard ของ Cloudinary มาใส่
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 2. ตั้งค่า Multer ให้ส่งไฟล์ไปที่ Cloudinary โดยตรง
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "avatars", // ชื่อโฟลเดอร์ที่จะสร้างใน Cloudinary
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"], // กำหนดประเภทไฟล์
    // transformation: [{ width: 500, height: 500, crop: 'limit' }] // สามารถย่อรูปก่อนเก็บได้
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // ไม่เกิน 2MB
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
    // ... (โค้ดเดิมของคุณ) ...
  });

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
        ) {
          return res.json({
            success: false,
            error: `เลือกได้ไม่เกิน ${MAX_SKILLS_PER_TYPE} ทักษะต่อประเภท`,
          });
        }

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

        const updateData = {
          bio: String(req.body.bio || "").slice(0, 500),
        };

        // 3. จัดเตรียมข้อมูลที่จะอัปเดต โดยใช้ URL ที่ได้จาก Cloudinary
        if (req.file) {
          // multer-storage-cloudinary จะคืนค่า URL ของรูปภาพกลับมาใน req.file.path
          updateData.avatar_url = req.file.path;
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

  // ... (โค้ด route อื่นๆ ด้านล่างเหมือนเดิม) ...

  return router;
};
