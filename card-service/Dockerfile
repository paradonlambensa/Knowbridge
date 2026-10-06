# บริการการ์ดโปรไฟล์ KnowBridge — PHP 8.4 + Apache (deploy บน Render ผ่าน render.yaml)
FROM php:8.4-apache

# ค่าตั้งต้นแบบ production + ไม่บอกเวอร์ชัน PHP/Apache ใน header
RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && printf 'expose_php = Off\n' > "$PHP_INI_DIR/conf.d/knowbridge.ini" \
 && sed -ri 's/^ServerTokens .*/ServerTokens Prod/; s/^ServerSignature .*/ServerSignature Off/' /etc/apache2/conf-available/security.conf

# src/ อยู่นอก DocumentRoot — เปิดจากเว็บตรง ๆ ไม่ได้
COPY src/ /var/www/src/
COPY public/ /var/www/html/

# Render บอกพอร์ตผ่าน $PORT (ค่าเริ่มต้น 10000) — ตอนรันเองไม่ตั้งก็ใช้ 80
CMD sed -i "s/^Listen .*/Listen ${PORT:-80}/" /etc/apache2/ports.conf \
 && sed -i "s/<VirtualHost \*:[0-9]*>/<VirtualHost *:${PORT:-80}>/" /etc/apache2/sites-enabled/000-default.conf \
 && exec apache2-foreground
