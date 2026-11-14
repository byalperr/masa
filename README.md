# Masa

Kişisel çalışma ortamı uygulaması. Sunucu, kurulum veya internet gerektirmez. PDF okurken seçtiğin yazıyı yapay zekaya sorma özelliği isteğe bağlıdır ve tek tıkla kurulur.

## Hızlı Başlangıç

### 1. Masa'yı indir
- **Kolay yol:** Bu sayfanın üstündeki yeşil **Code** düğmesine bas, **Download ZIP**'i seç. İnen zip'i sağ tıklayıp **Tümünü ayıkla** de ve klasörü istediğin yere koy (ör. Masaüstü).
- **git kullanıyorsan:**
  ```bash
  git clone https://github.com/byalperr/masa.git
  ```

### 2. Aç ve kullan
Klasördeki **`index.html`** dosyasına çift tıkla (Chrome veya Edge önerilir). Masa, PDF okuyucu, defter, müzik ve ambiyans hemen çalışır; başka bir şey kurman gerekmez.

### 3. Yapay Zekaya Sor'u kur (isteğe bağlı, bir kerelik)
- **Windows:** Klasördeki **`Kurulum.bat`** dosyasına çift tıkla.
- **macOS / Linux:** Klasörde terminal aç ve şunu çalıştır:
  ```bash
  bash kurulum.sh
  ```

Kurulum yardımcısı eksik olanları sana sorarak kurar: **Python** ve **Antigravity CLI (agy)**. Sonra agy'yi açar; tarayıcıda **Google hesabınla giriş yapıp** agy'de `/exit` yazman yeterli. Zaten kurulu olanları atlar.

> Windows "Bilgisayarınız korundu" (SmartScreen) uyarısı gösterirse **Ek bilgi → Yine de çalıştır**'a bas. Kurulum yardımcısı yalnız Python'u (winget ile) ve agy'yi Antigravity'nin resmi adresinden kurar.

### 4. Her kullanımda
1. Köprüyü başlat: masaüstündeki **Masa AI Köprüsü** kısayoluna ya da klasördeki **`AI Köprüsü Başlat.bat`**'a çift tıkla (macOS/Linux: `python3 ai_kopru.py`). Açılan pencere açık kalsın.
2. Masa'da bir PDF aç, bir yazı seç ve altında çıkan **Yapay zekaya sor** balonuna bas.

Takıldığın bir şey olursa `Kurulum.bat`'ı yeniden çalıştırman yeterli; neyin eksik olduğunu söyler.

## Özellikler
- **Birden Fazla Masa**: Üst çubuktan farklı çalışma masaları oluşturabilir, masa yüzeyini (Ceviz, Meşe, Siyah, Mermer, Yeşil Sümen), ortam temasını ve arka plan fotoğrafını masaya özel değiştirebilirsin.
- **Masa Üstü PDF Kitap & Çalışma Notları**: PDF dosyalarını sürükle-bırak veya **PDF Ekle** ile masaya ekle; kapakları masa üstünde görünür, tıklayınca tam özellikli PDF okuyucu açılır (`Kitaplik` okuyucu motoru).
- **Müzik Kutusu & Ambiyans**: Bilgisayarındaki `.mp3/.ogg/.wav/.flac/.m4a` dosyalarını veya müzik klasörlerini Müzik Kutusu'na ekleyip çalabilir, üstüne yağmur/şömine/kafe/dalga ambiyans seslerini karıştırabilirsin.
- **Defter (Konu Başlıkları)**: Masadaki ciltli deftere veya üstteki **Defter** düğmesine tıklayıp konu başlıkları açabilir, Markdown destekli çalışma notları ve görev listeleri yazabilirsin. Kitap okurken de **Deftere Not Al** çekmecesiyle sayfadan ayrılmadan not düşebilirsin.
- **Değiştirilebilir Masa Aksesuarları**: Masa Lambası (yanar/söner), Odak Saati / Pomodoro (25/5 sayaç), İçecek Kupası, Yapışkan Not, Masa Bitkisi, Kokulu Mum ve Masa Takvimi masa üstünde sürüklenip özelleştirilebilir.

## Yapay Zekaya Sor
PDF okuyucuda, Defter'de ve Masa'da seçtiğin yazı ya da sorun hakkında yapay zekaya soru sorabilirsin. Bu özellik isteğe bağlıdır; Masa'nın geri kalanı onsuz da çalışır.

### Kolay kurulum (ilk sefer)
- **Windows**: Masa klasöründeki **`Kurulum.bat`** dosyasına çift tıkla.
- **macOS / Linux**: Masa klasöründe terminal aç ve `bash kurulum.sh` çalıştır.

