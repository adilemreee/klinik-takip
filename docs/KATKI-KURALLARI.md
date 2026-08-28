# Katkı Kuralları

## Dallar

| Dal | Amaç |
|---|---|
| `main` | Production. Yalnız `develop`'tan PR ile merge edilir. |
| `develop` | Entegrasyon dalı. Varsayılan çalışma hedefi. |
| `feat/T1.2-auth-refresh` | Task bazlı dal. Şartnamedeki task kodu ile başlar. |
| `fix/...`, `chore/...`, `docs/...` | Diğer işler. |

Doğrudan `main`'e commit edilmez.

## Commit Mesajları — Conventional Commits

```
<tip>(<kapsam>): <özet>

<gövde — neden, ne değişti>

Refs: T1.2
```

Tipler: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`.
Kapsam örnekleri: `auth`, `patients`, `labs`, `ios`, `android`, `infra`.

Örnek:

```
feat(auth): add refresh token rotation with device sessions

Refresh tokens are now single-use and rotated on every refresh.
Reuse of a consumed token revokes the whole device session family.

Refs: T1.2
```

## Dil

- **İletişim, dokümantasyon, commit gövdesi:** Türkçe olabilir.
- **Kod, değişken/fonksiyon isimleri, kod yorumları, commit özeti:** İngilizce (Şartname §0.8).

## Bir Task Ne Zaman "Bitti" Sayılır?

Şartname §12'deki kabul kriterlerinin tamamı karşılandığında. **Testsiz modül bitmiş sayılmaz** (§0.6).

## Sırlar

Hiçbir koşulda repoya girmez: `.env`, API anahtarları, DB şifreleri, SSH anahtarları,
APNs `.p8`, `google-services.json`, `GoogleService-Info.plist`, sunucu IP'si.
`.gitignore` bunları kapsar; yine de commit öncesi `git diff --staged` ile bakılır.
