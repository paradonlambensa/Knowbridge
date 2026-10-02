# KnowBridge — เชื่อมความรู้ เชื่อมคน

แพลตฟอร์มแลกเปลี่ยนทักษะ: คุณสอนสิ่งที่คุณเก่ง แลกกับการเรียนสิ่งที่คุณอยากรู้
จากคนที่เก่งเรื่องนั้น — ไม่มีค่าเรียน มีแต่การแลกกัน

ระบบจับคู่คนสอนกับคนเรียน มีระบบสมาชิก คำขอแลกเปลี่ยน และแชทเรียลไทม์ในตัว

> **In short:** a skill-swap platform. Users list what they can teach and what
> they want to learn, search for a match, send an exchange request, and chat in
> real time once it's accepted. Node.js + Express + MongoDB + Socket.IO, with a
> plain HTML/CSS/JS frontend and no build step.

---

## เส้นทางการใช้งาน

```
สมัครสมาชิก
   ↓
ตั้งโปรไฟล์ — เลือกทักษะที่ "สอนได้" และที่ "อยากเรียน"
   ↓
ค้นหา — หาคนที่สอนทักษะที่เราอยากเรียน (กรองตามชื่อ/หมวดหมู่)
   ↓
ส่งคำขอแลกเปลี่ยน พร้อมข้อความแนะนำตัว
   ↓
อีกฝ่ายเห็นใน Dashboard → ตอบรับ หรือ ปฏิเสธ
   ↓
แชทกันแบบเรียลไทม์ในห้องของคำขอนั้น
```

## ฟีเจอร์

**ระบบสมาชิก**
- สมัคร / เข้าสู่ระบบ / ออกจากระบบ
- รหัสผ่านเข้ารหัสด้วย bcrypt ไม่เก็บเป็นข้อความธรรมดา
- จัดการ session ด้วยคุกกี้ อายุ 24 ชั่วโมง
- กันสมัครซ้ำทั้ง username และ email

**โปรไฟล์และทักษะ**
- เขียน bio แนะนำตัว
- เลือกทักษะจากแคตตาล็อกกลาง แยกเป็น "สอนได้" กับ "อยากเรียน"
- แคตตาล็อกมี 25 ทักษะ ใน 5 หมวด: IT, Language, Art, Music, Other

**ค้นหาและจับคู่**
- ช่องค้นหาอยู่บนสุดของหน้า ผลลัพธ์อัปเดตทันทีที่พิมพ์ กรองหมวดหมู่ด้วยปุ่มกดเดียว
- ผลลัพธ์ไม่แสดงตัวเราเอง

**คำขอแลกเปลี่ยน**
- ส่งคำขอพร้อมข้อความ สถานะเริ่มต้นเป็น `pending`
- หน้า "คำขอของฉัน" แยกแท็บ ได้รับ / ส่งไป พร้อมป้ายสถานะสีของแต่ละคำขอ
- ตอบรับ / ปฏิเสธ และลบคำขอได้ทั้งสองฝ่าย

**แชทเรียลไทม์**
- ห้องแชทผูกกับคำขอแลกเปลี่ยนแต่ละรายการ
- ข้อความเข้าทันทีผ่าน Socket.IO และบันทึกลงฐานข้อมูล เปิดใหม่ก็ยังอยู่

**รีวิวและคะแนน**
- ให้คะแนน 1–5 ดาวพร้อมความคิดเห็น หลังคำขอถูกตอบรับ ได้ครั้งเดียวต่อคำขอ
- คะแนนเฉลี่ยแสดงบนการ์ดผลค้นหา กดดูโปรไฟล์เพื่ออ่านรีวิวทั้งหมดได้

**แจ้งเตือน**
- เด้งแจ้งเตือนทันทีเมื่อมีคำขอใหม่ คำขอถูกตอบรับ/ปฏิเสธ หรือมีข้อความใหม่ — กดที่แจ้งเตือนเพื่อไปยังหน้านั้น
- ตัวเลขบนเมนู Dashboard และบนแท็บเบราว์เซอร์ = คำขอที่รอเราตอบ + ข้อความที่ยังไม่อ่าน
- ปุ่มแชทแต่ละห้องบอกจำนวนข้อความที่ยังไม่อ่าน เปิดแชทแล้วนับว่าอ่านแล้ว

