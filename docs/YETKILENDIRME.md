# Yetkilendirme (RBAC)

Şartname §2. Modül: [`backend/src/authz/`](../backend/src/authz/)

## İki Ayrı Katman

Yetkilendirme iki farklı soruya cevap verir ve bunlar **bilinçli olarak ayrıdır**:

| Soru | Nerede | Örnek |
|---|---|---|
| **Ne yapabilir?** | `PermissionsGuard` + `@RequirePermissions` | `patients.read` iznin var mı? |
| **Hangi hastaya?** | `PatientAccessService` | Bu hasta sana atanmış mı? |

Bir hemşire `patients.read` iznine sahiptir, ama yalnızca **kendisine atanmış** hastaları
görmelidir (§2). Tek başına izin kontrolü ona tüm kliniği verirdi.

## İzinler Kodda Değil, Veritabanında

```
role_permissions   rol → izin  (varsayılan matris, seed ile kurulur)
user_permissions   kullanıcı → izin, granted true/false  (kişisel istisna)
```

Doktor, deploy gerektirmeden kimin ne yapabileceğini değiştirebilir (§2).
`granted: false` bir override, rolün normalde verdiği izni **geri alır**.

42 izin, 7 rol, 113 varsayılan atama. Kaynak: [`prisma/permissions.ts`](../backend/prisma/permissions.ts) —
ama bu yalnız seed; çalışma anındaki doğruluk kaynağı veritabanıdır.

## Önbellek

Her izin kontrolü bir veritabanı okumasıdır, bu yüzden Redis'te önbelleklenir.

**Önbellek ömrü (5 dk) iptal mekanizması değildir** — izin değiştiren her yazma, o
kullanıcının kaydını açıkça geçersiz kılar, böylece iptal anında etkili olur. TTL yalnız
kaçırılmış bir geçersizleştirmenin ne kadar yaşayabileceğini sınırlar.

Redis erişilemezse veritabanına düşülür. Önbellek kaynaklı bir kesinti, herkesi sistemden
kilitlemekten iyidir.

## Hasta Kapsamı

`PatientAccessService.scopeFilter()` bir Prisma `where` koşulu döner. Liste uçları bunu
**sorgunun içine** koyar, sonradan filtrelemez.

> Okumadan *sonra* yapılan kapsamlama, unutulmuş bir `count()` veya sayfalamanın bir kenar
> durumunun er geç sızdıracağı kapsamlamadır.

| Rol | Görebildiği |
|---|---|
| `SUPER_ADMIN`, `DOCTOR` | Tüm hastalar |
| `NURSE`, `COORDINATOR` | Atanmış hastalar + kendi sorumlusu olduğu hastalar; doktor `canSeeAllPatients` verirse hepsi |
| `PATIENT` | Yalnız kendi dosyası |
| `CAREGIVER` | Bağlı hasta, **yalnız onam sürerken** |
| `FINANCE` | **Hiçbiri** — klinik erişimi yok |

Silinmiş (`deleted_at`) hastalar herkesten gizlidir. Personel profili olmayan bir hesap
**hiçbir şey görmez** — bozuk bir hesap kapalı tarafa düşmelidir, açık tarafa değil.

## Kapsam Dışı Kayıt = 404, 403 Değil

`assertCanAccess` yetkisiz erişimde **NotFound** fırlatır.

> 403 kaydın var olduğunu doğrular. Bu, hesabı olan herkesin "şu kişi burada hasta mı"
> sorusunu deneyerek yanıtlamasına izin verirdi. Sağlık verisinde varlığın kendisi veridir.

Test ile korunuyor: var olmayan bir hasta ile kapsam dışı bir hasta **aynı yanıtı** verir.

## Guard Sıralaması

`JwtAuthGuard` → `PermissionsGuard`. Bu sıra önemlidir: tersi olsaydı, tokensiz bir istek
403 alırdı (401 yerine) ve izin guard'ı hiçbir zaman bir kullanıcı görmezdi.

HTTP testiyle korunuyor: *"answers 401, not 403, when no token is presented"*.

## Test Kapsamı

| Dosya | Adet | Odak |
|---|---|---|
| `test/authz.integration.spec.ts` | 45 | Rol matrisi, override'lar, hasta kapsamı |
| `test/authz-http.integration.spec.ts` | 11 | HTTP seviyesinde rol bazlı ret, guard sırası |

§11'in istediği gibi ağırlık **negatif taraftadır**: her rol için erişememesi gereken
izinler ve uçlar tek tek test edilir. Doğru veren bir sistem ama yanlış reddeden bir
sistem bir sızıntıdır; üstelik izin veren yol zaten elle en çok denenen yoldur.
