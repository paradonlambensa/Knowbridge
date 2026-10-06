<?php
declare(strict_types=1);

namespace KnowBridge\Card;

/**
 * วาดการ์ดโปรไฟล์เป็น SVG: รูปโปรไฟล์ ชื่อ คะแนน แนะนำตัว ทักษะที่สอนได้ / อยากเรียน
 * สีเดียวกับเว็บหลัก (frontend/css/style.css) — ข้อความทุกชิ้นผ่าน esc() ก่อนใส่ลง SVG
 */
final class CardRenderer
{
    private const WIDTH = 600;
    private const PAD = 32;
    // ต้องตรงกับ AVATAR_HUES ใน frontend/js/app.js — คนเดิมได้สีเดิมทั้งบนเว็บและบนการ์ด
    private const HUES = [217, 152, 330, 268, 28, 190, 45, 0, 290, 170];
    private const FONT = "Sarabun, 'Noto Sans Thai', 'Leelawadee UI', Tahoma, sans-serif";
    private const NAVY = '#0B2A5B';
    private const MUTED = '#64748B';
    private const BORDER = '#E3EAF5';
    private const CHIP = [
        'teach' => ['bg' => '#EAF1FE', 'fg' => '#1D4ED8', 'label' => 'สอนได้'],
        'learn' => ['bg' => '#E6F6FE', 'fg' => '#0369A1', 'label' => 'อยากเรียน'],
    ];

    public function __construct(private readonly string $siteUrl)
    {
    }

    public function render(array $profile): string
    {
        $user = $profile['user'];
        $name = (string) $user['username'];
        $rating = $profile['rating'] ?? ['avg' => null, 'count' => 0];
        $skills = $profile['skills'] ?? [];
        $hue = self::hueFor($name);
        $x0 = self::PAD;
        $maxX = self::WIDTH - self::PAD;

        // หัวการ์ด: วงกลมตัวอักษรแรก + ชื่อ + คะแนน
        $first = mb_strtoupper(mb_substr($name, 0, 1));
        $body = sprintf(
            '<circle cx="%d" cy="78" r="38" fill="hsl(%d, 85%%, 93%%)"/>'
            . '<text x="%d" y="90" font-size="32" font-weight="700" text-anchor="middle" fill="hsl(%d, 60%%, 36%%)">%s</text>',
            $x0 + 38, $hue, $x0 + 38, $hue, self::esc($first)
        );
        $textX = $x0 + 96;
        $body .= sprintf('<text x="%d" y="72" font-size="28" font-weight="700" fill="%s">%s</text>', $textX, self::NAVY, self::esc($name));
        $meta = $rating['avg'] !== null
            ? sprintf('<tspan fill="#F59E0B">★</tspan> %s · %d รีวิว', self::esc((string) $rating['avg']), (int) $rating['count'])
            : 'ยังไม่มีรีวิว';
        if (!empty($user['email_verified'])) {
            $meta .= ' · <tspan fill="#059669" font-weight="600">✓ ยืนยันอีเมลแล้ว</tspan>';
        }
        $body .= sprintf('<text x="%d" y="102" font-size="16" fill="%s">%s</text>', $textX, self::MUTED, $meta);

        // แนะนำตัว 1 บรรทัด (ยาวเกินตัดด้วย …)
        $y = 150;
        $bio = trim(preg_replace('/\s+/u', ' ', (string) ($user['bio'] ?? '')) ?? '');
        if ($bio !== '') {
            $body .= sprintf('<text x="%d" y="%d" font-size="15" fill="#475569">%s</text>',
                $x0, $y, self::esc(self::fitWidth($bio, $maxX - $x0, 15)));
            $y += 22;
        }

        // ทักษะ: ป้ายเรียงต่อกัน เต็มบรรทัดแล้วขึ้นบรรทัดใหม่
        foreach (self::CHIP as $type => $style) {
            $names = array_values(array_map(
                fn ($s) => (string) $s['skill_name'],
                array_filter($skills, fn ($s) => ($s['type'] ?? '') === $type && !empty($s['skill_name']))
            ));
            $body .= sprintf('<text x="%d" y="%d" font-size="14" font-weight="600" fill="%s">%s</text>',
                $x0, $y + 20, self::MUTED, $style['label']);
            if ($names === []) {
                $body .= sprintf('<text x="%d" y="%d" font-size="14" fill="#94A3B8">—</text>', $x0 + 92, $y + 20);
                $y += 42;
                continue;
            }
            [$chips, $bottom] = self::chips($names, $style['bg'], $style['fg'], $x0 + 92, $y, $maxX);
            $body .= $chips;
            $y = $bottom + 12;
        }

        return $this->frame($body, $y + 10, "การ์ดโปรไฟล์ของ {$name} บน KnowBridge");
    }

    /** การ์ดข้อความ (ไม่พบผู้ใช้ / ติดต่อเว็บหลักไม่ได้) */
    public function renderMessage(string $title, string $detail): string
    {
        $body = sprintf(
            '<text x="%d" y="92" font-size="24" font-weight="700" text-anchor="middle" fill="%s">%s</text>'
            . '<text x="%d" y="124" font-size="15" text-anchor="middle" fill="%s">%s</text>',
            self::WIDTH / 2, self::NAVY, self::esc($title), self::WIDTH / 2, self::MUTED, self::esc($detail)
        );
        return $this->frame($body, 170, $title);
    }

