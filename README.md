# Masa

Kişisel çalışma ortamı uygulaması. Sunucu, kurulum veya internet gerektirmez.

## Nasıl Açılır?
`index.html` dosyasına çift tıkla (Chrome veya Edge önerilir).

## Özellikler
- **Birden Fazla Masa**: Üst çubuktan farklı çalışma masaları oluşturabilir, masa yüzeyini (Ceviz, Meşe, Siyah, Mermer, Yeşil Sümen), ortam temasını ve arka plan fotoğrafını masaya özel değiştirebilirsin.
- **Masa Üstü PDF Kitap & Çalışma Notları**: PDF dosyalarını sürükle-bırak veya **PDF Ekle** ile masaya ekle; kapakları masa üstünde görünür, tıklayınca tam özellikli PDF okuyucu açılır (`Kitaplik` okuyucu motoru).
- **Müzik Kutusu & Ambiyans**: Bilgisayarındaki `.mp3/.ogg/.wav/.flac/.m4a` dosyalarını veya müzik klasörlerini Müzik Kutusu'na ekleyip çalabilir, üstüne yağmur/şömine/kafe/dalga ambiyans seslerini karıştırabilirsin.
- **Defter (Konu Başlıkları)**: Masadaki ciltli deftere veya üstteki **Defter** düğmesine tıklayıp konu başlıkları açabilir, Markdown destekli çalışma notları ve görev listeleri yazabilirsin. Kitap okurken de **Deftere Not Al** çekmecesiyle sayfadan ayrılmadan not düşebilirsin.
- **Değiştirilebilir Masa Aksesuarları**: Masa Lambası (yanar/söner), Odak Saati / Pomodoro (25/5 sayaç), İçecek Kupası, Yapışkan Not, Masa Bitkisi, Kokulu Mum ve Masa Takvimi masa üstünde sürüklenip özelleştirilebilir.

## Yapay Zekaya Sor
PDF okuyucuda seçtiğin yazı hakkında yapay zekaya soru sorabilirsin. Bu özellik isteğe bağlıdır; Masa'nın geri kalanı onsuz da çalışır.

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
- Sohbetler yalnız tarayıcının yerel deposunda tutulur; köprü soruları diske veya konsola yazmaz.

### Kullanım
- **Nasıl kullanılır**: PDF'te bir yazı seç, altında çıkan **Yapay zekaya sor** balonuna bas (ya da üst çubuktaki yıldız düğmesiyle paneli aç, **+** ile seçimi ekle), sorunu yaz ve Enter'a bas (Shift+Enter yeni satır). Birden çok alıntı ekleyebilirsin; yalnız alıntı gönderirsen "Bu alıntıyı açıkla." diye sorulur. Bekleyen isteği **Durdur** ile iptal edebilirsin.
- **Sohbetler PDF'e özeldir**: Her PDF'in sohbeti ayrı olarak tarayıcının IndexedDB deposunda (`aichats`) saklanır; başka PDF açınca yalnız onun sohbeti görünür. Bir PDF'te istediğin kadar sohbet açabilirsin: **Yeni sohbet** eskisini silmez, eski sohbetler panelin **Sohbetler** listesinde durur ve tıklayınca açılır. Hiçbir sohbet silinmez.
- **Model seçimi**: Panelin üstündeki listeden model seçersin; seçimin hatırlanır.

## Veriler Nerede Tutulur?
Tüm PDF'ler, müzikler, defter notları, masalar ve özel arka plan fotoğrafları tarayıcının **IndexedDB (`masa_db`)** deposunda yerel olarak saklanır.
