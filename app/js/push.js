// Uygulama içi bildirim (Web Push). Telefonun aboneliği settings/push/{kimlik} altına yazılır; Pi bildirimleri
// doğrudan bu aboneliğe şifreli gönderir. Gizli anahtar Pi'de, burada yalnız açık anahtar var.
export const VAPID_PUBLIC = 'BDt4dE2A7ZnULzu6zzjCrG8aUthbday57B3F22Hu_nEpImYdTr_YDYQRyoUitj83fZ450e-RaSJadWKt6e8e74M';

const destek = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
async function kimlik(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function cihazAdi() {
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+)/);
  return (m ? m[1].trim() : /iPhone/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : 'Cihaz').slice(0, 40);
}

// 'yok' (tarayıcı desteklemiyor) | 'kapali' (izin verilmedi) | 'reddedildi' | 'acik'
export async function bildirimDurumu() {
  if (!destek()) return 'yok';
  if (Notification.permission === 'denied') return 'reddedildi';
  if (Notification.permission !== 'granted') return 'kapali';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'acik' : 'kapali';
}

async function kaydet(store, sub) {
  const j = sub.toJSON();
  const id = await kimlik(j.endpoint);
  await store.patch(`settings/push/${id}`, { endpoint: j.endpoint, keys: j.keys, ad: cihazAdi(), ts: Date.now() });
  return id;
}

// Kullanıcı düğmeye basınca: izin iste, abone ol, aboneliği veritabanına yaz
export async function bildirimAc(store) {
  if (!destek()) throw new Error('Bu tarayıcı bildirimi desteklemiyor');
  const izin = await Notification.requestPermission();
  if (izin !== 'granted') throw new Error('Bildirim izni verilmedi');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) });
  return kaydet(store, sub);
}

// Uygulama her açıldığında: izin varsa abonelik veritabanında da olsun (tarayıcı yenilediyse güncellenir)
export async function bildirimTazele(store) {
  try {
    if (!destek() || Notification.permission !== 'granted' || store.mode !== 'live') return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) });
    const id = await kimlik(sub.endpoint);
    if (store.raw?.settings?.push?.[id]?.endpoint !== sub.endpoint) await kaydet(store, sub);
  } catch { /* sessiz */ }
}

export async function bildirimKapat(store) {
  if (!destek()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const id = await kimlik(sub.endpoint);
  await sub.unsubscribe();
  await store.patch('settings/push', { [id]: null });
}

export async function buCihazKimligi() {
  if (!destek()) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? kimlik(sub.endpoint) : null;
}