    /** กรอบการ์ด + แถบล่าง (ชื่อเว็บ) — ความสูงยืดตามจำนวนทักษะ */
    private function frame(string $body, int $contentBottom, string $title): string
    {
        $h = $contentBottom + 64;
        $footerY = $h - 30;
        $host = parse_url($this->siteUrl, PHP_URL_HOST) ?: $this->siteUrl;
        return sprintf(
            '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
            . '<svg xmlns="http://www.w3.org/2000/svg" width="%1$d" height="%2$d" viewBox="0 0 %1$d %2$d" role="img" font-family="%3$s">'
            . '<title>%4$s</title>'
            . '<defs><linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="#2563EB"/><stop offset="1" stop-color="#38BDF8"/></linearGradient>'
            . '<clipPath id="card"><rect width="%1$d" height="%2$d" rx="18"/></clipPath></defs>'
            . '<g clip-path="url(#card)">'
            . '<rect width="%1$d" height="%2$d" fill="#FFFFFF"/>'
            . '<circle cx="%1$d" cy="0" r="170" fill="#E6F6FE" opacity="0.7"/>'
            . '%5$s'
            . '<line x1="%6$d" x2="%7$d" y1="%8$d" y2="%8$d" stroke="%9$s"/>'
            . '<text x="%6$d" y="%10$d" font-size="16" font-weight="700" fill="%11$s">KnowBridge <tspan font-weight="400" fill="%12$s" font-size="14">· เชื่อมความรู้ เชื่อมคน</tspan></text>'
            . '<text x="%7$d" y="%10$d" font-size="13" text-anchor="end" fill="%12$s">%13$s</text>'
            . '<rect y="%14$d" width="%1$d" height="6" fill="url(#bar)"/>'
            . '</g>'
            . '<rect x="0.5" y="0.5" width="%15$d" height="%16$d" rx="18" fill="none" stroke="%9$s"/>'
            . '</svg>',
            self::WIDTH, $h, self::esc(self::FONT), self::esc($title), $body,
            self::PAD, self::WIDTH - self::PAD, $footerY - 26, self::BORDER, $footerY,
            self::NAVY, self::MUTED, self::esc($host), $h - 6, self::WIDTH - 1, $h - 1
        );
    }

    /** @return array{0: string, 1: int} SVG ของป้ายทั้งหมด และตำแหน่งขอบล่างของแถวสุดท้าย */
    private static function chips(array $names, string $bg, string $fg, int $x0, int $y, int $maxX): array
    {
        $height = 30;
        $x = $x0;
        $out = '';
        foreach ($names as $name) {
            $label = self::fitWidth($name, $maxX - $x0 - 24, 14);
            $w = (int) ceil(self::textWidth($label, 14)) + 24;
            if ($x + $w > $maxX && $x > $x0) {
                $x = $x0;
                $y += $height + 8;
            }
            $out .= sprintf(
                '<rect x="%d" y="%d" width="%d" height="%d" rx="15" fill="%s"/>'
                . '<text x="%d" y="%d" font-size="14" font-weight="600" fill="%s">%s</text>',
                $x, $y, $w, $height, $bg, $x + 12, $y + 20, $fg, self::esc($label)
            );
            $x += $w + 8;
        }
        return [$out, $y + $height];
    }

    /** ความกว้างโดยประมาณของข้อความ (SVG วัดเองไม่ได้) — สระบน/ล่างและวรรณยุกต์ไทยไม่กินที่ */
    public static function textWidth(string $text, int $size): float
    {
        $w = 0.0;
        foreach (mb_str_split($text) as $ch) {
            if (preg_match('/\p{Mn}/u', $ch) === 1) {
                continue;
            }
            $w += match (true) {
                preg_match('/[A-Z@MWmw]/', $ch) === 1 => 0.68,
                preg_match('/[ .,:;\'!|il]/', $ch) === 1 => 0.3,
                strlen($ch) === 1 => 0.54,
                default => 0.6,
            } * $size;
        }
        return $w;
    }

    /** ตัดข้อความให้พอดีความกว้าง แล้วต่อ … */
    public static function fitWidth(string $text, int $maxWidth, int $size): string
    {
        if (self::textWidth($text, $size) <= $maxWidth) {
            return $text;
        }
        $chars = mb_str_split($text);
        while ($chars !== [] && self::textWidth(implode('', $chars) . '…', $size) > $maxWidth) {
            array_pop($chars);
        }
        return rtrim(implode('', $chars)) . '…';
    }

    /** สูตรเดียวกับ hueFor() ใน frontend/js/app.js */
    public static function hueFor(string $name): int
    {
        $h = 0;
        foreach (mb_str_split($name) as $ch) {
            $h = ($h * 31 + mb_ord($ch)) & 0xFFFFFFFF;
        }
        return self::HUES[$h % count(self::HUES)];
    }

    private static function esc(string $s): string
    {
        return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