Kurulum yardımcısı sırasıyla şunlara bakar ve eksik olanı (sana sorarak) tamamlar:
1. **Python 3.7+** — Windows'ta winget ile yalnız senin kullanıcına kurulur (yönetici izni gerekmez). macOS/Linux'ta kurulum komutunu gösterir.
2. **Antigravity CLI (`agy`)** — Antigravity'nin [resmi kurulum betiğiyle](https://antigravity.google/docs/getting-started) kurulur (yaklaşık 230 MB).
3. **agy girişi** — Giriş yapılmamışsa agy açılır; tarayıcıda Google hesabınla giriş yapıp agy'de `/exit` yazarsın.
4. **Köprü** — Windows'ta masaüstüne "Masa AI Köprüsü" kısayolu koyabilir ve köprüyü başlatabilir.

Zaten kurulu olanları atlar; tekrar çalıştırmak zararsızdır, bir şey bozulursa onarım için de kullanılabilir. Köprü yalnız Python'un kendi kütüphanelerini kullanır, ek paket kurulmaz.

Elle kurmak istersen: Python 3.7+ ([python.org](https://www.python.org/downloads/), Windows'ta "Add Python to PATH" işaretli) ve `agy` (terminalde `agy models` model listesini gösteriyorsa hazırsın).

### Köprüyü başlat
Tarayıcı terminal komutu çalıştıramadığı için soruları `agy`'ye küçük bir yerel köprü (`ai_kopru.py`) iletir.
- **Windows**: Masa klasöründeki `AI Köprüsü Başlat.bat` dosyasına çift tıkla.
- **macOS / Linux**: Masa klasöründe terminal aç ve `python3 ai_kopru.py` çalıştır.

Köprü `http://127.0.0.1:8765` adresinde açılır; penceresi açık kaldığı sürece çalışır. Köprü kapalıysa panel bunu söyler; açtıktan sonra **Tekrar dene**'ye bas.

### Gizlilik
- Köprü yalnız bu bilgisayardan (`127.0.0.1`) gelen bağlantıları kabul eder; `agy` salt-okuma modunda ve boş bir geçici klasörde çalışır.
- Seçtiğin yazı, sorun ve kitabın adı/sayfa numarası, seçtiğin modelin sağlayıcısına (ör. Google veya Anthropic) kendi `agy` hesabın üzerinden gönderilir. Gizli tutman gereken belgelerde bunu göz önünde bulundur.
- Sohbetler yalnız tarayıcının yerel deposunda tutulur; köprü soruları ve cevapları olduğu gibi diske yazmaz (yalnız aşağıdaki "Masa hafızası" klasörüne oturum sonunda özetler girer).

### Kullanım
- **Nasıl kullanılır**: PDF'te bir yazı seç, altında çıkan **Yapay zekaya sor** balonuna bas (ya da üst çubuktaki yıldız düğmesiyle paneli aç, **+** ile seçimi ekle), sorunu yaz ve Enter'a bas (Shift+Enter yeni satır). Birden çok alıntı ekleyebilirsin; yalnız alıntı gönderirsen "Bu alıntıyı açıkla." diye sorulur. Bekleyen isteği **Durdur** ile iptal edebilirsin.
- **Nerede kullanılır**: PDF okuyucuda, **Defter**'de ve **Masa**'da; üst çubuktaki **Yapay zekaya sor** düğmesiyle panel açılır. Panel görünümler arasında açık kalır ve o görünümün sohbetlerine geçer. Defter'de not editöründe ya da önizlemede yazı seçince de aynı balon çıkar.
- **Sohbetler kapsama özeldir**: PDF'in sohbetleri o PDF'e, defterin sohbetleri o deftere (tek tek notlara değil), masanın genel sohbetleri o masaya aittir ve tarayıcının IndexedDB deposunda (`aichats`) saklanır. Bir kapsamda istediğin kadar sohbet açabilirsin: **Yeni sohbet** eskisini silmez, eski sohbetler panelin **Sohbetler** listesinde durur ve tıklayınca açılır. Sohbetler yalnız PDF, defter ya da masa silinince onunla birlikte silinir.
- **Masa'da merkez**: Masada panel, o masadaki tüm sohbetleri gruplar halinde gösterir (masa sohbetleri, PDF'ler, defterler). Bir sohbete tıklayınca masadan ayrılmadan panelde açılır; **← Masa** ile merkeze dönersin.
- **Panel boyutu**: Panelin sol kenarından sürükleyerek genişliğini ayarlayabilirsin (hatırlanır); üstteki tam ekran düğmesiyle tüm ekranı kaplatabilirsin (Esc ile çıkılır).
- **Model seçimi**: Panelin üstündeki listeden model seçersin; seçimin hatırlanır.

### Masa hafızası
Her masa, kendi küçük "ikinci beynine" sahiptir: köprü her masa için bir klasör tutar ve yapay zeka her soruda önce kısa giriş dosyasını (`GEMINI.md`) okur, ayrıntı gerekince klasördeki diğer dosyaları kendisi açar. Klasör Windows'ta `%LOCALAPPDATA%\Masa\masalar\…`, diğer sistemlerde `~/.local/share/masa/masalar/…` altındadır. Dosyaları yalnız köprü yazar:
- `GEMINI.md`: kısa giriş ve içindekiler.
- `hedef.md`: bu masada neyi başarmak istediğin (amaç, son tarih, seviye, notlar).
- `oturumlar.md`: oturum kartları (ne yaptın, nerede kaldın, sonraki adım).
- `acik-sorular.md`: aklında kalan, henüz kapanmamış sorular.
- `kaynaklar/<kitap>.md`: her PDF için profil (internet araştırması), okuma ilerlemesi ve PDF'ten yakaladığın alıntılar.
- `kavramlar/<kavram>.md`: oturumlarda öğrenilen kavramların notları.
- `notlar.md`: genel notlar.
- `gunluk.jsonl`: ham olay günlüğü.

**Oturum nedir?** Bir masa etkin masa olduğu sürece oturum sürer; başka masaya geçince ya da sayfayı kapatınca/yenileyince biter. PDF okuyucu ve defter, aynı masanın aynı oturumudur.

**Otomatik kayıt (yapay zeka maliyeti yok).** Panel kapalıyken bile şunlar köprüye yazılır: oturumun başlama/bitişi, masaya PDF eklendiği, PDF'in açıldığı, okuduğun sayfa (yaklaşık 8 sn'de bir son sayfa), PDF'ten yakaladığın alıntılar (yan deftere aktarılanlar ve yapay zekaya alıntı olarak eklenenler) ve defter notlarının kısa özeti (ilk 1500 karakter, yaklaşık 20 sn'de bir). Bunlar yalnız bilgisayarındaki yerel köprüye gider.

