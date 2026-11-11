/* TEAM JMFIT · interfaz de la app (entrenador + clientes) */
(function () {
  'use strict';
  const BRAND = (window.JMFIT_CONFIG && window.JMFIT_CONFIG.BRAND) || 'TEAM JMFIT';
  const $app = document.getElementById('app');
  const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const DIAS_C = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const S = { profile: null, client: null, route: [], clients: [], exercises: [], sheet: null };

  // ------------------------------------------------------------ utilidades
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = v => esc(v).replace(/\n/g, '<br>');
  const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  // Variables de entrenamiento: texto corto "60 kg · RIR 2 · tempo 3-1-1-0" (o el texto libre antiguo)
  const loadLabel = i => {
    const p = [];
    if (i.load_kg != null && i.load_kg !== '') p.push(fmtKg(i.load_kg) + ' kg');
    if (i.target_rir != null && i.target_rir !== '') p.push('RIR ' + fmtKg(i.target_rir));
    else if (i.target_rpe != null && i.target_rpe !== '') p.push('RPE ' + fmtKg(i.target_rpe));
    if (i.tempo) p.push('tempo ' + i.tempo);
    return p.length ? p.join(' · ') : (i.load || '');
  };
  const repsRange = t => { const m = String(t || '').match(/^\s*(\d+)(?:\s*[-–]\s*(\d+))?/); return m ? { reps_min: +m[1], reps_max: +(m[2] || m[1]) } : { reps_min: null, reps_max: null }; };
  // Pasa el texto libre antiguo ("RIR 2, 60 kg…") a campos; lo que no se reconoce se conserva en indicaciones
  function legacyLoad(i) {
    if (!i.load || i.load_kg != null || i.target_rir != null || i.target_rpe != null) return i;
    let rest = i.load; const o = Object.assign({}, i);
    const kg = rest.match(/(\d+(?:[.,]\d+)?)\s*kg/i); if (kg) { o.load_kg = Number(kg[1].replace(',', '.')); rest = rest.replace(kg[0], ''); }
    const rir = rest.match(/RIR\s*(\d+(?:[.,]\d)?)/i); if (rir) { o.target_rir = Number(rir[1].replace(',', '.')); rest = rest.replace(rir[0], ''); }
    const rpe = rest.match(/RPE\s*(\d+(?:[.,]\d)?)/i); if (rpe) { o.target_rpe = Number(rpe[1].replace(',', '.')); rest = rest.replace(rpe[0], ''); }
    rest = rest.replace(/^[\s,·;-]+|[\s,·;-]+$/g, '');
    if (rest && !(o.notes || '').includes(rest)) o.notes = o.notes ? rest + ' · ' + o.notes : rest;
    return o;
  }
  const TRAINING_FIELDS = ['load_kg', 'target_rir', 'target_rpe', 'tempo', 'reps_min', 'reps_max', 'progression'];
  // Programas por semanas: regla de progresión de cada ejercicio y utilidades de semana
  const PROG_RULES = [['none', 'Sin progresión'], ['load:1.25', '+1,25 kg'], ['load:2.5', '+2,5 kg'], ['load:5', '+5 kg'], ['reps:1', '+1 rep'], ['reps:2', '+2 reps']];
  const progKey = p => (!p || !p.type || p.type === 'none' ? 'none' : p.type === 'reps' ? 'reps:' + Number(p.inc || 1) : 'load:' + Number(p.inc_kg || p.inc || 2.5));
  const progVal = k => { const [t, v] = String(k || 'none').split(':'); return t === 'reps' ? { type: 'reps', inc: Number(v) || 1 } : t === 'load' ? { type: 'load', inc_kg: Number(v) || 2.5 } : { type: 'none' }; };
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const weekLabel = w => `Semana ${w.week_no}${w.kind === 'deload' ? ' · Descarga' : w.kind === 'test' ? ' · Test' : ''}`;
  // Repetición automática: crea (y publica) las semanas que falten hasta hoy. Una vez por programa y día.
  async function rollWeeks(programs) {
    S.rolled = S.rolled || {}; let n = 0;
    for (const p of programs || []) {
      const k = p.id + today(); if (p.status !== 'active' || p.auto_repeat === false || S.rolled[k]) continue;
      S.rolled[k] = true; n += Number(await DB.rpc('roll_program_weeks', { p_program: p.id }).catch(() => 0)) || 0;
    }
    return n;
  }
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // La semana que ve el cliente: la última publicada que ya ha empezado. Si no hay, ve sus rutinas fijas.
  const currentWeek = (weeks, programs) => {
    const ok = new Set(programs.filter(p => p.status === 'active').map(p => p.id)), t = today();
    return weeks.filter(w => w.published && ok.has(w.program_id) && w.start_date <= t).sort((a, b) => b.start_date.localeCompare(a.start_date) || b.week_no - a.week_no)[0] || null;
  };
  // Vídeo de técnica: YouTube (sin cookies), Vimeo, Google Drive, imagen o enlace externo
  function mediaInfo(url) {
    const u = String(url || '').trim(); if (!/^https?:\/\//i.test(u)) return null;
    let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i);
    if (m) { const t = (u.match(/[?&]t=(\d+)/) || [])[1]; return { kind: 'yt', id: m[1], src: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&playsinline=1&rel=0&modestbranding=1${t ? '&start=' + t : ''}`, thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` }; }
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i); if (m) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}?autoplay=1&playsinline=1` };
    m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/i); if (m) return { kind: 'drive', src: `https://drive.google.com/file/d/${m[1]}/preview` };
    if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(u)) return { kind: 'img', src: u };
    if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) return { kind: 'file', src: u };
    return { kind: 'link', src: u };
  }
  // Fachada: no carga nada de terceros hasta que se pulsa "play"
  function mediaFacade(url) {
    const v = mediaInfo(url); if (!v) return '';
    if (v.kind === 'img') return `<div class="vmedia"><img src="${esc(v.src)}" alt="Técnica" loading="lazy"></div>`;
    if (v.kind === 'link') return `<div class="vmedia link"><a class="btn small" href="${esc(v.src)}" target="_blank" rel="noopener">${ic('video')} Abrir vídeo de la técnica</a></div>`;
    return `<div class="vmedia" data-vsrc="${esc(v.src)}" data-vkind="${v.kind}"><button type="button" class="vplay" aria-label="Reproducir vídeo"${v.thumb ? ` style="background-image:url('${esc(v.thumb)}')"` : ''}>${ic('play')}</button></div>`;
  }
  function bindMedia(root) {
    root.querySelectorAll('[data-vsrc] .vplay').forEach(b => b.onclick = () => {
      const box = b.parentNode, src = box.dataset.vsrc;
      box.innerHTML = box.dataset.vkind === 'file'
        ? `<video src="${esc(src)}" controls autoplay playsinline></video>`
        : `<iframe src="${esc(src)}" title="Vídeo de la técnica" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    });
  }
  const fmtKg = v => (v == null ? '–' : (Math.round(v * 10) / 10).toString().replace('.', ','));
  const eur = v => (v === '' || v == null || isNaN(Number(v)) ? (v || '–') : Number(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const isoDay = () => { const d = new Date().getDay(); return d === 0 ? 7 : d; };
  const fmtDate = (s, opts) => { if (!s) return '–'; const d = new Date(s.length === 10 ? s + 'T12:00:00' : s); return isNaN(d) ? s : d.toLocaleDateString('es-ES', opts || { day: 'numeric', month: 'short' }); };
  const ago = s => {
    const m = Math.round((Date.now() - new Date(s)) / 6e4);
    if (m < 1) return 'ahora'; if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24); return d === 1 ? 'ayer' : `hace ${d} días`;
  };
  const initials = n => (n || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const go = h => { if (location.hash === h) render(); else location.hash = h; };
  const byId = (arr, id) => arr.find(x => x.id === id);

  const ICON = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-5-5.5"/>',
    dumbbell: '<path d="M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12"/>',
    euro: '<path d="M17 5.5A7 7 0 1 0 17 18.5"/><path d="M4 10h10M4 14h10"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    apple: '<path d="M12 7c-2-2-6-1.5-6.5 2.5S7 19 9.5 19.5c1 .2 1.7-.5 2.5-.5s1.5.7 2.5.5C17 19 18.5 13 18 9.5S14 5 12 7z"/><path d="M12 7c0-2 1-3.5 3-4"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    send: '<path d="M4 12l16-8-6 16-2-7z"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    wa: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/>'
  };
  const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  }
  async function safe(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; }
    catch (e) { console.error(e); toast(e.message === 'NO_SHEET' ? 'Conecta primero tu hoja de cobros' : ('Error: ' + e.message), 'err'); throw e; }
  }

  // ------------------------------------------------------------ modal
  function modal(title, body, { onSubmit, submitLabel = 'Guardar', wide = false, danger } = {}) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'modal-back';
    m.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" novalidate>
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button></header>
      <div class="modal-body">${body}</div>
      ${onSubmit ? `<footer>${danger ? `<button type="button" class="btn ghost danger" data-danger>${esc(danger.label)}</button>` : ''}<span class="grow"></span><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" type="submit">${esc(submitLabel)}</button></footer>` : ''}
    </form>`;
    document.body.appendChild(m);
    document.body.classList.add('noscroll');
    const form = m.querySelector('form');
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
    if (danger) m.querySelector('[data-danger]').onclick = async () => { await danger.run(); };
    if (onSubmit) form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try { const r = await onSubmit(form, new FormData(form)); if (r !== false) closeModal(); }
      catch (err) { /* el toast ya informa */ }
      finally { btn.disabled = false; }
    });
    const first = form.querySelector('input,select,textarea'); if (first && window.innerWidth > 700) first.focus();
    return form;
  }
  function closeModal() { document.querySelectorAll('.modal-back').forEach(m => m.remove()); document.body.classList.remove('noscroll'); }
  function confirmBox(text, label = 'Eliminar') {
    return new Promise(res => {
      modal('¿Seguro?', `<p>${esc(text)}</p>`, { submitLabel: label, onSubmit: () => { res(true); } });
      document.querySelector('.modal-back').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target.classList.contains('modal-back')) res(false); });
    });
  }

  // ------------------------------------------------------------ arranque
  async function boot() {
    try {
      S.profile = await DB.profile();
      S.client = S.profile && S.profile.role === 'client' ? await DB.myClient() : null;
    } catch (e) { console.error(e); S.profile = null; }
    render();
  }
  DB.onAuth(() => boot());
  window.addEventListener('hashchange', render);

  function parseRoute() { return (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent); }

  async function render() {
    stopIntervals();
    S.route = parseRoute();
    if (location.hash.includes('type=recovery')) return renderNewPassword();
    if (!S.profile) return renderLogin();
    if (S.profile.role === 'coach') return renderCoach();
    return renderClient();
  }

  let intervals = [];
  const stopIntervals = () => { intervals.forEach(clearInterval); intervals = []; };

  // ------------------------------------------------------------ login
  function renderLogin(mode = 'in') {
    document.body.dataset.role = 'guest';
    const demo = DB.mode === 'demo';
    $app.innerHTML = `<main class="login">
      <div class="login-card">
        <div class="brand big"><span class="brand-mark">JM</span><div><b>${esc(BRAND)}</b><small>Entrenamiento y nutrición</small></div></div>
        ${demo ? `
          <p class="muted">Modo demo: la app aún no está conectada a Supabase. Prueba los dos lados con datos de ejemplo (se guardan solo en este navegador).</p>
          <button class="btn primary block" data-demo="coach">${ic('users')} Entrar como entrenador</button>
          <button class="btn block" data-demo="client">${ic('dumbbell')} Entrar como cliente (Laura)</button>
          <button class="btn ghost block small" data-reset>Reiniciar datos de ejemplo</button>
        ` : `
          <div class="seg"><button class="${mode === 'in' ? 'on' : ''}" data-mode="in">Entrar</button><button class="${mode === 'up' ? 'on' : ''}" data-mode="up">Crear cuenta</button></div>
          <form id="auth" class="stack">
            ${mode === 'up' ? '<label>Nombre<input name="name" required autocomplete="name"></label>' : ''}
            <label>Correo<input name="email" type="email" required autocomplete="email"></label>
            ${mode !== 'reset' ? `<label>Contraseña<input name="password" type="password" minlength="6" required autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"></label>` : ''}
            <button class="btn primary block" type="submit">${mode === 'up' ? 'Crear cuenta' : mode === 'reset' ? 'Enviar enlace' : 'Entrar'}</button>
            ${mode === 'up' ? '<p class="muted small">Usa el mismo correo que diste a tu entrenador.</p>' : ''}
            ${mode === 'in' ? '<button type="button" class="link" data-mode="reset">¿Olvidaste la contraseña?</button>' : ''}
            ${mode === 'reset' ? '<button type="button" class="link" data-mode="in">Volver</button>' : ''}
          </form>`}
      </div></main>`;
    $app.querySelectorAll('[data-demo]').forEach(b => b.onclick = () => DB.signIn(b.dataset.demo));
    const r = $app.querySelector('[data-reset]'); if (r) r.onclick = () => { DB.resetDemo(); toast('Datos de ejemplo reiniciados', 'ok'); };
    $app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => renderLogin(b.dataset.mode));
    const f = $app.querySelector('#auth');
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        if (mode === 'in') await DB.signIn(d.email.trim(), d.password);
        else if (mode === 'up') { const r = await DB.signUp(d.email.trim(), d.password, d.name.trim()); if (r.needsConfirm) { toast('Revisa tu correo para confirmar la cuenta', 'ok'); renderLogin('in'); } }
        else { await DB.resetPassword(d.email.trim()); toast('Te hemos enviado un enlace', 'ok'); renderLogin('in'); }
      } catch (err) { toast(traducirError(err.message), 'err'); }
      finally { btn.disabled = false; }
    };
  }
  function traducirError(m) {
    if (/NOT_INVITED|saving new user/i.test(m)) return 'Este correo no está autorizado. Pide a tu entrenador que te dé de alta con este correo.';
    if (/Invalid login/i.test(m)) return 'Correo o contraseña incorrectos';
    if (/not confirmed/i.test(m)) return 'Confirma tu correo antes de entrar';
    if (/already registered/i.test(m)) return 'Ese correo ya tiene cuenta: entra con tu contraseña';
    return m;
  }
  function renderNewPassword() {
    $app.innerHTML = `<main class="login"><div class="login-card"><h2>Nueva contraseña</h2>
      <form id="np" class="stack"><label>Contraseña nueva<input name="p" type="password" minlength="6" required></label><button class="btn primary block">Guardar</button></form></div></main>`;
    $app.querySelector('#np').onsubmit = async e => {
      e.preventDefault();
      await safe(() => DB.updatePassword(new FormData(e.target).get('p')), 'Contraseña actualizada');
      location.hash = ''; boot();
    };
  }

  // ------------------------------------------------------------ layout
  function shell(navItems, activeKey, content, { title, back, actions = '' } = {}) {
    const nav = navItems.map(n => `<a href="#/${n.href}" class="${n.key === activeKey ? 'on' : ''}">${ic(n.icon)}<span>${n.label}</span>${n.badge ? `<i class="badge">${n.badge}</i>` : ''}</a>`).join('');
    $app.innerHTML = `
      <aside class="side"><div class="brand"><span class="brand-mark">JM</span><div><b>${esc(BRAND)}</b><small>${S.profile.role === 'coach' ? 'Panel de entrenador' : esc(S.client ? S.client.name : '')}</small></div></div>
        <nav>${nav}</nav>
        <button class="side-out" data-logout>${ic('out')} Salir</button>
        ${DB.mode === 'demo' ? '<div class="demo-tag">MODO DEMO</div>' : ''}
      </aside>
      <div class="main">
        <header class="top">${back ? `<a class="icon-btn" href="#/${back}" aria-label="Volver">${ic('back')}</a>` : '<span class="brand-mark sm only-mobile">JM</span>'}
          <h1>${esc(title || '')}</h1><span class="grow"></span>${actions}
          <button class="icon-btn only-mobile" data-logout aria-label="Salir">${ic('out')}</button></header>
        <div class="content">${content}</div>
      </div>
      <nav class="tabbar">${nav}</nav>`;
    $app.querySelectorAll('[data-logout]').forEach(b => b.onclick = async () => { if (await confirmBox('¿Cerrar sesión?', 'Salir')) { await DB.signOut(); S.profile = null; location.hash = ''; render(); } });
  }
  const loading = () => '<div class="loading"><span></span><span></span><span></span></div>';

  // ================================================================ ENTRENADOR
  const COACH_NAV = [
    { key: 'inicio', href: '', icon: 'home', label: 'Inicio' },
    { key: 'clientes', href: 'clientes', icon: 'users', label: 'Clientes' },
    { key: 'programas', href: 'programas', icon: 'dumbbell', label: 'Programas' },
    { key: 'revisiones', href: 'revisiones', icon: 'inbox', label: 'Revisiones' },
    { key: 'cobros', href: 'cobros', icon: 'euro', label: 'Cobros' }
  ];
  // Aviso en la pestaña Revisiones con los check-ins sin revisar (no bloquea el render)
  async function refreshReviewBadge() {
    try {
      const n = (await DB.list('checkins', { order: ['created_at', 'desc'], limit: 200 })).filter(k => !k.coach_seen).length;
      document.querySelectorAll('nav a[href="#/revisiones"]').forEach(a => {
        let b = a.querySelector('.badge');
        if (!n) { if (b) b.remove(); return; }
        if (!b) { b = document.createElement('i'); b.className = 'badge'; a.appendChild(b); }
        b.textContent = n > 99 ? '99+' : n;
      });
    } catch (e) { /* el aviso es opcional */ }
  }

  async function renderCoach() {
    document.body.dataset.role = 'coach';
    const [r0, r1, r2] = S.route;
    if (!r0 || r0 === 'clientes' || r0 === 'cliente') setTimeout(refreshReviewBadge, 0);
    if (!r0) return coachHome();
    if (r0 === 'clientes') return coachClients();
    if (r0 === 'cliente' && r1) return coachClient(r1, r2 || 'rutinas');
    if (r0 === 'programas' || r0 === 'ejercicios') { setTimeout(refreshReviewBadge, 0); return r1 === 'ejercicios' || r0 === 'ejercicios' ? coachExercises() : coachPrograms(); }
    if (r0 === 'revisiones') return coachReviews(r1);
    if (r0 === 'cobros') { setTimeout(refreshReviewBadge, 0); return coachPayments(); }
    go('#/');
  }

  async function loadClients() { S.clients = await DB.list('clients', { order: ['name', 'asc'] }); return S.clients; }
  async function loadExercises() { S.exercises = await DB.list('exercises', { order: ['name', 'asc'] }); return S.exercises; }

  // ---------- Inicio
  async function coachHome() {
    shell(COACH_NAV, 'inicio', loading(), { title: 'Hola 👋' });
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const [clients, sessions, checkins, msgs] = await Promise.all([
      loadClients(),
      DB.list('sessions', { order: ['started_at', 'desc'], limit: 60 }),
      DB.list('checkins', { order: ['created_at', 'desc'], limit: 60 }),
      DB.list('messages', { order: ['created_at', 'desc'], limit: 60 })
    ]);
    const name = id => (byId(clients, id) || {}).name || 'Cliente';
    const active = clients.filter(c => c.active);
    const week = sessions.filter(s => s.started_at >= weekAgo && s.finished_at);
    const unseenCk = checkins.filter(c => !c.coach_seen);
    // último mensaje por cliente; si es del cliente, está pendiente de respuesta
    const lastByClient = {};
    msgs.forEach(m => { if (!lastByClient[m.client_id]) lastByClient[m.client_id] = m; });
    const pendingMsgs = Object.values(lastByClient).filter(m => m.author === 'client');
    const trainedIds = new Set(week.map(s => s.client_id));
    const idle = active.filter(c => !trainedIds.has(c.id));

    const feed = [
      ...sessions.slice(0, 15).filter(s => s.finished_at).map(s => ({ t: s.finished_at, html: `<b>${esc(name(s.client_id))}</b> completó <i>${esc(s.routine_name || 'entreno')}</i>${s.rpe ? ` · RPE ${s.rpe}` : ''}`, href: `cliente/${s.client_id}/progreso`, icon: 'dumbbell', unseen: !s.coach_seen })),
      ...checkins.slice(0, 15).map(c => ({ t: c.created_at, html: `<b>${esc(name(c.client_id))}</b> envió su check-in${c.weight ? ` · ${fmtKg(c.weight)} kg` : ''}`, href: `cliente/${c.client_id}/progreso`, icon: 'chart', unseen: !c.coach_seen })),
      ...pendingMsgs.map(m => ({ t: m.created_at, html: `<b>${esc(name(m.client_id))}</b>: ${esc(m.body.slice(0, 80))}`, href: `cliente/${m.client_id}/mensajes`, icon: 'chat', unseen: true }))
    ].sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 14);

    const html = `
      <div class="kpis">
        <a class="kpi" href="#/clientes"><small>Clientes activos</small><b>${active.length}</b><span>${clients.length - active.length} en pausa</span></a>
        <div class="kpi"><small>Entrenos esta semana</small><b>${week.length}</b><span>${trainedIds.size} clientes han entrenado</span></div>
        <a class="kpi ${unseenCk.length ? 'warn' : ''}" href="#/revisiones"><small>Check-ins sin revisar</small><b>${unseenCk.length}</b><span>pendientes de respuesta</span></a>
        <div class="kpi ${pendingMsgs.length ? 'warn' : ''}"><small>Mensajes por contestar</small><b>${pendingMsgs.length}</b><span>de tus clientes</span></div>
      </div>
      <div class="grid2">
        <section class="card"><h3>Actividad reciente</h3>
          ${feed.length ? `<ul class="feed">${feed.map(f => `<li><a href="#/${f.href}">${ic(f.icon)}<div>${f.html}<small>${ago(f.t)}</small></div>${f.unseen ? '<i class="dot"></i>' : ''}</a></li>`).join('')}</ul>` : '<p class="empty">Aún no hay actividad. Cuando tus clientes entrenen o envíen su check-in, aparecerá aquí.</p>'}
        </section>
        <div class="stack">
          <section class="card" id="venc"><h3>Próximos cobros</h3>${loading()}</section>
          <section class="card"><h3>Sin entrenar en 7 días</h3>
            ${idle.length ? `<ul class="list">${idle.map(c => `<li><a href="#/cliente/${c.id}/mensajes"><span class="av">${initials(c.name)}</span><span class="grow">${esc(c.name)}</span><small>Escribir</small></a></li>`).join('')}</ul>` : '<p class="empty">¡Todos tus clientes activos han entrenado esta semana! 🎉</p>'}
          </section>
        </div>
      </div>`;
    $app.querySelector('.content').innerHTML = html;
    // cobros (no bloquea)
    const box = $app.querySelector('#venc');
    try {
      const data = await getSheet();
      const rows = data.clientes.filter(c => c.vence && c.estado !== 'BAJA / PAUSA')
        .map(c => Object.assign({}, c, { d: parseInt(c.dias, 10) })).filter(c => !isNaN(c.d) && c.d <= 30).sort((a, b) => a.d - b.d);
      box.innerHTML = `<h3>Próximos cobros <a class="link small" href="#/cobros">Ver todo</a></h3>` + (rows.length
        ? `<ul class="list">${rows.map(c => `<li><span class="pill ${c.d < 0 ? 'red' : c.d <= 7 ? 'amber' : 'green'}">${c.d < 0 ? `vencido ${-c.d} d` : c.d === 0 ? 'hoy' : `${c.d} d`}</span><span class="grow">${esc(c.nombre)}<small>${esc(c.plan)}</small></span><b>${eur(c.cuota)}</b></li>`).join('')}</ul>`
        : '<p class="empty">Nada vence en los próximos 30 días.</p>');
    } catch (e) {
      box.innerHTML = `<h3>Próximos cobros</h3><p class="empty">${e.message === 'NO_SHEET' ? 'Conecta tu hoja de cobros para ver aquí los vencimientos.' : 'No se pudo leer la hoja: ' + esc(e.message)}</p><a class="btn small" href="#/cobros">${ic('euro')} Ir a Cobros</a>`;
    }
  }

  async function getSheet(force) {
    if (S.sheet && !force && Date.now() - S.sheet.at < 120000) return S.sheet.data;
    const data = await DB.sheets('resumen');
    S.sheet = { at: Date.now(), data };
    return data;
  }

  // ---------- Lista de clientes
  async function coachClients() {
    shell(COACH_NAV, 'clientes', loading(), { title: 'Clientes', actions: `<button class="btn primary" data-new>${ic('plus')}<span>Nuevo cliente</span></button>` });
    $app.querySelector('[data-new]').onclick = () => clientForm();
    const [clients, sessions] = await Promise.all([loadClients(), DB.list('sessions', { order: ['started_at', 'desc'], limit: 200 })]);
    const last = {}; sessions.forEach(s => { if (s.finished_at && !last[s.client_id]) last[s.client_id] = s.finished_at; });
    const row = c => `<li><a href="#/cliente/${c.id}"><span class="av">${initials(c.name)}</span>
        <span class="grow"><b>${esc(c.name)}</b><small>${esc(c.service || 'Sin servicio')}${c.goal ? ' · ' + esc(c.goal) : ''}</small></span>
        <span class="right"><small>${last[c.id] ? 'Entrenó ' + ago(last[c.id]) : 'Sin entrenos'}</small>${c.user_id ? '<span class="pill green">con acceso</span>' : '<span class="pill amber">invitación pendiente</span>'}</span></a></li>`;
    const act = clients.filter(c => c.active), off = clients.filter(c => !c.active);
    $app.querySelector('.content').innerHTML = clients.length ? `
      <input class="search" placeholder="Buscar cliente…" data-q>
      <section class="card flush"><ul class="list big" data-list>${act.map(row).join('')}</ul></section>
      ${off.length ? `<h3 class="sub">En pausa</h3><section class="card flush"><ul class="list big">${off.map(row).join('')}</ul></section>` : ''}`
      : `<div class="hero-empty">${ic('users', 'xl')}<h2>Da de alta a tu primer cliente</h2><p>Pon su nombre y su correo. Después le mandas el enlace de la app para que cree su cuenta con ese mismo correo.</p><button class="btn primary" data-new2>${ic('plus')} Nuevo cliente</button></div>`;
    const n2 = $app.querySelector('[data-new2]'); if (n2) n2.onclick = () => clientForm();
    const q = $app.querySelector('[data-q]');
    if (q) q.oninput = () => { const v = q.value.toLowerCase(); $app.querySelectorAll('.list.big li').forEach(li => { li.hidden = !li.textContent.toLowerCase().includes(v); }); };
  }

  function clientForm(c) {
    const isNew = !c; c = c || { active: true };
    modal(isNew ? 'Nuevo cliente' : 'Editar cliente', `
      <div class="form-grid">
        <label class="full">Nombre y apellidos<input name="name" required value="${esc(c.name)}"></label>
        <label>Correo (con el que entrará)<input name="email" type="email" required value="${esc(c.email)}"></label>
        <label>Teléfono (con 34)<input name="phone" inputmode="tel" value="${esc(c.phone)}" placeholder="346…"></label>
        <label>Servicio<select name="service">${['', 'Entreno', 'Nutrición', 'Mixto'].map(s => `<option ${c.service === s ? 'selected' : ''} value="${s}">${s || '—'}</option>`).join('')}</select></label>
        <label>Nombre en la hoja de cobros<input name="sheet_name" value="${esc(c.sheet_name || c.name || '')}" placeholder="Igual que en tu Excel"></label>
        <label class="full">Objetivo<input name="goal" value="${esc(c.goal)}" placeholder="Ej: ganar masa muscular, preparar competición…"></label>
        <label class="full">Notas privadas (lesiones, preferencias…)<textarea name="notes" rows="3">${esc(c.notes)}</textarea></label>
        <label class="check full"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Cliente activo</label>
      </div>`, {
      submitLabel: isNew ? 'Crear cliente' : 'Guardar',
      danger: isNew ? null : { label: 'Eliminar', run: async () => { if (await confirmBox(`Se borrarán ${c.name} y todos sus datos (rutinas, entrenos, check-ins). No se puede deshacer.`)) { await safe(() => DB.remove('clients', c.id), 'Cliente eliminado'); go('#/clientes'); } } },
      onSubmit: async (f, fd) => {
        const d = Object.fromEntries(fd); d.active = !!fd.get('active'); d.email = d.email.trim().toLowerCase();
        if (!d.name.trim() || !d.email) { toast('Nombre y correo son obligatorios', 'err'); return false; }
        if (isNew) { const r = await safe(() => DB.insert('clients', d), 'Cliente creado'); invite(r[0]); return false; }
        await safe(() => DB.update('clients', c.id, d), 'Guardado'); render();
      }
    });
  }

  function appUrl() { return location.origin + location.pathname; }
  function invite(c) {
    const msg = `¡Hola ${c.name.split(' ')[0]}! Ya tienes tu app de ${BRAND} 💪\n\n1. Entra aquí: ${appUrl()}\n2. Pulsa "Crear cuenta" y usa este correo: ${c.email}\n3. En el móvil, añádela a la pantalla de inicio (Compartir → Añadir a pantalla de inicio).\n\nAhí verás tus entrenos, tu plan de nutrición y podrás enviarme tus check-ins.`;
    modal('Invita a ' + c.name, `
      <p>Envíale este mensaje para que cree su cuenta con <b>${esc(c.email)}</b>. En cuanto se registre, verá su plan.</p>
      <textarea class="mono" rows="8" readonly>${esc(msg)}</textarea>
      <div class="row gap">
        <button type="button" class="btn" data-copy>${ic('copy')} Copiar</button>
        ${c.phone ? `<a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/${esc(String(c.phone).replace(/\D/g, ''))}?text=${encodeURIComponent(msg)}">${ic('wa')} Enviar por WhatsApp</a>` : ''}
        <a class="btn ghost" href="#/cliente/${c.id}" data-close>Ir a su ficha</a>
      </div>`);
    document.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(msg).then(() => toast('Copiado', 'ok'));
  }

  // ---------- Ficha de cliente
  const CLIENT_TABS = [['rutinas', 'Rutinas'], ['calendario', 'Calendario'], ['nutricion', 'Nutrición'], ['progreso', 'Progreso'], ['mensajes', 'Mensajes'], ['cobros', 'Cobros']];
  async function coachClient(id, tab) {
    shell(COACH_NAV, 'clientes', loading(), { title: '', back: 'clientes' });
    const c = await DB.get('clients', id);
    if (!c) { toast('Cliente no encontrado', 'err'); return go('#/clientes'); }
    $app.querySelector('.top h1').textContent = c.name;
    const actions = document.createElement('div'); actions.className = 'row gap';
    actions.innerHTML = `<button class="btn ghost small" data-inv>${c.user_id ? '' : 'Invitar'}</button><button class="btn small" data-edit>${ic('edit')}<span>Editar</span></button>`;
    $app.querySelector('.top .grow').after(actions);
    const inv = actions.querySelector('[data-inv]'); if (c.user_id) inv.remove(); else inv.onclick = () => invite(c);
    actions.querySelector('[data-edit]').onclick = () => clientForm(c);
    const content = $app.querySelector('.content');
    content.innerHTML = `
      <div class="client-head"><span class="av lg">${initials(c.name)}</span><div><b>${esc(c.name)}</b><small>${esc(c.email)}${c.service ? ' · ' + esc(c.service) : ''}</small>${c.goal ? `<p>🎯 ${esc(c.goal)}</p>` : ''}${c.notes ? `<p class="note">📝 ${esc(c.notes)}</p>` : ''}</div></div>
      <div class="tabs">${CLIENT_TABS.map(([k, l]) => `<a href="#/cliente/${id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
      <div data-tab>${loading()}</div>`;
    const box = content.querySelector('[data-tab]');
    if (tab === 'rutinas') return tabRoutines(c, box);
    if (tab === 'calendario') return tabCalendar(c, box);
    if (tab === 'nutricion') return tabNutrition(c, box);
    if (tab === 'progreso') return tabProgress(c, box, true);
    if (tab === 'mensajes') return tabMessages(c, box, 'coach');
    if (tab === 'cobros') return tabClientPayments(c, box);
  }

  // ----- Rutinas (entrenador)
  async function tabRoutines(c, box) {
    await rollWeeks(await DB.list('programs', { eq: { client_id: c.id } }).catch(() => []));
    const [allRoutines, items, programs, weeks] = await Promise.all([
      DB.list('routines', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('routine_items', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('programs', { eq: { client_id: c.id } }),
      DB.list('program_weeks', { eq: { client_id: c.id } })
    ]);
    if (!S.exercises.length) await loadExercises();
    S.weekSel = S.weekSel || {};
    const prog = programs.filter(p => p.status !== 'archived').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
    const pweeks = prog ? weeks.filter(w => w.program_id === prog.id).sort((a, b) => a.week_no - b.week_no) : [];
    const wantFixed = S.weekSel[c.id] === 'fixed';
    const view = prog && !wantFixed ? (pweeks.find(w => w.id === S.weekSel[c.id]) || pweeks[pweeks.length - 1] || null) : null;
    const fixed = allRoutines.filter(r => !r.program_week_id);
    const routines = allRoutines.filter(r => (view ? r.program_week_id === view.id : !r.program_week_id));
    const live = currentWeek(pweeks, prog ? [prog] : []);
    const laterDrafts = view ? pweeks.filter(w => w.week_no > view.week_no && !w.published).length : 0;
    routines.sort((a, b) => (a.day || 9) - (b.day || 9) || a.position - b.position);
    const progBox = !prog
      ? `<section class="card prog-card"><div class="row gap"><span class="grow"><b>Programa por semanas</b><small class="muted">Convierte estas rutinas en la semana 1. Luego creas cada semana nueva con un clic (copia, progresión automática o descarga) y la publicas cuando esté lista.</small></span>
          <button class="btn small primary" data-newprog ${fixed.length ? '' : 'disabled title="Crea antes alguna rutina"'}>${ic('plus')} Crear programa</button></div></section>`
      : `<section class="card prog-card">
          <div class="row gap"><span class="grow"><b>${esc(prog.name)}</b><small class="muted">${pweeks.length} semana${pweeks.length === 1 ? '' : 's'} · ${live ? 'el cliente ve ahora la ' + esc(weekLabel(live)) : 'el cliente ve sus rutinas fijas hasta que publiques una semana ya empezada'}</small></span></div>
          <label class="check"><input type="checkbox" data-auto ${prog.auto_repeat !== false ? 'checked' : ''}> Repetir sola cada semana con los pesos que hizo <small class="muted">(si no has preparado la siguiente)</small></label>
          <div class="wkchips">${pweeks.map(w => `<button type="button" class="wkchip ${view && view.id === w.id ? 'on' : ''} ${w.published ? 'pub' : ''} ${w.kind === 'deload' ? 'deload' : ''}" data-wk="${w.id}" title="${w.published ? 'Publicada' : 'Borrador'}">S${w.week_no}${w.kind === 'deload' ? ' ↓' : ''}<i></i></button>`).join('')}<button type="button" class="wkchip fixedchip ${view ? '' : 'on'}" data-wk="fixed">Fijas</button></div>
          ${view ? `<div class="row gap wrap wkbar"><span class="grow"><b>${esc(weekLabel(view))}</b> <small class="muted">${fmtDate(view.start_date)} – ${fmtDate(addDays(view.start_date, 6))}</small> <span class="pill ${view.published ? 'green' : 'amber'}">${view.published ? 'Publicada' : 'Borrador'}</span></span>
              <button class="btn small ${view.published ? 'ghost' : 'primary'}" data-pub>${view.published ? 'Ocultar al cliente' : 'Publicar'}</button>
              <button class="btn small" data-clone>${ic('copy')} Crear semana ${Math.max(...pweeks.map(w => w.week_no)) + 1}</button>
              ${!view.published && view.week_no === pweeks[pweeks.length - 1].week_no && pweeks.length > 1 ? `<button class="icon-btn danger" data-delwk title="Eliminar esta semana">${ic('trash')}</button>` : ''}</div>`
            : `<p class="muted small">Rutinas fijas: el cliente solo las ve mientras no haya ninguna semana publicada en curso.</p>`}
        </section>`;
    const week = [1, 2, 3, 4, 5, 6, 7].map(d => { const r = routines.filter(x => x.day === d); return `<div class="wday ${r.length ? 'has' : ''}"><small>${DIAS_C[d]}</small>${r.map(x => `<span>${esc(x.name)}</span>`).join('') || '<em>—</em>'}</div>`; }).join('');
    box.innerHTML = `${progBox}
      <div class="week">${week}</div>
      <div class="row gap wrap"><button class="btn primary" data-add>${ic('plus')} Nueva rutina</button>${view ? '' : `<button class="btn ghost" data-copyall>${ic('copy')} Copiar plan desde otro cliente</button>`}</div>
      <div class="routines">${routines.map(r => {
        const its = items.filter(i => i.routine_id === r.id);
        return `<section class="card routine">
          <header><div><b>${esc(r.name)}</b><small>${r.day ? DIAS[r.day] : 'Día libre'} · ${its.length} ejercicios</small></div><span class="grow"></span>
            <button class="icon-btn" data-dup="${r.id}" title="Duplicar en otro cliente">${ic('copy')}</button>
            <button class="btn small" data-edit="${r.id}">${ic('edit')}<span>Editar</span></button></header>
          ${r.notes ? `<p class="note">${nl2br(r.notes)}</p>` : ''}
          <ol class="ex-list">${its.map(i => `<li><b>${esc(i.exercise_name)}</b><span>${i.sets} × ${esc(i.reps)}${loadLabel(i) ? ' · ' + esc(loadLabel(i)) : ''} · ${i.rest_sec}" desc.${progKey(i.progression) !== 'none' ? ' · ↑ ' + esc((PROG_RULES.find(p => p[0] === progKey(i.progression)) || [0, progKey(i.progression)])[1]) : ''}</span>${i.notes ? `<small>${esc(i.notes)}</small>` : ''}</li>`).join('') || '<li class="empty">Sin ejercicios todavía</li>'}</ol>
        </section>`;
      }).join('') || `<p class="empty">${view ? 'Esta semana no tiene rutinas.' : 'Este cliente aún no tiene rutinas. Crea la primera.'}</p>`}</div>`;
    const opts = { week: view, laterDrafts };
    box.querySelector('[data-add]').onclick = () => routineEditor(c, null, [], opts);
    box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const r = byId(routines, b.dataset.edit); routineEditor(c, r, items.filter(i => i.routine_id === r.id), opts); });
    box.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => duplicateRoutines(c, [byId(routines, b.dataset.dup)], items));
    const ca = box.querySelector('[data-copyall]'); if (ca) ca.onclick = () => copyPlanFrom(c);
    const np = box.querySelector('[data-newprog]'); if (np) np.onclick = () => newProgram(c, fixed.length);
    box.querySelectorAll('[data-wk]').forEach(b => b.onclick = () => { S.weekSel[c.id] = b.dataset.wk; tabRoutines(c, box); });
    const au = box.querySelector('[data-auto]');
    if (au) au.onchange = async () => {
      await safe(() => DB.update('programs', prog.id, { auto_repeat: au.checked }), au.checked ? 'Repetición automática activada' : 'Repetición automática desactivada');
      if (au.checked) { S.rolled = {}; } tabRoutines(c, box);
    };
    if (view) {
      box.querySelector('[data-pub]').onclick = async () => {
        if (view.published && !(await confirmBox(`El cliente dejará de ver la ${weekLabel(view)}.`, 'Ocultar'))) return;
        await safe(() => DB.update('program_weeks', view.id, { published: !view.published }), view.published ? 'Semana ocultada' : `Publicada: el cliente la verá desde el ${fmtDate(view.start_date, { weekday: 'long', day: 'numeric', month: 'short' })}`);
        tabRoutines(c, box);
      };
      box.querySelector('[data-clone]').onclick = () => cloneWeek(c, view, () => tabRoutines(c, box));
      const dw = box.querySelector('[data-delwk]');
      if (dw) dw.onclick = async () => {
        if (!(await confirmBox(`Se eliminará la ${weekLabel(view)} (borrador) con sus rutinas.`))) return;
        await safe(() => DB.remove('program_weeks', view.id), 'Semana eliminada'); S.weekSel[c.id] = null; tabRoutines(c, box);
      };
    }
  }

  function newProgram(c, n) {
    modal('Nuevo programa por semanas', `<p class="muted">Se copiarán las ${n} rutinas fijas de ${esc(c.name)} a la semana 1, en borrador. Las fijas no se borran: el cliente las seguirá viendo hasta que publiques la semana 1.</p>
      <label>Nombre<input name="name" required value="Bloque 1" placeholder="Ej: Hipertrofia otoño"></label>
      <label>Empieza la semana del<input name="start" type="date" required value="${today()}"></label>
      <p class="muted small">Tip: en cada ejercicio elige su «Progresión» (p. ej. +2,5 kg) para que las semanas siguientes suban solas.</p>`, {
      submitLabel: 'Crear programa', onSubmit: async (f, fd) => {
        if (!fd.get('start')) { toast('Elige la fecha de inicio', 'err'); return false; }
        await safe(() => DB.rpc('create_program_from_routines', { p_client: c.id, p_name: String(fd.get('name')).trim() || 'Programa', p_start: fd.get('start') }), 'Programa creado: semana 1 en borrador');
        S.weekSel = S.weekSel || {}; S.weekSel[c.id] = null; render();
      }
    });
  }

  function cloneWeek(c, w, done) {
    const modes = [['progress', 'Progresión automática', 'Sube carga o reps en los ejercicios con regla de progresión si el cliente cumplió el objetivo en esta semana (todas las series en el tope del rango y con el RIR pedido). Lo demás se copia igual.'],
      ['repeat', 'Repetir con los pesos que hizo', 'Misma semana; cada ejercicio parte de la carga que registró el cliente (y sube si tiene regla de progresión y la cumplió).'],
      ['copy', 'Copia exacta', 'Mismas series, reps y cargas.'], ['deload', 'Descarga', '60 % de las series, misma carga y RIR +2.']];
    modal('Crear la semana siguiente', `<p class="muted">A partir de la ${esc(weekLabel(w))}. Se crea en borrador para que la revises antes de publicarla.</p>
      <div class="choices">${modes.map(([v, t, d], i) => `<label class="choice"><input type="radio" name="mode" value="${v}" ${i ? '' : 'checked'}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>`, {
      submitLabel: 'Crear semana', onSubmit: async (f, fd) => {
        const id = await safe(() => DB.rpc('clone_program_week', { p_week_id: w.id, p_mode: fd.get('mode') }), 'Semana creada en borrador');
        S.weekSel[c.id] = id; done();
      }
    });
  }

  // ----- Calendario mensual del cliente (entrenador)
  async function tabCalendar(c, box) {
    S.calMonth = S.calMonth || {};
    const [y, m] = (S.calMonth[c.id] || today().slice(0, 7)).split('-').map(Number);
    await rollWeeks(await DB.list('programs', { eq: { client_id: c.id } }).catch(() => []));
    const [routines, items, programs, weeks, sessions] = await Promise.all([
      DB.list('routines', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('routine_items', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('programs', { eq: { client_id: c.id } }),
      DB.list('program_weeks', { eq: { client_id: c.id } }),
      DB.list('sessions', { eq: { client_id: c.id }, order: ['started_at', 'desc'], limit: 400 })
    ]);
    const prog = programs.filter(p => p.status === 'active').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
    const pweeks = prog ? weeks.filter(w => w.program_id === prog.id).sort((a, b) => a.week_no - b.week_no) : [];
    const lastW = pweeks[pweeks.length - 1];
    const fixed = routines.filter(r => !r.program_week_id);
    const t = today();
    const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const lastDay = new Date(y, m, 0), end = new Date(lastDay); end.setDate(lastDay.getDate() + (7 - ((lastDay.getDay() + 6) % 7)) - 1);
    const plan = iso => {
      const dow = ((new Date(iso + 'T12:00:00').getDay() + 6) % 7) + 1;
      const w = pweeks.find(x => x.start_date <= iso && iso <= addDays(x.start_date, 6));
      if (w) return { week: w, kind: w.published ? 'pub' : 'draft', rs: routines.filter(r => r.program_week_id === w.id && r.day === dow) };
      if (lastW && iso > addDays(lastW.start_date, 6)) {
        if (prog.auto_repeat !== false && lastW.published) return { week: lastW, kind: 'auto', rs: routines.filter(r => r.program_week_id === lastW.id && r.day === dow) };
        return { kind: 'none', rs: [] };
      }
      return { kind: 'fixed', rs: fixed.filter(r => r.day === dow) };
    };
    const doneOn = iso => sessions.filter(s => s.finished_at && ymd(new Date(s.started_at)) === iso);
    const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
    // Una rutina cuenta como hecha si el cliente la hizo cualquier día de esa misma semana
    const doneInWeek = (r, iso) => { const d0 = new Date(iso + 'T12:00:00'); d0.setDate(d0.getDate() - (d0.getDay() + 6) % 7); const a = ymd(d0), z = addDays(a, 6);
      return sessions.some(s => { const sd = s.finished_at && ymd(new Date(s.started_at)); return sd && sd >= a && sd <= z && (s.routine_id === r.id || (s.routine_name || '') === r.name); }); };
    const cells = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = ymd(d), p = plan(iso), done = doneOn(iso);
      const monday = d.getDay() === 1;
      cells.push(`<button type="button" class="cday ${d.getMonth() !== m - 1 ? 'out' : ''} ${iso === t ? 'today' : ''} ${S.calSel === iso ? 'sel' : ''}" data-day="${iso}">
        <span class="cnum">${d.getDate()}${monday && p.week ? `<i class="cwk">S${p.week.week_no + (p.kind === 'auto' ? Math.floor((new Date(iso) - new Date(lastW.start_date)) / 6048e5) : 0)}</i>` : ''}</span>
        ${p.rs.map(r => { const dn = done.some(s => s.routine_id === r.id || (s.routine_name || '') === r.name); return `<span class="cev ${p.kind} ${dn ? 'done' : doneInWeek(r, iso) ? 'moved' : iso < t ? 'missed' : ''}">${esc(r.name)}</span>`; }).join('')}
        ${done.filter(s => !p.rs.some(r => r.id === s.routine_id || r.name === s.routine_name)).map(s => `<span class="cev done">${esc(s.routine_name || 'Entreno')}</span>`).join('')}
      </button>`);
    }
    const mName = cap(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
    const monthDone = sessions.filter(s => s.finished_at && s.started_at.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}`).length;
    box.innerHTML = `<section class="card cal">
        <header class="row gap"><button class="icon-btn" data-mv="-1" aria-label="Mes anterior">‹</button><h3 class="grow center">${esc(mName)}</h3><button class="icon-btn" data-mv="1" aria-label="Mes siguiente">›</button></header>
        <p class="muted small center">${monthDone} entreno${monthDone === 1 ? '' : 's'} hecho${monthDone === 1 ? '' : 's'} este mes${prog ? ` · ${esc(prog.name)}${prog.auto_repeat !== false ? ' · se repite sola cada semana' : ''}` : ' · rutinas fijas (se repiten cada semana)'}</p>
        <div class="cgrid">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => `<small class="chead">${x}</small>`).join('')}${cells.join('')}</div>
        <div class="clegend"><span class="cev pub">Planificado</span><span class="cev done">Hecho</span><span class="cev moved pub">Hecho otro día</span><span class="cev missed pub">No hecho</span>${prog ? '<span class="cev auto">Se repetirá</span><span class="cev draft">Borrador</span>' : ''}</div>
      </section><div data-dayinfo></div>`;
    box.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const d = new Date(y, m - 1 + Number(b.dataset.mv), 1); S.calMonth[c.id] = ymd(d).slice(0, 7); tabCalendar(c, box); });
    const info = box.querySelector('[data-dayinfo]');
    const showDay = iso => {
      S.calSel = iso; box.querySelectorAll('.cday').forEach(x => x.classList.toggle('sel', x.dataset.day === iso));
      const p = plan(iso), done = doneOn(iso);
      info.innerHTML = `<section class="card"><h3>${cap(fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>${p.week ? `<p class="muted small">${esc(weekLabel(p.week))}${p.kind === 'auto' ? ' · se creará sola con los pesos que haga' : p.kind === 'draft' ? ' · borrador (el cliente no la ve)' : ''}</p>` : p.kind === 'fixed' && p.rs.length ? '<p class="muted small">Rutinas fijas</p>' : ''}
        ${p.rs.map(r => `<div class="routine-mini"><b>${esc(r.name)}</b><ol class="ex-list compact">${items.filter(i => i.routine_id === r.id).map(i => `<li><b>${esc(i.exercise_name)}</b><span>${i.sets}×${esc(i.reps)}${loadLabel(i) ? ' · ' + esc(loadLabel(i)) : ''}</span></li>`).join('')}</ol></div>`).join('') || (done.length ? '' : '<p class="empty">Descanso</p>')}
        ${done.map(s => `<p class="pill green">✓ ${esc(s.routine_name || 'Entreno')} · ${Math.max(1, Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 6e4))} min${s.volume ? ' · ' + Math.round(s.volume).toLocaleString('es-ES') + ' kg vol.' : ''}</p>`).join('')}
        ${p.rs.length ? `<button class="btn small" data-goweek>${ic('edit')} Editar ${p.week && p.kind !== 'auto' ? esc(weekLabel(p.week)) : p.kind === 'auto' ? 'la última semana' : 'rutinas fijas'}</button>` : ''}</section>`;
      const g = info.querySelector('[data-goweek]');
      if (g) g.onclick = () => { S.weekSel = S.weekSel || {}; S.weekSel[c.id] = p.week ? p.week.id : 'fixed'; go('#/cliente/' + c.id + '/rutinas'); };
    };
    box.querySelectorAll('[data-day]').forEach(b => b.onclick = () => showDay(b.dataset.day));
    const inMonth = S.calSel && S.calSel.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}` ? S.calSel : (t.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}` ? t : null);
    if (inMonth) showDay(inMonth);
  }

  async function copyRoutinesTo(target, routines, allItems) {
    for (const r of routines) {
      const [nr] = await DB.insert('routines', { client_id: target.id, name: r.name, day: r.day, position: r.position, notes: r.notes });
      const its = allItems.filter(i => i.routine_id === r.id).map(i => ({ ...(crypto.randomUUID ? { lineage_id: crypto.randomUUID() } : {}), routine_id: nr.id, client_id: target.id, exercise_id: i.exercise_id, exercise_name: i.exercise_name, media_url: i.media_url, position: i.position, sets: i.sets, reps: i.reps, load: i.load, rest_sec: i.rest_sec, notes: i.notes, ...Object.fromEntries(TRAINING_FIELDS.filter(k => i[k] !== undefined).map(k => [k, i[k]])) }));
      if (its.length) await DB.insert('routine_items', its);
    }
  }
  async function duplicateRoutines(from, routines, items) {
    const clients = (await loadClients()).filter(x => x.id !== from.id);
    modal('Duplicar "' + routines[0].name + '"', `<label>¿En qué cliente?<select name="to">${clients.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`, {
      submitLabel: 'Duplicar', onSubmit: async (f, fd) => { const t = byId(clients, fd.get('to')); await safe(() => copyRoutinesTo(t, routines, items), 'Rutina copiada a ' + t.name); }
    });
  }
  async function copyPlanFrom(target) {
    const clients = (await loadClients()).filter(x => x.id !== target.id);
    if (!clients.length) return toast('No hay otros clientes de los que copiar', 'err');
    modal('Copiar plan desde otro cliente', `<p class="muted">Se añadirán todas sus rutinas a ${esc(target.name)}. Las que ya tenga se mantienen.</p><label>Cliente de origen<select name="from">${clients.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`, {
      submitLabel: 'Copiar', onSubmit: async (f, fd) => {
        const fromId = fd.get('from');
        const [rs0, its] = await Promise.all([DB.list('routines', { eq: { client_id: fromId } }), DB.list('routine_items', { eq: { client_id: fromId } })]);
        const rs = rs0.filter(r => !r.program_week_id);
        await safe(() => copyRoutinesTo(target, rs, its), `${rs.length} rutinas copiadas`); render();
      }
    });
  }

  function routineEditor(c, r, items, { week = null, laterDrafts = 0 } = {}) {
    const isNew = !r; r = r || { name: '', day: null, notes: '' };
    const rows = items.map(i => legacyLoad(Object.assign({}, i)));
    rows.forEach(i => { i.prog = progKey(i.progression); });
    const intensOf = i => i.target_rir != null && i.target_rir !== '' ? 'rir:' + Number(i.target_rir) : i.target_rpe != null && i.target_rpe !== '' ? 'rpe:' + Number(i.target_rpe) : '';
    rows.forEach(i => { i.intens = intensOf(i); });
    const INTENS = [['', '—'], ...[0, 1, 2, 3, 4, 5].map(v => ['rir:' + v, 'RIR ' + v]), ...[6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map(v => ['rpe:' + v, 'RPE ' + fmtKg(v)])];
    const exOpts = S.exercises.map(e => `<option value="${esc(e.name)}">${esc(e.muscle || '')}</option>`).join('');
    const rowHtml = (i, idx) => `<div class="ex-row" data-idx="${idx}">
        <div class="ex-row-top"><span class="num">${idx + 1}</span><input list="exlist" name="ex" placeholder="Ejercicio" value="${esc(i.exercise_name || '')}" required>
          <button type="button" class="icon-btn" data-up title="Subir">${ic('up')}</button><button type="button" class="icon-btn" data-down title="Bajar">${ic('down')}</button><button type="button" class="icon-btn danger" data-del title="Quitar">${ic('trash')}</button></div>
        <div class="ex-row-fields">
          <label>Series<input name="sets" type="number" min="1" max="20" value="${i.sets || 3}"></label>
          <label>Reps (rango)<input name="reps" value="${esc(i.reps || '10')}" placeholder="8-10"></label>
          <label>Carga (kg)<input name="kg" type="number" min="0" step="0.25" inputmode="decimal" value="${i.load_kg != null ? esc(i.load_kg) : ''}" placeholder="—"></label>
          <label>Intensidad<select name="int">${(() => { const cur = i.intens || intensOf(i); const opts = INTENS.some(o => o[0] === cur) ? INTENS : [...INTENS, [cur, cur.replace(':', ' ').toUpperCase()]]; return opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join(''); })()}</select></label>
          <label>Tempo<input name="tempo" value="${esc(i.tempo || '')}" placeholder="3-1-1-0" pattern="[0-9Xx]-[0-9Xx]-[0-9Xx]-[0-9Xx]" title="Excéntrica-pausa-concéntrica-pausa, p. ej. 3-1-1-0 (X = explosivo)"></label>
          <label>Descanso (s)<input name="rest" type="number" min="0" step="15" value="${i.rest_sec != null ? i.rest_sec : 90}"></label>
          <label>Progresión<select name="prog">${(PROG_RULES.some(p => p[0] === i.prog) ? PROG_RULES : [...PROG_RULES, [i.prog, i.prog]]).map(([v, l]) => `<option value="${v}" ${v === (i.prog || 'none') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="wide">Indicaciones<input name="notes" value="${esc(i.notes || '')}" placeholder="Técnica, superserie…"></label>
          <label class="wide">Vídeo o foto (enlace, opcional)<input name="media" value="${esc(i.media_url || '')}" placeholder="https://youtube.com/…"></label>
        </div></div>`;
    const form = modal(isNew ? 'Nueva rutina para ' + c.name : 'Editar rutina', `
      <datalist id="exlist">${exOpts}</datalist>
      <div class="form-grid">
        <label>Nombre<input name="name" required value="${esc(r.name)}" placeholder="Ej: Pierna y glúteo"></label>
        <label>Día<select name="day"><option value="">Libre (sin día fijo)</option>${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}" ${r.day === d ? 'selected' : ''}>${DIAS[d]}</option>`).join('')}</select></label>
        <label class="full">Notas de la sesión<textarea name="rnotes" rows="2" placeholder="Calentamiento, objetivo del día…">${esc(r.notes)}</textarea></label>
      </div>
      <h4>Ejercicios${week ? ` <small class="muted">· ${esc(weekLabel(week))}</small>` : ''}</h4>
      <div data-rows></div>
      <button type="button" class="btn block ghost dashed" data-addex>${ic('plus')} Añadir ejercicio</button>
      ${week && laterDrafts && !isNew ? `<label class="check"><input type="checkbox" name="propagate"> Aplicar también los cambios a las ${laterDrafts} semana${laterDrafts > 1 ? 's' : ''} siguiente${laterDrafts > 1 ? 's' : ''} en borrador <small class="muted">(series, reps, descanso, tempo, RIR, indicaciones, vídeo y progresión; no cargas)</small></label>` : ''}`, {
      wide: true, submitLabel: 'Guardar rutina',
      danger: isNew ? null : { label: 'Eliminar rutina', run: async () => { if (await confirmBox('Se eliminará la rutina "' + r.name + '".')) { await safe(() => DB.remove('routines', r.id), 'Rutina eliminada'); render(); } } },
      onSubmit: async (f, fd) => {
        sync();
        const valid = rows.filter(x => (x.exercise_name || '').trim());
        const head = { name: fd.get('name').trim() || 'Rutina', day: fd.get('day') ? Number(fd.get('day')) : null, notes: fd.get('rnotes') };
        await safe(async () => {
          let rid = r.id;
          if (isNew) { const [nr] = await DB.insert('routines', Object.assign({ client_id: c.id, position: Date.now() % 100000 }, week ? { program_week_id: week.id } : {}, head)); rid = nr.id; }
          else await DB.update('routines', rid, head);
          // Actualiza en su sitio los ejercicios que ya existían (así conservan su linaje y su historial de cargas),
          // crea los nuevos y borra solo los que se han quitado
          const old = isNew ? [] : await DB.list('routine_items', { eq: { routine_id: rid } });
          const payload = (x, i) => {
            const e = S.exercises.find(e => e.name.toLowerCase() === x.exercise_name.trim().toLowerCase());
            const [kind, val] = String(x.intens || '').split(':');
            const tempo = String(x.tempo || '').trim().toUpperCase();
            const d = {
              exercise_id: e ? e.id : null, exercise_name: x.exercise_name.trim(), media_url: x.media_url || (e && e.media_url) || '', position: i,
              sets: Number(x.sets) || 1, reps: String(x.reps || '').trim(), rest_sec: Number(x.rest_sec) || 0, notes: x.notes || '',
              load_kg: num(x.load_kg), target_rir: kind === 'rir' ? Number(val) : null, target_rpe: kind === 'rpe' ? Number(val) : null,
              tempo: /^[0-9X]-[0-9X]-[0-9X]-[0-9X]$/.test(tempo) ? tempo : null, progression: progVal(x.prog), ...repsRange(x.reps)
            };
            d.load = loadLabel(d); // texto resumen para versiones antiguas de la app
            return d;
          };
          const keep = new Set(valid.filter(x => x.id).map(x => x.id));
          for (const o of old) if (!keep.has(o.id)) await DB.remove('routine_items', o.id);
          const news = [];
          for (const [i, x] of valid.entries()) {
            if (x.id && old.some(o => o.id === x.id)) {
              const d = payload(x, i); await DB.update('routine_items', x.id, d);
              if (fd.get('propagate')) {
                const ch = {}; ['sets', 'reps', 'rest_sec', 'tempo', 'target_rir', 'notes', 'media_url', 'progression'].forEach(k => { if (d[k] != null) ch[k] = d[k]; });
                await DB.rpc('propagate_item_change', { p_item_id: x.id, p_changes: ch });
              }
            }
            else news.push(Object.assign({ routine_id: rid, client_id: c.id }, crypto.randomUUID ? { lineage_id: crypto.randomUUID() } : {}, payload(x, i)));
          }
          if (news.length) await DB.insert('routine_items', news);
        }, 'Rutina guardada');
        render();
      }
    });
    const box = form.querySelector('[data-rows]');
    function sync() {
      box.querySelectorAll('.ex-row').forEach(el => {
        const i = rows[+el.dataset.idx]; const v = n => el.querySelector(`[name=${n}]`).value;
        Object.assign(i, { exercise_name: v('ex'), sets: v('sets'), reps: v('reps'), load_kg: v('kg'), intens: v('int'), tempo: v('tempo'), rest_sec: v('rest'), notes: v('notes'), media_url: v('media'), prog: v('prog') });
      });
    }
    function draw() {
      box.innerHTML = rows.map(rowHtml).join('') || '<p class="empty">Añade el primer ejercicio. Escribe para buscar en tu catálogo (o escribe uno nuevo).</p>';
      box.querySelectorAll('.ex-row').forEach(el => {
        const idx = +el.dataset.idx;
        el.querySelector('[data-del]').onclick = () => { sync(); rows.splice(idx, 1); draw(); };
        el.querySelector('[data-up]').onclick = () => { sync(); if (idx > 0) { [rows[idx - 1], rows[idx]] = [rows[idx], rows[idx - 1]]; draw(); } };
        el.querySelector('[data-down]').onclick = () => { sync(); if (idx < rows.length - 1) { [rows[idx + 1], rows[idx]] = [rows[idx], rows[idx + 1]]; draw(); } };
        el.querySelector('[name=ex]').onchange = e => { const ex = S.exercises.find(x => x.name === e.target.value); const m = el.querySelector('[name=media]'); if (ex && ex.media_url && !m.value) m.value = ex.media_url; };
      });
    }
    form.querySelector('[data-addex]').onclick = () => { sync(); const prev = rows[rows.length - 1]; rows.push({ sets: prev ? prev.sets : 3, reps: prev ? prev.reps : '10', rest_sec: prev ? prev.rest_sec : 90, intens: prev ? prev.intens : '', prog: prev ? prev.prog : 'none' }); draw(); const ins = box.querySelectorAll('[name=ex]'); ins[ins.length - 1].focus(); };
    draw();
  }

  // ----- Nutrición (entrenador)
  // ----- Calculadora nutricional (fórmulas de la Calculadora V1 de Jorge)
  const ACT = [['Poco activo', 1.2, 0.35, 'Todo el día sentado y no entrena.'], ['Algo activo', 1.375, 0.45, 'Gran parte del día sentado, pero entrena en el gimnasio.'],
    ['Activo', 1.55, 0.5, 'Se mueve bastante durante el día y además entrena.'], ['Muy activo', 1.725, 0.55, 'Mucho movimiento a diario y entrenos intensos frecuentes.'],
    ['Extremadamente activo', 1.9, 0.6, 'Trabajo físico muy exigente o entrenos dobles / alto rendimiento.']];
  const GOALS = ['Mantenimiento', 'Pérdida de grasa', 'Ganancia muscular'];
  const MEALS5 = ['Comida 1 · Desayuno', 'Comida 2 · Media mañana', 'Comida 3 · Almuerzo', 'Comida 4 · Pre-entreno', 'Comida 5 · Post-entreno'];
  function nutriCalc(i) {
    const a = ACT.find(x => x[0] === i.act) || ACT[2], gain = i.goal === 'Ganancia muscular', loss = i.goal === 'Pérdida de grasa', fem = i.sex === 'Femenino';
    const tmb = 10 * i.kg + 6.25 * i.cm - 5 * i.age + (fem ? -161 : 5);
    const get = tmb * a[1];
    const kcal = gain ? get * 1.12 : loss ? get * 0.82 : get;
    const pR = gain ? 1.6 : loss ? 2 : 1.8, fR = fem ? 1.1 : 0.8;
    const p = i.kg * pR, f = i.kg * fR, c = (kcal - p * 4 - f * 9) / 4;
    const r2 = x => Math.round(x * 100) / 100;
    const rate = gain ? `+${r2(i.kg * 0.0025)} a +${r2(i.kg * 0.005)} kg/sem` : loss ? `-${r2(i.kg * 0.005)} a -${r2(i.kg * 0.01)} kg/sem` : '0 kg/sem (mantenimiento)';
    const x = a[2];
    const dist = [
      [0.2, (1 - x) * 0.3, 0.75 * (loss ? 0.4 : gain ? 0.3 : 0.35)],
      [0.2, (1 - x) * 0.45, 0.75 * (loss ? 0.35 : gain ? 0.3 : 0.35)],
      [gain ? 0.2 : 0.25, (1 - x) * 0.25, 0.75 * (loss ? 0.25 : gain ? 0.4 : 0.3)],
      [0.05, x * 0.45, 0.05],
      [gain ? 0.35 : 0.3, x * 0.55, 0.2]
    ];
    return { tmb, get, practical: (gain ? 37.4 : loss ? 28.6 : 33) * i.kg, kcal, adj: (kcal - get) / get, rate, water: i.kg * 0.04, p, f, c, pR, fR, fiber: Math.round(kcal / 1000 * 12), dist };
  }
  async function calcCard(c, form, hasPlan) {
    const key = 'jmfit-calc-' + c.id;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
    Object.keys(saved).forEach(k => { if (saved[k] === '' || saved[k] === 0 || saved[k] == null) delete saved[k]; });   // nunca pisar datos reales con vacíos
    const cks = await DB.list('checkins', { eq: { client_id: c.id }, order: ['date', 'desc'], limit: 5 }).catch(() => []);
    const lastW = (cks.find(k => k.weight) || {}).weight;
    const bm = String(c.notes || '').match(/Nacimiento:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const age = bm ? Math.floor((Date.now() - new Date(+bm[3], +bm[2] - 1, +bm[1])) / 31557600000) : '';
    const inp = Object.assign({ sex: 'Masculino', age, cm: '', kg: lastW || '', goal: 'Mantenimiento', act: 'Activo' }, saved);
    const box = document.createElement('details'); box.className = 'card calc'; if (!hasPlan) box.open = true;
    const o = (list, v) => list.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
    box.innerHTML = `<summary><b>${ic('chart')} Calculadora de necesidades y macros</b><small class="muted">Mifflin-St Jeor · actividad · objetivo</small></summary>
      <div class="form-grid three calc-in">
        <label>Género<select name="sex">${o(['Masculino', 'Femenino'], inp.sex)}</select></label>
        <label>Edad (años)<input name="age" type="number" min="12" max="99" value="${esc(inp.age)}"></label>
        <label>Altura (cm)<input name="cm" type="number" min="120" max="230" value="${esc(inp.cm)}"></label>
        <label>Peso (kg)${lastW ? ` <small class="muted">· último check-in ${fmtKg(lastW)}</small>` : ''}<input name="kg" type="number" step="0.1" min="30" max="250" value="${esc(inp.kg)}"></label>
        <label>Objetivo<select name="goal">${o(GOALS, inp.goal)}</select></label>
        <label>Nivel de actividad<select name="act">${o(ACT.map(a => a[0]), inp.act)}</select></label>
      </div>
      <p class="muted small" data-actd></p>
      <div data-out></div>`;
    form.parentNode.insertBefore(box, form);
    const get = () => { const v = n => box.querySelector(`[name=${n}]`).value; return { sex: v('sex'), age: Number(v('age')), cm: Number(v('cm')), kg: Number(v('kg')), goal: v('goal'), act: v('act') }; };
    let pct = null;   // reparto por comidas editado a mano (como en el Excel); null = automático
    const R = x => Math.round(x), pc = x => Math.round(x * 100);
    let sig = '';
    const draw = () => {
      const i = get(); const ns = JSON.stringify([i, pct]); if (ns === sig) return; sig = ns;   // sin cambios: no redibujar (si no, se pierde el clic en los botones)
      try { const keep = {}; Object.entries(i).forEach(([k, v]) => { if (v !== '' && v !== 0 && !Number.isNaN(v)) keep[k] = v; }); localStorage.setItem(key, JSON.stringify(keep)); } catch (e) {}
      box.querySelector('[data-actd]').textContent = (ACT.find(a => a[0] === i.act) || [])[3] || '';
      const out = box.querySelector('[data-out]');
      if (!(i.age && i.cm && i.kg)) { out.innerHTML = '<p class="empty">Rellena edad, altura y peso para calcular.</p>'; return; }
      const r = nutriCalc(i); const d = pct || r.dist;
      const sums = [0, 1, 2].map(j => d.reduce((s, row) => s + row[j], 0));
      out.innerHTML = `<div class="kpis small calc-k">
          <div class="kpi"><small>TMB</small><b>${R(r.tmb)}</b><span>kcal en reposo</span></div>
          <div class="kpi"><small>Mantenimiento</small><b>${R(r.get)}</b><span>práctico: ${R(r.practical)} kcal</span></div>
          <div class="kpi"><small>Objetivo</small><b>${R(r.kcal)}</b><span>${r.adj ? (r.adj > 0 ? '+' : '') + pc(r.adj) + ' % · ' : ''}${esc(r.rate)}</span></div>
          <div class="kpi"><small>Agua mínima</small><b>${fmtKg(Math.round(r.water * 10) / 10)} L</b><span>fibra ${r.fiber} g</span></div>
        </div>
        <table class="calc-t"><thead><tr><th></th><th>g/kg</th><th>g</th><th>kcal</th><th>%</th></tr></thead><tbody>
          <tr><td>Proteína</td><td>${fmtKg(r.pR)}</td><td><b>${R(r.p)}</b></td><td>${R(r.p * 4)}</td><td>${pc(r.p * 4 / r.kcal)}</td></tr>
          <tr><td>Grasas</td><td>${fmtKg(r.fR)}</td><td><b>${R(r.f)}</b></td><td>${R(r.f * 9)}</td><td>${pc(r.f * 9 / r.kcal)}</td></tr>
          <tr><td>Carbohidratos</td><td>${fmtKg(Math.round(r.c / i.kg * 100) / 100)}</td><td><b>${R(r.c)}</b></td><td>${R(r.c * 4)}</td><td>${pc(r.c * 4 / r.kcal)}</td></tr>
        </tbody></table>
        ${r.c < 0 ? '<p class="pill red">Con estos datos no quedan calorías para carbohidratos: revisa peso u objetivo.</p>' : ''}
        <h4>Reparto en 5 comidas</h4><p class="muted small">% de cada macro por comida (cada columna suma 100) y gramos resultantes.</p>
        <div class="tscroll"><table class="calc-t calc-d"><thead><tr><th>Comida</th><th>% P</th><th>% C</th><th>% G</th><th>P g</th><th>C g</th><th>G g</th></tr></thead><tbody>
          ${MEALS5.map((m, k) => `<tr><td><span class="lg">${m.split(' · ')[0]} · </span>${m.split(' · ')[1]}</td>${[0, 1, 2].map(j => `<td><input type="number" step="0.5" data-pct="${k},${j}" value="${Math.round(d[k][j] * 1000) / 10}"></td>`).join('')}<td><b>${R(d[k][0] * r.p)}</b></td><td><b>${R(d[k][1] * r.c)}</b></td><td><b>${R(d[k][2] * r.f)}</b></td></tr>`).join('')}
          <tr class="tot"><td>Total</td>${sums.map(x => `<td class="${Math.abs(x - 1) > 0.005 ? 'bad' : ''}">${Math.round(x * 1000) / 10}</td>`).join('')}<td>${R(d.reduce((s, row) => s + R(row[0] * r.p), 0))}</td><td>${R(d.reduce((s, row) => s + R(row[1] * r.c), 0))}</td><td>${R(d.reduce((s, row) => s + R(row[2] * r.f), 0))}</td></tr>
        </tbody></table></div>
        <div class="row gap wrap calc-actions">
          <button type="button" class="btn primary small" data-apply>Usar en el plan (kcal, macros y agua)</button>
          <button type="button" class="btn small" data-meals>Añadir reparto al menú</button>
          ${pct ? '<button type="button" class="btn ghost small" data-reset>Restablecer reparto</button>' : ''}
        </div>`;
      out.querySelectorAll('[data-pct]').forEach(el => el.onchange = () => { const [k, j] = el.dataset.pct.split(',').map(Number); pct = (pct || r.dist).map(row => row.slice()); pct[k][j] = (Number(el.value) || 0) / 100; draw(); });
      const rs = out.querySelector('[data-reset]'); if (rs) rs.onclick = () => { pct = null; draw(); };
      out.querySelector('[data-apply]').onclick = () => {
        const set = (n, v) => { form[n].value = v; };
        set('kcal', R(r.kcal)); set('protein', R(r.p)); set('carbs', Math.max(0, R(r.c))); set('fat', R(r.f)); set('water', fmtKg(Math.round(r.water * 10) / 10) + ' L');
        form.dispatchEvent(new Event('input')); toast('Valores puestos en el plan. Revisa y pulsa Guardar plan', 'ok');
      };
      out.querySelector('[data-meals]').onclick = () => {
        const txt = `REPARTO POR COMIDAS (${R(r.kcal)} kcal)\n` + MEALS5.map((m, k) => `${m}: P ${R(d[k][0] * r.p)} g · C ${R(d[k][1] * r.c)} g · G ${R(d[k][2] * r.f)} g`).join('\n');
        form.meals.value = form.meals.value.trim() ? form.meals.value.trimEnd() + '\n\n' + txt : txt;
        toast('Reparto añadido al menú. Pulsa Guardar plan', 'ok');
      };
    };
    box.querySelectorAll('.calc-in input, .calc-in select').forEach(el => { el.oninput = draw; el.onchange = draw; });
    draw();
  }

  async function tabNutrition(c, box) {
    const p = (await DB.get('nutrition_plans', c.id, 'client_id')) || {};
    box.innerHTML = `<form class="card stack" data-nf>
      <div class="macros-edit">
        <label>Kcal / día<input name="kcal" type="number" value="${esc(p.kcal)}"></label>
        <label>Proteína (g)<input name="protein" type="number" value="${esc(p.protein)}"></label>
        <label>Carbohidratos (g)<input name="carbs" type="number" value="${esc(p.carbs)}"></label>
        <label>Grasas (g)<input name="fat" type="number" value="${esc(p.fat)}"></label>
        <label>Agua<input name="water" value="${esc(p.water)}" placeholder="2,5 L"></label>
      </div>
      <p class="muted small" data-calc></p>
      <label>Menú / distribución de comidas<textarea name="meals" rows="10" placeholder="Desayuno: …&#10;Comida: …&#10;Cena: …">${esc(p.meals)}</textarea></label>
      <label>Recomendaciones<textarea name="notes" rows="4" placeholder="Suplementación, comidas libres, intercambios…">${esc(p.notes)}</textarea></label>
      <div class="row"><small class="muted">${p.updated_at ? 'Actualizado ' + ago(p.updated_at) : 'Sin plan todavía'}</small><span class="grow"></span><button class="btn primary">Guardar plan</button></div>
    </form>`;
    const f = box.querySelector('[data-nf]');
    calcCard(c, f, !!p.kcal);
    const calc = () => { const g = n => Number(f[n].value) || 0; const k = g('protein') * 4 + g('carbs') * 4 + g('fat') * 9; f.querySelector('[data-calc]').textContent = k ? `Los macros suman ${k} kcal${g('kcal') ? ` (objetivo ${g('kcal')} kcal)` : ''}.` : ''; };
    f.oninput = calc; calc();
    f.onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      ['kcal', 'protein', 'carbs', 'fat'].forEach(k => { d[k] = num(d[k]); });
      await safe(() => DB.upsert('nutrition_plans', Object.assign({ client_id: c.id, updated_at: new Date().toISOString() }, d), 'client_id'), 'Plan de nutrición guardado');
    };
  }

  // ----- Progreso (compartido)
  async function tabProgress(c, box, asCoach) {
    const [checkins, sessions, logs] = await Promise.all([
      DB.list('checkins', { eq: { client_id: c.id }, order: ['date', 'desc'] }),
      DB.list('sessions', { eq: { client_id: c.id }, order: ['started_at', 'desc'], limit: 60 }),
      DB.list('set_logs', { eq: { client_id: c.id }, order: ['created_at', 'desc'], limit: 1500 })
    ]);
    const done = sessions.filter(s => s.finished_at);
    const weights = checkins.filter(x => x.weight).slice().reverse();
    const best = {};
    logs.forEach(l => { if (l.weight && l.reps) { const e1 = l.weight * (1 + l.reps / 30); if (!best[l.exercise_name] || e1 > best[l.exercise_name].e1) best[l.exercise_name] = { e1, w: l.weight, r: l.reps }; } });
    const prs = Object.entries(best).sort((a, b) => b[1].e1 - a[1].e1).slice(0, 8);
    const first = weights[0], lastW = weights[weights.length - 1];
    const diff = first && lastW && first !== lastW ? lastW.weight - first.weight : null;

    box.innerHTML = `
      ${!asCoach ? `<button class="btn primary block big" data-ck>${ic('camera')} Enviar check-in semanal</button>` : ''}
      <div class="kpis small">
        <div class="kpi"><small>Peso actual</small><b>${lastW ? fmtKg(lastW.weight) + ' kg' : '–'}</b><span>${diff != null ? (diff > 0 ? '+' : '') + fmtKg(diff) + ' kg desde el inicio' : 'Registra tu peso en el check-in'}</span></div>
        <div class="kpi"><small>Entrenos completados</small><b>${done.length}</b><span>${done[0] ? 'Último ' + ago(done[0].finished_at) : '—'}</span></div>
        <div class="kpi"><small>Check-ins</small><b>${checkins.length}</b><span>${checkins[0] ? 'Último ' + fmtDate(checkins[0].date) : '—'}</span></div>
      </div>
      ${weights.length > 1 ? `<section class="card"><h3>Evolución del peso</h3>${lineChart(weights.map(w => ({ x: w.date, y: Number(w.weight) })))}</section>` : ''}
      ${prs.length ? `<section class="card"><h3>Mejores marcas</h3><ul class="prs">${prs.map(([n, b]) => `<li><span>${esc(n)}</span><b>${fmtKg(b.w)} kg × ${b.r}</b><small>1RM est. ${Math.round(b.e1)} kg</small></li>`).join('')}</ul></section>` : ''}
      <div class="grid2">
        <section class="card"><h3>Check-ins</h3><div data-cks>${checkins.length ? '' : '<p class="empty">Aún no hay check-ins.</p>'}</div></section>
        <section class="card"><h3>Entrenos</h3>${done.length ? `<ul class="sessions">${done.map(s => `<li data-s="${s.id}" class="${asCoach && !s.coach_seen ? 'unseen' : ''}"><button type="button" class="srow"><b>${esc(s.routine_name || 'Entreno')}</b><small>${fmtDate(s.started_at, { weekday: 'short', day: 'numeric', month: 'short' })} · ${Math.max(1, Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 6e4))} min${s.volume ? ' · ' + Math.round(s.volume).toLocaleString('es-ES') + ' kg vol.' : ''}${s.rpe ? ' · RPE ' + s.rpe : ''}</small></button><div class="sdetail" hidden></div></li>`).join('')}</ul>` : '<p class="empty">Aún no hay entrenos registrados.</p>'}</section>
      </div>`;
    const ckBtn = box.querySelector('[data-ck]'); if (ckBtn) ckBtn.onclick = () => checkinForm(c);
    // check-ins con fotos
    const ckBox = box.querySelector('[data-cks]');
    for (const k of checkins) ckBox.appendChild(checkinCard(k, asCoach));
    // detalle de sesiones
    box.querySelectorAll('.sessions li').forEach(li => {
      li.querySelector('.srow').onclick = async () => {
        const d = li.querySelector('.sdetail');
        if (!d.hidden) { d.hidden = true; return; }
        const s = byId(done, li.dataset.s);
        const sets = logs.filter(l => l.session_id === s.id).sort((a, b) => a.set_no - b.set_no);
        const groups = {}; sets.forEach(l => { (groups[l.exercise_name] = groups[l.exercise_name] || []).push(l); });
        d.innerHTML = Object.entries(groups).map(([n, ls]) => `<div class="sx"><b>${esc(n)}</b><span>${ls.map(l => `${fmtKg(l.weight)}×${l.reps ?? '–'}${l.rir != null ? ' @RIR ' + fmtKg(l.rir) : l.rpe != null ? ' @RPE ' + fmtKg(l.rpe) : ''}`).join(' · ')}</span></div>`).join('') + (s.notes ? `<p class="note">${nl2br(s.notes)}</p>` : '') || '<p class="empty">Sin series registradas</p>';
        d.hidden = false;
        if (asCoach && !s.coach_seen) { s.coach_seen = true; li.classList.remove('unseen'); DB.update('sessions', s.id, { coach_seen: true }).catch(() => {}); }
      };
    });
  }

  function lineChart(pts) {
    const W = 600, H = 200, P = 46;
    const ys = pts.map(p => p.y); let min = Math.min(...ys), max = Math.max(...ys);
    if (max - min < 1) { min -= 0.5; max += 0.5; }
    const x = i => P + (i * (W - P * 2)) / Math.max(1, pts.length - 1);
    const y = v => H - P - ((v - min) * (H - P * 2)) / (max - min);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    const area = `${path} L${x(pts.length - 1)},${H - P} L${x(0)},${H - P} Z`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del peso">
      <line x1="${P}" x2="${W - P}" y1="${y(max)}" y2="${y(max)}" class="grid"/><line x1="${P}" x2="${W - P}" y1="${y(min)}" y2="${y(min)}" class="grid"/>
      <text x="${W - P + 4}" y="${y(max) + 4}" class="lbl">${fmtKg(max)}</text><text x="${W - P + 4}" y="${y(min) + 4}" class="lbl">${fmtKg(min)}</text>
      <path d="${area}" class="area"/><path d="${path}" class="line"/>
      ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="3.5" class="pt"><title>${fmtDate(p.x)}: ${fmtKg(p.y)} kg</title></circle>`).join('')}
      <text x="${P}" y="${H - 6}" class="lbl">${fmtDate(pts[0].x)}</text><text x="${W - P}" y="${H - 6}" class="lbl" text-anchor="end">${fmtDate(pts[pts.length - 1].x)}</text>
    </svg>`;
  }

  // ----- Mensajes (compartido)
  async function tabMessages(c, box, me) {
    box.innerHTML = `<section class="card chat"><div class="msgs" data-msgs>${loading()}</div>
      <form class="composer" data-send><textarea name="b" rows="1" placeholder="Escribe un mensaje…" required></textarea><button class="icon-btn primary" aria-label="Enviar">${ic('send')}</button></form></section>`;
    const list = box.querySelector('[data-msgs]');
    let lastCount = -1;
    async function load() {
      const msgs = await DB.list('messages', { eq: { client_id: c.id }, order: ['created_at', 'asc'] });
      if (msgs.length === lastCount) return; lastCount = msgs.length;
      list.innerHTML = msgs.length ? msgs.map(m => `<div class="msg ${m.author === me ? 'mine' : ''}"><p>${nl2br(m.body)}</p><small>${fmtDate(m.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')
        : `<p class="empty">${me === 'coach' ? 'Empieza la conversación con ' + esc(c.name.split(' ')[0]) + '.' : 'Escribe a tu entrenador cualquier duda.'}</p>`;
      list.scrollTop = list.scrollHeight;
    }
    await load();
    intervals.push(setInterval(() => { if (document.visibilityState === 'visible') load().catch(() => {}); }, 15000));
    const f = box.querySelector('[data-send]');
    const ta = f.b;
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 700) { e.preventDefault(); f.requestSubmit(); } });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
    f.onsubmit = async e => {
      e.preventDefault(); const body = ta.value.trim(); if (!body) return;
      ta.value = ''; ta.style.height = 'auto';
      await safe(() => DB.insert('messages', { client_id: c.id, author: me, body }));
      lastCount = -1; load();
    };
  }

  // ----- Cobros del cliente
  async function tabClientPayments(c, box) {
    try {
      const data = await getSheet();
      const key = (c.sheet_name || c.name).trim().toLowerCase();
      const row = data.clientes.find(x => String(x.nombre).trim().toLowerCase() === key);
      const pagos = data.pagos.filter(p => String(p.cliente).trim().toLowerCase() === key);
      box.innerHTML = `${data.demo ? demoSheetNote() : ''}
        ${row ? `<div class="kpis small">
          <div class="kpi"><small>Plan actual</small><b class="txt">${esc(row.plan || '—')}</b><span>${eur(row.cuota)}</span></div>
          <div class="kpi ${String(row.estado).includes('VENC') ? 'warn' : ''}"><small>Próximo vencimiento</small><b class="txt">${fmtDate(row.vence, { day: 'numeric', month: 'short', year: 'numeric' })}</b><span>${esc(row.estado)} · ${esc(row.dias)}</span></div>
          <div class="kpi"><small>Pagado este mes</small><b class="txt">${esc(row.pagadoMes || '—')}</b><span>${row.pendiente ? 'Pendiente fraccionado ' + eur(row.pendiente) : ''}</span></div>
        </div>` : `<p class="note">No encuentro a "${esc(c.sheet_name || c.name)}" en tu hoja. Edita el cliente y pon en "Nombre en la hoja de cobros" el nombre exacto de tu Excel.</p>`}
        <button class="btn primary" data-pay>${ic('plus')} Registrar pago</button>
        <section class="card"><h3>Pagos</h3>${pagosTable(pagos)}</section>`;
      box.querySelector('[data-pay]').onclick = () => paymentForm(data, row ? row.nombre : (c.sheet_name || c.name), () => render());
    } catch (e) { box.innerHTML = sheetError(e); }
  }
  const demoSheetNote = () => '<p class="note small">Modo demo: estos cobros son inventados. Al conectar tu hoja real verás tus clientes y pagos.</p>';
  const sheetError = e => `<div class="hero-empty">${ic('euro', 'xl')}<h2>${e.message === 'NO_SHEET' ? 'Conecta tu hoja de cobros' : 'No se pudo leer la hoja'}</h2><p>${e.message === 'NO_SHEET' ? 'Ve a Cobros y pega la dirección de tu hoja (te explico cómo en la guía).' : esc(e.message)}</p><a class="btn primary" href="#/cobros">Ir a Cobros</a></div>`;
  const pagosTable = pagos => pagos.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Plan</th><th class="r">Importe</th><th>Método</th><th>Cubre hasta</th></tr></thead>
      <tbody>${pagos.map(p => `<tr><td>${fmtDate(p.fecha, { day: 'numeric', month: 'short', year: '2-digit' })}</td><td>${esc(p.cliente)}</td><td>${esc(p.plan)}</td><td class="r">${eur(p.importe)}</td><td>${esc(p.metodo)}</td><td>${fmtDate(p.vence, { day: 'numeric', month: 'short', year: '2-digit' })}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="empty">Sin pagos registrados.</p>';

  function paymentForm(data, clientName, after) {
    const names = [...new Set(data.clientes.map(x => x.nombre))];
    if (clientName && !names.includes(clientName)) names.unshift(clientName);
    const tarifa = p => data.tarifas.find(t => t.plan === p);
    const cur = data.clientes.find(x => x.nombre === clientName);
    const f = modal('Registrar pago', `
      <div class="form-grid">
        <label>Cliente<select name="cliente" required>${names.map(n => `<option ${n === clientName ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label>Fecha del pago<input name="fecha" type="date" required value="${today()}"></label>
        <label>Plan<select name="plan" required>${data.tarifas.map(t => `<option ${cur && cur.plan === t.plan ? 'selected' : ''}>${esc(t.plan)}</option>`).join('')}</select></label>
        <label>Importe (€)<input name="importe" type="number" step="0.01" min="0" required></label>
        <label>Método<select name="metodo">${['Bizum', 'Efectivo', 'Transferencia', 'Tarjeta'].map(m => `<option ${cur && cur.metodo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="full">Notas<input name="notas" placeholder="Ej: pago 1 de 2, cambio de plan…"></label>
      </div>
      <p class="muted small">Se añade una fila en "Registro de Pagos" de tu hoja; el servicio y el vencimiento los calculan tus fórmulas.</p>`, {
      submitLabel: 'Registrar en la hoja',
      onSubmit: async (form, fd) => {
        const pago = Object.fromEntries(fd);
        const r = await safe(() => DB.sheets('registrarPago', { pago }), 'Pago registrado');
        S.sheet = null; if (after) after(r);
      }
    });
    const fill = () => {
      const t = tarifa(f.plan.value);
      const c2 = data.clientes.find(x => x.nombre === f.cliente.value);
      f.importe.value = c2 && c2.plan === f.plan.value && c2.cuota ? c2.cuota : (t ? t.precio : '');
    };
    f.plan.onchange = fill; f.cliente.onchange = () => { const c2 = data.clientes.find(x => x.nombre === f.cliente.value); if (c2 && c2.plan) f.plan.value = c2.plan; fill(); };
    fill();
  }

  // ---------- Cobros (vista general)
  async function coachPayments() {
    shell(COACH_NAV, 'cobros', loading(), { title: 'Cobros', actions: `<button class="icon-btn" data-refresh title="Actualizar">${ic('refresh')}</button><button class="btn small ghost" data-conf>${ic('cog')}<span>Conectar hoja</span></button>` });
    $app.querySelector('[data-conf]').onclick = sheetSettings;
    $app.querySelector('[data-refresh]').onclick = () => { S.sheet = null; render(); };
    const box = $app.querySelector('.content');
    let data;
    try { data = await getSheet(); } catch (e) { box.innerHTML = e.message === 'NO_SHEET' ? `<div class="hero-empty">${ic('euro', 'xl')}<h2>Conecta tu hoja de cobros</h2><p>Así podrás ver vencimientos y registrar pagos desde la app, y todo queda apuntado en tu Excel de Google.</p><button class="btn primary" data-conf2>Conectar hoja</button></div>` : sheetError(e); const b = box.querySelector('[data-conf2]'); if (b) b.onclick = sheetSettings; return; }
    const act = data.clientes.filter(c => c.estado && c.estado !== 'BAJA / PAUSA');
    const dd = c => parseInt(c.dias, 10);
    const venc = act.filter(c => dd(c) < 0), prox = act.filter(c => dd(c) >= 0 && dd(c) <= 7);
    const ym = today().slice(0, 7);
    const mes = data.pagos.filter(p => String(p.fecha).slice(0, 7) === ym).reduce((s, p) => s + (Number(p.importe) || 0), 0);
    const waLink = c => { const cl = S.clients.find(x => (x.sheet_name || x.name).toLowerCase() === String(c.nombre).toLowerCase()); return cl && cl.phone ? `https://wa.me/${String(cl.phone).replace(/\D/g, '')}?text=${encodeURIComponent(`¡Hola ${String(c.nombre).split(' ')[0]}! Te recuerdo que tu plan ${c.plan} de ${BRAND} ${dd(c) < 0 ? 'venció' : 'vence'} el ${fmtDate(c.vence, { day: 'numeric', month: 'long' })} (${eur(c.cuota)}). ¡Gracias! 💪`)}` : ''; };
    if (!S.clients.length) await loadClients().catch(() => {});
    box.innerHTML = `${data.demo ? demoSheetNote() : ''}
      <div class="kpis">
        <div class="kpi"><small>Cobrado este mes</small><b>${eur(mes)}</b><span>${data.pagos.filter(p => String(p.fecha).slice(0, 7) === ym).length} pagos</span></div>
        <div class="kpi"><small>Clientes con plan</small><b>${act.length}</b><span>según tu hoja</span></div>
        <div class="kpi ${venc.length ? 'warn' : ''}"><small>Vencidos</small><b>${venc.length}</b><span>${eur(venc.reduce((s, c) => s + (Number(c.cuota) || 0), 0))} por cobrar</span></div>
        <div class="kpi"><small>Vencen en 7 días</small><b>${prox.length}</b><span>${eur(prox.reduce((s, c) => s + (Number(c.cuota) || 0), 0))}</span></div>
      </div>
      <button class="btn primary" data-pay>${ic('plus')} Registrar pago</button>
      <section class="card"><h3>Estado por cliente</h3><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Plan</th><th class="r">Cuota</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>
        ${act.sort((a, b) => dd(a) - dd(b)).map(c => `<tr><td><b>${esc(c.nombre)}</b></td><td>${esc(c.plan)}</td><td class="r">${eur(c.cuota)}</td><td>${fmtDate(c.vence, { day: 'numeric', month: 'short', year: '2-digit' })}</td>
          <td><span class="pill ${dd(c) < 0 ? 'red' : dd(c) <= 7 ? 'amber' : 'green'}">${dd(c) < 0 ? 'Vencido ' + -dd(c) + ' d' : dd(c) + ' d'}</span></td>
          <td class="r nowrap">${waLink(c) ? `<a class="icon-btn" target="_blank" rel="noopener" href="${esc(waLink(c))}" title="Recordatorio por WhatsApp">${ic('wa')}</a>` : ''}<button class="btn small" data-payfor="${esc(c.nombre)}">Cobrar</button></td></tr>`).join('')}
      </tbody></table></div></section>
      <section class="card"><h3>Últimos pagos</h3>${pagosTable(data.pagos.slice(0, 20))}</section>
      <p class="muted small">Datos leídos de tu hoja ${ago(data.actualizado)}.</p>`;
    box.querySelector('[data-pay]').onclick = () => paymentForm(data, '', () => render());
    box.querySelectorAll('[data-payfor]').forEach(b => b.onclick = () => paymentForm(data, b.dataset.payfor, () => render()));
  }

  async function sheetSettings() {
    const [url, token] = await Promise.all([DB.getSetting('sheets_url'), DB.getSetting('sheets_token')]);
    modal('Conectar hoja de cobros', `
      <ol class="steps small">
        <li>Abre tu hoja → <b>Extensiones → Apps Script</b>.</li>
        <li>Pega el código del archivo <code>apps-script/Codigo.gs</code> y cambia <code>TOKEN</code> por una clave inventada.</li>
        <li><b>Implementar → Nueva implementación → Aplicación web</b> · Ejecutar como: <i>Yo</i> · Acceso: <i>Cualquier usuario</i>.</li>
        <li>Copia la URL que acaba en <code>/exec</code> y pégala aquí con tu clave.</li>
      </ol>
      <label>URL de la aplicación web<input name="url" value="${esc(url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label>Clave (TOKEN)<input name="token" type="password" value="${esc(token)}"></label>`, {
      submitLabel: 'Guardar y probar',
      onSubmit: async (f, fd) => {
        await DB.setSetting('sheets_url', fd.get('url').trim());
        await DB.setSetting('sheets_token', fd.get('token').trim());
        S.sheet = null;
        if (fd.get('url').trim()) { await safe(() => getSheet(true), 'Hoja conectada ✔'); }
        render();
      }
    });
  }

  // ----- Tarjeta de check-in (Progreso del cliente y bandeja de Revisiones)
  function checkinCard(k, asCoach, { who, prev } = {}) {
    const el = document.createElement('article'); el.className = 'checkin' + (asCoach && !k.coach_seen ? ' unseen' : '');
    const meas = [['Cintura', k.waist], ['Cadera', k.hip], ['Pecho', k.chest], ['Brazo', k.arm], ['Muslo', k.thigh]].filter(m => m[1]);
    const sc = [['Energía', k.energy], ['Sueño', k.sleep], ['Adherencia', k.adherence]].filter(m => m[1]);
    const dw = prev && prev.weight && k.weight ? Number(k.weight) - Number(prev.weight) : null;
    el.innerHTML = `${who ? `<a class="ck-who" href="#/cliente/${who.id}/progreso">${esc(who.name)}</a>` : ''}<header><b>${fmtDate(k.date, { weekday: 'long', day: 'numeric', month: 'long' })}</b>${k.weight ? `<span class="pill">${fmtKg(k.weight)} kg${dw != null ? ` · ${dw > 0 ? '+' : ''}${fmtKg(dw)}` : ''}</span>` : ''}</header>
      ${meas.length ? `<p class="small">${meas.map(m => `${m[0]} ${fmtKg(m[1])} cm`).join(' · ')}</p>` : ''}
      ${sc.length ? `<div class="scores">${sc.map(m => `<span>${m[0]} <b>${'●'.repeat(m[1])}${'○'.repeat(5 - m[1])}</b></span>`).join('')}</div>` : ''}
      ${k.notes ? `<p>“${nl2br(k.notes)}”</p>` : ''}
      ${k.photo_path ? '<div class="photo" data-photo></div>' : ''}
      ${k.coach_reply ? `<p class="reply"><b>Respuesta:</b> ${nl2br(k.coach_reply)}</p>` : ''}
      ${asCoach ? `<form class="row gap" data-reply><input name="r" placeholder="${k.coach_reply ? 'Cambiar respuesta…' : 'Responder al check-in…'}"><button class="btn small">${k.coach_seen ? 'Responder' : 'Revisado'}</button></form>` : ''}`;
    if (k.photo_path) DB.photoUrl(k.photo_path).then(u => { el.querySelector('[data-photo]').innerHTML = `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto de progreso" loading="lazy"></a>`; }).catch(() => {});
    const rf = el.querySelector('[data-reply]');
    if (rf) rf.onsubmit = async e => { e.preventDefault(); const v = rf.r.value.trim(); const patch = { coach_seen: true }; if (v) patch.coach_reply = v; await safe(() => DB.update('checkins', k.id, patch), 'Check-in revisado'); render(); };
    return el;
  }

  // ---------- Programas (por ahora: rutinas de cada cliente + catálogo)
  const PROGRAM_TABS = on => `<div class="tabs"><a href="#/programas" class="${on === 'rutinas' ? 'on' : ''}">Rutinas por cliente</a><a href="#/programas/ejercicios" class="${on === 'ejercicios' ? 'on' : ''}">Ejercicios</a></div>`;
  async function coachPrograms() {
    shell(COACH_NAV, 'programas', loading(), { title: 'Programas' });
    const [clients, allR, programs, weeks] = await Promise.all([loadClients(), DB.list('routines', { order: ['position', 'asc'] }), DB.list('programs', {}), DB.list('program_weeks', {})]);
    const routines = allR.filter(r => !r.program_week_id);
    const byClient = {}; routines.forEach(r => { (byClient[r.client_id] = byClient[r.client_id] || []).push(r); });
    const progInfo = c => {
      const p = programs.filter(x => x.client_id === c.id && x.status !== 'archived').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]; if (!p) return '';
      const ws = weeks.filter(w => w.program_id === p.id), cur = currentWeek(ws, [p]), last = ws.sort((a, b) => b.week_no - a.week_no)[0];
      return ` · ${esc(p.name)}: ${cur ? 'en ' + esc(weekLabel(cur)) : 'sin semana en curso'}${last && !last.published ? ` (S${last.week_no} en borrador)` : ''}`;
    };
    const active = clients.filter(c => c.active !== false);
    const row = c => { const rs = byClient[c.id] || []; const days = rs.filter(r => r.day).map(r => DIAS[r.day].slice(0, 3)); return `<li><a class="lrow" href="#/cliente/${c.id}/rutinas"><span class="grow"><b>${esc(c.name)}</b><small>${rs.length ? `${rs.length} rutina${rs.length > 1 ? 's' : ''}${days.length ? ' · ' + days.join(', ') : ''}` : 'Sin rutinas todavía'}${progInfo(c)}</small></span>${rs.length ? '' : '<span class="pill">Pendiente</span>'}</a></li>`; };
    const sin = active.filter(c => !(byClient[c.id] || []).length), con = active.filter(c => (byClient[c.id] || []).length);
    $app.querySelector('.content').innerHTML = `${PROGRAM_TABS('rutinas')}
      <p class="muted small">Toca un cliente para editar sus rutinas. Dentro puedes convertirlas en un programa por semanas y crear cada semana nueva con progresión automática o descarga.</p>
      ${active.length ? `${sin.length ? `<section class="card flush"><h3 class="pad">Sin rutinas (${sin.length})</h3><ul class="list">${sin.map(row).join('')}</ul></section>` : ''}
      ${con.length ? `<section class="card flush"><h3 class="pad">Con rutinas (${con.length})</h3><ul class="list">${con.map(row).join('')}</ul></section>` : ''}`
      : `<div class="hero-empty">${ic('dumbbell', 'xl')}<h2>Aún no tienes clientes activos</h2><a class="btn primary" href="#/clientes">Ir a Clientes</a></div>`}`;
  }

  // ---------- Revisiones: bandeja de check-ins
  async function coachReviews(filter) {
    const all = filter === 'todas';
    shell(COACH_NAV, 'revisiones', loading(), { title: 'Revisiones' });
    const [clients, checkins] = await Promise.all([loadClients(), DB.list('checkins', { order: ['created_at', 'desc'], limit: 200 })]);
    const pend = checkins.filter(k => !k.coach_seen);
    const list = all ? checkins : pend;
    const box = $app.querySelector('.content');
    box.innerHTML = `<div class="tabs"><a href="#/revisiones" class="${all ? '' : 'on'}">Pendientes${pend.length ? ` (${pend.length})` : ''}</a><a href="#/revisiones/todas" class="${all ? 'on' : ''}">Todas</a></div>
      ${list.length ? '<section class="card" data-list></section>' : `<div class="hero-empty">${ic('inbox', 'xl')}<h2>${all ? 'Aún no hay check-ins' : 'Todo revisado'}</h2><p>${all ? 'Cuando tus clientes envíen su check-in semanal aparecerá aquí.' : 'No tienes check-ins pendientes. Buen trabajo.'}</p>${all ? '' : '<a class="btn" href="#/revisiones/todas">Ver todos</a>'}</div>`}`;
    const wrap = box.querySelector('[data-list]');
    list.forEach(k => {
      const who = byId(clients, k.client_id) || { id: k.client_id, name: 'Cliente' };
      const idx = checkins.indexOf(k);
      const prev = checkins.slice(idx + 1).find(x => x.client_id === k.client_id && x.weight);
      wrap.appendChild(checkinCard(k, true, { who, prev }));
    });
    refreshReviewBadge();
  }

  // ---------- Catálogo de ejercicios
  async function coachExercises() {
    shell(COACH_NAV, 'programas', loading(), { title: 'Programas', actions: `<button class="btn primary" data-new>${ic('plus')}<span>Nuevo</span></button>` });
    $app.querySelector('[data-new]').onclick = () => exerciseForm();
    const ex = await loadExercises();
    const groups = {}; ex.forEach(e => { (groups[e.muscle || 'Otros'] = groups[e.muscle || 'Otros'] || []).push(e); });
    $app.querySelector('.content').innerHTML = `${PROGRAM_TABS('ejercicios')}<input class="search" placeholder="Buscar ejercicio…" data-q>
      <p class="muted small">Tu catálogo: aparece como sugerencia al crear rutinas. Añade un enlace a vídeo para que tus clientes vean la técnica.</p>
      ${Object.keys(groups).sort().map(g => `<section class="card flush" data-g><h3 class="pad">${esc(g)}</h3><ul class="list">${groups[g].map(e => `<li><button type="button" class="lrow" data-id="${e.id}"><span class="grow"><b>${esc(e.name)}</b><small>${esc(e.equipment || '')}</small></span>${e.media_url ? ic('video') : ''}</button></li>`).join('')}</ul></section>`).join('')}`;
    $app.querySelectorAll('[data-id]').forEach(b => b.onclick = () => exerciseForm(byId(ex, b.dataset.id)));
    const q = $app.querySelector('[data-q]');
    q.oninput = () => { const v = q.value.toLowerCase(); $app.querySelectorAll('[data-g]').forEach(s => { let any = false; s.querySelectorAll('li').forEach(li => { const m = li.textContent.toLowerCase().includes(v); li.hidden = !m; any = any || m; }); s.hidden = !any; }); };
  }
  function exerciseForm(e) {
    const isNew = !e; e = e || {};
    const mf = modal(isNew ? 'Nuevo ejercicio' : 'Editar ejercicio', `<div class="form-grid">
      <label class="full">Nombre<input name="name" required value="${esc(e.name)}"></label>
      <label>Grupo muscular<input name="muscle" value="${esc(e.muscle)}" list="muscles"></label>
      <datalist id="muscles">${[...new Set(S.exercises.map(x => x.muscle).filter(Boolean))].map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      <label>Material<input name="equipment" value="${esc(e.equipment)}"></label>
      <label class="full">Vídeo o foto de la técnica (enlace)<input name="media_url" value="${esc(e.media_url)}" placeholder="YouTube, Vimeo, Drive…"></label>
      <div class="full" data-mprev>${mediaFacade(e.media_url)}</div>
      <label class="full">Indicaciones técnicas<textarea name="notes" rows="3">${esc(e.notes)}</textarea></label></div>`, {
      danger: isNew ? null : { label: 'Eliminar', run: async () => { if (await confirmBox('¿Eliminar "' + e.name + '" del catálogo? Las rutinas que ya lo usan no cambian.')) { await safe(() => DB.remove('exercises', e.id), 'Eliminado'); render(); } } },
      onSubmit: async (f, fd) => {
        const d = Object.fromEntries(fd); if (!d.name.trim()) return false;
        if (isNew) await safe(() => DB.insert('exercises', d), 'Ejercicio añadido'); else await safe(() => DB.update('exercises', e.id, d), 'Guardado');
        render();
      }
    });
    const pv = mf.querySelector('[data-mprev]'), mi = mf.querySelector('[name=media_url]');
    let shown = mi.value; bindMedia(pv); mi.addEventListener('change', () => { if (mi.value === shown) return; shown = mi.value; pv.innerHTML = mediaFacade(mi.value); bindMedia(pv); });
  }

  // ================================================================ CLIENTE
  const CLIENT_NAV = [
    { key: 'hoy', href: '', icon: 'dumbbell', label: 'Entreno' },
    { key: 'nutricion', href: 'nutricion', icon: 'apple', label: 'Nutrición' },
    { key: 'progreso', href: 'progreso', icon: 'chart', label: 'Progreso' },
    { key: 'mensajes', href: 'mensajes', icon: 'chat', label: 'Mensajes' }
  ];

  async function renderClient() {
    document.body.dataset.role = 'client';
    if (!S.client) {
      $app.innerHTML = `<main class="login"><div class="login-card"><div class="brand big"><span class="brand-mark">JM</span><div><b>${esc(BRAND)}</b></div></div>
        <h2>¡Ya casi está!</h2><p>Tu cuenta (<b>${esc(S.profile.email)}</b>) todavía no está vinculada a un plan. Pide a tu entrenador que te dé de alta con este mismo correo y vuelve a entrar.</p>
        <button class="btn primary block" data-retry>Comprobar de nuevo</button><button class="btn ghost block" data-out>Salir</button></div></main>`;
      $app.querySelector('[data-retry]').onclick = boot;
      $app.querySelector('[data-out]').onclick = () => DB.signOut();
      return;
    }
    const [r0, r1] = S.route;
    if (r0 === 'entreno') return workout(r1);
    if (!r0) return clientToday();
    if (r0 === 'nutricion') return clientNutrition();
    if (r0 === 'progreso') { shell(CLIENT_NAV, 'progreso', loading(), { title: 'Mi progreso' }); return tabProgress(S.client, $app.querySelector('.content'), false); }
    if (r0 === 'mensajes') { shell(CLIENT_NAV, 'mensajes', loading(), { title: 'Mensajes' }); return tabMessages(S.client, $app.querySelector('.content'), 'client'); }
    go('#/');
  }

  async function clientToday() {
    const c = S.client;
    shell(CLIENT_NAV, 'hoy', loading(), { title: `Hola, ${c.name.split(' ')[0]}` });
    await rollWeeks(await DB.list('programs', { eq: { client_id: c.id } }).catch(() => []));
    const [allRoutines, items, sessions, programs, weeks] = await Promise.all([
      DB.list('routines', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('routine_items', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('sessions', { eq: { client_id: c.id }, order: ['started_at', 'desc'], limit: 30 }),
      DB.list('programs', { eq: { client_id: c.id } }).catch(() => []),
      DB.list('program_weeks', { eq: { client_id: c.id, published: true } }).catch(() => [])
    ]);
    const cw = currentWeek(weeks, programs);
    const routines = allRoutines.filter(r => (cw ? r.program_week_id === cw.id : !r.program_week_id));
    routines.sort((a, b) => (a.day || 9) - (b.day || 9));
    const d = isoDay();
    const todays = routines.filter(r => r.day === d);
    const doneToday = new Set(sessions.filter(s => s.finished_at && s.started_at.slice(0, 10) === today()).map(s => s.routine_id));
    const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - (d - 1));
    const doneWeek = sessions.filter(s => s.finished_at && new Date(s.started_at) >= weekStart);
    const planned = routines.filter(r => r.day).length;
    const next = routines.filter(r => r.day && r.day > d)[0] || routines.filter(r => r.day)[0];
    const card = (r, hero) => {
      const its = items.filter(i => i.routine_id === r.id);
      return `<section class="card routine ${hero ? 'hero' : ''}"><header><div><small>${r.day ? DIAS[r.day] : 'Cuando quieras'}</small><b>${esc(r.name)}</b><small>${its.length} ejercicios · ~${Math.round(its.reduce((s, i) => s + i.sets * (45 + i.rest_sec), 0) / 60)} min</small></div><span class="grow"></span>${doneToday.has(r.id) ? '<span class="pill green">Hecho hoy ✓</span>' : ''}</header>
        ${hero ? `<ol class="ex-list compact">${its.map(i => `<li><b>${esc(i.exercise_name)}</b><span>${i.sets}×${esc(i.reps)}</span></li>`).join('')}</ol>` : ''}
        <a class="btn ${hero ? 'primary big block' : 'small'}" href="#/entreno/${r.id}">${ic('play')} ${hero ? 'Empezar entreno' : 'Empezar'}</a></section>`;
    };
    const pending = getActiveWorkout();
    $app.querySelector('.content').innerHTML = `
      ${pending ? `<a class="resume" href="#/entreno/${esc(pending.routine_id)}">${ic('play')}<span class="grow"><b>Tienes un entreno a medias</b><small>${esc(pending.routine_name)} · empezado ${ago(pending.started_at)}</small></span><span class="btn small primary">Continuar</span></a>` : ''}
      <div class="weekstrip">${[1, 2, 3, 4, 5, 6, 7].map(n => { const has = routines.some(r => r.day === n); const dd = new Date(weekStart.getTime() + (n - 1) * 864e5); const did = doneWeek.some(s => new Date(s.started_at).toDateString() === dd.toDateString()); return `<div class="${n === d ? 'today' : ''} ${has ? 'has' : ''} ${did ? 'did' : ''}"><small>${DIAS_C[n]}</small><b>${dd.getDate()}</b><i></i></div>`; }).join('')}</div>
      <p class="muted small center">${cw ? esc(weekLabel(cw)) + ' · ' : ''}${doneWeek.length} de ${planned || '–'} entrenos esta semana</p>
      ${todays.length ? todays.map(r => card(r, true)).join('') : `<section class="card restday"><h3>Hoy toca descanso 😌</h3><p>${next ? `Tu próximo entreno es <b>${esc(next.name)}</b> el ${DIAS[next.day].toLowerCase()}.` : 'Tu entrenador aún no te ha asignado entrenos con día.'}</p></section>`}
      ${routines.filter(r => r.day !== d).length ? `<h3 class="sub">Todas mis rutinas</h3>${routines.filter(r => r.day !== d).map(r => card(r, false)).join('')}` : ''}
      ${!routines.length ? '<p class="empty">Tu entrenador todavía no ha publicado tus rutinas.</p>' : ''}`;
  }

  async function clientNutrition() {
    shell(CLIENT_NAV, 'nutricion', loading(), { title: 'Mi nutrición' });
    const p = await DB.get('nutrition_plans', S.client.id, 'client_id');
    const box = $app.querySelector('.content');
    if (!p) { box.innerHTML = `<div class="hero-empty">${ic('apple', 'xl')}<h2>Aún no tienes plan de nutrición</h2><p>Cuando tu entrenador lo publique, lo verás aquí.</p></div>`; return; }
    const tot = (p.protein || 0) * 4 + (p.carbs || 0) * 4 + (p.fat || 0) * 9;
    const pct = v => (tot ? Math.round(v / tot * 100) : 0);
    box.innerHTML = `
      ${p.kcal ? `<section class="card macros"><div class="kcal"><b>${p.kcal}</b><small>kcal al día</small></div>
        ${tot ? `<div class="mbar"><i style="flex:${pct(p.protein * 4)}" class="p"></i><i style="flex:${pct(p.carbs * 4)}" class="c"></i><i style="flex:${pct(p.fat * 9)}" class="f"></i></div>` : ''}
        <div class="mrow"><span class="p">Proteína <b>${p.protein ?? '–'} g</b></span><span class="c">Carbohidratos <b>${p.carbs ?? '–'} g</b></span><span class="f">Grasas <b>${p.fat ?? '–'} g</b></span>${p.water ? `<span>Agua <b>${esc(p.water)}</b></span>` : ''}</div></section>` : ''}
      ${p.meals ? `<section class="card"><h3>Mis comidas</h3><div class="meals">${esc(p.meals).split('\n').filter(Boolean).map(l => { const m = l.match(/^([^:]{1,30}):(.*)$/); return m ? `<div class="meal"><b>${m[1]}</b><p>${m[2]}</p></div>` : `<p>${l}</p>`; }).join('')}</div></section>` : ''}
      ${p.notes ? `<section class="card"><h3>Recomendaciones</h3><p>${nl2br(p.notes)}</p></section>` : ''}
      <p class="muted small">Actualizado ${ago(p.updated_at)}</p>`;
  }

  // ---------- Check-in (cliente)
  function checkinForm(c) {
    const scale = (n, l) => `<fieldset class="scale"><legend>${l}</legend>${[1, 2, 3, 4, 5].map(v => `<label><input type="radio" name="${n}" value="${v}"><span>${v}</span></label>`).join('')}</fieldset>`;
    const f = modal('Check-in semanal', `
      <div class="form-grid">
        <label>Peso (kg)<input name="weight" type="number" step="0.1" inputmode="decimal"></label>
        <label>Fecha<input name="date" type="date" value="${today()}"></label>
      </div>
      <details><summary>Medidas (cm, opcional)</summary><div class="form-grid three">
        <label>Cintura<input name="waist" type="number" step="0.1" inputmode="decimal"></label><label>Cadera<input name="hip" type="number" step="0.1" inputmode="decimal"></label><label>Pecho<input name="chest" type="number" step="0.1" inputmode="decimal"></label><label>Brazo<input name="arm" type="number" step="0.1" inputmode="decimal"></label><label>Muslo<input name="thigh" type="number" step="0.1" inputmode="decimal"></label></div></details>
      ${scale('energy', 'Energía esta semana')}${scale('sleep', 'Calidad del sueño')}${scale('adherence', 'Cumplimiento del plan')}
      <label>¿Cómo ha ido la semana?<textarea name="notes" rows="3" placeholder="Molestias, dudas, cómo te has sentido…"></textarea></label>
      <label class="file">${ic('camera')} <span data-fname>Añadir foto de progreso (opcional)</span><input name="photo" type="file" accept="image/*" hidden></label>`, {
      submitLabel: 'Enviar check-in',
      onSubmit: async (form, fd) => {
        const d = {}; ['weight', 'waist', 'hip', 'chest', 'arm', 'thigh', 'energy', 'sleep', 'adherence'].forEach(k => { d[k] = num(fd.get(k)); });
        d.notes = fd.get('notes'); d.date = fd.get('date') || today(); d.client_id = c.id;
        const file = fd.get('photo');
        await safe(async () => {
          if (file && file.size) d.photo_path = await DB.uploadPhoto(c.id, await shrink(file));
          await DB.insert('checkins', d);
        }, '¡Check-in enviado! 💪');
        render();
      }
    });
    f.photo.onchange = () => { f.querySelector('[data-fname]').textContent = f.photo.files[0] ? f.photo.files[0].name : 'Añadir foto de progreso (opcional)'; };
  }
  function shrink(file, max = 1280) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); cv.toBlob(b => { URL.revokeObjectURL(url); b ? res(b) : rej(new Error('No se pudo procesar la foto')); }, 'image/jpeg', 0.82); };
      img.onerror = () => rej(new Error('Formato de imagen no válido')); img.src = url;
    });
  }

  // ---------- Modo entrenamiento
  const WKEY = 'jmfit-workout';
  const getActiveWorkout = () => { try { return JSON.parse(localStorage.getItem(WKEY)); } catch (e) { return null; } };
  const saveWorkout = w => localStorage.setItem(WKEY, JSON.stringify(w));
  const clearWorkout = () => localStorage.removeItem(WKEY);

  async function workout(routineId) {
    const c = S.client;
    document.body.dataset.role = 'workout';
    $app.innerHTML = loading();
    let w = getActiveWorkout();
    if (w && w.routine_id !== routineId) {
      if (!(await confirmBox(`Tienes "${w.routine_name}" a medias. ¿Descartarlo y empezar otro?`, 'Descartar'))) return go('#/entreno/' + w.routine_id);
      clearWorkout(); w = null;
    }
    if (!w) {
      const [r, items, prevLogs] = await Promise.all([
        DB.get('routines', routineId),
        DB.list('routine_items', { eq: { routine_id: routineId }, order: ['position', 'asc'] }),
        DB.mode === 'demo'
          ? DB.list('set_logs', { eq: { client_id: c.id }, order: ['created_at', 'desc'], limit: 400 })
          : DB.list('last_performance', { eq: { client_id: c.id } }).catch(() => DB.list('set_logs', { eq: { client_id: c.id }, order: ['created_at', 'desc'], limit: 400 }))
      ]);
      if (!r) { toast('Rutina no encontrada', 'err'); return go('#/'); }
      const when = l => l.started_at || l.created_at || '';
      prevLogs.sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
      // última sesión de cada ejercicio
      const prev = {};
      items.forEach(i => {
        // por linaje (el mismo ejercicio aunque cambie de nombre o de semana); si no hay, por nombre (registros antiguos)
        let ls = i.lineage_id ? prevLogs.filter(l => l.lineage_id === i.lineage_id) : [];
        if (!ls.length) ls = prevLogs.filter(l => l.exercise_name === i.exercise_name);
        if (ls.length) { const key = l => l.session_id || l.started_at; const k = key(ls[0]); prev[i.id] = ls.filter(l => key(l) === k).sort((a, b) => a.set_no - b.set_no); prev[i.id].at = when(ls[0]); }
      });
      w = {
        routine_id: r.id, routine_name: r.name, notes: r.notes, started_at: new Date().toISOString(),
        ex: items.map(i => ({
          id: i.id, lin: i.lineage_id || null, name: i.exercise_name, media: i.media_url, reps: i.reps, load: loadLabel(i), rest: i.rest_sec, notes: i.notes,
          it: i.target_rir != null ? 'rir' : i.target_rpe != null ? 'rpe' : null, target: i.target_rir != null ? i.target_rir : i.target_rpe,
          prev: (prev[i.id] || []).map(l => ({ w: l.weight, r: l.reps, x: l.rir != null ? l.rir : l.rpe })), prevAt: prev[i.id] ? prev[i.id].at : null,
          sets: Array.from({ length: i.sets }, (_, k) => { const p = (prev[i.id] || [])[k]; return { w: i.load_kg != null ? i.load_kg : (p && p.weight != null ? p.weight : ''), r: '', x: '', done: false }; })
        }))
      };
      saveWorkout(w);
    }
    drawWorkout(w);
  }

  let restTimer = null;
  const openMedia = new Set(); // vídeos desplegados en el entreno actual
  function drawWorkout(w) {
    const total = w.ex.reduce((s, e) => s + e.sets.length, 0);
    const done = w.ex.reduce((s, e) => s + e.sets.filter(x => x.done).length, 0);
    $app.innerHTML = `<div class="wk">
      <header class="wk-top"><button class="icon-btn" data-exit aria-label="Salir">${ic('back')}</button><div class="grow"><b>${esc(w.routine_name)}</b><small data-elapsed></small></div><button class="btn primary small" data-finish>Terminar</button></header>
      <div class="wk-progress"><i style="width:${total ? (done / total * 100) : 0}%"></i></div>
      ${w.notes ? `<p class="note wk-note">${nl2br(w.notes)}</p>` : ''}
      <div class="wk-list">${w.ex.map((e, ei) => `
        <section class="card wk-ex ${e.sets.every(s => s.done) ? 'complete' : ''}" data-ei="${ei}">
          <header><span class="num">${ei + 1}</span><div class="grow"><b>${esc(e.name)}</b><small>${e.sets.length} × ${esc(e.reps)}${e.load ? ' · ' + esc(e.load) : ''} · ${ic('clock', 'xs')} ${e.rest}"</small></div>
            ${mediaInfo(e.media) ? `<button type="button" class="icon-btn ${openMedia.has(ei) ? 'on' : ''}" data-media title="Ver técnica" aria-label="Ver técnica">${ic('video')}</button>` : ''}</header>
          ${openMedia.has(ei) ? mediaFacade(e.media) : ''}
          ${e.prevAt ? `<p class="muted small last">Última vez ${esc(ago(e.prevAt))}: ${e.prev.map(p => `${fmtKg(p.w)}×${p.r ?? '–'}`).join(' · ')}</p>` : ''}
          ${e.notes ? `<p class="note">${esc(e.notes)}</p>` : ''}
          <div class="sets ${e.it ? 'with-x' : ''}"><div class="sets-h"><span>Serie</span><span>Anterior</span><span>kg</span><span>Reps</span>${e.it ? `<span>${e.it.toUpperCase()}</span>` : ''}<span></span></div>
          ${e.sets.map((s, si) => `<div class="set ${s.done ? 'done' : ''}" data-si="${si}"><span class="sn">${si + 1}</span>
            <span class="prev">${e.prev[si] ? `${fmtKg(e.prev[si].w)}×${e.prev[si].r ?? '–'}${e.prev[si].x != null ? ' @' + fmtKg(e.prev[si].x) : ''}` : '–'}</span>
            <input inputmode="decimal" data-f="w" value="${esc(s.w)}" placeholder="kg" aria-label="Kilos serie ${si + 1}">
            <input inputmode="numeric" data-f="r" value="${esc(s.r)}" placeholder="${esc(String(e.reps).split(/[-–]/).pop())}" aria-label="Repeticiones serie ${si + 1}">
            ${e.it ? `<input inputmode="decimal" data-f="x" value="${esc(s.x || '')}" placeholder="${e.target != null ? esc(fmtKg(e.target)) : ''}" aria-label="${e.it.toUpperCase()} serie ${si + 1}">` : ''}
            <button class="tick" data-tick aria-label="Serie hecha">${ic('check')}</button></div>`).join('')}</div>
          <div class="row gap"><button class="btn ghost small" data-addset>${ic('plus')} Serie</button>${e.sets.length > 1 ? '<button class="btn ghost small" data-delset>Quitar serie</button>' : ''}</div>
        </section>`).join('')}</div>
      <div class="rest" data-rest hidden><div class="rest-in"><small>Descanso</small><b data-rt>0:00</b><div class="row gap"><button class="btn small" data-rminus>−15 s</button><button class="btn small" data-rplus>+15 s</button><button class="btn small primary" data-rskip>Saltar</button></div></div><i class="rest-bar"></i></div>
    </div>`;
    const el = $app.querySelector('[data-elapsed]');
    const tick = () => { const m = Math.floor((Date.now() - new Date(w.started_at)) / 6e4); el.textContent = `${m} min · ${done}/${total} series`; };
    tick(); intervals.push(setInterval(tick, 20000));
    requestWakeLock();

    bindMedia($app);
    $app.querySelectorAll('.wk-ex').forEach(sec => {
      const ei = +sec.dataset.ei, e = w.ex[ei];
      const mb = sec.querySelector('[data-media]');
      if (mb) mb.onclick = () => {
        if (openMedia.has(ei)) { openMedia.delete(ei); sec.querySelector('.vmedia')?.remove(); mb.classList.remove('on'); return; }
        openMedia.add(ei); mb.classList.add('on'); sec.querySelector('header').insertAdjacentHTML('afterend', mediaFacade(e.media)); bindMedia(sec);
        const pb = sec.querySelector('.vmedia .vplay'); if (pb) pb.click();
      };
      sec.querySelectorAll('.set').forEach(row => {
        const si = +row.dataset.si, s = e.sets[si];
        row.querySelectorAll('input').forEach(inp => inp.oninput = () => { s[inp.dataset.f] = inp.value.replace(',', '.'); saveWorkout(w); });
        row.querySelector('[data-tick]').onclick = () => {
          s.done = !s.done;
          if (s.done) {
            if (s.r === '' || s.r == null) { const def = parseInt(String(e.reps).split(/[-–]/).pop(), 10); if (!isNaN(def)) s.r = String(def); }
            // propaga el peso a las series siguientes vacías
            e.sets.slice(si + 1).forEach(n => { if (n.w === '' && s.w !== '') n.w = s.w; });
            if (navigator.vibrate) navigator.vibrate(30);
            if (e.rest > 0) startRest(e.rest);
          }
          saveWorkout(w); drawWorkout(w);
        };
      });
      sec.querySelector('[data-addset]').onclick = () => { const l = e.sets[e.sets.length - 1]; e.sets.push({ w: l ? l.w : '', r: '', done: false }); saveWorkout(w); drawWorkout(w); };
      const ds = sec.querySelector('[data-delset]'); if (ds) ds.onclick = () => { e.sets.pop(); saveWorkout(w); drawWorkout(w); };
    });
    $app.querySelector('[data-exit]').onclick = async () => {
      if (done === 0 || await confirmBox('Tu progreso se queda guardado en este móvil y podrás seguir luego. ¿Salir?', 'Salir')) { if (done === 0) clearWorkout(); stopRest(); openMedia.clear(); go('#/'); }
    };
    $app.querySelector('[data-finish]').onclick = () => finishWorkout(w, done);
    if (restTimer) bindRest();
  }

  function startRest(sec) { restTimer = { end: Date.now() + sec * 1000, total: sec }; bindRest(); }
  function stopRest() { if (restTimer && restTimer.iv) clearInterval(restTimer.iv); restTimer = null; const r = document.querySelector('[data-rest]'); if (r) r.hidden = true; }
  function bindRest() {
    const box = document.querySelector('[data-rest]'); if (!box || !restTimer) return;
    box.hidden = false;
    const t = box.querySelector('[data-rt]'), bar = box.querySelector('.rest-bar');
    const upd = () => {
      if (!restTimer) return;
      const left = Math.max(0, Math.round((restTimer.end - Date.now()) / 1000));
      t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      bar.style.width = (left / restTimer.total * 100) + '%';
      if (left <= 0) { beep(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); stopRest(); toast('¡A por la siguiente serie!', 'ok'); }
    };
    if (restTimer.iv) clearInterval(restTimer.iv);
    restTimer.iv = setInterval(upd, 250); upd();
    box.querySelector('[data-rskip]').onclick = stopRest;
    box.querySelector('[data-rplus]').onclick = () => { restTimer.end += 15000; restTimer.total += 15; upd(); };
    box.querySelector('[data-rminus]').onclick = () => { restTimer.end -= 15000; upd(); };
  }
  let audioCtx;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach(d => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(audioCtx.destination); o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + 0.15); });
    } catch (e) { /* sin audio */ }
  }
  let wakeLock;
  async function requestWakeLock() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* no disponible */ } }

  function finishWorkout(w, done) {
    if (!done) return toast('Marca al menos una serie como hecha', 'err');
    modal('¡Entreno terminado! 🎉', `
      <p>${done} series completadas en ${Math.max(1, Math.round((Date.now() - new Date(w.started_at)) / 6e4))} minutos.</p>
      <fieldset class="scale wide"><legend>¿Qué tan duro fue? (RPE 1–10)</legend>${[5, 6, 7, 8, 9, 10].map(v => `<label><input type="radio" name="rpe" value="${v}"><span>${v}</span></label>`).join('')}</fieldset>
      <label>Comentario para tu entrenador (opcional)<textarea name="notes" rows="3" placeholder="Molestias, sensaciones, cambios…"></textarea></label>`, {
      submitLabel: 'Guardar entreno',
      onSubmit: async (f, fd) => {
        const c = S.client;
        const logs = []; let vol = 0;
        const inRange = (v, a, b) => (v != null && v >= a && v <= b ? Math.round(v * 2) / 2 : null);
        w.ex.forEach(e => { let n = 0; e.sets.forEach(s => {
          if (!s.done) return; n++; const kg = num(s.w), r = parseInt(s.r, 10), x = num(s.x);
          const l = { exercise_name: e.name, set_no: n, weight: kg, reps: isNaN(r) ? null : r };
          if (e.id) l.routine_item_id = e.id; if (e.lin) l.lineage_id = e.lin;
          if (e.it === 'rir') l.rir = inRange(x, 0, 10); if (e.it === 'rpe') l.rpe = inRange(x, 1, 10);
          logs.push(l); if (kg && !isNaN(r)) vol += kg * r; }); });
        await safe(async () => {
          const [s] = await DB.insert('sessions', { client_id: c.id, routine_id: w.routine_id, routine_name: w.routine_name, started_at: w.started_at, finished_at: new Date().toISOString(), rpe: num(fd.get('rpe')), notes: fd.get('notes'), volume: vol });
          if (logs.length) await DB.insert('set_logs', logs.map(l => Object.assign({ session_id: s.id, client_id: c.id }, l)));
        }, 'Entreno guardado 💪');
        clearWorkout(); stopRest(); openMedia.clear(); if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
        location.hash = '#/progreso';
      }
    });
  }

  // ------------------------------------------------------------ PWA
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  boot();
})();
