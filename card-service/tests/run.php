<?php
declare(strict_types=1);

// เทสการวาดการ์ด (ไม่ต้องต่อเว็บหลัก):  php card-service/tests/run.php
require __DIR__ . '/../src/CardRenderer.php';
require __DIR__ . '/../src/KnowBridgeClient.php';

use KnowBridge\Card\CardRenderer;
use KnowBridge\Card\KnowBridgeClient;

$results = [];
function check(string $name, bool $ok, string $extra = ''): void
{
    global $results;
    $results[] = [$ok, $name, $extra];
}

$renderer = new CardRenderer('https://knowbridge.example');
$profile = [
    'user' => ['_id' => str_repeat('a', 24), 'username' => 'Mai.english', 'bio' => "เรียนอักษรฯ   เอกภาษาอังกฤษ\nเคยติวสอบ IELTS", 'email_verified' => true],
    'skills' => [
        ['type' => 'teach', 'skill_name' => 'English', 'category' => 'Language'],
        ['type' => 'teach', 'skill_name' => 'Public Speaking', 'category' => 'Other'],
        ['type' => 'learn', 'skill_name' => 'UI/UX Design', 'category' => 'IT'],
    ],
    'rating' => ['avg' => 4.5, 'count' => 2],
];
$svg = $renderer->render($profile);
$xml = @simplexml_load_string($svg);
check('ได้ SVG ที่เป็น XML ถูกต้อง', $xml !== false && $xml->getName() === 'svg');
check('มีชื่อ คะแนน และป้ายยืนยันอีเมล', str_contains($svg, 'Mai.english') && str_contains($svg, '4.5 · 2 รีวิว') && str_contains($svg, 'ยืนยันอีเมลแล้ว'));
check('มีทักษะที่สอนได้และอยากเรียน', str_contains($svg, 'Public Speaking') && str_contains($svg, 'UI/UX Design'));
check('แนะนำตัวรวมช่องว่าง/ขึ้นบรรทัดให้เป็นบรรทัดเดียว', str_contains($svg, 'เรียนอักษรฯ เอกภาษาอังกฤษ เคยติวสอบ IELTS'));
check('มีชื่อเว็บที่มุมขวาล่าง', str_contains($svg, 'knowbridge.example'));

// ข้อความจากผู้ใช้ต้องไม่กลายเป็นแท็ก SVG
$evil = $profile;
$evil['user']['username'] = '<script>x</script>';
$evil['user']['bio'] = '"><image href="x" onerror="alert(1)"/>';
$evil['skills'][0]['skill_name'] = '</text><script>alert(1)</script>';
$svgEvil = $renderer->render($evil);
check('escape ข้อความจากผู้ใช้ (ไม่มีแท็ก script/image หลุด)',
    @simplexml_load_string($svgEvil) !== false && !str_contains($svgEvil, '<script') && !str_contains($svgEvil, '<image'));

// ไม่มีรีวิว / ไม่มีทักษะ / ไม่ได้ยืนยันอีเมล
$empty = ['user' => ['username' => 'Newbie', 'bio' => ''], 'skills' => [], 'rating' => ['avg' => null, 'count' => 0]];
$svgEmpty = $renderer->render($empty);
check('ผู้ใช้ใหม่: บอกว่ายังไม่มีรีวิว และไม่มีป้ายยืนยัน', str_contains($svgEmpty, 'ยังไม่มีรีวิว') && !str_contains($svgEmpty, 'ยืนยันอีเมล'));

// ทักษะเยอะ → ป้ายขึ้นบรรทัดใหม่ และการ์ดสูงขึ้น
$many = $profile;
$many['skills'] = array_map(fn ($n) => ['type' => 'teach', 'skill_name' => $n], ['Python Programming', 'JavaScript', 'Drawing & Illustration', 'Chinese (Mandarin)', 'Singing & Vocal']);
$heightOf = fn (string $s) => (int) simplexml_load_string($s)['height'];
check('ทักษะเยอะ → การ์ดสูงขึ้นตาม (ป้ายขึ้นบรรทัดใหม่)', $heightOf($renderer->render($many)) > $heightOf($svg));
check('ป้ายทุกอันอยู่ในขอบการ์ด', (function () use ($renderer, $many) {
    $xml = simplexml_load_string($renderer->render($many));
    foreach ($xml->xpath('//*[local-name()="rect"][@rx="15"]') as $rect) {
        if ((float) $rect['x'] + (float) $rect['width'] > 600 - 32 + 0.5) return false;
    }
    return true;
})());

// ชื่อยาวมากถูกตัดด้วย …
$long = CardRenderer::fitWidth(str_repeat('ภาษาญี่ปุ่น ', 20), 200, 14);
check('ข้อความยาวเกินถูกตัดด้วย …', str_ends_with($long, '…') && CardRenderer::textWidth($long, 14) <= 200);

// สีรูปโปรไฟล์ต้องตรงกับหน้าเว็บ (ค่าจาก hueFor() ใน frontend/js/app.js)
// ค่าที่คาดไว้คำนวณจาก hueFor() ใน frontend/js/app.js — แก้สูตรฝั่งไหนต้องแก้อีกฝั่งด้วย
check('สีรูปโปรไฟล์ตรงกับหน้าเว็บ', CardRenderer::hueFor('Mai.english') === 170 && CardRenderer::hueFor('ณัฐ') === 45);

check('ตรวจรูปแบบ id ของผู้ใช้', KnowBridgeClient::isValidUserId(str_repeat('a', 24)) && !KnowBridgeClient::isValidUserId('../../etc/passwd') && !KnowBridgeClient::isValidUserId(str_repeat('a', 25)));

$msg = $renderer->renderMessage('ไม่พบผู้ใช้นี้', 'ลองใหม่');
check('การ์ดข้อความ (ไม่พบผู้ใช้) เป็น SVG ที่ถูกต้อง', @simplexml_load_string($msg) !== false && str_contains($msg, 'ไม่พบผู้ใช้นี้'));

$fails = 0;
foreach ($results as [$ok, $name, $extra]) {
    echo ($ok ? 'PASS' : 'FAIL') . "  {$name}" . ($extra !== '' ? "  — {$extra}" : '') . "\n";
    if (!$ok) $fails++;
}
echo "\n" . (count($results) - $fails) . '/' . count($results) . " passed (PHP " . PHP_VERSION . ")\n";
exit($fails ? 1 : 0);
