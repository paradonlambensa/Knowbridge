<?php
declare(strict_types=1);

// ===== ตั้งค่าบริการการ์ดโปรไฟล์ =====
// KNOWBRIDGE_API_URL = URL ของเว็บหลัก (Node.js) ที่จะดึงโปรไฟล์สาธารณะมา เช่น https://knowbridge-ufsn.onrender.com
require __DIR__ . '/KnowBridgeClient.php';
require __DIR__ . '/CardRenderer.php';

use KnowBridge\Card\CardRenderer;
use KnowBridge\Card\KnowBridgeClient;

$apiUrl = rtrim(getenv('KNOWBRIDGE_API_URL') ?: 'http://localhost:3000', '/');
$client = new KnowBridgeClient($apiUrl, sys_get_temp_dir());
$renderer = new CardRenderer($apiUrl);