**Küratör (oturum sonunda tek yapay zeka çağrısı).** Masadan çıkınca köprü, o oturumda olan her şeyi bir kez yapay zekaya özetletir: oturum kartını, açık soruları ve kavram notlarını yazar. Oturumdaki sohbet mesajların da bu çağrıya girer; böylece eski "sohbetten ayrılınca özetle" davranışı kalktı. Beklemek istemezsen Hafıza sekmesinde **Şimdi güncelle** ile açık oturum için küratörü hemen çalıştırabilirsin.

**Hedef kartı.** Hedefi olmayan bir masada panelin üstünde "Bu masada neyi başarmak istiyorsun?" kartı çıkar (Amaç zorunlu; son tarih, seviye ve notlar isteğe bağlı). **Şimdi değil** ile o oturumluk kapatabilirsin. Hedef yazılınca yapay zeka cevaplarını ona göre ayarlar.

**Hafıza sekmesi.** Panelin **Hafıza** sekmesi, daraltılabilir bölümlerle hepsini gösterir ve düzenletir: **Hedef**, **Oturumlar**, **Açık sorular** (kapat, düzenle, sil, yeniden aç), **Kaynaklar** (kitap profili, okuma ilerlemesi, alıntılar; profili yeniden araştır/düzenle/sil), **Kavramlar**, **Genel notlar** ve **Ayarlar**. Bir kitabı ilk açtığında yapay zeka onu internette araştırıp kısa bir profil çıkarır (panelde "Kitabı tanıyorum…" kartı görünür; **Bu PDF için yapma** ile atlayabilirsin). Bu araştırmada kitabın adı, yazarı, dosya adı ve (PDF okuyucuda açıksa) ilk sayfalardan kısa bir bölüm internet araması için dışarı gider.

**Gizlilik.** Oturum sonunda şunlar yapay zeka modeline gider: o oturumdaki sohbet mesajların (PDF alıntıları dahil, toplam yaklaşık 12.000 karakter), PDF'ten yakaladığın alıntılar ve defter notlarının kısa özetleri. Bunu istemezsen Hafıza sekmesinde **Ayarlar** altından **Masadan çıkınca hafızayı güncelle (küratör)** seçeneğini kapat (kapalıyken sohbet mesajların köprüye hiç gönderilmez); **Yeni kitapları otomatik araştır** seçeneği de masa başına buradan kapatılır. Masa silinince hafıza klasörü de silinir. Köprü kapalıysa bu özellikler sessizce devre dışı kalır.

## Veriler Nerede Tutulur?
Tüm PDF'ler, müzikler, defter notları, masalar ve özel arka plan fotoğrafları tarayıcının **IndexedDB (`masa_db`)** deposunda yerel olarak saklanır.
