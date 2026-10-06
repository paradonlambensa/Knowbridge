<?php
declare(strict_types=1);

// หน้าแรกของบริการการ์ด: ใส่ลิงก์โปรไฟล์หรือ id ของผู้ใช้ แล้วดูการ์ด / คัดลอกลิงก์ไปใช้
require __DIR__ . '/../src/bootstrap.php';

use KnowBridge\Card\KnowBridgeClient;

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");

// รับได้ทั้ง id ตรง ๆ และลิงก์ที่มี id อยู่ข้างใน
$input = is_string($_GET['user'] ?? null) ? trim($_GET['user']) : '';
$userId = preg_match('/[0-9a-f]{24}/', $input, $m) === 1 ? $m[0] : '';
$cardPath = $userId !== '' ? 'card.php?user=' . $userId : '';
$scheme = (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || !empty($_SERVER['HTTPS'])) ? 'https' : 'http';
$host = preg_match('/^[A-Za-z0-9.-]+(:\d+)?$/', $_SERVER['HTTP_HOST'] ?? '') === 1 ? $_SERVER['HTTP_HOST'] : 'localhost';
$cardUrl = $cardPath !== '' ? "{$scheme}://{$host}/{$cardPath}" : '';
$e = fn (string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>การ์ดโปรไฟล์ KnowBridge</title>
  <style>
    body { margin: 0; font-family: Sarabun, 'Noto Sans Thai', 'Leelawadee UI', Tahoma, sans-serif; background: #F6F9FE; color: #0F172A; }
    main { max-width: 680px; margin: 0 auto; padding: 40px 16px; }
    h1 { color: #0B2A5B; margin: 0 0 6px; font-size: 1.7rem; }
    p { color: #475569; line-height: 1.7; }
    form { display: flex; gap: 8px; margin: 20px 0; flex-wrap: wrap; }
    input { flex: 1; min-width: 220px; padding: 10px 12px; border: 1px solid #C9D8F0; border-radius: 8px; font: inherit; }
    button, .btn { padding: 10px 18px; border: 0; border-radius: 8px; background: #2563EB; color: #fff; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn.outline { background: #fff; color: #2563EB; border: 1px solid #C9D8F0; }
    img { width: 100%; height: auto; display: block; margin: 16px 0; }
    code { background: #EAF1FE; padding: 2px 6px; border-radius: 6px; word-break: break-all; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    small { color: #94A3B8; }
  </style>
</head>
<body>
<main>
  <h1>การ์ดโปรไฟล์ KnowBridge</h1>
  <p>สร้างรูปการ์ดจากโปรไฟล์สาธารณะบน <a href="<?= $e($apiUrl) ?>">KnowBridge</a> (ชื่อ คะแนน ทักษะที่สอนได้และอยากเรียน)
    เอาไปแนบในพอร์ตโฟลิโอ หรือแชร์ให้เพื่อนได้ — บริการนี้เขียนด้วย PHP</p>
  <form method="get">
    <input name="user" value="<?= $e($input) ?>" placeholder="วางลิงก์โปรไฟล์ หรือ id ของผู้ใช้" aria-label="ลิงก์โปรไฟล์หรือ id ของผู้ใช้" />
    <button type="submit">ดูการ์ด</button>
  </form>
<?php if ($input !== '' && $userId === ''): ?>
  <p>ไม่พบ id ของผู้ใช้ในสิ่งที่ใส่มา — id เป็นตัวอักษร a–f และตัวเลข ยาว 24 ตัว</p>
<?php elseif ($cardUrl !== ''): ?>
  <img src="<?= $e($cardPath) ?>" alt="การ์ดโปรไฟล์" />
  <div class="actions">
    <a class="btn" href="<?= $e($cardPath) ?>&amp;download=1">ดาวน์โหลด .svg</a>
    <a class="btn outline" href="<?= $e($cardPath) ?>" target="_blank" rel="noopener">เปิดรูปในแท็บใหม่</a>
  </div>
  <p>ลิงก์รูปนี้ใช้แนบในเว็บอื่นได้: <code><?= $e($cardUrl) ?></code></p>
<?php endif; ?>
  <p><small>เว็บหลักบน Render แบบฟรีอาจกำลังหลับอยู่ ถ้าการ์ดยังไม่ขึ้นให้รอสักครู่แล้วโหลดใหม่</small></p>
</main>
</body>
</html>
