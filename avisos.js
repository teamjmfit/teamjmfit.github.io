// TEAM JMFIT · avisos en el móvil (notificaciones push, migración 032 + función «avisos»).
// En iPhone solo funcionan con la app añadida a la pantalla de inicio (iOS 16.4 o posterior).
(function () {
  'use strict';
  const cfg = window.JMFIT_CONFIG || {};
  const FN = cfg.SUPABASE_URL ? cfg.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/avisos' : '';
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const live = () => !!FN && window.DB && DB.mode !== 'demo';

  const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
  async function call(job, extra) {
    const s = window.DB && DB.session ? await DB.session().catch(() => null) : null;
    const h = { 'Content-Type': 'application/json' };
    if (s && s.access_token) h.Authorization = 'Bearer ' + s.access_token;
    const r = await fetch(FN, { method: 'POST', headers: h, body: JSON.stringify(Object.assign({ job }, extra || {})) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || 'No se pudo contactar con el servidor de avisos');
    return j;
  }
  async function sub() { if (!supported()) return null; const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }

  // Estado en este dispositivo: 'on' | 'off' | 'denied' | 'ios-home' (iPhone sin añadir a inicio) | 'unsupported' | 'demo'
  async function state() {
    if (isIOS && !standalone()) return 'ios-home';
    if (!supported()) return 'unsupported';
    if (!live()) return 'demo';
    if (Notification.permission === 'denied') return 'denied';
    return (Notification.permission === 'granted' && await sub().catch(() => null)) ? 'on' : 'off';
  }
  // Llamar desde un toque del usuario (el permiso se pide en ese momento)
  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Has bloqueado los avisos. Actívalos en los ajustes del móvil para esta app.' : 'No se activaron los avisos');
    const { key } = await call('key');
    const reg = await navigator.serviceWorker.ready;
    let s = await reg.pushManager.getSubscription();
    if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    const j = s.toJSON();
    await DB.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    return true;
  }
  async function disable() {
    const s = await sub().catch(() => null);
    if (!s) return;
    await DB.rpc('push_unsubscribe', { p_endpoint: s.endpoint }).catch(() => {});
    await s.unsubscribe().catch(() => {});
  }
  const test = () => call('test');

  const TXT = {
    'ios-home': 'En iPhone los avisos solo funcionan con la app en la pantalla de inicio: en Safari toca Compartir → «Añadir a pantalla de inicio» y ábrela desde ahí.',
    unsupported: 'Este navegador no admite avisos. Prueba desde Chrome (Android) o con la app añadida a la pantalla de inicio (iPhone).',
    demo: 'En el modo demo no se envían avisos.',
    denied: 'Los avisos están bloqueados para esta app. Actívalos en los ajustes del móvil (Notificaciones) y vuelve aquí.',
    on: 'Activados en este móvil.',
    off: 'Desactivados en este móvil.'
  };
  window.JMPush = { state, enable, disable, test, TXT, supported };
})();
