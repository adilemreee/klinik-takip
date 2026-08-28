## Ne değişti?

<!-- Kısa özet. Hangi task (ör. T1.2)? -->

## Kabul Kriterleri (Şartname §12)

- [ ] API OpenAPI'de dokümante
- [ ] Migration yazılmış ve geri alınabilir
- [ ] Unit + integration test geçiyor
- [ ] RBAC kontrolü uygulanmış ve **negatif** test edilmiş
- [ ] Audit log yazıyor (veri değiştiren işlemler için)
- [ ] Hata ve boş durumlar UI'da tasarlanmış
- [ ] Çevrimdışı davranışı tanımlanmış
- [ ] i18n anahtarları eklenmiş (TR + EN minimum)
- [ ] Loglama ve metrik eklenmiş

## Migration (varsa)

- [ ] Üretilen SQL baştan sona okundu; sahte `DROP INDEX` / `DROP TRIGGER` ifadeleri temizlendi
- [ ] Yıkıcı bir değişiklikse deploy öncesi elle yedek planı var

## Güvenlik

- [ ] Repoya hiçbir sır (key, şifre, token, .p8, service account) girmedi
- [ ] Hasta verisi loglara düz metin yazılmıyor
- [ ] AI'ya gönderilen veri minimize/pseudonimize edildi (varsa)

## Nasıl test edilir?

<!-- Adım adım -->
