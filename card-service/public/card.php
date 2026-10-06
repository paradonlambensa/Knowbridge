<?php
declare(strict_types=1);

// GET /card.php?user=<id>             → การ์ดโปรไฟล์เป็นรูป SVG (แนบในเว็บ/พอร์ตได้)
// GET /card.php?user=<id>&download=1  → ดาวน์โหลดเป็นไฟล์ .svg
require __DIR__ . '/../src/bootstrap.php';

use KnowBridge\Card\KnowBridgeClient;

header('Content-Type: image/svg+xml; charset=utf-8');
header('X-Content-Type-Options: nosniff');
// เปิดไฟล์ SVG ตรง ๆ ในเบราว์เซอร์ก็รันสคริปต์อะไรไม่ได้
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'");

$userId = is_string($_GET['user'] ?? null) ? $_GET['user'] : '';
if (!KnowBridgeClient::isValidUserId($userId)) {
    http_response_code(400);
    header('Cache-Control: no-store');
    echo $renderer->renderMessage('ลิงก์การ์ดไม่ถูกต้อง', 'ต้องระบุ ?user=<id ของผู้ใช้ KnowBridge>');
    exit;
}

$result = $client->fetchProfile($userId);
if ($result['status'] === 404) {
    http_response_code(404);
    header('Cache-Control: public, max-age=300');
    echo $renderer->renderMessage('ไม่พบผู้ใช้นี้', 'บัญชีอาจถูกลบ ถูกระงับ หรือลิงก์ไม่ถูกต้อง');
    exit;
}
if ($result['status'] !== 200) {
    http_response_code(502);
    header('Cache-Control: no-store');
    echo $renderer->renderMessage('ติดต่อ KnowBridge ไม่ได้', 'เว็บหลักอาจกำลังตื่นจากโหมดพัก ลองโหลดใหม่อีกครั้งใน 1 นาที');
    exit;
}

$profile = $result['profile'];
header('Cache-Control: public, max-age=600');
if (isset($_GET['download'])) {
    // ชื่อไฟล์ใช้เฉพาะตัวอักษรอังกฤษ/ตัวเลข — ชื่อผู้ใช้ภาษาไทยจะใช้ id แทน
    $safe = preg_replace('/[^A-Za-z0-9_.-]/', '', (string) $profile['user']['username']) ?: $userId;
    header('Content-Disposition: attachment; filename="knowbridge-' . $safe . '.svg"');
}
echo $renderer->render($profile);
