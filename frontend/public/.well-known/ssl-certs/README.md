# SSL Certificates (Public Only)

هذا المجلد يحتوي فقط على **الشهادات العامة (public certificates)** المستخرجة من الملف `ssl (1).zip` الذي رفعه المستخدم، لغرض رفعها إلى مزوّد الاستضافة/الدومين لتثبيت SSL.

## الملفات الموجودة

| الملف | الاسم الأصلي | الاستخدام |
| --- | --- | --- |
| `main-domain.crt` | `khw_zzw_temporary_site_e8ce2_b7f35_1784043118_*.crt` | شهادة الدومين الأساسي |
| `cpcalendars.crt` | `cpcalendars_khw_zzw_temporary_site_b5148_66293_*.crt` | شهادة `cpcalendars` subdomain |
| `webdisk.crt` | `webdisk_khw_zzw_temporary_site_bdf3c_6f3e1_*.crt` | شهادة `webdisk` subdomain |

## الملفات التي **لم** يتم وضعها هنا (لأسباب أمنية)

- `ssl/keys/*.key` → المفاتيح الخاصة (Private Keys). وضعها علنًا في موقع الويب يعني تسريب الشهادة بالكامل.
- `ssl/ssl.db` و `*.cache` → قاعدة بيانات SSL الداخلية لـ cPanel/WHM. لا يوجد سبب لنشرها.

## الطريقة الآمنة لاستخدام المفاتيح الخاصة

ارفع ملفات `.key` مباشرة داخل لوحة تحكم الاستضافة (cPanel → SSL/TLS → Install SSL) بدون وضعها داخل كود الموقع. لا تُشاركها عبر روابط عامة.

## الوصول إلى الشهادات العامة

بعد النشر، يمكن الوصول لكل شهادة عبر:

- `https://<your-domain>/.well-known/ssl-certs/main-domain.crt`
- `https://<your-domain>/.well-known/ssl-certs/cpcalendars.crt`
- `https://<your-domain>/.well-known/ssl-certs/webdisk.crt`

تم اختيار مجلد `.well-known/` لأنه المسار القياسي (RFC 8615) المستخدم لتخزين ملفات التحقق من الدومين والشهادات.