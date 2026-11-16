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
  // Safari (Mac e iPhone) solo deja suscribirse justo en el toque del usuario, sin esperas de red antes:
  // por eso la clave y el service worker se dejan preparados al abrir los ajustes (prepare) y en el toque
  // se llama a subscribe() directamente, que es quien pide el permiso.
  let ready = null;
  function prepare() {
    if (!ready && supported() && live()) ready = Promise.all([call('key'), navigator.serviceWorker.ready]).then(([k, reg]) => { ready.v = { key: b64(k.key), reg }; return ready.v; }).catch(e => { ready = null; throw e; });
    return ready || Promise.resolve(null);
  }
  // Llamar desde un toque del usuario
  async function enable() {
    const pre = ready && ready.v;
    let s;
    if (pre) {
      // primero, sin ningún await antes: así cuenta como gesto del usuario
      const p = pre.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pre.key });
      try { s = await p; } catch (e) { s = await pre.reg.pushManager.getSubscription(); if (!s) throw permErr(e); }
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw permErr();
      const v = await prepare(); if (!v) throw new Error("No se pudo preparar el aviso en este navegador");
      s = await v.reg.pushManager.getSubscription() || await v.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: v.key });
    }
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
  function permErr(e) {
    if ('Notification' in window && Notification.permission === 'denied') return new Error('Las notificaciones están bloqueadas para esta web. Actívalas en los ajustes del navegador (o del sistema) y vuelve aquí.');
    return new Error('No se activaron las notificaciones' + (e && e.message ? ' (' + e.message + ')' : ''));
  }

  const TXT = {
    'ios-home': 'En iPhone los avisos solo funcionan con la app en la pantalla de inicio: en Safari toca Compartir → «Añadir a pantalla de inicio» y ábrela desde ahí.',
    unsupported: 'Este navegador no admite avisos. Prueba desde Chrome (Android) o con la app añadida a la pantalla de inicio (iPhone).',
    demo: 'En el modo demo no se envían avisos.',
    denied: 'Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador o del móvil (Notificaciones) y vuelve aquí.',
    on: 'Activados en este móvil.',
    off: 'Desactivados en este móvil.'
  };
  window.JMPush = { state, enable, disable, test, prepare, TXT, supported };
})();
