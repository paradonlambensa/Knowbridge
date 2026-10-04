const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const { MongoStore } = require('connect-mongo');
const { db, ObjectId, client, dbName, ready, CI, DEMO_EMAILS } = require('./database');
const createModeration = require('./lib/moderation');
const createNotifier = require('./lib/notifier');
const createExchangeHelpers = require('./lib/exchangeHelpers');
const createEmailVerification = require('./lib/emailVerification');
const setupSocket = require('./lib/socket');
const limits = require('./lib/limits');
// API แยกตามเรื่อง — แต่ละไฟล์รับของที่ต้องใช้ผ่าน routeDeps ด้านล่าง
const ROUTERS = ['auth', 'skills', 'skillRequests', 'profile', 'exchange', 'notifications', 'posts', 'moderation', 'account', 'stats']
  .map(name => require('./routes/' + name));
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;
const SESSION_TTL = 24 * 60 * 60; // วินาที
const moderation = createModeration({ db, ObjectId });
ready.then(() => moderation.loadBanned());
if ((process.env.RENDER || process.env.NODE_ENV === 'production') && !process.env.SESSION_SECRET) {
  console.warn('⚠️ ยังไม่ได้ตั้ง SESSION_SECRET — ค่าเริ่มต้นอยู่ในโค้ดสาธารณะ ใครก็ปลอม session ได้');
}

// Render/โฮสต์ส่วนใหญ่อยู่หลัง proxy ที่ทำ HTTPS ให้ — ต้องเชื่อ proxy ถึงจะตั้งคุกกี้ secure ได้
app.set('trust proxy', 1);
// security headers (helmet): ห้ามเว็บอื่นเอาไปฝังใน iframe, จำกัดที่มาของสคริปต์/สไตล์/ฟอนต์ ฯลฯ
// หน้าเว็บยังใช้ onclick="..." และสคริปต์สั้น ๆ ใน <head> เลยต้องอนุญาต inline script
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      // ตอนรันในเครื่องเป็น http — ไม่บังคับเปลี่ยนเป็น https
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// หน้าแรก: ใส่ URL เต็มของเว็บลงใน meta การ์ดแชร์ลิงก์ (LINE/Facebook ต้องการลิงก์รูปแบบเต็ม)
// ใช้ได้ทุกโดเมนโดยไม่ต้องแก้ไฟล์ — Host แปลก ๆ ไม่ถูกใส่ลงหน้าเว็บ
const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
app.get(['/', '/index.html'], async (req, res, next) => {
  try {
    const host = req.get('host') || '';
    const origin = process.env.APP_URL
      || (/^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `${req.protocol}://${host}` : '');
    const html = await fs.readFile(INDEX_PATH, 'utf8');
    res.type('html').send(html.replaceAll('__ORIGIN__', origin.replace(/\/$/, '')));
  } catch (e) {
    next(e);
  }
});
app.use(express.static('public', { index: false }));
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'knowbridge-secret-2024',
  resave: false,
  saveUninitialized: false,
  // เก็บ session ใน MongoDB ไม่หลุด login ตอน server restart หรือ Render free หลับ
  store: MongoStore.create({
    clientPromise: ready.then(() => client),
    dbName,
    collectionName: 'sessions',
    ttl: SESSION_TTL,
    touchAfter: 60 * 60
  }),
  cookie: { maxAge: SESSION_TTL * 1000, httpOnly: true, sameSite: 'lax', secure: 'auto' }
});
app.use(sessionMiddleware);
// ให้ socket.io ใช้ session เดียวกับ express เพื่อรู้ว่าใครเป็นคนส่งข้อความ
io.engine.use(sessionMiddleware);
app.use('/api', limits.api);

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'กรุณา Login ก่อน' });
  // ถูกระงับระหว่างที่ยัง login อยู่ → ตัด session ทิ้งทันที
  if (moderation.banned.has(req.session.userId)) {
    return req.session.destroy(() => res.status(401).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน' }));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(403).json({ success: false, error: 'สำหรับแอดมินเท่านั้น' });
  next();
}

function isValidId(id) {
  return typeof id === 'string' && ObjectId.isValid(id);
}

// ทุก socket ของผู้ใช้ join ห้อง user:<id> ไว้ ส่งแจ้งเตือนถึงทุกแท็บที่เปิดอยู่ได้ในครั้งเดียว
// และเก็บลง DB ให้กระดิ่งเปิดดูย้อนหลังได้ (lib/notifier.js)
const notify = createNotifier({ db, io, ObjectId });
const helpers = createExchangeHelpers({ db, ObjectId, isValidId });
const emailVerification = createEmailVerification({ db });

const routeDeps = {
  db, ObjectId, io, notify, requireLogin, requireAdmin, isValidId, moderation, limits, CI, DEMO_EMAILS, emailVerification, ...helpers
};
for (const router of ROUTERS) app.use('/api', router(routeDeps));
setupSocket(routeDeps);

httpServer.listen(PORT, () => {
  console.log(`🌉 KnowBridge running at http://localhost:${PORT}`);
});