## เทคโนโลยีที่ใช้

| ส่วน | ใช้อะไร |
|---|---|
| Runtime | Node.js |
| เว็บเซิร์ฟเวอร์ | Express 5 |
| ฐานข้อมูล | MongoDB Atlas (ใช้ไดรเวอร์ `mongodb` ตรง ๆ ไม่ผ่าน ODM) |
| Session | `express-session` + `connect-mongo` (เก็บใน MongoDB ไม่หายตอน restart) |
| เข้ารหัสรหัสผ่าน | `bcryptjs` |
| เรียลไทม์ | `Socket.IO` |
| หน้าเว็บ | HTML + CSS + JavaScript ล้วน ไม่มีเฟรมเวิร์ก ไม่ต้อง build |

## โครงไฟล์

```
Knowbridge/
├── server.js          ← Express app, REST API ทั้งหมด และ Socket.IO handler
├── database.js        ← เชื่อม MongoDB, ประกาศ collection, และ seed ข้อมูลตัวอย่าง
├── package.json
├── public/            ← เสิร์ฟเป็น static ทั้งโฟลเดอร์
│   ├── index.html     ← หน้าเดียวจบ ส่วนที่เหลือเป็น modal
│   ├── css/style.css  ← สไตล์ทั้งหมด — สีของทั้งแอปตั้งไว้ใน `:root` ด้านบนไฟล์
│   ├── js/app.js      ← เรียก API, จัดการ modal, และ Socket.IO ฝั่ง client
│   └── image/         ← โลโก้ (`logo-mark.png` = เฉพาะสัญลักษณ์ ใช้บน navbar พื้นขาว)
├── test/e2e.js        ← เทส flow ทั้งหมดผ่าน HTTP + Socket.IO (`npm test`)
└── render.yaml        ← Blueprint สำหรับ deploy ขึ้น Render
```

## วิธีรัน

