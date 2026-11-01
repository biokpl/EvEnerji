#!/bin/sh
# Ağ bekçisi (/usr/local/bin/ag-bekcisi.sh), ag-bekcisi.timer ile 2 dk'da bir çalışır.
# Pi modeme (varsayılan ağ geçidi) ulaşamazsa:
#   3. başarısız kontrolde (~6 dk)  -> Wi-Fi'ı kapatıp açar
#   6. başarısız kontrolde (~12 dk) -> Pi'yi yeniden başlatır (saatte en fazla bir kez,
#                                     açılıştan sonraki ilk 20 dk hiç yeniden başlatmaz)
# Yalnız internet yoksa (modem cevap veriyorsa) hiçbir şey yapmaz: Pi'nin elinden bir şey gelmez.
SAYAC=/run/ag-bekcisi.sayac
SON_REBOOT=/var/lib/ag-bekcisi.son-reboot

gw=$(ip route show default 2>/dev/null | awk '/default/ {print $3; exit}')
[ -z "$gw" ] && gw=192.168.1.1

if ping -c 3 -W 3 "$gw" >/dev/null 2>&1; then
    [ -f "$SAYAC" ] && logger -t ag-bekcisi "Modem yeniden erişilebilir ($gw)"
    rm -f "$SAYAC"
    exit 0
fi

n=$(( $(cat "$SAYAC" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$SAYAC"
logger -t ag-bekcisi "Modeme ($gw) ulaşılamıyor, $n. kontrol"

if [ "$n" -eq 3 ]; then
    logger -t ag-bekcisi "Wi-Fi yeniden başlatılıyor"
    nmcli radio wifi off; sleep 5; nmcli radio wifi on
elif [ "$n" -ge 6 ]; then
    acik=$(cut -d. -f1 /proc/uptime)
    son=$(cat "$SON_REBOOT" 2>/dev/null || echo 0)
    simdi=$(date +%s)
    if [ "$acik" -gt 1200 ] && [ $(( simdi - son )) -gt 3600 ]; then
        logger -t ag-bekcisi "Ağ 12 dk'dır yok: Pi yeniden başlatılıyor"
        echo "$simdi" > "$SON_REBOOT"
        sync
        systemctl reboot
    fi
fi
