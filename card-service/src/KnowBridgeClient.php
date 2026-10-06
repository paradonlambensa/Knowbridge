<?php
declare(strict_types=1);

namespace KnowBridge\Card;

/**
 * ดึงโปรไฟล์สาธารณะจาก API ของเว็บหลัก (GET /api/user/:id/profile)
 * เก็บผลไว้ในไฟล์ชั่วคราว 10 นาที — การ์ดเดิมถูกเปิดซ้ำจะไม่ยิง API ใหม่ทุกครั้ง
 */
final class KnowBridgeClient
{
    private const CACHE_SECONDS = 600;
    private const TIMEOUT_SECONDS = 25; // เว็บหลักบน Render แบบฟรีอาจกำลังตื่นจากหลับ

    public function __construct(
        private readonly string $apiUrl,
        private readonly string $cacheDir,
    ) {
    }

    /** id ของ MongoDB (ObjectId) = เลขฐาน 16 ยาว 24 ตัว */
    public static function isValidUserId(string $id): bool
    {
        return preg_match('/^[0-9a-f]{24}$/', $id) === 1;
    }

    /**
     * @return array{status: int, profile: ?array} 200 = เจอ, 404 = ไม่พบผู้ใช้, 502 = ติดต่อเว็บหลักไม่ได้
     */
    public function fetchProfile(string $userId): array
    {
        $cacheFile = $this->cacheDir . DIRECTORY_SEPARATOR . 'kb-card-' . $userId . '.json';
        if (is_file($cacheFile) && time() - (int) filemtime($cacheFile) < self::CACHE_SECONDS) {
            $cached = json_decode((string) file_get_contents($cacheFile), true);
            if (is_array($cached)) {
                return $cached;
            }
        }

        $context = stream_context_create(['http' => [
            'timeout' => self::TIMEOUT_SECONDS,
            'ignore_errors' => true, // อ่านคำตอบ 404 ได้ ไม่โยน warning
            'header' => "Accept: application/json\r\nUser-Agent: KnowBridgeCard/1.0\r\n",
        ]]);
        $body = @file_get_contents(rtrim($this->apiUrl, '/') . '/api/user/' . $userId . '/profile', false, $context);
        $status = self::lastStatus(http_get_last_response_headers() ?? []);

        $result = ['status' => 502, 'profile' => null];
        if ($body !== false && $status === 200) {
            $json = json_decode($body, true);
            if (is_array($json) && isset($json['user']['username'])) {
                $result = ['status' => 200, 'profile' => $json];
            }
        } elseif ($status === 404) {
            $result = ['status' => 404, 'profile' => null];
        }

        // ติดต่อไม่ได้ไม่ต้องจำ — ครั้งหน้าลองใหม่ทันที
        if ($result['status'] !== 502) {
            @file_put_contents($cacheFile, json_encode($result), LOCK_EX);
        }
        return $result;
    }

    /** สถานะ HTTP สุดท้าย (ถ้ามี redirect จะมีหลายบรรทัด "HTTP/1.1 ...") — 0 ถ้าไม่ได้คำตอบเลย */
    private static function lastStatus(array $headers): int
    {
        $status = 0;
        foreach ($headers as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
                $status = (int) $m[1];
            }
        }
        return $status;
    }
}