ต้องมี Node.js และฐานข้อมูล MongoDB (ใช้ [MongoDB Atlas](https://www.mongodb.com/atlas) ฟรีได้)

```bash
git clone https://github.com/paradonlambensa/Knowbridge.git
cd Knowbridge
npm install
```

สร้างไฟล์ `.env` ที่รากโปรเจค:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
SESSION_SECRET=ใส่ค่าสุ่มยาว ๆ ของคุณเอง
PORT=3000
MONGODB_DB=knowbridge_dev
```

| ตัวแปร | จำเป็น | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|---|
| `MONGODB_URI` | ✅ | — | ไม่มีตัวนี้เชื่อมฐานข้อมูลไม่ได้ |
| `SESSION_SECRET` | ⚠️ | `knowbridge-secret-2024` | **ต้องตั้งเองก่อนใช้งานจริง** ค่าเริ่มต้นอยู่ในโค้ดสาธารณะ ใครก็ปลอม session ได้ |
| `PORT` | ❌ | `3000` | |
| `MONGODB_DB` | ❌ | `knowbridge` | ชื่อฐานข้อมูลใน cluster — **ตอนรันในเครื่องให้ตั้งเป็นชื่ออื่น** (เช่น `knowbridge_dev`) ถ้าใช้ cluster เดียวกับเว็บจริง จะได้ไม่ไปเขียนทับข้อมูลจริง |

แล้วสั่ง:

```bash
npm start
```

เปิด http://localhost:3000

ฐานข้อมูลจะถูก seed ให้อัตโนมัติตอนเชื่อมต่อครั้งแรก โดยข้ามให้เองถ้ามีข้อมูลอยู่แล้ว

### เทส

```bash
npm test
```

เปิด server ให้เองกับฐานข้อมูล `knowbridge_test` (เปลี่ยนได้ด้วย `TEST_DB`) แล้วไล่เทส flow ทั้งหมด:
สมัคร → ค้นหา → ส่งคำขอ → ตอบรับ → แชท → แจ้งเตือน → รีวิว รวมถึงเคสความปลอดภัย
(คนนอกอ่านแชทไม่ได้, ปลอมผู้ส่ง/ผู้ถูกรีวิวไม่ได้) และ session ที่ต้องอยู่รอดหลัง restart server
สร้างบัญชีใหม่ทุกครั้ง รันซ้ำได้โดยไม่ต้องล้างข้อมูล — ถ้าจะเทสกับ server ที่เปิดอยู่แล้วให้ตั้ง `BASE_URL`

## ข้อมูลตัวอย่าง

ตอนรันครั้งแรกกับฐานข้อมูลเปล่า ระบบจะใส่ให้:

- **25 ทักษะ** ใน 5 หมวด (IT, Language, Art, Music, Other)
- **บัญชีทดลอง 3 บัญชี** รหัสผ่าน `demo1234` ทุกบัญชี
  | Email | Username | ทักษะ |
  |---|---|---|
  | `lxzy@demo.com` | Lxzywinn | สอน Python · อยากเรียน English |
  | `opie@demo.com` | Opie | สอน English · อยากเรียน JavaScript |
  | `chwwy@demo.com` | Chwwy | สอน Drawing & Illustration · อยากเรียน Python |

> ⚠️ บัญชีทดลองพวกนี้ถูกสร้างอัตโนมัติทุกครั้งที่เจอฐานข้อมูลเปล่า **รวมถึงฐานข้อมูลจริง**
> ถ้าจะ deploy ใช้งานจริง ควรปิด `seedUsers()` ใน `database.js` หรือลบบัญชีทิ้งหลัง deploy
> เพราะรหัสผ่านอยู่ในโค้ดสาธารณะ

## REST API

`✓` = ต้องเข้าสู่ระบบก่อน

| Method | Endpoint | Auth | ทำอะไร |
|---|---|:--:|---|
| `POST` | `/api/register` | | สมัครสมาชิก แล้วเข้าสู่ระบบให้เลย |
| `POST` | `/api/login` | | เข้าสู่ระบบ |
| `POST` | `/api/logout` | | ออกจากระบบ |
| `GET` | `/api/skills` | | รายการทักษะทั้งหมดในระบบ |
| `GET` | `/api/search?skill=&category=` | | หาคนที่สอนทักษะนั้น (ไม่รวมตัวเอง) |
| `GET` | `/api/profile` | ✓ | โปรไฟล์และทักษะของตัวเอง |
| `POST` | `/api/profile/update` | ✓ | แก้ bio และทักษะที่สอน/อยากเรียน |
| `POST` | `/api/exchange/request` | ✓ | ส่งคำขอแลกเปลี่ยน |
| `GET` | `/api/dashboard` | ✓ | คำขอที่ได้รับและที่ส่งไป พร้อมชื่อคู่สนทนา |
| `POST` | `/api/exchange/respond` | ✓ | ตอบรับหรือปฏิเสธคำขอ |
| `DELETE` | `/api/exchange/request/:id` | ✓ | ลบคำขอ (ทำได้ทั้งผู้ส่งและผู้รับ) |
| `GET` | `/api/chat/:requestId` | ✓ | ประวัติแชทของคำขอนั้น เรียงตามเวลา (เฉพาะคู่กรณี) และนับว่าอ่านแล้ว |
| `POST` | `/api/chat/:requestId/read` | ✓ | บันทึกว่าอ่านแชทนี้แล้ว |
| `GET` | `/api/notifications` | ✓ | จำนวนคำขอที่รอเราตอบ และข้อความที่ยังไม่อ่าน |
| `POST` | `/api/review` | ✓ | ให้คะแนน 1–5 กับอีกฝ่ายของคำขอที่ตอบรับแล้ว ได้ครั้งเดียวต่อคำขอ |
| `GET` | `/api/review/check/:requestId` | ✓ | เช็กว่ารีวิวคำขอนี้ไปแล้วหรือยัง |
| `GET` | `/api/user/:userId/rating` | | คะแนนเฉลี่ยและจำนวนรีวิว |
| `GET` | `/api/user/:userId/reviews` | | รีวิวทั้งหมดของผู้ใช้ ใหม่สุดก่อน |
| `GET` | `/api/user/:userId/profile` | | โปรไฟล์สาธารณะ: bio, ทักษะ, คะแนน และรีวิว |

## Socket.IO

| ทิศทาง | Event | Payload | ทำอะไร |
|---|---|---|---|
| client → server | `joinRoom` | `requestId` | เข้าห้องแชท — เฉพาะคู่กรณีของคำขอที่ตอบรับแล้ว |
| client → server | `sendMessage` | `{ requestId, text }` | บันทึกข้อความลง DB แล้วกระจายให้ทุกคนในห้อง (ผู้ส่งอ่านจาก session) |
| server → client | `newMessage` | ข้อความที่บันทึกแล้ว | มีข้อความใหม่เข้าห้อง |
| server → client | `notify` | `{ type, from, request_id?, preview?, at }` | แจ้งเตือน — `type` เป็น `request`, `accepted`, `rejected` หรือ `message` |

socket ที่ไม่ได้ login จะถูกตัดทันที และทุก socket ของผู้ใช้จะอยู่ในห้อง `user:<id>`
แจ้งเตือนจึงไปถึงทุกแท็บที่เปิดอยู่

## Collection ในฐานข้อมูล

| Collection | เก็บอะไร |
|---|---|
| `users` | username, email, รหัสผ่านที่ hash แล้ว, bio |
| `skills` | แคตตาล็อกทักษะกลาง (name, category) |
| `user_skills` | ผูก user กับ skill พร้อม `type` เป็น `teach` หรือ `learn` |
| `exchange_requests` | ผู้ส่ง, ผู้รับ, ข้อความ, สถานะ, เวลาที่สร้าง, `last_read` (เวลาที่แต่ละฝ่ายอ่านแชทล่าสุด) |
| `messages` | ข้อความแชท ผูกกับ `request_id` |
| `reviews` | คะแนน 1–5 และความคิดเห็น ผูกกับคำขอ ผู้รีวิว และผู้ถูกรีวิว (unique ต่อคำขอ+ผู้รีวิว) |
| `sessions` | session ของผู้ใช้ จัดการโดย `connect-mongo` หมดอายุเองใน 24 ชั่วโมง |

## Deploy

deploy ขึ้น [Render](https://render.com) ได้ฟรีผ่านไฟล์ `render.yaml` ที่รากโปรเจค
(web service แบบ free, region `singapore`, ใช้ Node ≥ 20.19 ตาม `engines` ใน `package.json`)

1. push โค้ดขึ้น GitHub
2. ใน Render Dashboard เลือก **New → Blueprint** แล้วเลือก repo นี้
3. กรอก `MONGODB_URI` ตอนที่ Render ถาม — `SESSION_SECRET` ระบบสุ่มให้เอง
4. ใน MongoDB Atlas → **Network Access** เพิ่ม `0.0.0.0/0` เพราะ IP ขาออกของ Render free ไม่คงที่

ไฟล์ `.env` ไม่ได้ถูก commit ขึ้นมาด้วย ค่าทั้งหมดตั้งใน Environment ของ Render

> ⚠️ แผน free จะหลับเมื่อไม่มีคนเข้าราว 15 นาที เปิดครั้งแรกหลังหลับจะช้าประมาณ 1 นาที
> (session เก็บใน MongoDB ผู้ใช้จึงไม่หลุด login ตอนระบบหลับ)

## ที่อยากทำต่อ

- [x] ระบบรีวิว/ให้คะแนนหลังแลกเปลี่ยนเสร็จ
- [x] เก็บ session ใน MongoDB แทนหน่วยความจำ จะได้ไม่หลุด login ตอน server restart
- [x] แจ้งเตือนเมื่อมีคำขอใหม่หรือข้อความใหม่
- [x] ล้าง `nedb-promises` กับไฟล์ `knowbridge.db` ที่เหลือจากตอนใช้ NeDB
- [x] เขียนเทสสำหรับ flow สมัคร → ส่งคำขอ → ตอบรับ → แชท → รีวิว
- [x] ทำ navbar ให้รองรับจอมือถือ (เมนู ☰ ที่จอกว้างไม่เกิน 960px)
- [ ] แบ่ง `server.js` เป็น route แยกไฟล์ ตอนนี้ route ทั้งหมดอยู่ไฟล์เดียว

---

โปรเจคนี้เป็นส่วนหนึ่งของผลงานใน [portfolio ออนไลน์](https://paradonlambensa.github.io/Portfolio-site/)
