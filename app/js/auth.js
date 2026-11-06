// Google ile giriş (Firebase Authentication). Veritabanı kuralları yalnız sahibin hesabına izin verir;
// her veritabanı isteğine bu oturumun kimlik jetonu (?auth=) eklenir. Pi ve ESP32 kendi gizli anahtarıyla bağlanır.
const CFG = {
  apiKey: 'AIzaSyDGivExVpYT4omkfCDR_PQFbpGanj0X4C4',
  authDomain: 'ev-enerji.firebaseapp.com',
  databaseURL: 'https://ev-enerji-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'ev-enerji',
  appId: '1:80950354949:web:098345950841226225286c',
};
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

let auth = null, fa = null;
export const oturum = { user: null, token: null, hazir: false, hata: '' };

// Oturumu yükler; ilk durum belli olunca döner. Jeton yenilenince (saatte bir) ya da giriş/çıkışta onDegisti çağrılır.
export async function authBaslat(onDegisti) {
  try {
    const [appM, authM] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]);
    fa = authM;
    auth = fa.getAuth(appM.initializeApp(CFG));
    fa.getRedirectResult(auth).catch((e) => { oturum.hata = e.code || String(e); });
  } catch (e) {
    oturum.hata = 'Giriş servisine ulaşılamadı';
    oturum.hazir = true;
    return;
  }
  await new Promise((done) => {
    let ilk = true;
    fa.onIdTokenChanged(auth, async (u) => {
      oturum.user = u;
      oturum.token = u ? await u.getIdToken() : null;
      oturum.hazir = true;
      if (ilk) { ilk = false; done(); } else onDegisti?.();
    });
  });
}

// Kullanılmadan önce jeton süresi dolmak üzereyse yeniler (SDK önbellekten verir, gerekirse tazeler)
export async function jeton() {
  if (!oturum.user) return null;
  try { oturum.token = await oturum.user.getIdToken(); } catch { /* çevrimdışı: eldeki jeton */ }
  return oturum.token;
}

export async function girisYap() {
  if (!fa) throw new Error('Giriş servisine ulaşılamadı');
  const p = new fa.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try {
    await fa.signInWithPopup(auth, p);
  } catch (e) {
    // açılır pencere engellendiyse sayfa yönlendirmesiyle dene
    if (/popup-blocked|operation-not-supported/.test(e.code || '')) await fa.signInWithRedirect(auth, p);
    else if (!/popup-closed|cancelled-popup/.test(e.code || '')) throw e;
  }
}

export async function cikisYap() {
  if (fa) await fa.signOut(auth);
}
