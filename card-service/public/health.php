<?php
declare(strict_types=1);

// Render เรียกดูว่าบริการยังทำงาน — ไม่เรียกเว็บหลัก (เว็บหลักหลับอยู่ก็ยังตอบได้)
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
echo 'ok';
