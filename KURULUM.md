# Ev Enerji — Kurulum

Uygulama şu an **örnek veriyle** çalışıyor. Aşağıdaki adımlar bitince gerçek veriye kendiliğinden geçer.
✋ işaretli adımları sen yaparsın (hesap ve şifre gerektiriyor); gerisini Claude Pi'de yapar.

## 1. ✋ Prizleri Smart Life'a taşı
1. Play Store'dan **Smart Life** uygulamasını kur, hesap aç.
2. GG Smart'ta prizi sil (Cihaz > ⋯ > Cihazı kaldır).
3. Prizin düğmesine ~5 sn basılı tut (ışık hızlı yanıp söner) → Smart Life'ta **Cihaz ekle**, 2,4 GHz Wi-Fi.
4. Togg prizine Smart Life'ta **"Togg T10X"** adını ver.

## 2. ✋ Tuya geliştirici projesi (prizlerin anahtarı için, ücretsiz)
1. https://iot.tuya.com → hesap aç (Smart Life'tan ayrı bir hesap).
2. **Cloud > Development > Create Cloud Project**: Industry "Smart Home", Development Method "Smart Home", **Data Center: Central Europe**.
3. Açılan projede **Devices > Link App Account > Add App Account** → Smart Life uygulamasında *Ben > sağ üst tarayıcı* ile QR'ı okut.
4. **Overview** sekmesindeki **Access ID** ve **Access Secret**'ı not al (Claude'a ilet; `config.json > tuya_cloud`'a girer).

## 3. Ev şalteri (Tomzn TOBB-63 WiFi, eWeLink)
- Önce yerel ağdan okumayı deneriz: Pi'de `python probe.py ewelink-lan`.
- Yayın yoksa bulut yolu: ✋ https://dev.ewelink.cc hesabı → uygulama oluştur → **App ID / App Secret**, ayrıca eWeLink giriş e-postan ve şifren `config.json > ewelink`'e girer.
  `python probe.py ewelink-cloud` cihaz kimliğini, `devicekey`'i ve parametre adlarını (power/voltage/current) gösterir.
- Ana şalter uygulamadan **kapatılamaz** (yalnız ölçüm).

## 4. Pi'ye kurulum (Claude yapar)
```bash
ssh <kullanici>@<pi-adresi>
mkdir -p ~/evenerji && python3 -m venv ~/evenerji/venv
# PC'den: scp -r collector <kullanici>@<pi-adresi>:~/evenerji/
~/evenerji/venv/bin/pip install -r ~/evenerji/collector/requirements.txt
cd ~/evenerji/collector && cp config.example.json config.json   # doldur
~/evenerji/venv/bin/python discover.py                          # prizleri ve anahtarlarını bulur
~/evenerji/venv/bin/python probe.py tuya togg_t10x              # ham değerleri doğrula
sudo cp ev-enerji.service /etc/systemd/system/ && sudo systemctl enable --now ev-enerji
```
`devices_local.json`'a ana şalter elle eklenir, örnek:
```json
"ev_salter": {"provider": "ewelink",
  "ewelink": {"device_id": "1000xxxxxx", "devicekey": "....", "mode": "lan"},
  "default_meta": {"name": "Ev Şalteri", "type": "ana_sayac", "provider": "ewelink", "icon": "home", "color": "#9b8cff", "order": 0}}
```
Togg prizine de `"default_meta": {"name": "Togg T10X", "type": "ev_sarj", "provider": "tuya", "icon": "car", "color": "#22d3d6", "order": 1}` eklenir.

## 5. ✋ Telefon
1. Uygulama adresini Chrome'da aç → menü → **Ana ekrana ekle**.
2. **Ayarlar > Uzaktan kontrol**: `config.json > control_secret` ile aynı anahtarı gir (priz aç/kapa için).
3. **Ayarlar > Tarife**: faturandaki vergiler dahil birim fiyatlar; **2025 toplam tüketimi**.
4. **Ayarlar > Faturalar**: şalter takılmadan önceki ayların kWh'leri (yıllık limit hesabı için).
5. **ntfy** uygulamasını kur, Ayarlar'da görünen konuya abone ol (bildirimler).

## Veri nerede?
Ayrı Firebase projesi **ev-enerji**: `https://ev-enerji-default-rtdb.europe-west1.firebasedatabase.app`
(GridTracker ve NöbetTakip'ten tamamen bağımsız).

✋ Kurallar: Firebase konsolu → Realtime Database → **Rules** sekmesi → içeriği sil, `firebase-rules.json`'u yapıştır → **Publish**.
- Okuma herkese açık (uygulama girişsiz çalışır), yazma kapalı.
- Telefon yalnız ayarlara, cihaz adlarına, şarj km/notuna ve imzalı komut kuyruğuna yazabilir.
- Pi (ve ileride kablo sarıcı ESP32) **veritabanı gizli anahtarı** ile yazar: Proje ayarları ⚙ → Hizmet hesapları → Veritabanı gizli anahtarları → Göster. Bu anahtar yalnız `config.json > firebase_secret`'a girer.

Gizli anahtarlar (Tuya local key, eWeLink şifresi, Firebase gizli anahtarı, kontrol anahtarı) **yalnız Pi'de** durur; GitHub'a gitmez.
Komutlar telefonda HMAC ile imzalanır; Pi imzası tutmayan veya 2 dakikadan eski komutu reddeder.

## Testler
```bash
cd collector && python test_tariff.py && python test_meter.py && python test_collector.py
```

## Kendini kurtarma (Pi'de, 2026-11-01)

Dosyalar `collector/sistem/` altında; kurulu yerleri:

| Katman | Dosya | Ne yapar |
|---|---|---|
| Donanım bekçisi | `/etc/systemd/system.conf.d/watchdog.conf` | Pi donarsa 14 sn içinde kendini yeniden başlatır |
| Servis bekçisi | `/etc/systemd/system/ev-enerji.service` (`WatchdogSec=180`) | Toplayıcı döngüsü 3 dk takılırsa servis yeniden başlar |
| Ağ bekçisi | `/usr/local/bin/ag-bekcisi.sh` + `ag-bekcisi.timer` (2 dk) | Modeme ~6 dk ulaşamazsa Wi-Fi'ı yeniler, ~12 dk olursa Pi'yi yeniden başlatır (saatte en fazla 1, açılıştan sonra 20 dk yok) |
| Wi-Fi güç tasarrufu kapalı | `/etc/NetworkManager/conf.d/wifi-powersave.conf` | Bir sonraki açılışta geçerli |
| Priz bekçisi | `collector.py` `watchdog()` | Ağdaki priz 10 dk bozuk yanıt verirse servis kendini yeniden başlatır (saatte 1) |

Kayıtlar: `journalctl -t ag-bekcisi`, `journalctl -u ev-enerji | grep -i watchdog`.
Geri almak: dosyaları sil, `sudo systemctl disable --now ag-bekcisi.timer && sudo systemctl daemon-reexec`; eski servis dosyası `ev-enerji.service.yedek`.
