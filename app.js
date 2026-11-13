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
  // RIR pautado «al fallo»: target_rir 0 + progression.fail (el entrenador lo elige en Intensidad)
  const isFailT = i => i && Number(i.target_rir) === 0 && i.target_rir !== null && i.target_rir !== '' && !!(i.progression && i.progression.fail);
  // Variables de entrenamiento: texto corto "60 kg · RIR 2 · tempo 3-1-1-0" (o el texto libre antiguo)
  const loadLabel = i => {
    const p = [];
    if (i.load_kg != null && i.load_kg !== '') p.push(fmtKg(i.load_kg) + ' kg');
    if (isFailT(i)) p.push('Al fallo');
    else if (i.target_rir != null && i.target_rir !== '') p.push('RIR ' + fmtKg(i.target_rir));
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
  // Tipo de serie de cada ejercicio (se guarda en progression.scheme para que viaje con las semanas y los mesociclos)
  const SET_SCHEMES = [['straight', 'Lineal (series iguales)'], ['topset:10', 'Top set + back-off −10 %'], ['topset:15', 'Top set + back-off −15 %'], ['topset:20', 'Top set + back-off −20 %'],
    ['drop:1', 'Dropset: 1 bajada en la última serie'], ['drop:2', 'Dropset: 2 bajadas en la última serie'], ['drop:3', 'Dropset: 3 bajadas en la última serie'], ['dropall:1', 'Dropset en todas las series']];
  const schemeKey = p => { const x = p && p.scheme; return !x || !x.type ? 'straight' : x.type === 'topset' ? 'topset:' + (x.pct || 10) : x.type === 'drop' ? (x.all ? 'dropall:' : 'drop:') + (x.n || 1) : 'straight'; };
  const schemeVal = k => { const [t, v] = String(k || 'straight').split(':'); return t === 'topset' ? { type: 'topset', pct: +v || 10 } : t === 'drop' ? { type: 'drop', n: +v || 1, pct: 20 } : t === 'dropall' ? { type: 'drop', n: +v || 1, pct: 20, all: true } : null; };
  const schemeLabel = p => { const k = schemeKey(p); return k === 'straight' ? '' : (SET_SCHEMES.find(x => x[0] === k) || [0, ''])[1]; };
  // Filas de series del entreno según el tipo: TOP / BO (back-off) / ↓ (bajadas del dropset)
  const schemeSets = (n, p) => {
    const x = (p && p.scheme) || {}, out = [];
    for (let k = 0; k < n; k++) {
      out.push({ w: '', r: '', x: '', done: false, tag: x.type === 'topset' ? (k ? 'BO' : 'TOP') : '', pct: x.type === 'topset' && k ? x.pct || 10 : null });
      if (x.type === 'drop' && (x.all || k === n - 1)) for (let d = 0; d < (x.n || 1); d++) out.push({ w: '', r: '', x: '', done: false, tag: 'D', pct: x.pct || 20 });
    }
    return out;
  };
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const KINDS = { normal: ['Normal', ''], maintenance: ['Mantenimiento', '='], deload: ['Descarga', '↓'], intensity: ['Intensidad', '↑'], test: ['Test', 'T'] };
  const weekLabel = w => `Semana ${w.week_no}${w.kind && w.kind !== 'normal' && KINDS[w.kind] ? ' · ' + KINDS[w.kind][0] : ''}`;
  // Historial de cada ejercicio: mejor serie de cada sesión (1RM estimado) para ver progreso o estancamiento
  const e1rm = (w, r) => (w && r ? w * (1 + r / 30) : 0);
  function exHistory(logs, sessions) {
    const sd = {}; (sessions || []).forEach(x => { sd[x.id] = x.started_at; });
    const by = {};
    logs.forEach(l => {
      if (!l.weight || !l.reps) return;
      const k = String(l.exercise_name || '').trim().toLowerCase(); if (!k) return;
      const h = (by[k] = by[k] || {}); const ss = (h[l.session_id] = h[l.session_id] || { sid: l.session_id, date: sd[l.session_id] || l.created_at, e1: 0, w: 0, r: 0, n: 0, sets: [] });
      ss.n++; const e = e1rm(Number(l.weight), Number(l.reps));
      ss.sets.push({ no: l.set_no, w: Number(l.weight), r: Number(l.reps), rir: l.rir, rpe: l.rpe, fail: !!l.failure });
      if (e > ss.e1) Object.assign(ss, { e1: e, w: Number(l.weight), r: Number(l.reps) });
    });
    const out = {}; for (const k in by) out[k] = Object.values(by[k]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const k in out) out[k].forEach(x => x.sets.sort((a, b) => a.no - b.no));
    return out;
  }
  // Estado: récord en la última sesión, estancado (3+ sesiones sin superar la mejor marca) o bajando
  function stallOf(h) {
    if (!h || h.length < 2) return { st: 'new', since: 0 };
    let mi = 0; h.forEach((x, i) => { if (x.e1 >= h[mi].e1 * 1.005) mi = i; });
    const since = h.length - 1 - mi, last = h[h.length - 1].e1, max = h[mi].e1;
    if (since === 0) return { st: 'up', since };
    if (last < max * 0.95 && since >= 2) return { st: 'down', since };
    if (since >= 3) return { st: 'stall', since };
    return { st: 'ok', since };
  }
  const STALL_TXT = { up: ['green', 'Mejorando'], ok: ['', 'Normal'], stall: ['amber', 'Estancado'], down: ['red', 'Bajando'], new: ['', 'Pocos datos'] };
  // Repetición automática: crea (y publica) las semanas que falten hasta hoy. Una vez por programa y día.
  async function rollWeeks(programs) {
    if (!S.rolled) { try { S.rolled = JSON.parse(localStorage.getItem('jmfit-rolled') || '{}'); } catch (e) { S.rolled = {}; } }
    let n = 0;
    for (const p of programs || []) {
      const k = p.id + today(); if (p.status !== 'active' || p.auto_repeat === false || S.rolled[k]) continue;
      S.rolled[k] = true; n += Number(await DB.rpc('roll_program_weeks', { p_program: p.id }).catch(() => 0)) || 0;
      try { const t = today(); Object.keys(S.rolled).forEach(x => { if (!x.endsWith(t)) delete S.rolled[x]; }); localStorage.setItem('jmfit-rolled', JSON.stringify(S.rolled)); } catch (e) {}
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
  const cap1 = x => String(x || '').charAt(0).toUpperCase() + String(x || '').slice(1);
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
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
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
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    msg: '<path d="M4 5h16v11H9l-5 4z"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
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
  const BOOT_KEY = 'jmfit-boot';
  const bootSig = () => JSON.stringify([S.profile && S.profile.id, S.profile && S.profile.role, S.client && S.client.id, S.client && S.client.name]);
  async function boot() {
    let shown = false;
    // Verificación en dos pasos: si la cuenta la tiene activada y esta sesión aún no metió el código, se pide antes de nada
    if (DB.mode === 'live' && !location.hash.includes('type=recovery')) {
      try {
        const s0 = await DB.session();
        if (s0) { const lv = await DB.mfa.level(); if (lv && lv.nextLevel === 'aal2' && lv.currentLevel !== 'aal2') { S.profile = null; return renderMfa(); } }
      } catch (e) { console.error(e); }
    }
    // 1) si ya entraste antes en este móvil, pinta al momento con lo guardado
    if (DB.mode === 'live' && !location.hash.includes('type=recovery')) {
      try {
        const b = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null');
        const s = b && await DB.session();
        if (b && s && s.user && s.user.id === (b.profile && b.profile.id)) { S.profile = b.profile; S.client = b.client; render(); shown = true; }
      } catch (e) {}
    }
    // 2) comprueba con el servidor (perfil y ficha a la vez) y solo repinta si algo cambió
    const before = shown ? bootSig() : null;
    try {
      const [p, c] = await Promise.all([DB.profile(), DB.myClient().catch(() => null)]);
      S.profile = p; S.client = p && p.role === 'client' ? c : null;
      try { if (p) localStorage.setItem(BOOT_KEY, JSON.stringify({ profile: p, client: S.client })); else localStorage.removeItem(BOOT_KEY); } catch (e) {}
    } catch (e) { console.error(e); if (!shown) S.profile = null; }
    if (!shown || bootSig() !== before) render();
  }
  // Solo se vuelve a arrancar si cambia la persona (entrar/salir), no cada vez que se renueva la sesión
  let lastAuth = DB.mode === 'live' ? 'init' : undefined;
  DB.onAuth(s => { const u = s && s.user ? s.user.id : null; if (lastAuth === 'init') { lastAuth = u; return; } if (u === lastAuth) return; lastAuth = u; boot(); });
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
        <div class="brand big"><img class="brand-logo" src="logo.webp" alt="TEAM JMFIT" width="420" height="219"><small>Entrenamiento y nutrición</small></div>
        ${demo ? `
          <p class="muted">Modo demo: la app aún no está conectada a Supabase. Prueba los dos lados con datos de ejemplo (se guardan solo en este navegador).</p>
          <button class="btn primary block" data-demo="coach">${ic('users')} Entrar como entrenador</button>
          <button class="btn block" data-demo="client">${ic('dumbbell')} Entrar como cliente (Laura)</button>
          <button class="btn ghost block small" data-reset>Reiniciar datos de ejemplo</button>
        ` : `
          <div class="seg"><button class="${mode === 'in' ? 'on' : ''}" data-mode="in">Entrar</button><button class="${mode === 'up' ? 'on' : ''}" data-mode="up">Soy atleta nuevo</button></div>
          <form id="auth" class="stack">
            ${mode === 'up' ? '<label>Nombre<input name="name" required autocomplete="name"></label>' : ''}
            <label>Correo<input name="email" type="email" required autocomplete="email"></label>
            ${mode !== 'reset' ? `<label>Contraseña<input name="password" type="password" minlength="6" required autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"></label>` : ''}
            <button class="btn primary block" type="submit">${mode === 'up' ? 'Crear mi cuenta de atleta' : mode === 'reset' ? 'Enviar enlace' : 'Entrar'}</button>
            ${mode === 'up' ? '<p class="muted small">Solo para atletas de TEAM JMFIT: usa el mismo correo que diste a tu entrenador o entra desde tu enlace de invitación.</p>' : ''}
            ${mode === 'in' ? '<button type="button" class="link" data-mode="reset">¿Olvidaste la contraseña?</button>' : ''}
            ${mode === 'reset' ? '<button type="button" class="link" data-mode="in">Volver</button>' : ''}
          </form>`}
        <p class="legal-links"><a href="privacidad.html" target="_blank" rel="noopener">Privacidad y datos</a></p>
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
  // Pantalla del código de 6 dígitos al entrar
  async function renderMfa() {
    document.body.dataset.role = 'guest';
    $app.innerHTML = `<main class="login"><div class="login-card">
        <div class="brand big"><img class="brand-logo" src="logo.webp" alt="TEAM JMFIT" width="420" height="219"><small>Verificación en dos pasos</small></div>
        <form id="mfa" class="stack">
          <p class="muted">Abre tu app de códigos (Google Authenticator, Authy…) y escribe el código de 6 cifras de TEAM JMFIT.</p>
          <label>Código<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></label>
          <button class="btn primary block" type="submit">Verificar</button>
          <button type="button" class="link" data-out>Salir</button>
        </form></div></main>`;
    const f = $app.querySelector('#mfa');
    f.querySelector('[data-out]').onclick = async () => { await DB.signOut(); render(); };
    f.onsubmit = async e => {
      e.preventDefault(); const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const fac = (await DB.mfa.factors()).find(x => x.status === 'verified');
        if (!fac) throw new Error('No hay ningún factor activado');
        await DB.mfa.verify(fac.id, f.code.value.trim());
        boot();
      } catch (err) { toast(/invalid|expired/i.test(err.message) ? 'Código incorrecto o caducado' : err.message, 'err'); f.code.value = ''; f.code.focus(); }
      finally { btn.disabled = false; }
    };
  }
  // Activar / desactivar la verificación en dos pasos (entrenador)
  async function securityModal() {
    if (DB.mode !== 'live') { toast('La verificación en dos pasos solo funciona con la app real', 'err'); return; }
    const facs = (await DB.mfa.factors()).filter(x => x.status === 'verified');
    if (facs.length) {
      modal('Verificación en dos pasos', `<p>✅ <b>Activada.</b> Cada vez que entres en un dispositivo nuevo te pedirá el código de tu app de autenticación.</p>
        <p class="muted small">Si cambias de móvil, desactívala aquí y vuelve a activarla con el nuevo. Si pierdes el móvil: Supabase → Authentication → Users → tu usuario → borra el factor.</p>`,
        { danger: { label: 'Desactivar', run: async () => { if (await confirmBox('¿Desactivar la verificación en dos pasos? Tu cuenta quedará protegida solo con la contraseña.', 'Desactivar')) { await safe(async () => { for (const f of facs) await DB.mfa.unenroll(f.id); }, 'Verificación desactivada'); } } } });
      return;
    }
    let en;
    try { en = await DB.mfa.enroll(); } catch (e) { toast('Error: ' + e.message, 'err'); return; }
    const qr = en.totp.qr_code;
    modal('Activar verificación en dos pasos', `
      <ol class="small mfa-steps">
        <li>Instala en tu móvil <b>Google Authenticator</b> (o Authy, 1Password…).</li>
        <li>Pulsa <b>+</b> → <b>Escanear código QR</b> y escanea este:</li>
      </ol>
      <div class="mfa-qr"><img alt="Código QR para la app de autenticación" src="${esc(qr.startsWith('data:') ? qr : 'data:image/svg+xml;utf-8,' + encodeURIComponent(qr))}"></div>
      <details class="small"><summary>¿No puedes escanear? Introduce la clave a mano</summary><code class="mfa-secret">${esc(en.totp.secret)}</code></details>
      <label>3. Escribe el código de 6 cifras que te sale<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>`, {
      submitLabel: 'Activar',
      onSubmit: async (f, fd) => {
        try { await DB.mfa.verify(en.id, String(fd.get('code')).trim()); toast('Verificación en dos pasos activada 🔒', 'ok'); }
        catch (e) { toast(/invalid|expired/i.test(e.message) ? 'Código incorrecto: prueba con el siguiente' : 'Error: ' + e.message, 'err'); return false; }
      }
    });
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
  function shell(navItems, activeKey, content, { title, back, actions = '', sub = '' } = {}) {
    const nav = navItems.map(n => `<a href="#/${n.href}" class="${n.key === activeKey ? 'on' : ''}">${ic(n.icon)}<span>${n.label}</span>${n.badge ? `<i class="badge">${n.badge}</i>` : ''}</a>`).join('');
    $app.innerHTML = `
      <aside class="side"><div class="brand"><img class="brand-logo" src="logo.webp" alt="TEAM JMFIT" width="420" height="219"><div><small>${S.profile.role === 'coach' ? 'Panel de entrenador' : esc(S.client ? S.client.name : '')}</small></div></div>
        <nav>${nav}</nav>
        <button class="side-out" data-logout>${ic('out')} Salir</button>
        ${DB.mode === 'demo' ? '<div class="demo-tag">MODO DEMO</div>' : ''}
      </aside>
      <div class="main">
        <header class="top">${back ? `<a class="icon-btn" href="#/${back}" aria-label="Volver">${ic('back')}</a>` : ''}
          ${sub ? `<div class="ttl"><h1>${esc(title || '')}</h1><small>${esc(sub)}</small></div>` : `<h1>${esc(title || '')}</h1>`}<span class="grow"></span>${actions}
          <img class="brand-logo sm only-mobile" src="logo.webp" alt="TEAM JMFIT" width="420" height="219">
          ${S.profile.role === 'client' && S.client ? `<button class="icon-btn" data-priv aria-label="Privacidad y mis datos" title="Privacidad y mis datos">${ic('shield')}</button>` : ''}
          <button class="icon-btn only-mobile" data-logout aria-label="Salir">${ic('out')}</button></header>
        <div class="content">${content}</div>
      </div>
      <nav class="tabbar">${nav}</nav>`;
    $app.querySelectorAll('[data-logout]').forEach(b => b.onclick = async () => { if (await confirmBox('¿Cerrar sesión?', 'Salir')) { await DB.signOut(); S.profile = null; location.hash = ''; render(); } });
    $app.querySelectorAll('[data-priv]').forEach(b => b.onclick = () => privacyModal());
  }
  const loading = () => '<div class="loading"><span></span><span></span><span></span></div>';

  // ================================================================ ENTRENADOR
  const COACH_NAV = [
    { key: 'inicio', href: '', icon: 'home', label: 'Inicio' },
    { key: 'clientes', href: 'clientes', icon: 'users', label: 'Clientes' },
    { key: 'programas', href: 'programas', icon: 'dumbbell', label: 'Programas' },
    { key: 'revisiones', href: 'revisiones', icon: 'inbox', label: 'Revisiones' },
    { key: 'notas', href: 'notas', icon: 'edit', label: 'Notas' },
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

  // Aviso de almacenamiento (migración 018): fotos y base de datos frente al límite del plan de Supabase.
  // Límites del plan gratuito: 1 GB de archivos y 500 MB de base de datos (se pueden cambiar en ajustes: storage_limit_mb, db_limit_mb).
  // Privacidad: estado del consentimiento y solicitudes de los clientes (migración 019)
  function privPill(c) {
    if (!('consent_version' in c) || !c.user_id) return '';
    if (c.data_request === 'delete') return '<span class="pill red">pide borrar datos</span>';
    if (c.data_request === 'withdraw') return '<span class="pill red">retiró el permiso</span>';
    return c.consent_version ? '' : '<span class="pill amber">sin aceptar privacidad</span>';
  }
  function privacyAlerts(stack) {
    const list = (S.clients || []).filter(c => c.data_request);
    if (!list.length || stack.querySelector('[data-privalert]')) return;
    const sec = document.createElement('section'); sec.className = 'card stor-card'; sec.setAttribute('data-privalert', '');
    sec.innerHTML = `<h3>🔒 Solicitudes de datos</h3><ul class="list">${list.map(c => `<li><a href="#/cliente/${c.id}/ficha"><span class="grow">${esc(c.name)}<small>${c.data_request === 'delete' ? 'Pide que se borren sus datos' : 'Ha retirado el consentimiento'} · ${ago(c.data_request_at)}</small></span><small>Ver ficha ›</small></a></li>`).join('')}</ul>
      <p class="muted small">La ley da un mes para atender una petición de borrado. Para borrar: Clientes → el cliente → Editar → Eliminar.</p>`;
    stack.prepend(sec);
  }

  async function storageCard(stack) {
    if (S.storageInfo === undefined) {
      S.storageInfo = null;
      try {
        const [u, lf, ld] = await Promise.all([DB.rpc('storage_usage'), DB.getSetting('storage_limit_mb').catch(() => null), DB.getSetting('db_limit_mb').catch(() => null)]);
        S.storageInfo = { u, lf: Number(lf) || 1024, ld: Number(ld) || 500 };
      } catch (e) { return; }   // migración aún sin aplicar
    }
    const I = S.storageInfo; if (!I || !I.u || !document.body.contains(stack) || stack.querySelector('[data-stor]')) return;
    const mb = b => Math.round((Number(b) || 0) / 1048576), pf = mb(I.u.photo_bytes) / I.lf, pd = mb(I.u.db_bytes) / I.ld;
    if (Math.max(pf, pd) < 0.7) return;
    const row = (l, used, lim, p) => `<li><span class="grow">${l}<small>${used} MB de ${lim >= 1024 ? lim / 1024 + ' GB' : lim + ' MB'}</small></span><b class="${p >= 0.9 ? 'hi' : ''}">${Math.round(p * 100)} %</b></li>`;
    const sec = document.createElement('section'); sec.className = 'card stor-card'; sec.setAttribute('data-stor', '');
    sec.innerHTML = `<h3>⚠️ Almacenamiento casi lleno</h3><ul class="list">${pf >= 0.7 ? row(`Fotos de check-ins (${I.u.photos})`, mb(I.u.photo_bytes), I.lf, pf) : ''}${pd >= 0.7 ? row('Base de datos', mb(I.u.db_bytes), I.ld, pd) : ''}</ul>
      <p class="muted small">Cuando llegue al 100 % no se podrán subir más fotos ni datos. Opciones: pasar Supabase al plan Pro o borrar fotos antiguas de check-ins.</p>`;
    stack.prepend(sec);
  }

  async function renderCoach() {
    document.body.dataset.role = 'coach';
    const [r0, r1, r2] = S.route;
    if (!r0 || r0 === 'clientes' || r0 === 'cliente') setTimeout(refreshReviewBadge, 0);
    if (!r0) return coachHome();
    if (r0 === 'clientes') return coachClients();
    if (r0 === 'cliente' && r1) return coachClient(r1, r2 || 'rutinas');
    if (r0 === 'programas' || r0 === 'ejercicios') { setTimeout(refreshReviewBadge, 0); return r1 === 'ejercicios' || r0 === 'ejercicios' ? coachExercises() : r1 === 'plantillas' ? coachTemplates() : coachPrograms(); }
    if (r0 === 'revisiones') return coachReviews(r1);
    if (r0 === 'formularios') { shell(COACH_NAV, 'inicio', loading(), { title: 'Formularios' }); const fb = $app.querySelector('.content'); if (window.JMForms) return window.JMForms.page(fb); window.addEventListener('load', () => window.JMForms.page(fb), { once: true }); return; }
    if (r0 === 'cobros') { setTimeout(refreshReviewBadge, 0); return coachPayments(); }
    if (r0 === 'notas') { setTimeout(refreshReviewBadge, 0); return coachNotes(r1); }
    go('#/');
  }

  // Las plantillas de Programas son «clientes» internos (is_template) para reutilizar todos los editores de rutinas
  async function loadClients() { const all = await DB.list('clients', { order: ['name', 'asc'] }); S.templates = all.filter(c => c.is_template); S.clients = all.filter(c => !c.is_template); return S.clients; }
  async function loadExercises() { S.exercises = await DB.list('exercises', { order: ['name', 'asc'] }); return S.exercises; }

  // ---------- Actividad reciente: Hoy / Ayer / Anteriores, filtrable por Entrenos · Métricas · Formularios
  const ACT_T = { train: ['Entrenos', 'dumbbell'], metric: ['Métricas', 'chart'], form: ['Formularios', 'inbox'] };
  function activityFeed({ clients, sessions, checkins, metrics, forms, since }) {
    const cl = id => byId(clients, id) || {}, nm = id => cl(id).name || 'Cliente';
    const pill = t => `<span class="act-p">${t}</span>`;
    const out = [];
    sessions.filter(x => x.finished_at && x.finished_at >= since).forEach(x => {
      const min = Math.max(1, Math.round((new Date(x.finished_at) - new Date(x.started_at)) / 6e4));
      out.push({ k: 'train', t: x.finished_at, cid: x.client_id, who: nm(x.client_id), what: `completó <b>${esc(x.routine_name || 'entreno')}</b>`,
        pills: [min < 600 ? pill(`⏱ ${min} min`) : '', x.volume ? pill(`🏋️ ${Math.round(x.volume).toLocaleString('es-ES')} kg`) : '', x.rpe ? pill(`RPE ${x.rpe}`) : ''].join(''),
        href: `#/cliente/${x.client_id}/progreso`, unseen: !x.coach_seen });
    });
    metrics.filter(m => m.weight != null || m.steps != null || m.sleep_h != null).forEach(m => {
      const t = m.created_at && String(m.created_at).slice(0, 10) === String(m.date).slice(0, 10) ? m.created_at : String(m.date).slice(0, 10) + 'T12:00:00';
      out.push({ k: 'metric', t, day: String(m.date).slice(0, 10), cid: m.client_id, who: nm(m.client_id), what: 'registró sus métricas',
        pills: [m.weight != null ? pill(`⚖️ ${fmtKg(m.weight)} kg`) : '', m.steps != null ? pill(`👟 ${Number(m.steps).toLocaleString('es-ES')}`) : '', m.sleep_h != null ? pill(`😴 ${fmtKg(m.sleep_h)} h`) : ''].join(''),
        href: `#/cliente/${m.client_id}/progreso` });
    });
    checkins.filter(c => c.created_at >= since || !c.coach_seen).forEach(c => out.push({ k: 'form', t: c.created_at, cid: c.client_id, who: nm(c.client_id), what: 'envió su <b>check-in semanal</b>',
      pills: [c.weight ? pill(`⚖️ ${fmtKg(c.weight)} kg`) : '', c.adherence ? pill(`✅ adherencia ${c.adherence}/10`) : '', c.energy ? pill(`⚡ energía ${c.energy}/10`) : ''].join(''),
      href: `#/cliente/${c.client_id}/revisiones`, unseen: !c.coach_seen }));
    forms.filter(f => f.submitted_at >= since || !f.seen).forEach(f => out.push({ k: 'form', t: f.submitted_at, cid: f.client_id, who: f.client_id ? nm(f.client_id) : (f.name || 'Sin nombre'),
      what: `rellenó <b>${f.form === 'plan' ? 'Plan 1:1' : f.form === 'salud' ? 'Datos Base y Salud' : esc(f.form)}</b>`, pills: '', href: '#/formularios', unseen: !f.seen }));
    return out.sort((a, b) => (a.t < b.t ? 1 : -1));
  }
  function drawActivity(card, feed) {
    if (!card) return;
    const body = card.querySelector('[data-actbody]'), td = today(), yd = ymd(new Date(Date.now() - 864e5));
    let f = S.actF || 'all', more = false;
    const dayOf = x => x.day || ymd(new Date(x.t));
    const hhmm = x => (x.k === 'metric' && !String(x.t).includes(':') ? '' : new Date(x.t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
    const item = x => `<li class="act-i ${x.k}${x.unseen ? ' new' : ''}"><a href="${x.href}">
        <span class="act-av">${esc(initials(x.who))}<i class="act-k">${ic(ACT_T[x.k][1])}</i></span>
        <div class="act-tx"><div class="act-l1"><b>${esc(x.who)}</b> <span>${x.what}</span></div>${x.pills ? `<div class="act-ps">${x.pills}</div>` : ''}</div>
        <small class="act-t">${x.g === 'old' ? fmtDate(dayOf(x), { weekday: 'short', day: 'numeric' }) : hhmm(x)}</small>${x.unseen ? '<i class="dot"></i>' : ''}</a></li>`;
    const sumItem = ms => { const ws = [...new Set(ms.map(x => x.who))];
      return `<li class="act-i metric"><a href="#" data-actf="metric"><span class="act-av">${ws.length}<i class="act-k">${ic('chart')}</i></span>
        <div class="act-tx"><div class="act-l1"><b>${ws.length} cliente${ws.length > 1 ? 's' : ''}</b> <span>registraron sus métricas</span></div><div class="act-ps">${ws.slice(0, 6).map(w => `<span class="act-p">${esc(w.split(' ')[0])}</span>`).join('')}${ws.length > 6 ? `<span class="act-p">+${ws.length - 6}</span>` : ''}</div></div>
        <small class="act-t">Ver ›</small></a></li>`; };
    const draw = () => {
      const list = feed.filter(x => f === 'all' || x.k === f).map(x => Object.assign(x, { g: dayOf(x) === td ? 'today' : dayOf(x) === yd ? 'yday' : 'old' }));
      const cnt = k => feed.filter(x => k === 'all' || x.k === k).length;
      const groups = [['today', 'Hoy'], ['yday', 'Ayer'], ['old', 'Anteriores']].map(([g, l]) => {
        let xs = list.filter(x => x.g === g);
        // en «Todo», si hay muchas métricas se resumen en una fila (con 20 clientes serían 20 al día)
        const ms = f === 'all' ? xs.filter(x => x.k === 'metric') : [];
        if (ms.length > 3) { const i0 = xs.indexOf(ms[0]); xs = xs.filter(x => x.k !== 'metric'); xs.splice(Math.min(i0, xs.length), 0, { sum: ms }); }
        const total = xs.length; if (g === 'old' && !more) xs = xs.slice(0, 10);
        const tc = k => list.filter(x => x.g === g && x.k === k).length;
        return total ? `<div class="act-g"><div class="act-gh"><b>${l}</b><span class="act-sum">${Object.keys(ACT_T).filter(tc).map(k => `<span class="act-c ${k}">${ic(ACT_T[k][1])} ${tc(k)}</span>`).join('')}</span></div>
          <ul class="act-list">${xs.map(x => x.sum ? sumItem(x.sum) : item(x)).join('')}</ul>${g === 'old' && total > xs.length ? `<button class="btn small ghost block" data-actmore>Ver ${total - xs.length} más</button>` : ''}</div>` : '';
      }).join('');
      body.innerHTML = `<div class="act-f">${[['all', 'Todo'], ...Object.entries(ACT_T).map(([k, v]) => [k, v[0]])].map(([k, l]) => `<button type="button" class="chip ${f === k ? 'on' : ''}" data-actf="${k}">${l} <small>${cnt(k)}</small></button>`).join('')}</div>
        ${groups || `<p class="empty">${f === 'all' ? 'Aún no hay actividad esta semana. Cuando tus clientes entrenen, registren métricas o envíen formularios, aparecerá aquí.' : 'Nada de esto en los últimos 8 días.'}</p>`}`;
      body.querySelectorAll('[data-actf]').forEach(b => b.onclick = e => { e.preventDefault(); f = S.actF = b.dataset.actf; more = false; draw(); });
      const m = body.querySelector('[data-actmore]'); if (m) m.onclick = () => { more = true; draw(); };
    };
    draw();
  }

  // ---------- Inicio
  async function coachHome() {
    shell(COACH_NAV, 'inicio', loading(), { title: 'Hola 👋', actions: `<button class="btn ghost small" data-sec title="Verificación en dos pasos">🔒<span>Seguridad</span></button>` });
    $app.querySelector('[data-sec]').onclick = () => securityModal();
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const d8 = new Date(Date.now() - 8 * 864e5), d8i = d8.toISOString();
    const [clients, sessions, checkins, metrics, forms] = await Promise.all([
      loadClients(),
      DB.list('sessions', { gte: { started_at: d8i }, order: ['started_at', 'desc'], limit: 400 }),
      DB.list('checkins', { order: ['created_at', 'desc'], limit: 60 }),
      DB.list('daily_metrics', { gte: { date: ymd(d8) }, order: ['date', 'desc'], limit: 400 }).catch(() => []),
      DB.list('form_responses', { order: ['submitted_at', 'desc'], limit: 30 }).catch(() => [])
    ]);
    const name = id => (byId(clients, id) || {}).name || 'Cliente';
    const active = clients.filter(c => c.active);
    const week = sessions.filter(s => s.started_at >= weekAgo && s.finished_at);
    const unseenCk = checkins.filter(c => !c.coach_seen);
    const trainedIds = new Set(week.map(s => s.client_id));
    const idle = active.filter(c => !trainedIds.has(c.id));

    const feed = activityFeed({ clients, sessions, checkins, metrics, forms, since: d8i });
    const html = `
      <div class="kpis">
        <a class="kpi" href="#/clientes"><small>Clientes activos</small><b>${active.length}</b><span>${clients.length - active.length} en pausa</span></a>
        <div class="kpi"><small>Entrenos esta semana</small><b>${week.length}</b><span>${trainedIds.size} clientes han entrenado</span></div>
        <a class="kpi ${unseenCk.length ? 'warn' : ''}" href="#/revisiones"><small>Check-ins sin revisar</small><b>${unseenCk.length}</b><span>pendientes de respuesta</span></a>
        <div class="kpi ${idle.length ? 'warn' : ''}"><small>Sin entrenar en 7 días</small><b>${idle.length}</b><span>clientes activos</span></div>
      </div>
      <div class="grid2">
        <section class="card act-card" data-act><h3>Actividad reciente</h3><div data-actbody></div></section>
        <div class="stack">
          <section class="card" id="venc"><h3>Próximos cobros</h3>${loading()}</section>
          <section class="card"><h3>Sin entrenar en 7 días</h3>
            ${idle.length ? `<ul class="list">${idle.map(c => c.phone ? `<li><a href="https://wa.me/${esc(String(c.phone).replace(/\D/g, ''))}" target="_blank" rel="noopener"><span class="av">${initials(c.name)}</span><span class="grow">${esc(c.name)}</span><small>${ic('wa', 'xs')} WhatsApp</small></a></li>` : `<li><a href="#/cliente/${c.id}/progreso"><span class="av">${initials(c.name)}</span><span class="grow">${esc(c.name)}</span><small>Ver</small></a></li>`).join('')}</ul>` : '<p class="empty">¡Todos tus clientes activos han entrenado esta semana! 🎉</p>'}
          </section>
        </div>
      </div>`;
    $app.querySelector('.content').innerHTML = html;
    drawActivity($app.querySelector('[data-act]'), feed);
    {
      const stack = $app.querySelector('.content .stack');
      const extras = () => { if (!document.body.contains(stack)) return; if (window.JMBackup) window.JMBackup.remind(stack); if (window.JMForms) window.JMForms.homeCard(stack); storageCard(stack); privacyAlerts(stack); trainAlerts(stack).catch(e => console.warn(e)); };
      if (window.JMForms && window.JMBackup) extras(); else window.addEventListener('load', extras, { once: true });   // scripts aún cargando
    }
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

  function dropSheet() { S.sheet = null; try { localStorage.removeItem('jmfit-sheet'); } catch (e) {} }
  // La hoja puede mandar fechas como texto largo («Fri Nov 06 2026 08:00:00 GMT…»): se pasan a AAAA-MM-DD
  const sheetDay = v => {
    if (v == null || v === '') return '';
    const t = String(v); if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    // «Fri Nov 06 2026 …»: se toma el día tal cual lo escribió la hoja (sin pasar por la zona horaria del móvil)
    const m = t.match(/^[A-Za-z]{3},? ([A-Za-z]{3}) (\d{1,2}) (\d{4})/), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (m && M.includes(m[1])) return `${m[3]}-${String(M.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const e = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (e) return `${e[3]}-${e[2].padStart(2, '0')}-${e[1].padStart(2, '0')}`;
    const d = new Date(t.replace(/\s*\(.*\)\s*$/, '')); return isNaN(d) ? t : ymd(d);
  };
  const normSheet = d => {
    if (!d || d._norm) return d;
    (d.pagos || []).forEach(p => { p.fecha = sheetDay(p.fecha); p.vence = sheetDay(p.vence); p.importe = typeof p.importe === 'number' ? p.importe : Number(String(p.importe || '').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0; });
    (d.clientes || []).forEach(c => { ['alta', 'ultimoPago', 'vence'].forEach(k => { c[k] = sheetDay(c[k]); }); });
    d._norm = true; return d;
  };
  async function getSheet(force) { const d = normSheet(await getSheetRaw(force)); syncPayDue(d); return d; }
  // Copia en cada cliente su próxima renovación (fecha, plan y cuota) para que su app le avise. Solo el entrenador.
  let paySyncAt = 0;
  async function syncPayDue(d) {
    if (!d || !Array.isArray(d.clientes) || !S.profile || S.profile.role !== 'coach' || Date.now() - paySyncAt < 60000) return;
    paySyncAt = Date.now();
    try {
      const cl = S.clients && S.clients.length ? S.clients : await loadClients();
      if (!cl.length || !('pay_due' in cl[0])) return;   // migración 017 aún sin aplicar
      const money = v => (typeof v === 'number' ? v : Number(String(v || '').replace(/[^\d,.-]/g, '').replace(',', '.')) || null);
      for (const c of cl) {
        if (c.is_template) continue;
        const key = String(c.sheet_name || c.name || '').trim().toLowerCase();
        const r = d.clientes.find(x => String(x.nombre).trim().toLowerCase() === key);
        const want = r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.vence || '')) && r.estado !== 'BAJA / PAUSA'
          ? { pay_due: r.vence, pay_plan: String(r.plan || '').slice(0, 80) || null, pay_amount: money(r.cuota) } : { pay_due: null, pay_plan: null, pay_amount: null };
        if ((c.pay_due || null) === want.pay_due && (c.pay_plan || null) === want.pay_plan && Number(c.pay_amount || 0) === Number(want.pay_amount || 0)) continue;
        await DB.update('clients', c.id, want).then(() => Object.assign(c, want)).catch(() => {});
      }
    } catch (e) { /* el aviso de pago es opcional */ }
  }
  async function getSheetRaw(force) {
    if (!S.sheet && !force) { try { const c = JSON.parse(localStorage.getItem('jmfit-sheet') || 'null'); if (c && c.data) S.sheet = c; } catch (e) {} }
    if (S.sheet && !force && Date.now() - S.sheet.at < 120000) return S.sheet.data;
    // hay copia (aunque sea vieja): se usa ya y se refresca en segundo plano
    if (S.sheet && !force && !S.sheetLoading) {
      S.sheetLoading = DB.sheets('resumen').then(data => { S.sheet = { at: Date.now(), data }; try { localStorage.setItem('jmfit-sheet', JSON.stringify(S.sheet)); } catch (e) {} }).catch(() => {}).finally(() => { S.sheetLoading = null; });
      return S.sheet.data;
    }
    const data = await DB.sheets('resumen');
    S.sheet = { at: Date.now(), data };
    try { localStorage.setItem('jmfit-sheet', JSON.stringify(S.sheet)); } catch (e) {}
    return data;
  }

  // ---------- Lista de clientes
  async function coachClients() {
    shell(COACH_NAV, 'clientes', loading(), { title: 'Clientes', actions: `<button class="btn ghost" data-backup title="Descargar un Excel con todos los datos">${ic('copy')}<span>Copia de seguridad</span></button><button class="btn primary" data-new>${ic('plus')}<span>Nuevo cliente</span></button>` });
    $app.querySelector('[data-new]').onclick = () => clientForm();
    $app.querySelector('[data-backup]').onclick = e => window.JMBackup && window.JMBackup.run(e.currentTarget);
    const [clients, sessions] = await Promise.all([loadClients(), DB.list('sessions', { gte: { started_at: new Date(Date.now() - 35 * 864e5).toISOString() }, order: ['started_at', 'desc'], limit: 1500 })]);
    const last = {}; sessions.forEach(s => { if (s.finished_at && !last[s.client_id]) last[s.client_id] = s.finished_at; });
    const act = clients.filter(c => c.active), off = clients.filter(c => !c.active);
    if (!clients.length) {
      $app.querySelector('.content').innerHTML = `<div class="hero-empty">${ic('users', 'xl')}<h2>Da de alta a tu primer cliente</h2><p>Pon su nombre y su correo. Después le mandas el enlace de la app para que cree su cuenta con ese mismo correo.</p><button class="btn primary" data-new2>${ic('plus')} Nuevo cliente</button></div>`;
      $app.querySelector('[data-new2]').onclick = () => clientForm(); return;
    }
    const tri = await triage(act, sessions).catch(e => { console.warn('triaje', e); return null; });
    const tv = c => (tri && tri[c.id]) || null;
    const row = (c, why) => { const t = tv(c); return `<li data-tri="${t ? t.lv : ''}"><a href="#/cliente/${c.id}"><span class="av ${t && c.active ? 'tri-' + t.lv : ''}">${initials(c.name)}</span>
        <span class="grow"><b>${esc(c.name)}</b><small>${esc(c.service || 'Sin servicio')}${c.goal ? ' · ' + esc(c.goal) : ''}</small>${why && t && t.why.length ? `<span class="tri-why">${t.why.map(w => `<i class="tri-${w[0]}">${esc(w[1])}</i>`).join('')}</span>` : ''}</span>
        <span class="right"><small>${last[c.id] ? 'Entrenó ' + ago(last[c.id]) : 'Sin entrenos recientes'}</small>${c.user_id ? '' : '<span class="pill amber">invitación pendiente</span>'}${privPill(c)}</span></a></li>`; };
    const list = (cs, why) => `<section class="card flush"><ul class="list big" data-list>${cs.map(c => row(c, why)).join('')}</ul></section>`;
    const inApp = act.filter(c => c.user_id), pend = act.filter(c => !c.user_id);
    const LV = [['red', '🔴 Atender ya', 'Más de 3 días sin datos, molestias o caída de rendimiento'], ['amber', '🟡 Vigilar', 'Entreno fallado, peso raro o estancado'], ['green', '🟢 Bien', 'Cumpliendo y progresando']];
    const cnt = lv => inApp.filter(c => (tv(c) || {}).lv === lv).length;
    const TABS = [['activos', 'Activos', inApp.length], ['semaforo', 'Semáforo', tri ? cnt('red') : null], ['inactivos', 'Inactivos', off.length]];
    let tab = S.cliTab || (() => { try { return localStorage.getItem('jmfit-cli-tab'); } catch (e) { return null; } })() || 'activos';
    if (!TABS.some(t => t[0] === tab)) tab = 'activos';
    const CAT = [[/sin registrar|sin datos/, 'Días sin registrar'], [/molestia/, 'Molestias'], [/rendimiento/, 'Caída de rendimiento'], [/sin hacer/, 'Entrenos sin hacer'], [/peso/, 'Peso atípico'], [/estancado/, 'Estancado']];
    const body = () => {
      if (tab === 'activos') return `<p class="muted small cli-sub">${inApp.length} con la app${pend.length ? ` · ${pend.length} con la invitación pendiente` : ''}. El punto de color es su semáforo.</p>
        ${inApp.length ? list(inApp, false) : '<p class="empty">Ningún cliente activo ha entrado todavía en la app.</p>'}
        ${pend.length ? `<h3 class="sub">Invitación pendiente <small class="muted">· aún no han creado su cuenta</small></h3>${list(pend, false)}` : ''}`;
      if (tab === 'inactivos') return off.length ? `<p class="muted small cli-sub">Clientes en pausa o de baja. Para reactivar uno: entra en su ficha → Editar cliente → Activo.</p>${list(off, false)}` : '<p class="empty">No tienes clientes inactivos.</p>';
      if (!tri) return '<p class="empty">No se pudo calcular el semáforo ahora mismo.</p>';
      const n = inApp.length || 1, cats = CAT.map(([re, l]) => [l, inApp.filter(c => (tv(c) || { why: [] }).why.some(w => w[0] !== 'green' && re.test(w[1]))).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...cats.map(x => x[1]));
      return `<section class="card tri-chart"><h3>Semáforo de ${inApp.length} cliente${inApp.length === 1 ? '' : 's'} con la app</h3>
          <div class="tri-bar">${LV.map(([lv]) => cnt(lv) ? `<i class="tri-${lv}" style="flex:${cnt(lv)}" title="${cnt(lv)}">${cnt(lv)}</i>` : '').join('')}</div>
          <div class="tri-kpis">${LV.map(([lv, h, sub]) => `<button type="button" class="tri-k tri-${lv}" data-jump="${lv}"><b>${cnt(lv)}</b><span>${h.replace(/^\S+\s/, '')}</span><small>${Math.round(cnt(lv) / n * 100)} %</small></button>`).join('')}</div>
          ${cats.length ? `<h4>Motivos más frecuentes</h4><ul class="tri-cats">${cats.map(([l, v]) => `<li><span>${esc(l)}</span><i><em style="width:${Math.round(v / mx * 100)}%"></em></i><b>${v}</b></li>`).join('')}</ul>` : '<p class="muted small">Ningún aviso: todos van bien. 💪</p>'}
        </section>
        ${LV.map(([lv, h, sub]) => { const cs = inApp.filter(c => (tv(c) || {}).lv === lv).sort((a, b) => (tv(b).score - tv(a).score) || a.name.localeCompare(b.name)); return cs.length ? `<h3 class="sub tri-h" id="tri-${lv}">${h} <small class="muted">${cs.length} · ${esc(sub)}</small></h3>${list(cs, true)}` : ''; }).join('')}`;
    };
    const draw = () => {
      $app.querySelector('.content').innerHTML = `<div class="seg cli-tabs" role="tablist">${TABS.map(([k, l, n]) => `<button type="button" role="tab" class="${k === tab ? 'on' : ''}" data-ctab="${k}">${l}${n != null ? ` <span class="${k === 'semaforo' && n ? 'cnt red' : 'cnt'}">${n}</span>` : ''}</button>`).join('')}</div>
        <input class="search" placeholder="Buscar cliente…" data-q>${body()}`;
      $app.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { tab = S.cliTab = b.dataset.ctab; try { localStorage.setItem('jmfit-cli-tab', tab); } catch (e) {} draw(); });
      $app.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => { const h = $app.querySelector('#tri-' + b.dataset.jump); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      const q = $app.querySelector('[data-q]');
      q.oninput = () => { const v = q.value.toLowerCase(); $app.querySelectorAll('.list.big li').forEach(li => { li.hidden = !li.textContent.toLowerCase().includes(v); }); };
    };
    draw();
  }

  // ---------- Triaje de clientes (semáforo)
  //  Rojo: 3+ días sin registrar nada, molestias (comentarios del entreno o check-in) o caída de rendimiento.
  //  Amarillo: algún entreno fallado esta semana, peso que se sale de lo normal o estancado 3 semanas.
  //  Verde: el resto (cumpliendo). Gris: sin cuenta todavía.
  async function triage(cs, sessions) {
    const d14 = new Date(Date.now() - 14 * 864e5).toISOString(), day = s => String(s || '').slice(0, 10), td = today();
    const opt = p => p.catch(() => []);
    // Solo la ventana que mira el semáforo (14 días de métricas, 3 semanas de check-ins, 6 de semanas de plan):
    // con 20 clientes son unos cientos de filas en vez de todo el histórico. Se reutiliza 60 s al volver a la lista.
    if (S.triCache && Date.now() - S.triCache.t < 60e3 && S.triCache.n === cs.length + ':' + sessions.length) return S.triCache.v;
    const ago = n => new Date(Date.now() - n * 864e5).toISOString();
    const [daily, cks, fb, pws, progs, routines, stag] = await Promise.all([
      opt(DB.list('daily_metrics', { gte: { date: day(d14) }, order: ['date', 'desc'], limit: 3000 })), opt(DB.list('checkins', { gte: { created_at: ago(21) }, order: ['created_at', 'desc'], limit: 500 })),
      opt(DB.list('workout_feedback', { gte: { created_at: ago(8) }, order: ['created_at', 'desc'], limit: 500 })), opt(DB.list('program_weeks', { gte: { start_date: day(ago(56)) }, order: ['start_date', 'desc'], limit: 1000 })),
      opt(DB.list('programs')), opt(DB.list('routines', { notNull: ['day'], limit: 3000 })), opt(DB.rpc('stagnation_alerts'))
    ]);
    const mon = mondayOf(td), dow = (new Date(td + 'T12:00:00').getDay() + 6) % 7 + 1;   // 1 lunes … 7 domingo
    const actP = new Set(progs.filter(p => p.status !== 'archived').map(p => p.id));
    const out = {};
    cs.forEach(c => {
      if (!c.user_id) { out[c.id] = { lv: 'none', why: [], score: 0 }; return; }
      const why = [], add = (lv, t) => why.push([lv, t]);
      const ss = sessions.filter(s => s.client_id === c.id && s.finished_at);
      const dm = daily.filter(d => d.client_id === c.id && day(d.date) >= day(d14));
      const ck = cks.filter(k => k.client_id === c.id);
      // 1) días sin registrar nada
      const lastAt = [ss[0] && ss[0].finished_at, dm[0] && dm[0].date + 'T12:00:00', ck[0] && ck[0].created_at].filter(Boolean).sort().pop();
      const idle = lastAt ? Math.floor((Date.now() - new Date(lastAt)) / 864e5) : null;
      if (idle == null) add('red', 'sin datos'); else if (idle >= 3) add('red', `${idle} días sin registrar`);
      // 2) molestias
      const pain = /molest|dolor|lesi|pinch|tir[oó]n|me duele|sobrecarg|articul/i;
      const fbc = fb.filter(x => x.client_id === c.id && x.kind === 'comment' && x.created_at >= new Date(Date.now() - 7 * 864e5).toISOString());
      if (fbc.some(x => pain.test(x.body || ''))) add('red', 'molestias en un ejercicio');
      const ck7 = ck.find(k => k.created_at >= new Date(Date.now() - 8 * 864e5).toISOString());
      if (ck7 && ck7.pains && !/^\s*(no|nada|ninguna?|-|ok|bien)\.?\s*$/i.test(ck7.pains)) add('red', 'molestias en el check-in');
      // 3) caída de rendimiento: el último entreno de una rutina con ≥ 20 % menos volumen que la media de los 3 anteriores
      const lastS = ss[0];
      if (lastS && lastS.volume > 0) { const prevS = ss.slice(1).filter(s => s.routine_name === lastS.routine_name && s.volume > 0).slice(0, 3);
        if (prevS.length >= 2) { const m = prevS.reduce((a, s) => a + Number(s.volume), 0) / prevS.length; if (lastS.volume < m * 0.8) add('red', `rendimiento −${Math.round((1 - lastS.volume / m) * 100)} % en ${lastS.routine_name}`); } }
      // 4) entrenos fallados esta semana (días pautados ya pasados sin entreno)
      const cw = pws.filter(w => w.client_id === c.id && w.published && actP.has(w.program_id) && w.start_date <= td).sort((a, b) => b.start_date.localeCompare(a.start_date) || b.week_no - a.week_no)[0];
      const planned = routines.filter(r => r.client_id === c.id && r.day && (cw ? r.program_week_id === cw.id : !r.program_week_id)).filter(r => r.day < dow).length;
      const doneW = ss.filter(s => day(s.started_at) >= mon).length;
      if (planned > doneW) add('amber', `${planned - doneW} entreno${planned - doneW > 1 ? 's' : ''} sin hacer esta semana`);
      // 5) peso atípico: media de 7 días vs la semana anterior
      const ws = dm.filter(d => d.weight != null).map(d => ({ d: day(d.date), w: Number(d.weight) }));
      const a1 = avg(ws.filter(x => x.d > day(new Date(Date.now() - 7 * 864e5).toISOString())).map(x => x.w)), a0 = avg(ws.filter(x => x.d <= day(new Date(Date.now() - 7 * 864e5).toISOString())).map(x => x.w));
      if (a1 != null && a0 != null) { const dlt = a1 - a0, tgt = c.weekly_target != null && c.weekly_target !== '' ? Number(c.weekly_target) : null, lim = a1 * (tgt != null ? 0.01 : 0.015);
        if (Math.abs(dlt - (tgt || 0)) > lim) add('amber', `peso ${dlt > 0 ? '+' : ''}${fmtKg(Math.round(dlt * 10) / 10)} kg en la semana`); }
      // 6) estancado
      const st = (stag || []).filter(x => x.client_id === c.id);
      if (st.length) add('amber', `estancado en ${st[0].exercise_name}${st.length > 1 ? ` y ${st.length - 1} más` : ''}`);
      const lv = why.some(w => w[0] === 'red') ? 'red' : why.length ? 'amber' : 'green';
      if (lv === 'green' && ss.length) why.push(['green', doneW ? `${doneW} entreno${doneW > 1 ? 's' : ''} esta semana` : 'al día']);
      out[c.id] = { lv, why, score: why.filter(w => w[0] === 'red').length * 10 + why.filter(w => w[0] === 'amber').length };
    });
    S.triCache = { t: Date.now(), n: cs.length + ':' + sessions.length, v: out };
    return out;
  }

  // Inicio del entrenador: comentarios y cambios de ejercicio, metas por estructurar y estancamientos
  async function trainAlerts(stack) {
    const [fb, stag] = await Promise.all([DB.list('workout_feedback', { order: ['created_at', 'desc'], limit: 60 }).catch(() => null), DB.rpc('stagnation_alerts').catch(() => null)]);
    if (!document.body.contains(stack)) return;
    const cs = S.clients || [], name = id => (byId(cs, id) || {}).name || 'Cliente';
    const un = (fb || []).filter(x => !x.seen_at), reqs = cs.filter(c => c.active && c.goal_request);
    if (un.length || reqs.length) {
      const card = document.createElement('section'); card.className = 'card'; card.setAttribute('data-talerts', '');
      card.innerHTML = `<h3>Avisos de tus clientes</h3><ul class="list talerts">
        ${un.map(x => `<li data-fb="${x.id}"><span class="av">${x.kind === 'swap' ? ic('swap') : ic('msg')}</span><a class="grow" href="#/cliente/${x.client_id}/progreso"><b>${esc(name(x.client_id))}</b><small>${x.kind === 'swap' ? `Cambió <b>${esc(x.exercise_name)}</b> por <b>${esc(x.swap_to || '')}</b>${x.body ? ' · «' + esc(x.body) + '»' : ''}` : `${esc(x.exercise_name)}: «${esc(x.body || '')}»`} · ${ago(x.created_at)}</small></a><button class="btn small ghost" data-fbseen>Visto</button></li>`).join('')}
        ${reqs.map(c => `<li><span class="av">🎯</span><a class="grow" href="#/cliente/${c.id}/progreso"><b>${esc(c.name)}</b><small>Meta por convertir en S.M.A.R.T.: «${esc(c.goal_request)}»</small></a></li>`).join('')}</ul>`;
      stack.prepend(card);
      card.querySelectorAll('[data-fbseen]').forEach(b => b.onclick = async () => { const li = b.closest('li'); await safe(() => DB.update('workout_feedback', li.dataset.fb, { seen_at: new Date().toISOString() })); li.remove(); if (!card.querySelector('li')) card.remove(); });
    }
    if (stag && stag.length) {
      const card = document.createElement('section'); card.className = 'card'; card.setAttribute('data-stag', '');
      card.innerHTML = `<h3>Estancamientos <small class="muted">· 3 semanas iguales</small></h3><ul class="list">${stag.map(x => `<li><a class="grow" href="#/cliente/${x.client_id}/rutinas"><b>${esc(name(x.client_id))}</b><small>${esc(x.exercise_name)}: ${fmtKg(x.weight)} kg × ${x.reps} tres semanas seguidas. Toca forzar la sobrecarga (más carga, reps o series).</small></a></li>`).join('')}</ul>`;
      stack.prepend(card);
    }
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
        ${!isNew && 'remind_checkin' in c ? `<fieldset class="full rem-set"><legend>Avisos en su app</legend>
          <label class="check"><input type="checkbox" name="remind_checkin" ${c.remind_checkin !== false ? 'checked' : ''}> Recordarle el check-in el viernes si aún no lo ha hecho</label>
          <label class="check"><input type="checkbox" name="remind_payment" ${c.remind_payment !== false ? 'checked' : ''}> Avisarle de la renovación del plan (2 días antes, el día antes y el mismo día)</label>
          <small class="muted">La fecha de renovación sale de tu hoja de cobros.</small></fieldset>` : ''}
      </div>`, {
      submitLabel: isNew ? 'Crear cliente' : 'Guardar',
      danger: isNew ? null : { label: 'Eliminar', run: async () => { if (await confirmBox(`Se borrarán ${c.name} y todos sus datos (rutinas, entrenos, check-ins). No se puede deshacer.`)) { await safe(() => DB.remove('clients', c.id), 'Cliente eliminado'); go('#/clientes'); } } },
      onSubmit: async (f, fd) => {
        const d = Object.fromEntries(fd); d.active = !!fd.get('active'); d.email = d.email.trim().toLowerCase();
        if (!isNew && 'remind_checkin' in c) { d.remind_checkin = !!fd.get('remind_checkin'); d.remind_payment = !!fd.get('remind_payment'); }
        if (!d.name.trim() || !d.email) { toast('Nombre y correo son obligatorios', 'err'); return false; }
        if (isNew) { const r = await safe(() => DB.insert('clients', d), 'Cliente creado'); invite(r[0]); return false; }
        await safe(() => DB.update('clients', c.id, d), 'Guardado'); render();
      }
    });
  }

  function appUrl() { return location.origin + location.pathname; }
  function invite(c) {
    const msg = `¡Hola, ${c.name.trim().split(/\s+/)[0]}! 💪 Desde ahora tus entrenos, tu nutrición y tus revisiones van en la app de TEAM JMFIT.

1️⃣ Entra en https://teamjmfit.github.io, pulsa «Soy atleta nuevo» y crea tu cuenta con este correo: ${c.email}
2️⃣ Instálala en el móvil:
   • iPhone: ábrela en Safari → botón Compartir → «Añadir a pantalla de inicio».
   • Android: ábrela en Chrome → menú ⋮ → «Instalar aplicación».
3️⃣ En «Entreno» tienes lo de cada día: apunta tus series, kilos y RIR. Los viernes te pedirá el check-in.

Cualquier duda, me escribes por aquí. ¡A por ello! 🔥`;
    // WhatsApp (sobre todo en ordenador) estropea los emojis que llegan por el enlace: ahí va la versión sin emojis.
    // «Copiar» mantiene los emojis (al pegar sí se ven).
    const waMsg = msg.replace(/([1-9])\uFE0F?\u20E3\s*/g, '$1. ').replace(/\s*\p{Extended_Pictographic}\uFE0F?/gu, '');
    modal('Invita a ' + c.name, `
      <p>Envíale este mensaje para que cree su cuenta con <b>${esc(c.email)}</b>. En cuanto se registre, verá su plan.</p>
      <textarea class="mono" rows="13" readonly>${esc(msg)}</textarea>
      <div class="row gap">
        <button type="button" class="btn" data-copy>${ic('copy')} Copiar</button>
        ${c.phone ? `<a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/${esc(String(c.phone).replace(/\D/g, ''))}?text=${encodeURIComponent(waMsg)}">${ic('wa')} Enviar por WhatsApp</a>` : ''}
        <a class="btn ghost" href="#/cliente/${c.id}" data-close>Ir a su ficha</a>
      </div>`);
    document.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(msg).then(() => toast('Copiado', 'ok'));
  }

  // ---------- Ficha de cliente
  const CLIENT_TABS = [['rutinas', 'Rutinas'], ['calendario', 'Calendario'], ['nutricion', 'Nutrición'], ['progreso', 'Progreso'], ['revisiones', 'Revisiones'], ['ficha', 'Ficha'], ['diario', 'Diario'], ['cobros', 'Cobros']];
  async function coachClient(id, tab) {
    if (tab === 'mensajes') return go(`#/cliente/${id}/progreso`);   // los mensajes se quitaron: se habla por WhatsApp
    shell(COACH_NAV, 'clientes', loading(), { title: '', back: 'clientes' });
    const c = await DB.get('clients', id);
    if (!c) { toast('Cliente no encontrado', 'err'); return go('#/clientes'); }
    if (c.is_template) return templateClient(c);
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
    if (window.JMGoals) loadGoals(c.id).then(gs => { const g = primaryGoal(gs), hd = content.querySelector('.client-head > div'); if (!g || !hd) return;
      const fo = JMGoals.FOCUS[g.focus]; const p = document.createElement('p'); p.className = 'gl-head';
      p.innerHTML = `🎯 <b>${esc(g.title)}</b>${fo ? ` <span class="pill">${esc(fo.tag)}</span>` : ''}`; hd.appendChild(p); });
    if (tab === 'rutinas') return tabRoutines(c, box);
    if (tab === 'calendario') return tabCalendar(c, box);
    if (tab === 'nutricion') return tabNutrition(c, box);
    if (tab === 'progreso') return tabProgress(c, box, true);
    if (tab === 'ficha') return tabFicha(c, box);
    if (tab === 'revisiones') return tabReviews(c, box);
    if (tab === 'cobros') return tabClientPayments(c, box);
    if (tab === 'diario') return notesBox(c, box);
  }

  // ---------- Diario / bloc de notas del entrenador por cliente (migración 020; solo lo ve el entrenador)
  const NOTE_TAGS = ['Entreno', 'Nutrición', 'Salud', 'Revisión', 'Llamada', 'Idea'];
  async function coachNotes(sel) {
    if (!S.clients) await loadClients();
    let cid = sel || (() => { try { return localStorage.getItem('jmfit-notes-client') || ''; } catch (e) { return ''; } })();
    if (cid && !S.clients.some(c => c.id === cid)) cid = '';
    shell(COACH_NAV, 'notas', `<section class="card row gap wrap notes-pick"><label class="grow">Cliente<select data-nc><option value="">Todos (últimas notas)</option>${S.clients.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></section><div data-notes>${loading()}</div>`, { title: 'Notas' });
    const host = $app.querySelector('[data-notes]');
    const draw = () => { const c = S.clients.find(x => x.id === cid); try { localStorage.setItem('jmfit-notes-client', cid); } catch (e) {} return c ? notesBox(c, host) : notesAll(host); };
    $app.querySelector('[data-nc]').onchange = e => { cid = e.target.value; draw(); };
    draw();
  }
  async function notesAll(host) {
    const ns = await DB.list('client_notes', { order: ['created_at', 'desc'], limit: 60 }).catch(() => null);
    if (!ns) { host.innerHTML = '<p class="empty">El diario necesita la actualización 020 de la base de datos.</p>'; return; }
    const name = id => (S.clients.find(c => c.id === id) || {}).name || '—';
    host.innerHTML = ns.length ? `<section class="card"><h3>Últimas notas</h3><ul class="notes">${ns.map(n => `<li class="note-fold"><div class="note-h" data-ntog title="Desplegar o plegar"><span class="n-chev">${ic('back')}</span><a href="#/notas/${n.client_id}"><b>${esc(name(n.client_id))}</b></a><small class="muted">${fmtDate(n.note_date, { day: 'numeric', month: 'short', year: 'numeric' })}</small>${n.tag ? `<span class="pill">${esc(n.tag)}</span>` : ''}</div><p class="n-prev">${esc(String(n.body).split('\n')[0])}</p><p class="n-body">${nl2br(n.body)}</p></li>`).join('')}</ul></section>`
      : `<div class="hero-empty">${ic('edit', 'xl')}<h2>Sin notas todavía</h2><p>Elige un cliente y apunta lo que quieras: cambios que le haces, lo que habláis, ideas para su próximo bloque…</p></div>`;
    host.querySelectorAll('[data-ntog]').forEach(h => h.onclick = e => { if (!e.target.closest('a')) h.parentNode.classList.toggle('open'); });
  }
  async function notesBox(c, host) {
    let ns = await DB.list('client_notes', { eq: { client_id: c.id }, order: ['note_date', 'desc'] }).catch(() => null);
    if (!ns) { host.innerHTML = '<p class="empty">El diario necesita la actualización 020 de la base de datos.</p>'; return; }
    let q = '', edit = null; const open = new Set();   // notas plegadas: se ve la cabecera y la primera línea
    const sort = () => ns.sort((a, b) => (!!b.pinned - !!a.pinned) || String(b.note_date).localeCompare(String(a.note_date)) || String(b.created_at).localeCompare(String(a.created_at)));
    const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const form = n => `<form class="note-form" data-nf="${n ? n.id : ''}">
        <textarea name="body" rows="${n ? 5 : 3}" maxlength="20000" required placeholder="Ej: le subo 20 g de carbos en el pre entreno; dice que duerme mal por exámenes…">${n ? esc(n.body) : ''}</textarea>
        <div class="row gap wrap"><input type="date" name="note_date" value="${esc(n ? n.note_date : today())}">
          <div class="note-tags">${NOTE_TAGS.map(t => `<label class="chip"><input type="radio" name="tag" value="${t}" ${n && n.tag === t ? 'checked' : ''}>${t}</label>`).join('')}</div>
          <span class="grow"></span>${n ? '<button type="button" class="btn small ghost" data-ncancel>Cancelar</button>' : ''}<button class="btn small primary">${n ? 'Guardar' : 'Añadir nota'}</button></div></form>`;
    const draw = () => {
      sort();
      const words = norm(q).split(/\s+/).filter(Boolean);
      const list = ns.filter(n => words.every(w => norm(n.body + ' ' + (n.tag || '')).includes(w)));
      let mo = ''; const allOpen = list.length && list.every(n => open.has(n.id));
      host.innerHTML = `<section class="card notes-card"><h3>Diario de ${esc(c.name)} <small class="muted">· solo lo ves tú</small></h3>${form(null)}</section>
        <section class="card">${ns.length > 4 ? `<input type="search" class="notes-q" placeholder="Buscar en sus notas…" value="${esc(q)}" data-nq>` : ''}
        ${list.length > 1 ? `<div class="row"><span class="grow"></span><button class="btn small ghost" data-nall>${allOpen ? 'Plegar todas' : 'Desplegar todas'}</button></div>` : ''}
        ${list.length ? `<ul class="notes">${list.map(n => {
          const m = n.pinned ? '📌 Fijadas' : fmtDate(n.note_date, { month: 'long', year: 'numeric' }), hd = m !== mo ? `<li class="note-mo">${m}</li>` : ''; mo = m;
          return hd + (edit === n.id ? `<li>${form(n)}</li>` : `<li data-n="${n.id}" class="note-fold ${open.has(n.id) || words.length ? 'open' : ''}"><div class="note-h" data-ntog title="Desplegar o plegar"><span class="n-chev">${ic('back')}</span><b>${fmtDate(n.note_date, { weekday: 'short', day: 'numeric', month: 'short' })}</b>${n.tag ? `<span class="pill">${esc(n.tag)}</span>` : ''}<span class="grow"></span>
            <button class="icon-btn sm ${n.pinned ? 'on' : ''}" data-npin title="${n.pinned ? 'Quitar de fijadas' : 'Fijar arriba'}">📌</button><button class="icon-btn sm" data-nedit title="Editar">${ic('edit')}</button><button class="icon-btn sm" data-ndel title="Borrar">${ic('trash')}</button></div><p class="n-prev">${esc(String(n.body).split('\n')[0])}</p><p class="n-body">${nl2br(n.body)}</p></li>`);
        }).join('')}</ul>` : `<p class="empty">${ns.length ? 'Nada con esa búsqueda.' : 'Aún no hay notas de este cliente.'}</p>`}</section>`;
      host.querySelectorAll('[data-nf]').forEach(f => {
        const ta = f.querySelector('textarea'); ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) f.requestSubmit(); });
        const cn = f.querySelector('[data-ncancel]'); if (cn) cn.onclick = () => { edit = null; draw(); };
        f.querySelectorAll('[name=tag]').forEach(r => r.onclick = e => { if (r.dataset.was === '1') { r.checked = false; r.dataset.was = ''; } else { f.querySelectorAll('[name=tag]').forEach(x => { x.dataset.was = ''; }); r.dataset.was = '1'; } });
        f.querySelectorAll('[name=tag]:checked').forEach(r => { r.dataset.was = '1'; });
        f.onsubmit = async e => {
          e.preventDefault();
          const fd = new FormData(f), body = String(fd.get('body') || '').trim(); if (!body) return;
          const row = { body, note_date: fd.get('note_date') || today(), tag: fd.get('tag') || null };
          await safe(async () => {
            if (f.dataset.nf) { Object.assign(ns.find(n => n.id === f.dataset.nf), row, { updated_at: new Date().toISOString() }); await DB.update('client_notes', f.dataset.nf, Object.assign({ updated_at: new Date().toISOString() }, row)); open.add(f.dataset.nf); edit = null; }
            else { const [n] = await DB.insert('client_notes', Object.assign({ client_id: c.id }, row)); ns.push(n); }
          }, 'Nota guardada');
          draw();
        };
      });
      const na = host.querySelector('[data-nall]'); if (na) na.onclick = () => { if (allOpen) list.forEach(n => open.delete(n.id)); else list.forEach(n => open.add(n.id)); draw(); };
      const sq = host.querySelector('[data-nq]'); if (sq) sq.oninput = () => { q = sq.value; const pos = sq.selectionStart; draw(); const n2 = host.querySelector('[data-nq]'); n2.focus(); n2.setSelectionRange(pos, pos); };
      host.querySelectorAll('[data-n]').forEach(li => {
        const n = ns.find(x => x.id === li.dataset.n);
        li.querySelector('[data-ntog]').onclick = e => { if (e.target.closest('button')) return; li.classList.toggle('open'); if (li.classList.contains('open')) open.add(n.id); else open.delete(n.id); };
        li.querySelector('[data-nedit]').onclick = () => { edit = n.id; draw(); const t = host.querySelector(`[data-nf="${n.id}"] textarea`); if (t) t.focus(); };
        li.querySelector('[data-npin]').onclick = async () => { n.pinned = !n.pinned; await safe(() => DB.update('client_notes', n.id, { pinned: n.pinned })); draw(); };
        li.querySelector('[data-ndel]').onclick = async () => { if (!(await confirmBox('¿Borrar esta nota?'))) return; await safe(() => DB.remove('client_notes', n.id), 'Nota borrada'); ns = ns.filter(x => x.id !== n.id); draw(); };
      });
    };
    draw();
  }

  // Una plantilla se edita con la misma pestaña Rutinas que un cliente
  function templateClient(c) {
    shell(COACH_NAV, 'programas', loading(), { title: '', back: 'programas/plantillas' });
    $app.querySelector('.top h1').textContent = c.name;
    const actions = document.createElement('div'); actions.className = 'row gap';
    actions.innerHTML = `<button class="btn small" data-copyto>${ic('copy')}<span>Copiar a cliente</span></button><button class="btn small ghost" data-ren>${ic('edit')}<span>Renombrar</span></button>`;
    $app.querySelector('.top .grow').after(actions);
    actions.querySelector('[data-copyto]').onclick = async () => { if (!S.clients.length) await loadClients(); copyTemplateForm(c); };
    actions.querySelector('[data-ren]').onclick = () => modal('Renombrar plantilla', `<label>Nombre<input name="name" required maxlength="80" value="${esc(c.name)}"></label><label>Descripción<input name="notes" maxlength="200" value="${esc(c.notes || '')}"></label>`, {
      submitLabel: 'Guardar', onSubmit: async (f, fd) => { await safe(() => DB.update('clients', c.id, { name: String(fd.get('name')).trim() || c.name, notes: String(fd.get('notes') || '').trim() || null }), 'Guardado'); render(); } });
    const content = $app.querySelector('.content');
    content.innerHTML = `<p class="note small">📚 Plantilla de Programas${c.notes ? ' · ' + esc(String(c.notes).replace(/\.\s*$/, '')) : ''}. Edita aquí las rutinas base; al copiarla a un cliente se crean sus rutinas fijas para adaptarlas.</p><div data-tab>${loading()}</div>`;
    return tabRoutines(c, content.querySelector('[data-tab]'));
  }

  // ----- Rutinas (entrenador)
  async function tabRoutines(c, box) {
    await rollWeeks(await DB.list('programs', { eq: { client_id: c.id } }).catch(() => []));
    const [allRoutines, programs, weeks, goalsR] = await Promise.all([
      DB.list('routines', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('programs', { eq: { client_id: c.id } }),
      DB.list('program_weeks', { eq: { client_id: c.id } }),
      window.JMGoals ? loadGoals(c.id) : null
    ]);
    const pgR = primaryGoal(goalsR), foR = pgR && window.JMGoals ? JMGoals.FOCUS[pgR.focus] : null;
    const focusBox = foR ? `<section class="card focus-card"><div class="row gap wrap"><b class="grow">Enfoque: ${esc(foR.l)} <span class="pill">${esc(foR.tag)}</span></b><a class="small" href="#/cliente/${c.id}/progreso">Objetivo</a></div>
      <p class="small">🏋️ ${esc(foR.train)}</p><p class="small muted">🍽️ ${esc(foR.diet)}</p><p class="small muted">Lo marca el objetivo principal: «${esc(pgR.title)}».</p></section>` : '';
    if (!S.exercises.length) await loadExercises();
    S.weekSel = S.weekSel || {};
    const prog = programs.filter(p => p.status !== 'archived').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
    const pweeks = prog ? weeks.filter(w => w.program_id === prog.id).sort((a, b) => a.week_no - b.week_no) : [];
    const wantFixed = S.weekSel[c.id] === 'fixed';
    const view = prog && !wantFixed ? (pweeks.find(w => w.id === S.weekSel[c.id]) || pweeks[pweeks.length - 1] || null) : null;
    const fixed = allRoutines.filter(r => !r.program_week_id);
    const routines = allRoutines.filter(r => (view ? r.program_week_id === view.id : !r.program_week_id));
    // solo los ejercicios de la semana que se ve (y de la anterior, para comparar el volumen): con muchos mesociclos no se carga todo
    const pwPrev = view ? pweeks.find(w => w.week_no === view.week_no - 1) : null;
    const needIds = routines.map(r => r.id).concat(pwPrev ? allRoutines.filter(r => r.program_week_id === pwPrev.id).map(r => r.id) : []);
    const items = needIds.length ? await DB.list('routine_items', { in: { routine_id: needIds }, order: ['position', 'asc'] }) : [];
    const live = currentWeek(pweeks, prog ? [prog] : []);
    const laterDrafts = view ? pweeks.filter(w => w.week_no > view.week_no).length : 0;
    const lastW = pweeks[pweeks.length - 1];
    const mesoEnd = !!(prog && prog.meso_weeks && lastW && ((live && live.id === lastW.id) || addDays(lastW.start_date, 7) <= today()));
    routines.sort((a, b) => (a.day || 9) - (b.day || 9) || a.position - b.position);
    const progBox = !prog
      ? `<section class="card prog-card"><div class="row gap wrap"><span class="grow"><b>Planificación por bloques</b><small class="muted"><b>Mesociclo</b>: 4 o 6 semanas con la progresión proyectada y descarga automática al final. <b>Programa abierto</b>: creas cada semana a mano (copia, progresión o descarga).</small></span>
          <button class="btn small primary" data-meso ${fixed.length ? '' : 'disabled title="Crea antes alguna rutina"'}>${ic('plus')} Crear mesociclo</button>
          <button class="btn small ghost" data-newprog ${fixed.length ? '' : 'disabled'}>Programa abierto</button></div></section>`
      : `<section class="card prog-card">
          <div class="row gap wrap"><span class="grow"><b>${esc(prog.name)}</b>${prog.meso_weeks ? ` <span class="pill">Mesociclo · ${Math.max(prog.meso_weeks, pweeks.length)} semanas</span>` : ''}<small class="muted">${pweeks.length} semana${pweeks.length === 1 ? '' : 's'} · ${live ? 'el cliente ve ahora la ' + esc(weekLabel(live)) + (prog.meso_weeks ? ` (${live.week_no}/${Math.max(prog.meso_weeks, pweeks.length)})` : '') : 'el cliente ve sus rutinas fijas hasta que publiques una semana ya empezada'}</small></span>
            <button class="btn small ${mesoEnd ? 'primary' : 'ghost'}" data-meso>${ic('plus')} ${prog.meso_weeks ? 'Siguiente mesociclo' : 'Nuevo mesociclo'}</button>
            ${prog.meso_weeks && pweeks[0] && pweeks[0].start_date >= mondayOf(today()) ? `<button class="btn small ghost" data-delaymeso title="Empezar el mesociclo una semana más tarde">${ic('clock')} Retrasar 1 semana</button>` : ''}
            ${prog.meso_weeks ? `<button class="btn small ghost danger" data-delmeso title="Quitar este mesociclo">${ic('trash')} Quitar</button>` : ''}</div>
          ${mesoEnd ? `<p class="note small">${live && live.kind === 'deload' ? 'Está en la semana de descarga: ' : 'El bloque ha terminado: '}prepara el siguiente mesociclo para que no se quede sin plan.</p>` : ''}
          ${prog.meso_weeks ? `<div class="meso-line">${pweeks.map(w => `<span class="${w.kind === 'deload' ? 'dl' : ''} ${live && live.id === w.id ? 'now' : ''} ${live && w.week_no < live.week_no ? 'past' : ''}" title="${esc(weekLabel(w))}">${w.kind === 'deload' ? 'Descarga' : 'Carga ' + pweeks.filter(x => x.week_no <= w.week_no && x.kind !== 'deload').length}</span>`).join('')}</div>`
            : `<label class="check"><input type="checkbox" data-auto ${prog.auto_repeat !== false ? 'checked' : ''}> Repetir sola cada semana con los pesos que hizo <small class="muted">(si no has preparado la siguiente)</small></label>`}
          <div class="wkchips">${pweeks.map(w => `<button type="button" class="wkchip ${view && view.id === w.id ? 'on' : ''} ${w.published ? 'pub' : ''} k-${w.kind || 'normal'} ${w.kind === 'deload' ? 'deload' : ''}" data-wk="${w.id}" title="${w.published ? 'Publicada' : 'Borrador'} · ${(KINDS[w.kind] || KINDS.normal)[0]}">S${w.week_no}${KINDS[w.kind] && KINDS[w.kind][1] ? ' ' + KINDS[w.kind][1] : ''}<i></i></button>`).join('')}<button type="button" class="wkchip fixedchip ${view ? '' : 'on'}" data-wk="fixed">Fijas</button></div>
          ${view ? `<div class="row gap wrap wkbar"><span class="grow"><b>${esc(weekLabel(view))}</b> <small class="muted">${fmtDate(view.start_date)} – ${fmtDate(addDays(view.start_date, 6))}</small> <span class="pill ${view.published ? 'green' : 'amber'}">${view.published ? 'Publicada' : 'Borrador'}</span></span>
              <label class="wkkind">Tipo<select data-kind>${['normal', 'maintenance', 'deload', 'intensity'].map(k => `<option value="${k}" ${(view.kind || 'normal') === k ? 'selected' : ''}>${KINDS[k][0]}</option>`).join('')}</select></label>
              <button class="btn small ${view.published ? 'ghost' : 'primary'}" data-pub>${view.published ? 'Ocultar al cliente' : 'Publicar'}</button>
              <button class="btn small" data-clone>${ic('copy')} Crear semana ${Math.max(...pweeks.map(w => w.week_no)) + 1}</button>
              ${!view.published && view.week_no === pweeks[pweeks.length - 1].week_no && pweeks.length > 1 ? `<button class="icon-btn danger" data-delwk title="Eliminar esta semana">${ic('trash')}</button>` : ''}</div>`
            : `<p class="muted small">Rutinas fijas: el cliente solo las ve mientras no haya ninguna semana publicada en curso.</p>`}
        </section>`;
    const week = [1, 2, 3, 4, 5, 6, 7].map(d => { const r = routines.filter(x => x.day === d); return `<div class="wday ${r.length ? 'has' : ''}"><small>${DIAS_C[d]}</small>${r.map(x => `<span>${esc(x.name)}</span>`).join('') || '<em>—</em>'}</div>`; }).join('');
    box.innerHTML = `${c.is_template ? '' : focusBox + progBox}
      <div class="week">${week}</div>
      ${window.JMLoad ? (() => { const ids = new Set(routines.map(r => r.id)); const pw = view ? pweeks.find(w => w.week_no === view.week_no - 1) : null;
        const prevIds = pw ? new Set(allRoutines.filter(r => r.program_week_id === pw.id).map(r => r.id)) : null;
        return JMLoad.weekVolume(items.filter(i => ids.has(i.routine_id)), prevIds ? items.filter(i => prevIds.has(i.routine_id)) : null, S.exercises, { label: view ? weekLabel(view) : 'rutinas fijas' }); })() : ''}
      <div class="row gap wrap"><button class="btn primary" data-add>${ic('plus')} Nueva rutina</button>${view || c.is_template ? '' : `<button class="btn ghost" data-copyall>${ic('copy')} Copiar plan o plantilla</button>`}${!c.is_template && routines.length ? `<button class="btn ghost" data-savetpl>${ic('copy')} Guardar como plantilla</button>` : ''}</div>
      ${routines.length > 1 ? `<div class="row gap r-tog"><button type="button" class="btn small ghost" data-ropen="1">Desplegar todas</button><button type="button" class="btn small ghost" data-ropen="0">Plegar todas</button></div>` : ''}
      <div class="routines">${routines.map(r => {
        const its = items.filter(i => i.routine_id === r.id), names = its.map(i => i.exercise_name);
        return `<details class="card routine r-fold" data-rk="${esc(r.name)}" ${S.rOpen && S.rOpen.has(c.id + '|' + r.name) ? 'open' : ''}>
          <summary><span class="r-chev">${ic('back')}</span><div class="grow"><b>${esc(r.name)}</b><small>${r.day ? DIAS[r.day] : 'Día libre'} · ${its.length} ejercicios${r.prio_muscles && r.prio_muscles.length ? ` · prioridad: ${esc(r.prio_muscles.join(', '))}` : ''}</small><small class="r-names">${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ` y ${names.length - 3} más` : ''}</small></div>
            <button class="icon-btn" data-dup="${r.id}" title="Duplicar en otro cliente">${ic('copy')}</button>
            <button class="btn small" data-edit="${r.id}">${ic('edit')}<span>Editar</span></button></summary>
          ${r.notes ? `<p class="note">${nl2br(r.notes)}</p>` : ''}
          <ol class="ex-list">${its.map(i => `<li><b>${esc(i.exercise_name)}</b><span>${i.sets} × ${esc(i.reps)}${loadLabel(i) ? ' · ' + esc(loadLabel(i)) : ''} · ${i.rest_sec}" desc.${progKey(i.progression) !== 'none' ? ' · ↑ ' + esc((PROG_RULES.find(p => p[0] === progKey(i.progression)) || [0, progKey(i.progression)])[1]) : ''}${schemeLabel(i.progression) ? ' · ' + esc(schemeLabel(i.progression)) : ''}</span>${i.notes ? `<small>${esc(i.notes)}</small>` : ''}</li>`).join('') || '<li class="empty">Sin ejercicios todavía</li>'}</ol>
        </details>`;
      }).join('') || `<p class="empty">${view ? 'Esta semana no tiene rutinas.' : 'Este cliente aún no tiene rutinas. Crea la primera.'}</p>`}</div>`;
    const opts = { week: view, laterDrafts };
    // rutinas plegadas: se recuerda cuáles abriste (por nombre, así sigue igual al cambiar de semana)
    S.rOpen = S.rOpen || new Set();
    box.querySelectorAll('details.r-fold').forEach(d => {
      d.addEventListener('toggle', () => { const k = c.id + '|' + d.dataset.rk; if (d.open) S.rOpen.add(k); else S.rOpen.delete(k); });
      d.querySelectorAll('summary button').forEach(b => b.addEventListener('click', e => e.preventDefault()));
    });
    box.querySelectorAll('[data-ropen]').forEach(b => b.onclick = () => box.querySelectorAll('details.r-fold').forEach(d => { d.open = b.dataset.ropen === '1'; }));
    box.querySelector('[data-add]').onclick = () => routineEditor(c, null, [], opts);
    box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const r = byId(routines, b.dataset.edit); routineEditor(c, r, items.filter(i => i.routine_id === r.id), opts); });
    box.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => duplicateRoutines(c, [byId(routines, b.dataset.dup)], items));
    const ca = box.querySelector('[data-copyall]'); if (ca) ca.onclick = () => copyPlanFrom(c);
    const st = box.querySelector('[data-savetpl]'); if (st) st.onclick = () => saveAsTemplate(c, routines, items);
    const np = box.querySelector('[data-newprog]'); if (np) np.onclick = () => newProgram(c, fixed.length);
    const ms = box.querySelector('[data-meso]'); if (ms) ms.onclick = () => mesoForm(c, { after: () => tabRoutines(c, box) });
    const dly = box.querySelector('[data-delaymeso]'); if (dly) dly.onclick = () => delayMeso(c, prog, pweeks, weeks, () => { S.weekSel[c.id] = null; tabRoutines(c, box); });
    const dms = box.querySelector('[data-delmeso]'); if (dms) dms.onclick = () => deleteMeso(c, prog, pweeks, allRoutines, () => { S.weekSel[c.id] = null; tabRoutines(c, box); });
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
      const kd = box.querySelector('[data-kind]');
      kd.onchange = async () => {
        const k = kd.value;
        const msg = { normal: 'Vuelve a lo pautado (series, RIR y cargas originales).', maintenance: 'Se mantiene lo pautado, sin subir cargas ni apretar el RIR.',
          deload: 'Baja al 60 % las series, mantiene las cargas y pone RIR 2 (si ya era más alto, lo deja). Puedes volver atrás cuando quieras.',
          intensity: 'Acerca el RIR 1 punto al fallo y sube la carga en los ejercicios donde la semana anterior llegó al tope del rango con el RIR pedido.' }[k];
        if (!(await confirmBox(`${weekLabel(view)} → ${KINDS[k][0]}. ${msg}`, 'Aplicar'))) { kd.value = view.kind || 'normal'; return; }
        await safe(() => DB.rpc('set_week_kind', { p_week: view.id, p_kind: k }), `Semana ${view.week_no}: ${KINDS[k][0].toLowerCase()}`);
        tabRoutines(c, box);
      };
      const dw = box.querySelector('[data-delwk]');
      if (dw) dw.onclick = async () => {
        if (!(await confirmBox(`Se eliminará la ${weekLabel(view)} (borrador) con sus rutinas.`))) return;
        await safe(() => DB.remove('program_weeks', view.id), 'Semana eliminada'); S.weekSel[c.id] = null; tabRoutines(c, box);
      };
    }
  }

  function newProgram(c, n, start) {
    modal('Nuevo programa por semanas', `<p class="muted">Se copiarán las ${n} rutinas fijas de ${esc(c.name)} a la semana 1, en borrador. Las fijas no se borran: el cliente las seguirá viendo hasta que publiques la semana 1.</p>
      <label>Nombre<input name="name" required value="Bloque 1" placeholder="Ej: Hipertrofia otoño"></label>
      <label>Empieza la semana del<input name="start" type="date" required value="${start || today()}"></label>
      <p class="muted small">Tip: en cada ejercicio elige su «Progresión» (p. ej. +2,5 kg) para que las semanas siguientes suban solas.</p>`, {
      submitLabel: 'Crear programa', onSubmit: async (f, fd) => {
        if (!fd.get('start')) { toast('Elige la fecha de inicio', 'err'); return false; }
        await safe(() => DB.rpc('create_program_from_routines', { p_client: c.id, p_name: String(fd.get('name')).trim() || 'Programa', p_start: fd.get('start') }), 'Programa creado: semana 1 en borrador');
        S.weekSel = S.weekSel || {}; S.weekSel[c.id] = null; render();
      }
    });
  }

  // ----- Objetivos S.M.A.R.T. (objetivos.js + migración 013)
  const mesoOf = (progs, weeks) => { const p = (progs || []).filter(x => x.status !== 'archived' && x.meso_weeks).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]; return p ? { start: p.start_date, weeks: p.meso_weeks } : null; };
  const loadGoals = cid => DB.list('goals', { eq: { client_id: cid }, order: ['created_at', 'desc'] }).catch(() => null);
  const primaryGoal = gs => (gs || []).filter(g => g.status === 'active').sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  // Historial de un cliente (último año). Las mismas opciones en todas partes: así la caché de lecturas se comparte
  // entre Progreso, Rutinas y Objetivos. Con 4-5 entrenos/semana son ~5.000 series al año: se traen por páginas.
  const yearAgo = () => new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const clientLogs = cid => DB.list('set_logs', { eq: { client_id: cid }, gte: { created_at: yearAgo() }, order: ['created_at', 'desc'], limit: 6000 });
  const clientSessions = cid => DB.list('sessions', { eq: { client_id: cid }, gte: { started_at: yearAgo() }, order: ['started_at', 'desc'], limit: 400 });
  async function goalData(c, need) {
    const [checkins, daily, logs, sessions] = await Promise.all([
      DB.list('checkins', { eq: { client_id: c.id }, order: ['date', 'desc'], limit: 120 }).catch(() => []),
      DB.list('daily_metrics', { eq: { client_id: c.id }, order: ['date', 'asc'] }).catch(() => []),
      need === 'e1rm' || need === 'all' ? clientLogs(c.id).catch(() => []) : [],
      need === 'e1rm' || need === 'all' ? clientSessions(c.id).catch(() => []) : []]);
    return { checkins, daily, logs, sessions };
  }
  function goalForm(c, { goal = null, preset = null, data, goals = [], after, meso = null }) {
    const G = window.JMGoals, M = G.METRICS, F = G.FOCUS;
    const exs = [...new Set((data.logs || []).filter(l => +l.weight > 0).map(l => String(l.exercise_name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const curOf = (m, ex) => { const s = G.series(m, data, ex); return G.valueAt(m, s, today()); };
    const progs = meso;
    const g0 = goal || Object.assign({ metric: 'weight', start_date: progs && progs.start && progs.start >= addDays(today(), -6) ? progs.start : today(), block_weeks: (progs && progs.weeks) || 4, is_primary: !goals.some(x => x.status === 'active' && x.is_primary) }, preset || {});
    const startV = goal ? goal.start_value : preset && preset.start_value != null ? preset.start_value : curOf('weight');
    const f = modal(goal ? 'Editar objetivo' : 'Nuevo objetivo S.M.A.R.T.', `
      <div class="smart-steps"><span><b>S</b>pecífico</span><span><b>M</b>edible</span><span><b>A</b>lcanzable</span><span><b>R</b>elevante</span><span><b>T</b>emporal</span></div>
      <fieldset class="smart"><legend><b>S·M</b> ¿Qué vas a conseguir y cómo se mide?</legend>
        <div class="form-grid">
          <label>Métrica<select name="metric">${Object.entries(M).map(([k, m]) => `<option value="${k}" ${g0.metric === k ? 'selected' : ''}>${m.l}</option>`).join('')}</select></label>
          <label data-ex>Ejercicio<input name="exercise_name" list="gl-exs" maxlength="120" value="${esc(g0.exercise_name || '')}" placeholder="Ej: Peso muerto"><datalist id="gl-exs">${exs.map(e => `<option value="${esc(e)}">`).join('')}</datalist></label>
          <label>Valor actual <small class="muted" data-unit></small><input name="start_value" type="number" step="0.1" min="0" inputmode="decimal" required value="${startV != null ? Math.round(startV * 10) / 10 : ''}"></label>
          <label>Objetivo <small class="muted" data-unit></small><input name="target_value" type="number" step="0.1" min="0" inputmode="decimal" required value="${g0.target_value != null ? g0.target_value : ''}"></label>
        </div><p class="muted small" data-src></p>
        <div data-rates hidden><small class="muted">Ritmo (calcula el objetivo con su peso y la fecha límite)</small>
          <div class="rate-chips">${G.RATES.filter(r => r.s).map(r => `<button type="button" class="chip" data-rate="${r.k}" title="${esc(r.txt)}">${esc(r.l)}<small>${esc(r.txt.replace(' del peso/sem', ''))}</small></button>`).join('')}</div>
          <label class="check"><input type="checkbox" name="to_ficha" checked> Poner este ritmo en su ficha («Ritmo buscado»)</label></div></fieldset>
      <fieldset class="smart"><legend><b>T</b> ¿Para cuándo?</legend><div class="form-grid">
        <label>Empieza<input name="start_date" type="date" required value="${esc(g0.start_date)}"></label>
        <label>Fecha límite<input name="deadline" type="date" required value="${esc(g0.deadline || addDays(g0.start_date, (g0.block_weeks || 4) * 7 * 3))}"></label>
        <label>Micro-objetivos cada<select name="block_weeks"><option value="4" ${+g0.block_weeks === 4 ? 'selected' : ''}>4 semanas</option><option value="6" ${+g0.block_weeks === 6 ? 'selected' : ''}>6 semanas</option></select></label>
      </div><p class="muted small">Los bloques coinciden con los mesociclos${progs ? ` (el actual empieza el ${fmtDate(progs.start)})` : ''}: un hito al final de cada uno.</p></fieldset>
      <fieldset class="smart"><legend><b>R</b> ¿Por qué es importante?</legend>
        <label>Enfoque <small class="muted">marca las pautas de las rutinas</small><select name="focus">${Object.entries(F).map(([k, x]) => `<option value="${k}" ${g0.focus === k ? 'selected' : ''}>${x.l}</option>`).join('')}</select></label>
        <label>Motivo<textarea name="why" rows="2" maxlength="1000" placeholder="Ej: competir en −86 kg en febrero; sentirme más ágil en el BJJ">${esc(g0.why || '')}</textarea></label>
        <label class="check"><input type="checkbox" name="is_primary" ${g0.is_primary ? 'checked' : ''}> Objetivo principal (sale en el inicio y guía las rutinas)</label>
        <label>🎁 Premio al conseguirlo <small class="muted">opcional; se desbloquea al llegar al 100 %</small><input name="reward" maxlength="200" value="${esc(g0.reward || '')}" placeholder="Ej: camiseta TEAM JMFIT, sesión de técnica gratis, comida libre"></label></fieldset>
      <div class="smart-a"><b>A · ¿Es alcanzable?</b><ul data-val></ul></div>
      <div class="smart-prev" data-prev></div>
      <label class="check" data-force hidden><input type="checkbox" name="force"> Lo hemos hablado y aun así lo queremos así</label>`, {
      submitLabel: goal ? 'Guardar' : 'Crear objetivo',
      onSubmit: async (form, fd) => {
        const g = read(fd), v = G.validate(g, { cur: g.metric === 'e1rm' ? curOf('e1rm', g.exercise_name) : null });
        const bad = v.filter(x => x.lv === 'bad');
        if (bad.some(x => !/extremo|demasiado|poco realista|agresivo|rápido/.test(x.t))) { toast(bad[0].t, 'err'); return false; }
        if (bad.length && !fd.get('force')) { toast('El objetivo no parece realista: ajústalo o marca que lo habéis hablado', 'err'); return false; }
        const row = Object.assign(g, { client_id: c.id, title: G.title(g) });
        if (row.metric !== 'e1rm') row.exercise_name = null;
        if (row.metric === 'weight' && fd.get('to_ficha')) {
          const wk = Math.max(1, (new Date(row.deadline + 'T12:00:00') - new Date(row.start_date + 'T12:00:00')) / (7 * 864e5)), kgw = Math.round((row.target_value - row.start_value) / wk * 100) / 100;
          if (Math.abs(kgw) <= 2) await DB.update('clients', c.id, { weekly_target: kgw }).then(() => { c.weekly_target = kgw; }).catch(e => console.warn(e));
        }
        await safe(async () => {
          if (row.is_primary) for (const x of goals.filter(x => x.is_primary && x.status === 'active' && (!goal || x.id !== goal.id))) await DB.update('goals', x.id, { is_primary: false });
          if (goal) await DB.update('goals', goal.id, row); else await DB.insert('goals', Object.assign({ status: 'active' }, row));
        }, goal ? 'Objetivo guardado' : 'Objetivo creado 🎯');
        return after && after();
      }
    });
    function read(fd) {
      const n = k => num(String(fd.get(k) || '').replace(',', '.'));
      return { metric: fd.get('metric'), exercise_name: String(fd.get('exercise_name') || '').trim() || null, start_value: n('start_value'), target_value: n('target_value'),
        start_date: fd.get('start_date'), deadline: fd.get('deadline'), block_weeks: +fd.get('block_weeks') || 4, focus: fd.get('focus'), why: String(fd.get('why') || '').trim() || null, is_primary: !!fd.get('is_primary'), reward: String(fd.get('reward') || '').trim() || null };
    }
    let lastMetric = g0.metric, lastEx = g0.exercise_name || '', focusTouched = !!goal || !!(preset && preset.focus);
    f.querySelector('[name=focus]').addEventListener('change', () => { focusTouched = true; });
    const draw = () => {
      const fd = new FormData(f), g = read(fd), m = M[g.metric];
      f.querySelectorAll('[data-unit]').forEach(e => { e.textContent = '(' + m.u + ')'; });
      f.querySelector('[data-ex]').hidden = g.metric !== 'e1rm';
      // al cambiar de métrica o de ejercicio, el valor actual sale de sus datos
      if (!goal && (g.metric !== lastMetric || (g.metric === 'e1rm' && (g.exercise_name || '') !== lastEx))) {
        const cv = curOf(g.metric, g.exercise_name); f.querySelector('[name=start_value]').value = cv != null ? Math.round(cv * 10) / 10 : '';
        lastMetric = g.metric; lastEx = g.exercise_name || ''; g.start_value = cv;
      }
      const cv = curOf(g.metric, g.exercise_name);
      f.querySelector('[data-src]').textContent = `Se mide con: ${m.src}.${cv != null ? ` Último dato: ${G.nf(cv)} ${m.u}.` : ' Aún no hay datos: empezará a contar con el próximo registro.'}`;
      if (!focusTouched && g.start_value && g.target_value) f.querySelector('[name=focus]').value = G.autoFocus(g.metric, g.start_value, g.target_value);
      const v = G.validate(g, { cur: g.metric === 'e1rm' ? cv : null });
      f.querySelector('[data-val]').innerHTML = v.map(x => `<li class="${x.lv}">${esc(x.t)}</li>`).join('') || '<li class="ok">Todo en orden.</li>';
      f.querySelector('[data-force]').hidden = !v.some(x => x.lv === 'bad' && /extremo|demasiado|poco realista|agresivo|rápido/.test(x.t));
      const ok = g.start_value > 0 && g.target_value > 0 && g.start_value !== g.target_value && g.deadline > g.start_date;
      const fo = F[fd.get('focus')] || F.health;
      f.querySelector('[data-prev]').innerHTML = ok ? `<p><b>🎯 ${esc(G.title(g))}</b></p><p class="small muted">Enfoque «${esc(fo.l)}»: ${esc(fo.train)}</p>
        <ol class="gl-blocks">${G.blocks(g).map(b => `<li><span>Bloque ${b.i} · hasta el ${G.fd(b.to)}</span><b>${G.nf(b.target)} ${m.u}</b></li>`).join('')}</ol>` : '';
    };
    f.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => {
      const g = read(new FormData(f)); if (!(g.start_value > 0)) { toast('Pon antes el peso actual', 'err'); return; }
      const wk = Math.max(1, (new Date(g.deadline + 'T12:00:00') - new Date(g.start_date + 'T12:00:00')) / (7 * 864e5));
      f.querySelector('[name=target_value]').value = Math.round((g.start_value + G.rateKg(b.dataset.rate, g.start_value) * wk) * 10) / 10;
      f.querySelectorAll('[data-rate]').forEach(x => x.classList.toggle('on', x === b)); draw();
    });
    const drawRates = () => {
      const g = read(new FormData(f)), box = f.querySelector('[data-rates]'); box.hidden = g.metric !== 'weight';
      if (g.metric !== 'weight' || !(g.start_value > 0) || !(g.target_value > 0) || !(g.deadline > g.start_date)) return;
      const wk = (new Date(g.deadline + 'T12:00:00') - new Date(g.start_date + 'T12:00:00')) / (7 * 864e5), b = G.rateBand((g.target_value - g.start_value) / wk, g.start_value);
      f.querySelectorAll('[data-rate]').forEach(x => x.classList.toggle('on', !!b && x.dataset.rate === b.k));
    };
    f.addEventListener('input', drawRates); f.addEventListener('change', drawRates); drawRates();
    f.addEventListener('input', draw); f.addEventListener('change', draw); draw();
  }
  // Tarjeta de un objetivo con anillo, estado, medallas y micro-objetivos
  function goalCard(g, data, { big = false, actions = true, compact = false } = {}) {
    const G = window.JMGoals, m = G.METRICS[g.metric], p = G.progress(g, data), fo = G.FOCUS[g.focus];
    return `<article class="gl-card st-${p.st[0]} ${big ? 'big' : ''}" data-goal="${g.id}">
      <div class="gl-top">${G.ring(p.pct, p.st[0] === 'done' ? 1 : p.exp, 'st-' + p.st[0], compact ? 88 : big ? 104 : 84)}
        <div class="grow"><b>${esc(g.title)}</b>
          ${compact ? `<small class="gl-st">${esc(p.st[1])}${p.daysLeft > 0 && p.st[0] !== 'done' ? ` · quedan ${p.daysLeft} días` : ''}</small>
          <p class="gl-now">Ahora <b>${p.cur != null ? G.nf(p.cur) + ' ' + m.u : '–'}</b><span>→</span>meta <b>${G.nf(+g.target_value)} ${m.u}</b></p>
          ${g.why ? `<p class="small muted">«${esc(g.why)}»</p>` : ''}</div></div>` : `<small><span class="pill">${esc(fo ? fo.tag : 'Objetivo')}</span>${g.is_primary ? ' <span class="pill green">Principal</span>' : ''} ${esc(p.st[1])}${p.daysLeft > 0 && p.st[0] !== 'done' ? ` · quedan ${p.daysLeft} días` : ''}</small>
          <p class="small">Ahora <b>${p.cur != null ? G.nf(p.cur) + ' ' + m.u : 'sin datos'}</b> · a estas alturas tocaría ${G.nf(p.expected)} ${m.u} · meta ${G.nf(+g.target_value)} ${m.u}</p>
          ${g.why ? `<p class="small muted">«${esc(g.why)}»</p>` : ''}</div></div>`}
      <div class="gl-badges">${G.badges(p.pct)}</div>
      ${g.reward ? `<p class="gl-reward ${p.st[0] === 'done' ? 'on' : ''}">${p.st[0] === 'done' ? `🎁 <b>¡Premio desbloqueado!</b> ${esc(g.reward)}` : `🔒 Premio al conseguirlo: <b>${esc(g.reward)}</b> <small>(${Math.round(p.pct * 100)} %)</small>`}</p>` : ''}
      ${compact && p.blocks.length ? `<details class="gl-more"><summary>Micro-objetivos por bloque (${p.blocks.length})</summary>` : ''}<ol class="gl-blocks">${p.blocks.map(b => `<li class="${b.now ? 'now' : ''} ${b.hit === true ? 'hit' : b.hit === false ? 'miss' : ''}"><span>${b.now ? '▶ ' : ''}Bloque ${b.i} · hasta el ${G.fd(b.to)}</span><b>${G.nf(b.target)} ${m.u}</b><small>${b.hit === true ? '✓ ' + G.nf(b.value) : b.hit === false ? '✗ ' + G.nf(b.value) : b.now ? 'en curso' : ''}</small></li>`).join('')}</ol>${compact && p.blocks.length ? '</details>' : ''}
      ${actions ? `<div class="row gap wrap">${p.st[0] === 'done' && g.status !== 'done' ? `<button class="btn small primary" data-gdone="${g.id}">${ic('check')} Marcar conseguido</button>` : ''}<button class="btn small" data-gedit="${g.id}">${ic('edit')} Editar</button><button class="btn small ghost" data-gdrop="${g.id}">${g.status === 'active' ? 'Archivar' : 'Reactivar'}</button><button class="icon-btn danger" data-gdel="${g.id}" title="Borrar">${ic('trash')}</button></div>` : ''}
    </article>`;
  }
  async function goalsSection(c, box, data, goals, redraw, meso = null) {
    const el = box.querySelector('[data-goals]'); if (!el) return;
    if (goals === null) { el.innerHTML = ''; return; }
    if (!window.JMGoals) { el.innerHTML = ''; return; }
    const act = goals.filter(g => g.status === 'active'), old = goals.filter(g => g.status !== 'active');
    const sug = S.profile.role === 'coach' ? JMGoals.suggest(data, c, goals, (meso && meso.weeks) || 4) : [];
    const sugHtml = sug.length ? `<div class="gl-sug"><b>💡 Objetivos sugeridos por sus datos</b>${sug.map((g, i) => `<div class="gl-sug-row"><span class="grow"><b>${esc(g.title)}</b><small>${esc(g.why)} · ${esc((JMGoals.FOCUS[g.focus] || {}).tag || '')}</small></span><button class="btn small" data-gsug="${i}">${ic('plus')} Crear</button></div>`).join('')}</div>` : '';
    const isC = S.profile.role !== 'coach';
    // El cliente solo escribe su meta; el entrenador la convierte en objetivo S.M.A.R.T. (con premio si quiere)
    const req = c.goal_request ? String(c.goal_request) : '';
    const reqHtml = isC
      ? `<div class="gl-req">${req ? `<p><b>Tu meta enviada:</b> «${esc(req)}» <small class="muted">· ${ago(c.goal_request_at)}</small></p><p class="muted small">Jorge la convertirá en un objetivo con fechas y pasos. <button type="button" class="link" data-greqedit>Cambiarla</button></p>`
        : `<form class="gl-reqf" data-greqf><label>¿Cuál es tu meta?<input name="t" maxlength="500" required placeholder="Ej: perder 5 kg, hacer 10 dominadas, correr 10 km…"></label><button class="btn small primary">Enviar a Jorge</button></form>`}</div>`
      : req ? `<div class="gl-req coach"><p>📩 <b>Meta que propone ${esc(c.name)}:</b> «${esc(req)}» <small class="muted">· ${ago(c.goal_request_at)}</small></p>
          <div class="row gap wrap"><button class="btn small primary" data-greqmake>${ic('plus')} Convertir en objetivo S.M.A.R.T.</button><button class="btn small ghost" data-greqdrop>Descartar</button></div></div>` : '';
    el.innerHTML = `<section class="card"><header class="row gap"><h3 class="grow">${isC ? 'Mis objetivos' : 'Objetivos S.M.A.R.T.'}</h3>${isC ? '' : `<button class="btn small primary" data-gnew>${ic('plus')} Nuevo objetivo</button>`}</header>
      ${reqHtml}
      ${act.length ? act.map(g => goalCard(g, data, { compact: isC, actions: !isC })).join('') : `<p class="empty">${isC ? 'Aún no tienes objetivos activos.' : 'Sin objetivos activos. Define uno concreto, medible y con fecha: los micro-objetivos por bloque se crean solos.'}</p>`}
      ${sugHtml}
      ${old.length ? `<details><summary class="small">Anteriores (${old.length})</summary>${old.map(g => goalCard(g, data, { actions: !isC })).join('')}</details>` : ''}</section>`;
    const byG = id => goals.find(g => g.id === id);
    const setReq = async t => { await safe(() => DB.rpc('set_goal_request', { p_text: t }), t ? 'Meta enviada a Jorge' : null); c.goal_request = t || null; c.goal_request_at = t ? new Date().toISOString() : null; if (S.client && S.client.id === c.id) Object.assign(S.client, { goal_request: c.goal_request, goal_request_at: c.goal_request_at }); redraw(); };
    const rf = el.querySelector('[data-greqf]'); if (rf) rf.onsubmit = e => { e.preventDefault(); const t = String(rf.t.value || '').trim(); if (t) setReq(t); };
    const re = el.querySelector('[data-greqedit]'); if (re) re.onclick = () => modal('Cambiar mi meta', `<label>Tu meta<input name="t" maxlength="500" value="${esc(req)}"></label>`, { submitLabel: 'Enviar', onSubmit: (f, fd) => setReq(String(fd.get('t') || '').trim()) });
    const clearReq = () => DB.update('clients', c.id, { goal_request: null, goal_request_at: null }).then(() => { c.goal_request = null; c.goal_request_at = null; });
    const rm = el.querySelector('[data-greqmake]'); if (rm) rm.onclick = () => goalForm(c, { preset: { why: req }, data, goals, meso, after: async () => { await clearReq().catch(e => console.warn(e)); redraw(); } });
    const rd = el.querySelector('[data-greqdrop]'); if (rd) rd.onclick = async () => { if (await confirmBox('Se quitará la meta propuesta (no se crea ningún objetivo).', 'Descartar')) { await safe(clearReq, 'Meta descartada'); redraw(); } };
    const gn = el.querySelector('[data-gnew]'); if (gn) gn.onclick = () => goalForm(c, { data, goals, after: redraw, meso });
    el.querySelectorAll('[data-gsug]').forEach(b => b.onclick = () => { const g = Object.assign({}, sug[+b.dataset.gsug]); delete g.title; g.why = ''; goalForm(c, { preset: g, data, goals, after: redraw, meso }); });
    el.querySelectorAll('[data-gedit]').forEach(b => b.onclick = () => goalForm(c, { goal: byG(b.dataset.gedit), data, goals, after: redraw, meso }));
    el.querySelectorAll('[data-gdone]').forEach(b => b.onclick = async () => { await safe(() => DB.update('goals', b.dataset.gdone, { status: 'done', achieved_at: new Date().toISOString(), is_primary: false }), '¡Objetivo conseguido! 🏆'); redraw(); });
    el.querySelectorAll('[data-gdrop]').forEach(b => b.onclick = async () => { const g = byG(b.dataset.gdrop); await safe(() => DB.update('goals', g.id, g.status === 'active' ? { status: 'dropped', is_primary: false } : { status: 'active' }), g.status === 'active' ? 'Objetivo archivado' : 'Objetivo reactivado'); redraw(); });
    el.querySelectorAll('[data-gdel]').forEach(b => b.onclick = async () => { if (await confirmBox('Se borrará este objetivo.')) { await safe(() => DB.remove('goals', b.dataset.gdel), 'Objetivo borrado'); redraw(); } });
  }

  // ----- Quitar un mesociclo publicado (migración 017): las semanas con entrenos se conservan como historial
  async function deleteMeso(c, prog, pweeks, routines, after) {
    const ses = await clientSessions(c.id).catch(() => []);
    const trainedR = new Set(ses.map(x => x.routine_id)), trained = new Set(routines.filter(r => trainedR.has(r.id)).map(r => r.program_week_id));
    const x = new Date(today() + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); const mon = ymd(x);
    const fut = pweeks.filter(w => w.start_date >= mon && !trained.has(w.id)).length, all = pweeks.filter(w => !trained.has(w.id)).length;
    const kept = pweeks.filter(w => trained.has(w.id)).length;
    if (!all) { toast('Todas sus semanas tienen entrenos: no hay nada que quitar', 'err'); return; }
    modal('Quitar mesociclo', `<p>«<b>${esc(prog.name)}</b>» · ${pweeks.length} semanas.</p>
      <div class="choices">
        <label class="choice"><input type="radio" name="scope" value="future" ${fut ? 'checked' : 'disabled'}><span><b>Desde esta semana</b><small>Quita ${fut} semana${fut === 1 ? '' : 's'} (la actual y las siguientes) que aún no ha entrenado.</small></span></label>
        <label class="choice"><input type="radio" name="scope" value="all" ${fut ? '' : 'checked'}><span><b>Todo lo que no ha entrenado</b><small>Quita ${all} semana${all === 1 ? '' : 's'}, también las pasadas sin entrenos.</small></span></label>
      </div>
      <p class="muted small">${kept ? `Las ${kept} semana${kept === 1 ? '' : 's'} con entrenos se guardan como historial. ` : ''}El cliente vuelve a ver lo que tenía antes (su programa anterior o sus rutinas fijas). No se puede deshacer.</p>`, {
      submitLabel: 'Quitar mesociclo',
      onSubmit: async (f, fd) => {
        const n = await safe(() => DB.rpc('delete_mesocycle', { p_program: prog.id, p_scope: fd.get('scope') || 'future' }));
        toast(`Mesociclo quitado (${n || 0} semana${n === 1 ? '' : 's'})`, 'ok'); after && after();
      }
    });
  }

  // ----- Retrasar un mesociclo una semana y, si se quiere, meter antes una descarga (migración 020)
  async function delayMeso(c, prog, pweeks, allWeeks, after) {
    const w1 = pweeks[0]; if (!w1) return;
    const prev = (allWeeks || []).filter(w => w.program_id !== prog.id && w.start_date < w1.start_date).sort((a, b) => b.start_date.localeCompare(a.start_date) || b.week_no - a.week_no)[0];
    const end = addDays(pweeks[pweeks.length - 1].start_date, 7 + 6);
    modal('Retrasar mesociclo', `<p>«<b>${esc(prog.name)}</b>» empezará el <b>${fmtDate(addDays(w1.start_date, 7))}</b> en vez del ${fmtDate(w1.start_date)} (y terminará el ${fmtDate(end)}). Las cargas y la progresión no cambian.</p>
      <h4>Semana del ${fmtDate(w1.start_date)}</h4>
      <div class="choices">
        <label class="choice"><input type="radio" name="mode" value="prev" ${prev ? 'checked' : 'disabled'}><span><b>Descarga del bloque actual</b><small>${prev ? 'Sus rutinas de la última semana con 60 % de las series, mismas cargas y RIR 2.' : 'No hay un bloque anterior con rutinas.'}</small></span></label>
        <label class="choice"><input type="radio" name="mode" value="meso" ${prev ? '' : 'checked'}><span><b>Descarga con las rutinas del nuevo mesociclo</b><small>Las de su semana 1 en versión descarga: sirve para aprender los ejercicios nuevos.</small></span></label>
        <label class="choice"><input type="radio" name="mode" value="none"><span><b>Sin descarga</b><small>Solo lo mueve una semana (vacaciones, viaje…). Esa semana verá lo que tenía antes.</small></span></label>
      </div>
      <p class="muted small">Con descarga, el mesociclo pasa a tener ${pweeks.length + 1} semanas (la descarga queda como semana 1).</p>`, {
      submitLabel: 'Retrasar',
      onSubmit: async (f, fd) => {
        const m = fd.get('mode') || 'prev';
        await safe(() => DB.rpc('delay_mesocycle', { p_program: prog.id, p_deload: m !== 'none', p_source: m === 'none' ? 'prev' : m }),
          m === 'none' ? 'Mesociclo retrasado una semana' : 'Mesociclo retrasado: descarga la semana del ' + fmtDate(w1.start_date));
        after && after();
      }
    });
  }

  // ----- Mesociclo cerrado: 4 o 6 semanas, progresión proyectada y descarga final automática (meso.js + migración 012)
  async function mesoForm(c, { start = null, after = null } = {}) {
    if (!S.exercises.length) await loadExercises().catch(() => []);
    const [routines, items, programs, weeks, goalsM] = await Promise.all([
      DB.list('routines', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('routine_items', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('programs', { eq: { client_id: c.id } }), DB.list('program_weeks', { eq: { client_id: c.id } }), window.JMGoals ? loadGoals(c.id) : null]);
    const pgM = primaryGoal(goalsM), foM = pgM && window.JMGoals ? JMGoals.FOCUS[pgM.focus] : null, defProg = foM ? foM.prog : 'auto';
    const prog = programs.filter(p => p.status !== 'archived').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
    const pweeks = prog ? weeks.filter(w => w.program_id === prog.id).sort((a, b) => a.week_no - b.week_no) : [];
    const fixed = routines.filter(r => !r.program_week_id);
    const srcs = [];
    if (fixed.length) srcs.push(['', `Rutinas fijas (${fixed.length})`]);
    pweeks.forEach(w => { const n = routines.filter(r => r.program_week_id === w.id).length; if (n) srcs.push([w.id, `${prog.name} · ${weekLabel(w)} (${n})`]); });
    if (!srcs.length) { toast('Crea antes alguna rutina', 'err'); return; }
    const w1 = pweeks[0], lastAcc = pweeks.filter(w => w.kind !== 'deload').pop();
    const defSrc = prog && prog.meso_weeks && w1 && srcs.some(s => s[0] === w1.id) ? w1.id : lastAcc && srcs.some(s => s[0] === lastAcc.id) ? lastAcc.id : srcs[0][0];
    const mon = d => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
    const nextStart = pweeks.length ? addDays(pweeks[pweeks.length - 1].start_date, 7) : null;
    const st0 = start || (nextStart && nextStart >= mon(today()) ? nextStart : today());
    const nMeso = programs.filter(p => p.meso_weeks).length;
    const nf = x => String(Math.round(x * 100) / 100).replace('.', ',');
    const D = window.JMMeso.DEF;
    const f = modal('Nuevo mesociclo', `
      <p class="muted">Un bloque cerrado: semanas de carga con la progresión ya proyectada y una <b>descarga automática</b> al final. Se crea entero; luego puedes retocar cualquier semana.</p>
      <div class="form-grid">
        <label>Nombre<input name="name" required maxlength="60" value="Mesociclo ${nMeso + 1}"></label>
        <label>Empieza la semana del<input name="start" type="date" required value="${esc(st0)}"></label>
      </div>
      <div class="choices two">${[[4, '4 semanas', '3 de carga + descarga en la 4.ª'], [6, '6 semanas', '5 de carga + descarga en la 6.ª']].map(([v, t, d]) => `<label class="choice"><input type="radio" name="weeks" value="${v}" ${v === ((prog && prog.meso_weeks) || 4) ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>
      <div class="form-grid">
        <label>Parte de<select name="src">${srcs.map(([v, l]) => `<option value="${v}" ${v === defSrc ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label>Punto de partida<select name="offset"><option value="0">Igual que esas rutinas</option><option value="1" ${prog && prog.meso_weeks ? 'selected' : ''}>Un paso por encima (continuar el bloque anterior)</option></select></label>
        <label>Progresión en la carga<select name="prog">
          ${[['auto', 'Automática: +kg si tiene carga; si no, +reps'], ['load', 'Carga (kg)'], ['reps', 'Repeticiones'], ['sets', 'Series (+1 cada 2 semanas, máx. +2)'], ['none', 'Solo el RIR']].map(([v, l]) => `<option value="${v}" ${v === defProg ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Subida por semana<span class="row gap"><input name="inc_kg" type="number" step="0.25" min="0" max="20" value="${D.inc_kg}" aria-label="kg por semana"><small>kg</small><input name="inc_reps" type="number" step="1" min="0" max="5" value="${D.inc_reps}" aria-label="reps por semana"><small>reps</small></span></label>
      </div>
      ${foM ? `<p class="note small">Enfoque del objetivo principal: <b>${esc(foM.l)}</b>. ${esc(foM.train)}</p>` : ''}
      <div class="form-grid">
        <label>RIR en las semanas de carga<select name="rir_mode">
          <option value="range" selected>Rango (normal: de RIR 2 a RIR 1)</option><option value="routine">El de cada ejercicio, bajando hasta 1</option><option value="keep">El de cada ejercicio, sin cambios</option></select></label>
        <label data-rng>Rango<span class="row gap"><small>de RIR</small>${rirSel('rir_hi', 2)}<small>a</small>${rirSel('rir_lo', 1)}</span></label>
        <label>Tope de repeticiones<select name="rep_cap"><option value="1" selected>Subir como mucho +1 rep (p. ej. 8-10 → 9-11)</option><option value="2">Como mucho +2 reps</option><option value="">Sin tope</option></select>
          <small class="muted">Al llegar al tope se mantiene el rango y sube la carga.</small></label>
      </div>
      <fieldset class="prio-set"><legend>Músculos prioritarios <small class="muted">(opcional)</small></legend>
        <div class="prio-chips" data-prio></div>
        <div class="form-grid" data-prio-opts hidden>
          <label>RIR de los prioritarios<span class="row gap"><small>de</small>${rirSel('prio_rir_hi', 1)}<small>a</small>${rirSel('prio_rir_lo', 0)}</span></label>
          <label>Series de los prioritarios<select name="prio_sets">${[[0, 'Igual'], [1, '+1 por ejercicio'], [2, '+2 por ejercicio']].map(([v, l]) => `<option value="${v}" ${v === 1 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Series del resto<select name="other_sets">${[[0, 'Igual'], [-1, '−1 por ejercicio (mín. 1)']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label>RIR en la descarga<span class="row gap"><small>prioritarios</small>${rirSel('prio_dl_rir', 2)}<small>resto</small>${rirSel('dl_rir', 3)}</span></label>
        </div>
        <small class="muted" data-prio-hint>Elige los grupos que quieres priorizar en este bloque: más series y más cerca del fallo; el resto se mantiene.</small></fieldset>
      <fieldset class="deload-set"><legend>Semana de descarga</legend><div class="form-grid">
        <label>Menos volumen (series)<span class="row gap"><input name="dvol" type="number" min="0" max="80" step="5" value="${D.deload_vol * 100}"><small>%</small></span></label>
        <label>Menos intensidad (carga)<span class="row gap"><input name="dint" type="number" min="0" max="50" step="5" value="${D.deload_int * 100}"><small>%</small></span></label>
      </div><small class="muted" data-dlnote>Y RIR 2 en todas las series. Parte de la última semana de carga.</small></fieldset>
      <label class="check"><input type="checkbox" name="publish" checked> Publicar ya las semanas (el cliente ve cada una cuando llega)</label>
      <div data-prev class="meso-prev"></div>
      <p class="note small" data-warn hidden></p>
      ${pweeks.length ? `<p class="muted small">«${esc(prog.name)}» deja de repetirse sola y se quitan sus semanas desde la fecha de inicio que aún no se han entrenado. Lo entrenado se conserva.</p>` : ''}
      <p class="muted small">Los ejercicios con su propia regla de progresión (p. ej. +2,5 kg) la mantienen.</p>`, {
      submitLabel: 'Crear mesociclo',
      onSubmit: async (form, fd) => {
        const o = opts(fd), n = +fd.get('weeks');
        if (!fd.get('start')) { toast('Elige la fecha de inicio', 'err'); return false; }
        await safe(() => DB.rpc('create_mesocycle', { p_client: c.id, p_name: String(fd.get('name') || '').trim() || 'Mesociclo', p_start: fd.get('start'), p_weeks: n, p_opts: o, p_from_week: fd.get('src') || null }),
          `Mesociclo creado: ${n - 1} semanas de carga + descarga`);
        S.weekSel = S.weekSel || {}; S.weekSel[c.id] = null;
        return after ? after() : render();
      }
    });
    function rirSel(name, def) { return `<select name="${name}" aria-label="RIR">${[0, 1, 2, 3, 4].map(v => `<option value="${v}" ${v === def ? 'selected' : ''}>${v === 0 ? 'Fallo (0)' : v}</option>`).join('')}</select>`; }
    // ejercicios de las rutinas de partida y su grupo muscular principal
    const srcItems = src => routines.filter(r => (src ? r.program_week_id === src : !r.program_week_id)).sort((a, b) => (a.day || 9) - (b.day || 9) || a.position - b.position)
      .flatMap(r => items.filter(i => i.routine_id === r.id).sort((a, b) => a.position - b.position));
    const mOf = it => { const m = window.JMLoad && JMLoad.muscleOf ? JMLoad.muscleOf(it.exercise_name, S.exercises)[0] : null; return m && !/^(sin grupo|movilidad|cardio|estiramiento|calentamiento)$/i.test(m) ? m : null; };
    function opts(fd) {
      const pct = (v, mx) => Math.max(0, Math.min(mx, +v || 0)) / 100, mode = fd.get('rir_mode') || 'range';
      const pm = new Set(fd.getAll('prio_m')), prio = pm.size ? srcItems(fd.get('src') || null).filter(it => pm.has(mOf(it))).map(it => it.id) : [];
      const o = { offset: +fd.get('offset') || 0, prog: fd.get('prog'), inc_kg: Math.max(0, +fd.get('inc_kg') || 0), inc_reps: Math.max(0, Math.round(+fd.get('inc_reps') || 0)),
        rir_mode: mode, rir_ramp: mode === 'routine', deload_vol: pct(fd.get('dvol'), 80), deload_int: pct(fd.get('dint'), 50), publish: !!fd.get('publish'),
        weeks: Array.from({ length: +fd.get('weeks') || 4 }, (_, k) => { const r = fd.get('wr' + k), z = +fd.get('ws' + k) || 0; return Object.assign({}, r != null && r !== '' ? { rir: +r } : {}, z ? { sets: z } : {}); }) };
      if (mode === 'range') { o.rir_hi = +fd.get('rir_hi'); o.rir_lo = Math.min(+fd.get('rir_lo'), o.rir_hi); }
      if (fd.get('rep_cap') !== '' && fd.get('rep_cap') != null) o.rep_cap = +fd.get('rep_cap');
      if (prio.length) {
        o.prio = prio; o.prio_muscles = [...pm];
        o.prio_rir_hi = +fd.get('prio_rir_hi'); o.prio_rir_lo = Math.min(+fd.get('prio_rir_lo'), o.prio_rir_hi);
        o.prio_sets = +fd.get('prio_sets') || 0; o.other_sets = +fd.get('other_sets') || 0; o.prio_dl_rir = +fd.get('prio_dl_rir'); o.dl_rir = +fd.get('dl_rir');
      }
      return o;
    }
    let prioKey = null;
    const draw = () => {
      const fd0 = new FormData(f), src = fd0.get('src') || null, its = srcItems(src);
      // grupos musculares de la semana de partida (se mantienen los marcados al cambiar de origen)
      const ms = [...new Set(its.map(mOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), key = ms.join('|');
      if (key !== prioKey) { prioKey = key; const on = new Set(fd0.getAll('prio_m'));
        f.querySelector('[data-prio]').innerHTML = ms.length ? ms.map(m => `<label class="chip-ck"><input type="checkbox" name="prio_m" value="${esc(m)}" ${on.has(m) ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('') : '<small class="muted">Sus ejercicios no tienen grupo muscular en el catálogo.</small>'; }
      const fd = new FormData(f), o = opts(fd), n = +fd.get('weeks');
      const hasP = !!(o.prio && o.prio.length), pset = new Set(o.prio || []);
      f.querySelector('[data-prio-opts]').hidden = !hasP; f.querySelector('[data-prio-hint]').hidden = hasP;
      f.querySelector('[data-rng]').hidden = fd.get('rir_mode') !== 'range';
      f.querySelector('[data-dlnote]').textContent = hasP ? `RIR ${o.prio_dl_rir} en los prioritarios y RIR ${o.dl_rir} en el resto. Parte de la última semana de carga.` : 'Y RIR 2 en todas las series. Parte de la última semana de carga.';
      const P = window.JMMeso.project, show = its.filter(it => pset.has(it.id)).concat(its.filter(it => !pset.has(it.id))).slice(0, 8);
      const cell = v => `${v.sets}×${esc(v.reps || '')}${v.load_kg != null ? ' · ' + nf(v.load_kg) + ' kg' : ''}${v.target_rir != null ? ' · RIR ' + nf(v.target_rir) : ''}`;
      const sets = Array.from({ length: n }, (_, k) => its.reduce((a, it) => a + P(it, k, n, o).sets, 0));
      const ld = window.JMMeso.weekLoads(its, n, o), mx = Math.max(...ld, 1);
      const sd = f.querySelector('[name=start]').value || st0;
      f.querySelector('[data-prev]').innerHTML = `<h4>Proyección del bloque</h4>
        <div class="meso-bars" aria-hidden="true">${ld.map((x, k) => `<span class="${k === n - 1 ? 'dl' : ''}" style="height:${Math.max(8, Math.round(x / mx * 100))}%"><i>S${k + 1}</i></span>`).join('')}</div>
        <div class="table-wrap"><table class="meso-table"><thead><tr><th>Ejercicio</th>${Array.from({ length: n }, (_, k) => `<th class="${k === n - 1 ? 'dl' : ''}">S${k + 1}${k === n - 1 ? ' ↓' : ''}<small>${fmtDate(addDays(mon(sd), 7 * k), { day: 'numeric', month: 'short' })}</small></th>`).join('')}</tr></thead>
        <tbody>${show.map(it => `<tr class="${pset.has(it.id) ? 'prio' : ''}"><td>${pset.has(it.id) ? '★ ' : ''}${esc(it.exercise_name)}</td>${Array.from({ length: n }, (_, k) => `<td class="${k === n - 1 ? 'dl' : ''}">${cell(P(it, k, n, o))}</td>`).join('')}</tr>`).join('')}
        <tr class="tot"><td>Series totales</td>${sets.map((x, k) => `<td class="${k === n - 1 ? 'dl' : ''}">${x}</td>`).join('')}</tr>
        <tr class="adj"><td>RIR de la semana <small>auto = progresión</small></td>${Array.from({ length: n }, (_, k) => { const cur = fd.get('wr' + k) ?? ''; return `<td class="${k === n - 1 ? 'dl' : ''}"><select name="wr${k}" aria-label="RIR de la semana ${k + 1}"><option value="">auto</option>${[0, 1, 2, 3, 4, 5].map(v => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${v === 0 ? 'Fallo' : 'RIR ' + v}</option>`).join('')}</select></td>`; }).join('')}</tr>
        <tr class="adj"><td>Series <small>de más o de menos por ejercicio</small></td>${Array.from({ length: n }, (_, k) => { const cur = +(fd.get('ws' + k) || 0); return `<td class="${k === n - 1 ? 'dl' : ''}"><select name="ws${k}" aria-label="Ajuste de series de la semana ${k + 1}">${[-2, -1, 0, 1, 2, 3].map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v > 0 ? '+' + v : v === 0 ? '±0' : v}</option>`).join('')}</select></td>`; }).join('')}</tr></tbody></table></div>
        <p class="muted small">Cambia el RIR o las series de cualquier semana y la tabla se recalcula. Después también puedes editar cada ejercicio de cada semana en Rutinas.</p>
        ${its.length > show.length ? `<p class="muted small">Y ${its.length - show.length} ejercicios más con la misma lógica.</p>` : ''}`;
      const w = f.querySelector('[data-warn]'), past = (fd.get('start') || '') < mon(today());
      w.hidden = !past; w.textContent = past ? 'La fecha de inicio es de una semana ya pasada: las semanas sin entrenar desde esa fecha se sustituyen.' : '';
    };
    f.addEventListener('input', draw); f.addEventListener('change', draw); draw();
  }

  function cloneWeek(c, w, done) {
    const modes = [['progress', 'Progresión automática', 'Sube carga o reps en los ejercicios con regla de progresión si el cliente cumplió el objetivo en esta semana (todas las series en el tope del rango y con el RIR pedido). Lo demás se copia igual.'],
      ['repeat', 'Repetir con los pesos que hizo', 'Misma semana; cada ejercicio parte de la carga que registró el cliente (y sube si tiene regla de progresión y la cumplió).'],
      ['copy', 'Copia exacta', 'Mismas series, reps y cargas.'], ['maintenance', 'Mantenimiento', 'Lo mismo que esta semana, sin subir cargas.'],
      ['intensity', 'Intensidad', 'RIR 1 punto más cerca del fallo y +carga donde esta semana llegó al tope del rango.'], ['deload', 'Descarga', '60 % de las series, misma carga y RIR 2.']];
    modal('Crear la semana siguiente', `<p class="muted">A partir de la ${esc(weekLabel(w))}. Se crea en borrador para que la revises antes de publicarla.</p>
      <div class="choices">${modes.map(([v, t, d], i) => `<label class="choice"><input type="radio" name="mode" value="${v}" ${i ? '' : 'checked'}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>`, {
      submitLabel: 'Crear semana', onSubmit: async (f, fd) => {
        const mode = fd.get('mode'), base = mode === 'maintenance' || mode === 'intensity' ? 'copy' : mode;
        const id = await safe(async () => {
          const nid = await DB.rpc('clone_program_week', { p_week_id: w.id, p_mode: base });
          if (base !== mode) await DB.rpc('set_week_kind', { p_week: nid, p_kind: mode });
          return nid;
        }, 'Semana creada en borrador');
        S.weekSel[c.id] = id; done();
      }
    });
  }

  // ----- Eventos del calendario: se añaden pinchando un día (entreno puntual, cardio, movilidad, revisión, fotos, nota)
  const EV_KINDS = {
    workout: ['Entreno', 'dumbbell', 'Un entreno extra o puntual ese día'],
    cardio: ['Cardio', 'clock', 'Caminar, bici, carrera… con minutos y zona'],
    mobility: ['Movilidad', 'refresh', 'Movilidad o estiramientos'],
    checkin: ['Revisión', 'inbox', 'Pedir la valoración semanal ese día'],
    photos: ['Fotos', 'camera', 'Pedir fotos de progreso'],
    note: ['Nota', 'chat', 'Un recordatorio o indicación']
  };
  const evTitle = e => e.title || (EV_KINDS[e.kind] || ['Evento'])[0];
  async function loadEvents(cid, from, to) {
    try { return (await DB.list('calendar_events', { eq: { client_id: cid }, gte: { date: from }, order: ['date', 'asc'] })).filter(e => e.date <= to); }
    catch (e) { return null; } // tabla aún no creada (migración 011)
  }
  // Hecho: marcado a mano, o cumplido por un entreno / una revisión del cliente
  function evDone(e, sessions, checkins) {
    if (e.done_at) return true;
    if (e.kind === 'workout' || (e.kind === 'mobility' && e.routine_id)) return !!e.routine_id && sessions.some(s => s.finished_at && s.routine_id === e.routine_id && ymd(new Date(s.started_at)) === e.date);
    if (e.kind === 'checkin' || e.kind === 'photos') return (checkins || []).some(k => k.date >= addDays(e.date, -1) && k.date <= addDays(e.date, 3) && (e.kind === 'checkin' || k.photo_path));
    return false;
  }
  function evDetail(e, routines) {
    const r = e.routine_id && byId(routines || [], e.routine_id);
    return [EV_KINDS[e.kind] ? EV_KINDS[e.kind][0] : '', r ? r.name : '', e.minutes ? e.minutes + ' min' : '', e.visible === false ? 'privada' : '', e.series_id ? 'semanal' : ''].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i && x !== evTitle(e)).join(' · ');
  }
  function eventForm(c, { date, ev = null, routines = [], weeks = [], fixedCount = 0, after, planHas = null }) {
    const pubW = new Map(weeks.map(w => [w.id, w]));
    // solo rutinas que el cliente puede abrir: fijas o de la semana publicada de ese día (o la última publicada)
    const pub = weeks.filter(w => w.published).sort((a, b) => a.week_no - b.week_no);
    const d1 = ev ? ev.date : date, wk = pub.find(w => w.start_date <= d1 && d1 <= addDays(w.start_date, 6)) || pub[pub.length - 1];
    const opts = routines.filter(r => !r.program_week_id || (wk && r.program_week_id === wk.id) || (ev && r.id === ev.routine_id && pubW.has(r.program_week_id)))
      .map(r => { const w = pubW.get(r.program_week_id); return `<option value="${r.id}" ${ev && ev.routine_id === r.id ? 'selected' : ''}>${esc(r.name)}${w ? ' · ' + esc(weekLabel(w)) : ' · fija'}</option>`; }).join('');
    const k0 = ev ? ev.kind : 'workout';
    const f = modal(ev ? 'Editar' : 'Añadir · ' + fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }), `
      ${ev ? '' : `<div class="evkinds">${Object.entries(EV_KINDS).map(([k, [l, icn, d]]) => `<label class="evkind k-${k}"><input type="radio" name="kind" value="${k}" ${k === k0 ? 'checked' : ''}><span>${ic(icn)}<b>${l}</b><small>${d}</small></span></label>`).join('')}
        <button type="button" class="evkind k-program" data-newprog><span>${ic('copy')}<b>Mesociclo</b><small>Bloque de 4 o 6 semanas con progresión y descarga</small></span></button></div>`}
      <div class="form-grid">
        <label>Fecha<input name="date" type="date" required value="${esc(ev ? ev.date : date)}"></label>
        <label data-for="workout mobility">Rutina<select name="routine_id"><option value="">${'(sin rutina)'}</option>${opts}</select></label>
        <label data-for="cardio mobility">Minutos<input name="minutes" type="number" min="1" max="600" inputmode="numeric" value="${ev && ev.minutes ? ev.minutes : ''}" placeholder="Ej: 30"></label>
      </div>
      <label>Título <small class="muted">opcional</small><input name="title" maxlength="120" value="${esc(ev ? ev.title : '')}" data-ph></label>
      <label>Indicaciones<textarea name="notes" rows="2" maxlength="2000" data-phn>${esc(ev ? ev.notes || '' : '')}</textarea></label>
      <label class="check" data-for="note"><input type="checkbox" name="private" ${ev && ev.visible === false ? 'checked' : ''}> Nota privada (solo la ves tú)</label>
      ${ev ? '' : `<div class="form-grid"><label class="check"><input type="checkbox" name="repeat"> Repetir cada semana</label><label data-rep hidden>Hasta<input name="until" type="date" value="${addDays(date, 27)}"></label></div>`}`, {
      submitLabel: ev ? 'Guardar' : 'Añadir',
      onSubmit: async (form, fd) => {
        const kind = ev ? ev.kind : fd.get('kind');
        const d0 = fd.get('date'); if (!d0) { toast('Pon la fecha', 'err'); return false; }
        const uses = s => (EV_KINDS[kind] && form.querySelector(`[data-for~="${kind}"] [name="${s}"]`));
        const row = {
          client_id: c.id, date: d0, kind,
          title: String(fd.get('title') || '').trim(),
          notes: String(fd.get('notes') || '').trim() || null,
          routine_id: uses('routine_id') ? fd.get('routine_id') || null : null,
          minutes: uses('minutes') ? num(fd.get('minutes')) : null,
          visible: !(kind === 'note' && fd.get('private'))
        };
        if (!row.title && row.routine_id) row.title = (byId(routines, row.routine_id) || {}).name || '';
        if (row.minutes != null) row.minutes = Math.max(1, Math.min(600, Math.round(row.minutes)));
        if (kind === 'workout' && !row.routine_id && !row.title) { toast('Elige una rutina o pon un título', 'err'); return false; }
        if (kind === 'note' && !row.title && !row.notes) { toast('Escribe la nota', 'err'); return false; }
        if (ev) { await safe(() => DB.update('calendar_events', ev.id, row), 'Guardado'); return after && after(row.date); }
        let rows = [row];
        const until = fd.get('repeat') ? fd.get('until') || addDays(d0, 27) : d0;
        if (fd.get('repeat')) {
          const sid = crypto.randomUUID();
          rows = [];
          for (let d = d0, n = 0; d <= until && n < 26; d = addDays(d, 7), n++) rows.push(Object.assign({}, row, { date: d, series_id: sid }));
        }
        // sin duplicados: no se añade donde ese día ya tiene esa rutina en su plan o un evento igual
        const nk = x => String(x || '').trim().toLowerCase();
        const have = (await loadEvents(c.id, d0, until)) || [];
        const dup = x => (planHas && (x.kind === 'workout' || x.kind === 'mobility') && planHas(x.date, x.routine_id, x.title))
          || have.some(e => e.date === x.date && e.kind === x.kind && (x.routine_id ? e.routine_id === x.routine_id : nk(e.title) === nk(x.title) && !!x.title));
        const skip = rows.filter(dup).length; rows = rows.filter(x => !dup(x));
        if (!rows.length) { toast(skip > 1 ? 'Ya lo tiene esos días (en su plan o en el calendario): no se ha añadido nada' : 'Ya lo tiene ese día (en su plan o en el calendario)', 'err'); return false; }
        await safe(() => DB.insert('calendar_events', rows), (rows.length > 1 ? `${rows.length} semanas añadidas` : 'Añadido') + (skip ? ` · ${skip} día${skip > 1 ? 's' : ''} que ya lo tenía${skip > 1 ? 'n' : ''}, sin repetir` : ''));
        return after && after(row.date);
      }
    });
    const sync = () => {
      const k = ev ? ev.kind : (f.querySelector('[name=kind]:checked') || {}).value;
      f.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(k); });
      const ph = { workout: 'Ej: Full body extra', cardio: 'Ej: Caminar inclinado', mobility: 'Ej: Movilidad cadera y tobillo', checkin: 'Valoración semanal', photos: 'Fotos de frente, perfil y espalda', note: 'Ej: Hoy come un poco más de carbos' }[k] || '';
      f.querySelector('[data-ph]').placeholder = ph;
      f.querySelector('[data-phn]').placeholder = { cardio: 'Ej: zona 2, 130–140 ppm, que puedas hablar', checkin: 'Ej: con medidas esta vez', note: 'Lo que verá el cliente ese día' }[k] || '';
    };
    f.querySelectorAll('[name=kind]').forEach(x => x.onchange = sync); sync();
    const rep = f.querySelector('[name=repeat]'); if (rep) rep.onchange = () => { f.querySelector('[data-rep]').hidden = !rep.checked; };
    const np = f.querySelector('[data-newprog]'); if (np) np.onclick = () => { const d = f.querySelector('[name=date]').value || date; closeModal(); mesoForm(c, { start: d, after: () => after && after(d) }); };
  }
  async function deleteEvent(ev, after) {
    if (!ev.series_id) { if (await confirmBox(`Se borrará «${evTitle(ev)}» del ${fmtDate(ev.date)}.`)) { await safe(() => DB.remove('calendar_events', ev.id), 'Borrado'); after(); } return; }
    const next = await DB.list('calendar_events', { eq: { client_id: ev.client_id, series_id: ev.series_id }, gte: { date: ev.date }, fresh: true });
    modal('Borrar evento semanal', `<p>«${esc(evTitle(ev))}» se repite cada semana.</p>`, {
      submitLabel: 'Solo este día',
      danger: { label: `Este y los siguientes (${next.length})`, run: async () => { closeModal(); await safe(async () => { for (const x of next) await DB.remove('calendar_events', x.id); }, 'Serie borrada'); after(); } },
      onSubmit: async () => { await safe(() => DB.remove('calendar_events', ev.id), 'Borrado'); after(); }
    });
  }

  // ----- Calendario mensual del cliente (entrenador)
  async function tabCalendar(c, box) {
    S.calMonth = S.calMonth || {};
    if (!S.calHide) { try { S.calHide = new Set(JSON.parse(localStorage.getItem('jm-cal-hide') || '[]')); } catch (e) { S.calHide = new Set(); } }
    const [y, m] = (S.calMonth[c.id] || today().slice(0, 7)).split('-').map(Number);
    await rollWeeks(await DB.list('programs', { eq: { client_id: c.id } }).catch(() => []));
    const [routines, programs, weeks, sessions] = await Promise.all([
      DB.list('routines', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('programs', { eq: { client_id: c.id } }),
      DB.list('program_weeks', { eq: { client_id: c.id } }),
      clientSessions(c.id)
    ]);
    // ejercicios solo de las semanas que caen en el mes que se ve (y de las rutinas fijas)
    const mFrom = addDays(`${y}-${String(m).padStart(2, '0')}-01`, -13), mTo = addDays(`${y}-${String(m).padStart(2, '0')}-01`, 44);
    const wIn = new Set(weeks.filter(w => w.start_date >= mFrom && w.start_date <= mTo).map(w => w.id));
    programs.forEach(p => { const l = weeks.filter(w => w.program_id === p.id).sort((a, b) => b.week_no - a.week_no)[0]; if (l) wIn.add(l.id); });   // la última semana se repite sola
    const calIds = routines.filter(r => !r.program_week_id || wIn.has(r.program_week_id)).map(r => r.id);
    const items = calIds.length ? await DB.list('routine_items', { in: { routine_id: calIds }, order: ['position', 'asc'] }) : [];
    const prog = programs.filter(p => p.status === 'active').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
    const pweeks = prog ? weeks.filter(w => w.program_id === prog.id).sort((a, b) => a.week_no - b.week_no) : [];
    const lastW = pweeks[pweeks.length - 1];
    const fixed = routines.filter(r => !r.program_week_id);
    const t = today(), ym = `${y}-${String(m).padStart(2, '0')}`;
    const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const lastDay = new Date(y, m, 0), end = new Date(lastDay); end.setDate(lastDay.getDate() + (7 - ((lastDay.getDay() + 6) % 7)) - 1);
    const [events0, checkins] = await Promise.all([loadEvents(c.id, ymd(start), ymd(end)), DB.list('checkins', { eq: { client_id: c.id }, order: ['date', 'desc'], limit: 200 }).catch(() => [])]);
    const events = events0 || [];
    const evOn = iso => events.filter(e => e.date === iso);
    const gls = window.JMGoals ? ((await loadGoals(c.id)) || []).filter(g => g.status === 'active') : [];
    const msOn = iso => gls.flatMap(g => JMGoals.blocks(g).filter(b => b.to === iso).map(b => ({ g, b })));
    const reload = iso => { if (iso) { S.calSel = iso; S.calMonth[c.id] = iso.slice(0, 7); } tabCalendar(c, box); };
    const noTable = () => { toast('Falta ejecutar la migración 011 en Supabase', 'err'); };
    const planHas = (iso, rid, title) => plan(iso).rs.some(r => (rid && r.id === rid) || (title && r.name.trim().toLowerCase() === String(title).trim().toLowerCase()));
    const addOn = iso => events0 === null ? noTable() : eventForm(c, { date: iso, routines, weeks: pweeks, fixedCount: fixed.length, after: reload, planHas });
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
    // Eventos del día sin duplicados: un entreno o movilidad que ya está en su plan ese día (misma rutina o mismo nombre)
    // no se pinta dos veces, y tampoco dos eventos iguales el mismo día
    const nk = x => String(x || '').trim().toLowerCase();
    const evsOn = iso => { const rs = plan(iso).rs, seen = new Set();
      return evOn(iso).filter(e => {
        if ((e.kind === 'workout' || e.kind === 'mobility') && rs.some(r => (e.routine_id && r.id === e.routine_id) || (nk(evTitle(e)) && nk(r.name) === nk(evTitle(e))))) return false;
        const k = e.kind + '|' + (e.routine_id || nk(evTitle(e))); if (e.kind !== 'note' && seen.has(k)) return false; seen.add(k); return true; }); };
    const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
    const doneInWeek = (r, iso) => { const a = mondayOf(iso), z = addDays(a, 6);
      return sessions.some(s => { const sd = s.finished_at && ymd(new Date(s.started_at)); return sd && sd >= a && sd <= z && (s.routine_id === r.id || (s.routine_name || '') === r.name); }); };
    // Filtros (tipo de tarea) y contadores del mes, como en Harbiz
    const FILT = [['train', 'Entrenos'], ['cardio', 'Cardio'], ['mobility', 'Movilidad'], ['review', 'Revisiones y fotos'], ['note', 'Notas'], ['goal', 'Objetivos']];
    const fk = e => (e.kind === 'workout' ? 'train' : ['checkin', 'photos'].includes(e.kind) ? 'review' : e.kind);
    const shown = k => !S.calHide.has(k);
    // Tareas de un día: rutinas del plan + entrenos hechos fuera del plan + eventos + hitos de objetivos
    const tasks = iso => {
      const p = plan(iso), done = doneOn(iso), out = [];
      if (shown('train')) {
        p.rs.forEach(r => { const dn = done.some(s => s.routine_id === r.id || (s.routine_name || '') === r.name), mv = !dn && doneInWeek(r, iso);
          out.push({ cls: `cev ${p.kind} ${dn ? 'done' : mv ? 'moved' : iso < t ? 'missed' : ''}`, txt: r.name, st: dn || mv ? 'ok' : iso < t ? 'miss' : 'todo', rt: r.id }); });
        done.filter(s => !p.rs.some(r => r.id === s.routine_id || r.name === s.routine_name) && !evsOn(iso).some(e => e.routine_id && e.routine_id === s.routine_id))
          .forEach(s => out.push({ cls: 'cev done', txt: s.routine_name || 'Entreno', st: 'ok', sid: s.id }));
      }
      evsOn(iso).filter(e => shown(fk(e))).forEach(e => { const dn = evDone(e, sessions, checkins);
        out.push({ cls: `cev k-${e.kind} ${dn ? 'done' : ''}`, txt: evTitle(e), ic: EV_KINDS[e.kind][1], id: e.id, rt: e.routine_id || null, st: e.kind === 'note' ? null : dn ? 'ok' : iso < t ? 'miss' : 'todo' }); });
      if (shown('goal')) msOn(iso).forEach(({ g, b }) => out.push({ cls: 'cev k-goal', txt: `🎯 ${JMGoals.nf(b.target)} ${JMGoals.METRICS[g.metric].u}`, title: g.title }));
      return out;
    };
    let nOk = 0, nMiss = 0, nTodo = 0;
    const rows = [];
    for (let ws = new Date(start); ws <= end; ws.setDate(ws.getDate() + 7)) {
      const mon = ymd(ws), p0 = plan(mon), w = p0.week;
      let bar, bcls = 'pb-none';
      if (w && p0.kind !== 'auto') {
        const dl = w.kind === 'deload';
        bar = `${esc(prog.name)} · ${prog.meso_weeks ? `S${w.week_no}/${Math.max(prog.meso_weeks, w.week_no)} · ${dl ? 'Descarga' : 'Carga'}` : esc(weekLabel(w))}${w.published ? '' : ' · borrador'}`;
        bcls = dl ? 'pb-dl' : w.published ? 'pb-pub' : 'pb-draft';
      } else if (p0.kind === 'auto') { bar = `${esc(prog.name)} · se repetirá sola`; bcls = 'pb-auto'; }
      else if (p0.kind === 'fixed') { bar = fixed.length ? 'Rutinas fijas' : 'Sin plan'; bcls = fixed.length ? 'pb-fixed' : 'pb-none'; }
      else bar = 'Sin plan';
      const isLast = !!(w && prog && prog.meso_weeks && lastW && w.id === lastW.id && p0.kind !== 'auto');
      const clipW = S.calClip && S.calClip.cid === c.id && S.calClip.type === 'week';
      const days = [];
      for (let i = 0; i < 7; i++) {
        const iso = addDays(mon, i), d = new Date(iso + 'T12:00:00'), tk = tasks(iso);
        if (iso.slice(0, 7) === ym && iso <= t) tk.forEach(x => { if (x.st === 'ok') nOk++; else if (x.st === 'miss') nMiss++; });
        if (iso.slice(0, 7) === ym && iso > t) tk.forEach(x => { if (x.st === 'todo') nTodo++; });
        const vis = tk.slice(0, 3), more = tk.length - vis.length;
        days.push(`<div class="cday ${iso.slice(0, 7) !== ym ? 'out' : ''} ${iso === t ? 'today' : ''} ${S.calSel === iso ? 'sel' : ''} ${iso < t ? 'past' : ''}" data-day="${iso}" role="button" tabindex="0" aria-label="${esc(fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' }))}${tk.length ? ', ' + tk.length + ' tareas' : ''}">
          <span class="cnum"><b>${d.getDate()}</b><button type="button" class="cadd" data-add="${iso}" aria-label="Añadir el ${d.getDate()}" title="Añadir">${ic('plus')}</button></span>
          ${vis.map(x => `<span class="${x.cls} ${x.rt || x.sid ? 'cev-link' : ''}" ${x.id ? `draggable="true" data-ev="${x.id}"` : ''} ${x.rt ? `data-rt="${x.rt}"` : ''} ${x.sid ? `data-sid="${x.sid}"` : ''} data-iso="${iso}" ${x.title ? `title="${esc(x.title)}"` : ''}>${x.ic ? ic(x.ic) : ''}<em>${esc(x.txt)}</em></span>`).join('')}
          ${more > 0 ? `<span class="cmore">+${more} más</span>` : ''}</div>`);
      }
      rows.push(`<div class="cweek"><div class="pbar ${bcls}"><span class="grow">${bar}</span>
          ${events0 !== null ? `<button type="button" class="pb-btn" data-cpw="${mon}" title="Copiar los eventos de esta semana">${ic('copy')}<span>Copiar</span></button>${clipW && S.calClip.from !== mon ? `<button type="button" class="pb-btn on" data-psw="${mon}" title="Pegar aquí la semana copiada">Pegar semana</button>` : ''}` : ''}
          ${isLast ? `<button type="button" class="pb-btn link" data-link>Enlazar próximo mesociclo →</button>` : ''}
</div><div class="cdays">${days.join('')}</div></div>`);
    }
    const mName = cap(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
    box.innerHTML = `<section class="card cal cal2">
        <header class="cal-top">
          <div class="row gap"><button class="icon-btn" data-mv="-1" aria-label="Mes anterior">‹</button><button class="btn small ghost" data-today>Hoy</button><button class="icon-btn" data-mv="1" aria-label="Mes siguiente">›</button></div>
          <h3>${esc(mName)}</h3>
          <div class="row gap"><button class="btn small ghost ${S.calHide.size ? 'on' : ''}" data-filt aria-expanded="false">${ic('filter')}<span class="lbl">Filtros</span>${S.calHide.size ? ` (${FILT.length - S.calHide.size}/${FILT.length})` : ''}</button><button class="btn small primary" data-addev>${ic('plus')}<span class="lbl">Tarea</span></button></div>
        </header>
        <div class="cal-filt" data-fbox hidden>${FILT.map(([k, l]) => `<label class="check"><input type="checkbox" data-fk="${k}" ${shown(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <div class="cal-kpi"><span class="ok">${ic('check')}<b>${nOk}</b> tareas completadas</span><span class="miss">!<b>${nMiss}</b> sin completar</span><span class="todo">${ic('clock')}<b>${nTodo}</b> por hacer este mes</span></div>
        ${S.calClip && S.calClip.cid === c.id ? `<p class="note small cal-clip">📋 Copiado: ${S.calClip.type === 'week' ? 'semana del ' + fmtDate(S.calClip.from) : fmtDate(S.calClip.from, { weekday: 'long', day: 'numeric', month: 'short' })} (${S.calClip.evs.length} evento${S.calClip.evs.length === 1 ? '' : 's'}). ${S.calClip.type === 'week' ? 'Pulsa «Pegar semana» en otra semana.' : 'Elige un día y pulsa «Pegar aquí».'} <button type="button" class="link" data-clipx>Cancelar</button></p>` : ''}
        <div class="chead7">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(x => `<small>${x}</small>`).join('')}</div>
        <div class="cweeks">${rows.join('')}</div>
        <div class="clegend"><span class="cev pub"><em>Planificado</em></span><span class="cev done"><em>Hecho</em></span><span class="cev moved pub"><em>Hecho otro día</em></span><span class="cev missed pub"><em>No hecho</em></span>${Object.entries(EV_KINDS).filter(([k]) => k !== 'workout').map(([k, [l, icn]]) => `<span class="cev k-${k}">${ic(icn)}<em>${l}</em></span>`).join('')}<span class="cev k-goal"><em>🎯 Hito</em></span></div>
        <p class="muted small center">Pincha un día para ver y gestionar lo que tiene; con «+» añades directamente. En el ordenador puedes arrastrar un evento a otro día.</p>
      </section><div data-dayinfo></div>`;
    box.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const d = new Date(y, m - 1 + Number(b.dataset.mv), 1); S.calMonth[c.id] = ymd(d).slice(0, 7); tabCalendar(c, box); });
    box.querySelector('[data-today]').onclick = () => { S.calMonth[c.id] = t.slice(0, 7); S.calSel = t; tabCalendar(c, box); };
    const fb = box.querySelector('[data-fbox]'), fbt = box.querySelector('[data-filt]');
    fbt.onclick = () => { fb.hidden = !fb.hidden; fbt.setAttribute('aria-expanded', String(!fb.hidden)); };
    fb.querySelectorAll('[data-fk]').forEach(x => x.onchange = () => { if (x.checked) S.calHide.delete(x.dataset.fk); else S.calHide.add(x.dataset.fk); try { localStorage.setItem('jm-cal-hide', JSON.stringify([...S.calHide])); } catch (e) { /* sin almacenamiento */ } tabCalendar(c, box); });
    const cx = box.querySelector('[data-clipx]'); if (cx) cx.onclick = () => { S.calClip = null; tabCalendar(c, box); };
    const lk = box.querySelector('[data-link]'); if (lk) lk.onclick = () => mesoForm(c, { after: () => tabCalendar(c, box) });
    // Copiar y pegar semanas (solo los eventos; los entrenos del programa se gestionan en Rutinas)
    const copyEvs = async (list, shift) => {
      const rows = list.map(e => ({ client_id: c.id, date: addDays(e.date, shift(e)), kind: e.kind, title: e.title, notes: e.notes, routine_id: e.routine_id, minutes: e.minutes, visible: e.visible !== false }));
      if (rows.length) await DB.insert('calendar_events', rows); return rows.length;
    };
    box.querySelectorAll('[data-cpw]').forEach(b => b.onclick = async () => {
      const a = b.dataset.cpw, evs = (await loadEvents(c.id, a, addDays(a, 6))) || [];
      if (!evs.length) { toast('Esa semana no tiene eventos que copiar (cardio, notas, revisiones…)', 'err'); return; }
      S.calClip = { cid: c.id, type: 'week', from: a, evs }; toast(`Semana copiada (${evs.length}). Ahora pulsa «Pegar semana» donde quieras.`); tabCalendar(c, box);
    });
    box.querySelectorAll('[data-psw]').forEach(b => b.onclick = async () => {
      const k = S.calClip, sh = (new Date(b.dataset.psw + 'T12:00:00') - new Date(k.from + 'T12:00:00')) / 864e5;
      if (sh === 0) { toast('Elige otra semana', 'err'); return; }
      const n = await safe(() => copyEvs(k.evs, () => Math.round(sh)), 'Semana pegada'); if (n != null) tabCalendar(c, box);
    });
    // Arrastrar un evento a otro día (ordenador)
    box.querySelectorAll('[data-ev][draggable]').forEach(el => {
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.ev); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); e.stopPropagation(); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
    box.querySelectorAll('.cday').forEach(cell => {
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drop'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
      cell.addEventListener('drop', async e => {
        e.preventDefault(); cell.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain'), ev = byId(events, id), to = cell.dataset.day;
        if (!ev || ev.date === to) return;
        await safe(() => DB.update('calendar_events', id, { date: to }), `Movido al ${fmtDate(to, { weekday: 'long', day: 'numeric' })}`); reload(to);
      });
    });
    // Pinchar una rutina del calendario: si ese día la hizo, lo que hizo (series); si no, lo que le toca
    const openSession = async s => {
      if (!s) return;
      const ls = await DB.list('set_logs', { eq: { session_id: s.id }, order: ['set_no', 'asc'] }).catch(() => []);
      const g = {}; ls.forEach(l => { (g[l.exercise_name] = g[l.exercise_name] || []).push(l); });
      modal(`✓ ${s.routine_name || 'Entreno'} · ${fmtDate(s.started_at, { weekday: 'long', day: 'numeric', month: 'long' })}`,
        `<p class="muted small">${Math.max(1, Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 6e4))} min${s.volume ? ' · ' + Math.round(s.volume).toLocaleString('es-ES') + ' kg de volumen' : ''}${s.rpe ? ' · RPE ' + s.rpe : ''}</p>
        ${Object.entries(g).map(([n, xs]) => `<div class="sx2"><b>${esc(n)}</b><div class="sx-sets">${xs.map(l => `<span>${fmtKg(l.weight)} × ${l.reps ?? '–'}${l.failure ? ' <small>Fallo</small>' : l.rir != null ? ` <small>RIR ${fmtKg(l.rir)}</small>` : ''}</span>`).join('')}</div></div>`).join('') || '<p class="empty">Sin series registradas.</p>'}
        ${s.notes ? `<p class="note">${nl2br(s.notes)}</p>` : ''}
        <a class="btn small" href="#/cliente/${c.id}/progreso">Editar en Progreso</a>`, { wide: true });
    };
    const openRoutine = async (iso, rid) => {
      const r = byId(routines, rid); if (!r) return;
      const s = doneOn(iso).find(x => x.routine_id === r.id || (x.routine_name || '') === r.name);
      if (s) return openSession(s);
      let its = items.filter(i => i.routine_id === r.id);
      if (!its.length) its = await DB.list('routine_items', { eq: { routine_id: r.id }, order: ['position', 'asc'] }).catch(() => []);
      const w = weeks.find(x => x.id === r.program_week_id);
      modal(`${r.name} · ${fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' })}`,
        `<p class="muted small">${w ? esc(weekLabel(w)) : 'Rutina fija'} · ${iso < t ? 'no consta que la hiciera' : 'lo que le toca'}</p>${r.notes ? `<p class="note">${nl2br(r.notes)}</p>` : ''}
        <ol class="ex-list">${its.map(i => `<li><b>${esc(i.exercise_name)}</b><span>${i.sets} × ${esc(i.reps)}${loadLabel(i) ? ' · ' + esc(loadLabel(i)) : ''} · ${i.rest_sec}" desc.</span>${i.notes ? `<small>${esc(i.notes)}</small>` : ''}</li>`).join('') || '<li class="empty">Sin ejercicios</li>'}</ol>`, { wide: true });
    };
    box.querySelectorAll('.cday [data-rt], .cday [data-sid]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      if (el.dataset.sid) openSession(byId(sessions, el.dataset.sid)); else openRoutine(el.dataset.iso, el.dataset.rt);
    }));
    const info = box.querySelector('[data-dayinfo]');
    const showDay = iso => {
      S.calSel = iso; box.querySelectorAll('.cday').forEach(x => x.classList.toggle('sel', x.dataset.day === iso));
      const p = plan(iso), done = doneOn(iso), evs = evOn(iso), clipD = S.calClip && S.calClip.cid === c.id && S.calClip.type === 'day';
      info.innerHTML = `<section class="card dayp"><header class="row gap wrap"><h3 class="grow">${cap(fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>
          ${evs.length ? `<button class="btn small ghost" data-cpd>${ic('copy')} Copiar día</button>` : ''}${clipD && S.calClip.from !== iso ? `<button class="btn small" data-psd>Pegar aquí (${S.calClip.evs.length})</button>` : ''}
          <button class="btn small primary" data-addday>${ic('plus')} Añadir</button></header>${p.week ? `<p class="muted small">${esc(weekLabel(p.week))}${p.kind === 'auto' ? ' · se creará sola con los pesos que haga' : p.kind === 'draft' ? ' · borrador (el cliente no la ve)' : ''}</p>` : p.kind === 'fixed' && p.rs.length ? '<p class="muted small">Rutinas fijas</p>' : ''}
        ${msOn(iso).map(({ g, b }) => `<p class="note small">🎯 Fin del bloque ${b.i} de «${esc(g.title)}»: llegar a <b>${JMGoals.nf(b.target)} ${JMGoals.METRICS[g.metric].u}</b>.</p>`).join('')}
        ${evs.length ? `<ul class="evlist">${evs.map(e => { const dn = evDone(e, sessions, checkins); return `<li class="ev k-${e.kind} ${dn ? 'done' : ''}"><span class="evic">${ic(EV_KINDS[e.kind][1])}</span><div class="grow"><b>${esc(evTitle(e))}</b><small>${esc(evDetail(e, routines))}${dn ? ' · ✓ hecho' : ''}</small>${e.notes ? `<p class="small">${nl2br(e.notes)}</p>` : ''}</div>
          <button class="icon-btn" data-evdone="${e.id}" aria-label="${e.done_at ? 'Desmarcar' : 'Marcar hecho'}" title="${e.done_at ? 'Desmarcar' : 'Marcar hecho'}">${ic('check')}</button><button class="icon-btn" data-evdup="${e.id}" aria-label="Duplicar" title="Duplicar al día siguiente">${ic('copy')}</button><button class="icon-btn" data-evedit="${e.id}" aria-label="Editar o mover" title="Editar o mover">${ic('edit')}</button><button class="icon-btn danger" data-evdel="${e.id}" aria-label="Borrar" title="Borrar">${ic('trash')}</button></li>`; }).join('')}</ul>` : ''}
        ${p.rs.map(r => `<div class="routine-mini"><button type="button" class="link-b" data-rtp="${r.id}" title="Ver lo que le toca o lo que hizo"><b>${ic('dumbbell')} ${esc(r.name)}</b></button><ol class="ex-list compact">${items.filter(i => i.routine_id === r.id).map(i => `<li><b>${esc(i.exercise_name)}</b><span>${i.sets}×${esc(i.reps)}${loadLabel(i) ? ' · ' + esc(loadLabel(i)) : ''}</span></li>`).join('')}</ol></div>`).join('') || (done.length || evs.length ? '' : '<p class="empty">Descanso · pulsa «Añadir» para poner algo este día</p>')}
        ${done.map(s => `<button type="button" class="pill green pill-btn" data-sidp="${s.id}" title="Ver lo que hizo">✓ ${esc(s.routine_name || 'Entreno')} · ${Math.max(1, Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 6e4))} min${s.volume ? ' · ' + Math.round(s.volume).toLocaleString('es-ES') + ' kg vol.' : ''} ›</button>`).join('')}
        ${p.rs.length ? `<button class="btn small" data-goweek>${ic('edit')} Editar ${p.week && p.kind !== 'auto' ? esc(weekLabel(p.week)) : p.kind === 'auto' ? 'la última semana' : 'rutinas fijas'}</button>` : ''}</section>`;
      info.querySelectorAll('[data-rtp]').forEach(b => b.onclick = () => openRoutine(iso, b.dataset.rtp));
      info.querySelectorAll('[data-sidp]').forEach(b => b.onclick = () => openSession(byId(sessions, b.dataset.sidp)));
      const g = info.querySelector('[data-goweek]');
      if (g) g.onclick = () => { S.weekSel = S.weekSel || {}; S.weekSel[c.id] = p.week ? p.week.id : 'fixed'; go('#/cliente/' + c.id + '/rutinas'); };
      info.querySelector('[data-addday]').onclick = () => addOn(iso);
      const cpd = info.querySelector('[data-cpd]'); if (cpd) cpd.onclick = () => { S.calClip = { cid: c.id, type: 'day', from: iso, evs }; toast('Día copiado: elige otro día y pulsa «Pegar aquí»'); tabCalendar(c, box); };
      const psd = info.querySelector('[data-psd]'); if (psd) psd.onclick = async () => { const n = await safe(() => copyEvs(S.calClip.evs, e => (new Date(iso + 'T12:00:00') - new Date(e.date + 'T12:00:00')) / 864e5), 'Pegado'); if (n != null) reload(iso); };
      const ev = id => byId(evs, id);
      info.querySelectorAll('[data-evdone]').forEach(b => b.onclick = async () => { const e = ev(b.dataset.evdone); await safe(() => DB.rpc('set_event_done', { p_id: e.id, p_done: !e.done_at })); reload(iso); });
      info.querySelectorAll('[data-evdup]').forEach(b => b.onclick = async () => { const n = await safe(() => copyEvs([ev(b.dataset.evdup)], () => 1), 'Duplicado al día siguiente'); if (n != null) reload(iso); });
      info.querySelectorAll('[data-evedit]').forEach(b => b.onclick = () => eventForm(c, { date: iso, ev: ev(b.dataset.evedit), routines, weeks: pweeks, fixedCount: fixed.length, after: reload }));
      info.querySelectorAll('[data-evdel]').forEach(b => b.onclick = () => deleteEvent(ev(b.dataset.evdel), () => reload(iso)));
      if (window.innerWidth < 700) info.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    box.querySelector('[data-addev]').onclick = () => addOn(S.calSel || t);
    box.querySelectorAll('[data-add]').forEach(b => b.onclick = e => { e.stopPropagation(); addOn(b.dataset.add); });
    box.querySelectorAll('.cday').forEach(b => { b.onclick = () => showDay(b.dataset.day); b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDay(b.dataset.day); } }; });
    const inMonth = S.calSel && S.calSel.slice(0, 7) === ym ? S.calSel : (t.slice(0, 7) === ym ? t : null);
    if (inMonth) { const sc = window.scrollY; showDay(inMonth); window.scrollTo(0, sc); }
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
    const clients = (await loadClients()).filter(x => x.id !== target.id), tpls = (S.templates || []).filter(x => x.id !== target.id);
    if (!clients.length && !tpls.length) return toast('No hay otros clientes ni plantillas de los que copiar', 'err');
    modal('Copiar plan o plantilla', `<p class="muted">Se añadirán sus rutinas fijas a ${esc(target.name)}. Las que ya tenga se mantienen.</p><label>Origen<select name="from">${tpls.length ? `<optgroup label="Plantillas">${tpls.map(x => `<option value="${x.id}">📚 ${esc(x.name)}</option>`).join('')}</optgroup>` : ''}<optgroup label="Clientes">${clients.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</optgroup></select></label>`, {
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
    // En semanas de descarga / intensidad se editan los valores FIJOS (base); al guardar se vuelve a aplicar el tipo
    const adj = !!(week && (week.kind === 'deload' || week.kind === 'intensity'));
    const rows = items.map(i => { const x = Object.assign({}, i); if (adj && x.base) { const b = x.base; if (b.sets != null) x.sets = b.sets; x.target_rir = b.target_rir ?? null; if (b.load_kg !== undefined) x.load_kg = b.load_kg; } return legacyLoad(x); });
    rows.forEach(i => { i.prog = progKey(i.progression); i.scheme = schemeKey(i.progression); });
    const intensOf = i => isFailT(i) ? 'rir:F' : i.target_rir != null && i.target_rir !== '' ? 'rir:' + Number(i.target_rir) : i.target_rpe != null && i.target_rpe !== '' ? 'rpe:' + Number(i.target_rpe) : '';
    rows.forEach(i => { i.intens = intensOf(i); });
    const INTENS = [['', '—'], ['rir:F', 'Al fallo'], ...[0, 1, 2, 3, 4, 5].map(v => ['rir:' + v, 'RIR ' + v]), ...[6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map(v => ['rpe:' + v, 'RPE ' + fmtKg(v)])];
    const exOpts = S.exercises.map(e => `<option value="${esc(e.name)}">${esc(e.muscle || '')}</option>`).join('');
    let H = null;   // marcas anteriores del cliente (se cargan al abrir)
    // Músculos prioritarios: sus ejercicios van al principio (detrás del calentamiento / movilidad), en el orden en que se marcan
    let prio = Array.isArray(r.prio_muscles) ? r.prio_muscles.slice() : [];
    const PRE = /^(movilidad|calentamiento|cardio|estiramiento)$/i;
    const musOf = x => { const n = String(x.exercise_name || '').trim(); return n && window.JMLoad && JMLoad.muscleOf ? JMLoad.muscleOf(n, S.exercises)[0] : null; };
    const prioOrder = () => {
      if (!prio.length) return;
      const rk = x => { const m = musOf(x); const k = prio.findIndex(p => p.toLowerCase() === String(m || '').toLowerCase()); return k; };
      let lead = 0; while (lead < rows.length && PRE.test(musOf(rows[lead]) || '')) lead++;   // el calentamiento del principio se queda arriba
      const head = rows.slice(0, lead), rest = rows.slice(lead);
      const pr = rest.map((x, i) => ({ x, i, k: rk(x) })), top = pr.filter(o => o.k >= 0).sort((a, b) => a.k - b.k || a.i - b.i).map(o => o.x), oth = pr.filter(o => o.k < 0).map(o => o.x);
      rows.splice(0, rows.length, ...head, ...top, ...oth);
    };
    const prioBox = () => {
      const ms = [...new Set(rows.map(musOf).filter(m => m && m !== 'Sin grupo' && !PRE.test(m)))];
      prio.filter(p => !ms.includes(p)).forEach(p => ms.push(p));
      return ms.length ? `<span class="muted small">Priorizar:</span> ${ms.map(m => { const k = prio.indexOf(m); return `<button type="button" class="chip ${k >= 0 ? 'on' : ''}" data-pm="${esc(m)}">${k >= 0 ? `<b>${k + 1}</b> ` : ''}${esc(m)}</button>`; }).join('')}`
        : '<small class="muted">Añade ejercicios del catálogo para poder priorizar músculos.</small>';
    };
    const histHtml = name => {
      if (!H || !name) return '';
      const h = H[String(name).trim().toLowerCase()]; if (!h || !h.length) return '<p class="ex-hist muted">Sin marcas todavía en este ejercicio.</p>';
      const st = stallOf(h), [cls, txt] = STALL_TXT[st.st], best = h.reduce((m, x) => (x.e1 > m.e1 ? x : m), h[0]);
      const last = h[h.length - 1], prev = h[h.length - 2], d = (iso) => fmtDate(iso, { day: 'numeric', month: 'short' });
      const setTxt = x => `${fmtKg(x.w)}×${x.r}${x.fail ? '<small> /Fallo</small>' : x.rir != null ? `<small> /RIR ${fmtKg(x.rir)}</small>` : x.rpe != null ? `<small> /RPE ${fmtKg(x.rpe)}</small>` : ''}`;
      let cmp = '';
      if (prev) {
        const pc = (last.e1 - prev.e1) / prev.e1 * 100, dw = last.w - prev.w, dr = last.r - prev.r;
        const what = dw ? `${dw > 0 ? '+' : ''}${fmtKg(dw)} kg` : dr ? `${dr > 0 ? '+' : ''}${dr} rep${Math.abs(dr) === 1 ? '' : 's'}` : 'mismo peso y reps';
        const [c2, ar] = pc > 0.5 ? ['dn', '▲'] : pc < -0.5 ? ['up', '▼'] : ['', '='];
        cmp = `<span class="${c2}"><b>${ar}</b> ${what}</span> <small class="muted">en la mejor serie vs ${d(prev.date)} (${fmtKg(prev.w)}×${prev.r})</small>`;
      }
      // minigráfica del 1RM estimado de las últimas sesiones
      const pts = h.slice(-8), lo = Math.min(...pts.map(x => x.e1)), hi = Math.max(...pts.map(x => x.e1)), W = 90, Hh = 24;
      const spark = pts.length > 1 ? `<svg class="spark" viewBox="0 0 ${W} ${Hh}" aria-hidden="true"><polyline points="${pts.map((x, i) => `${(i * (W - 4) / (pts.length - 1) + 2).toFixed(1)},${(Hh - 3 - (hi > lo ? (x.e1 - lo) / (hi - lo) : 0.5) * (Hh - 6)).toFixed(1)}`).join(' ')}"/></svg>` : '';
      return `<div class="ex-hist2">
        <div class="eh-row"><span class="eh-l">Última vez <small>${d(last.date)}</small></span><span class="eh-sets">${last.sets.map(setTxt).join(' · ')}</span></div>
        <div class="eh-row"><span class="eh-l">Progresión</span><span class="eh-p">${cmp || '<small class="muted">Primera sesión registrada</small>'}</span>${spark}<span class="pill ${cls}">${txt}${st.st === 'stall' || st.st === 'down' ? ` · ${st.since} ses.` : ''}</span></div>
        <small class="muted">Mejor 1RM est.: ${Math.round(best.e1)} kg · ${h.length} ${h.length === 1 ? 'sesión' : 'sesiones'}</small></div>`;
    };
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
          <label>Tipo de serie<select name="scheme">${SET_SCHEMES.map(([v, l]) => `<option value="${v}" ${v === (i.scheme || 'straight') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Progresión<select name="prog">${(PROG_RULES.some(p => p[0] === i.prog) ? PROG_RULES : [...PROG_RULES, [i.prog, i.prog]]).map(([v, l]) => `<option value="${v}" ${v === (i.prog || 'none') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="wide">Indicaciones<input name="notes" value="${esc(i.notes || '')}" placeholder="Técnica, superserie…"></label>
          <label class="wide">Vídeo o foto (enlace, opcional)<input name="media" value="${esc(i.media_url || '')}" placeholder="https://youtube.com/…"></label>
        </div>${histHtml(i.exercise_name)}</div>`;
    const form = modal(isNew ? 'Nueva rutina para ' + c.name : 'Editar rutina', `
      <datalist id="exlist">${exOpts}</datalist>
      <div class="form-grid">
        <label>Nombre<input name="name" required value="${esc(r.name)}" placeholder="Ej: Pierna y glúteo"></label>
        <label>Día<select name="day"><option value="">Libre (sin día fijo)</option>${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}" ${r.day === d ? 'selected' : ''}>${DIAS[d]}</option>`).join('')}</select></label>
        <label class="full">Notas de la sesión<textarea name="rnotes" rows="2" placeholder="Calentamiento, objetivo del día…">${esc(r.notes)}</textarea></label>
      </div>
      <h4>Ejercicios${week ? ` <small class="muted">· ${esc(weekLabel(week))}</small>` : ''}</h4>
      <div class="prio-ms" data-prioms></div>
      <div data-rows></div>
      <button type="button" class="btn block ghost dashed" data-addex>${ic('plus')} Añadir ejercicio</button>
      ${adj ? `<p class="note small">Esta es una semana de <b>${week.kind === 'deload' ? 'descarga' : 'intensidad'}</b>: aquí ves y cambias los valores <b>fijos</b> (series, RIR y carga). Al guardar se vuelve a aplicar ${week.kind === 'deload' ? 'el 60 % de las series y RIR 2' : 'RIR −1 y la subida de carga'}.</p>` : ''}
      ${week && laterDrafts ? `<label class="check"><input type="checkbox" name="propagate" checked> Aplicar también a las ${laterDrafts} semana${laterDrafts > 1 ? 's' : ''} siguiente${laterDrafts > 1 ? 's' : ''} <small class="muted">(no cambia las semanas pasadas ni las sesiones que ya haya entrenado; cada semana conserva sus cargas y su tipo: descarga, intensidad…)</small></label>` : ''}`, {
      wide: true, submitLabel: 'Guardar rutina',
      danger: isNew ? null : { label: 'Eliminar rutina', run: async () => { if (await confirmBox('Se eliminará la rutina "' + r.name + '".')) { await safe(() => DB.remove('routines', r.id), 'Rutina eliminada'); render(); } } },
      onSubmit: async (f, fd) => {
        sync(); prioOrder();
        const valid = rows.filter(x => (x.exercise_name || '').trim());
        const head = { name: fd.get('name').trim() || 'Rutina', day: fd.get('day') ? Number(fd.get('day')) : null, notes: fd.get('rnotes'), prio_muscles: prio };
        await safe(async () => {
          let rid = r.id;
          // sin la actualización 022 la columna no existe: se guarda igual, solo sin recordar los músculos marcados
          const noPrio = e => /prio_muscles/.test(e && e.message || '');
          if (isNew) { const ins = h => DB.insert('routines', Object.assign({ client_id: c.id, position: Date.now() % 100000 }, week ? { program_week_id: week.id } : {}, h));
            const [nr] = await ins(head).catch(e => { if (!noPrio(e)) throw e; const h = Object.assign({}, head); delete h.prio_muscles; return ins(h); }); rid = nr.id; }
          else await DB.update('routines', rid, head).catch(e => { if (!noPrio(e)) throw e; const h = Object.assign({}, head); delete h.prio_muscles; return DB.update('routines', rid, h); });
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
              load_kg: num(x.load_kg), target_rir: kind === 'rir' ? (val === 'F' ? 0 : Number(val)) : null, target_rpe: kind === 'rpe' ? Number(val) : null,
              tempo: /^[0-9X]-[0-9X]-[0-9X]-[0-9X]$/.test(tempo) ? tempo : null, progression: Object.assign(progVal(x.prog), schemeVal(x.scheme) ? { scheme: schemeVal(x.scheme) } : {}, kind === 'rir' && val === 'F' ? { fail: true } : {}), ...repsRange(x.reps)
            };
            d.load = loadLabel(d); // texto resumen para versiones antiguas de la app
            return d;
          };
          const keep = new Set(valid.filter(x => x.id).map(x => x.id));
          for (const o of old) if (!keep.has(o.id)) await DB.remove('routine_items', o.id);
          const news = [];
          for (const [i, x] of valid.entries()) {
            if (x.id && old.some(o => o.id === x.id)) {
              const d = payload(x, i); d.base = null; await DB.update('routine_items', x.id, d);
            }
            else news.push(Object.assign({ routine_id: rid, client_id: c.id }, crypto.randomUUID ? { lineage_id: crypto.randomUUID() } : {}, payload(x, i)));
          }
          if (news.length) await DB.insert('routine_items', news);
          if (adj) await DB.rpc('set_week_kind', { p_week: week.id, p_kind: week.kind });   // vuelve a aplicar descarga / intensidad sobre lo fijo
          if (week && fd.get('propagate')) { const n = await DB.rpc('propagate_routine', { p_routine: rid }); if (n) toast(`Cambios aplicados a ${n} semana${n > 1 ? 's' : ''} siguiente${n > 1 ? 's' : ''}`, 'ok'); }
        }, 'Rutina guardada');
        render();
      }
    });
    const box = form.querySelector('[data-rows]');
    function sync() {
      box.querySelectorAll('.ex-row').forEach(el => {
        const i = rows[+el.dataset.idx]; const v = n => el.querySelector(`[name=${n}]`).value;
        Object.assign(i, { exercise_name: v('ex'), sets: v('sets'), reps: v('reps'), load_kg: v('kg'), intens: v('int'), tempo: v('tempo'), rest_sec: v('rest'), notes: v('notes'), media_url: v('media'), prog: v('prog'), scheme: v('scheme') });
      });
    }
    const pbox = form.querySelector('[data-prioms]');
    function drawPrio() {
      pbox.innerHTML = prioBox();
      pbox.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { sync(); const m = b.dataset.pm, k = prio.indexOf(m); if (k >= 0) prio.splice(k, 1); else prio.push(m); prioOrder(); draw(); });
    }
    function draw() {
      drawPrio();
      box.innerHTML = rows.map(rowHtml).join('') || '<p class="empty">Añade el primer ejercicio. Escribe para buscar en tu catálogo (o escribe uno nuevo).</p>';
      box.querySelectorAll('.ex-row').forEach(el => {
        const idx = +el.dataset.idx;
        el.querySelector('[data-del]').onclick = () => { sync(); rows.splice(idx, 1); draw(); };
        el.querySelector('[data-up]').onclick = () => { sync(); if (idx > 0) { [rows[idx - 1], rows[idx]] = [rows[idx], rows[idx - 1]]; draw(); } };
        el.querySelector('[data-down]').onclick = () => { sync(); if (idx < rows.length - 1) { [rows[idx + 1], rows[idx]] = [rows[idx], rows[idx + 1]]; draw(); } };
        el.querySelector('[name=ex]').onchange = e => { const ex = S.exercises.find(x => x.name === e.target.value); const m = el.querySelector('[name=media]'); if (ex && ex.media_url && !m.value) m.value = ex.media_url; sync(); drawPrio(); };
      });
    }
    Promise.all([clientLogs(c.id), clientSessions(c.id)])
      .then(([lg, ss]) => { H = exHistory(lg, ss); if (document.body.contains(box)) { sync(); draw(); } }).catch(() => {});
    form.querySelector('[data-addex]').onclick = () => { sync(); const prev = rows[rows.length - 1]; rows.push({ sets: prev ? prev.sets : 3, reps: prev ? prev.reps : '10', rest_sec: prev ? prev.rest_sec : 90, intens: prev ? prev.intens : '', prog: prev ? prev.prog : 'none', scheme: 'straight' }); draw(); const ins = box.querySelectorAll('[name=ex]'); ins[ins.length - 1].focus(); };
    draw();
  }

  // ----- Nutrición (entrenador)
  // ----- Calculadora nutricional (fórmulas de la Calculadora V1 de Jorge)
  const ACT = [['Poco activo', 1.2, 0.35, 'Todo el día sentado y no entrena.'], ['Algo activo', 1.375, 0.45, 'Gran parte del día sentado, pero entrena en el gimnasio.'],
    ['Activo', 1.55, 0.5, 'Se mueve bastante durante el día y además entrena.'], ['Muy activo', 1.725, 0.55, 'Mucho movimiento a diario y entrenos intensos frecuentes.'],
    ['Extremadamente activo', 1.9, 0.6, 'Trabajo físico muy exigente o entrenos dobles / alto rendimiento.']];
  // Objetivos de la calculadora = ritmos de objetivos.js (déficit/volumen en % del peso por semana)
  const GOALS = ['Mantenimiento', 'Déficit moderado', 'Déficit agresivo', 'Volumen moderado', 'Volumen agresivo'];
  const GOAL_OLD = { 'Pérdida de grasa': 'Déficit moderado', 'Ganancia muscular': 'Volumen moderado' };
  const rateKeyOf = g => (window.JMGoals ? (JMGoals.RATES.find(r => r.l === g) || JMGoals.RATES[2]).k : 'mant');
  const MEALS5 = ['Comida 1 · Desayuno', 'Comida 2 · Media mañana', 'Comida 3 · Almuerzo', 'Comida 4 · Pre-entreno', 'Comida 5 · Post-entreno'];
  function nutriCalc(i) {
    const goal = GOAL_OLD[i.goal] || i.goal;
    const a = ACT.find(x => x[0] === i.act) || ACT[2], gain = /^Volumen/.test(goal), loss = /^Déficit/.test(goal), fem = i.sex === 'Femenino';
    const tmb = 10 * i.kg + 6.25 * i.cm - 5 * i.age + (fem ? -161 : 5);
    const get = tmb * a[1];
    // ritmo en % del peso por semana → kg/semana → kcal/día (≈ 7.700 kcal por kg)
    const R8 = window.JMGoals ? JMGoals.rateOf(rateKeyOf(goal)) : { s: 0, mid: 0, lo: 0, hi: 0, l: goal, txt: '' };
    const ratePct = R8.s ? (i.rP > 0 ? i.rP : R8.mid) : 0, kgw = R8.s * ratePct / 100 * i.kg;
    const kcal = get + kgw * 7700 / 7;
    const pR = i.pR > 0 ? i.pR : (gain ? 1.6 : loss ? 2 : 1.8), fR = i.fR > 0 ? i.fR : (fem ? 1.1 : 0.8);   // g/kg elegidos a mano o los de por defecto
    const p = i.kg * pR, f = i.kg * fR, c = (kcal - p * 4 - f * 9) / 4;
    const r2 = x => Math.round(x * 100) / 100;
    const fk = x => String(r2(x)).replace('.', ',');
    const rate = R8.s ? `${kgw > 0 ? '+' : '−'}${fk(Math.abs(kgw))} kg/sem (${fk(ratePct)} %)` : '0 kg/sem (mantenimiento)';
    const x = a[2];
    const dist = [
      [0.2, (1 - x) * 0.3, 0.75 * (loss ? 0.4 : gain ? 0.3 : 0.35)],
      [0.2, (1 - x) * 0.45, 0.75 * (loss ? 0.35 : gain ? 0.3 : 0.35)],
      [gain ? 0.2 : 0.25, (1 - x) * 0.25, 0.75 * (loss ? 0.25 : gain ? 0.4 : 0.3)],
      [0.05, x * 0.45, 0.05],
      [gain ? 0.35 : 0.3, x * 0.55, 0.2]
    ];
    return { tmb, get, practical: (gain ? 37.4 : loss ? 28.6 : 33) * i.kg, kcal, adj: (kcal - get) / get, rate, kgw: r2(kgw), ratePct, band: R8, water: i.kg * 0.04, p, f, c, pR, fR, fiber: Math.round(kcal / 1000 * 12), dist };
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
    inp.goal = GOAL_OLD[inp.goal] || inp.goal;
    if (!saved.goal && c.weekly_target != null && c.weekly_target !== '' && lastW && window.JMGoals) {   // sin cálculo guardado: parte del ritmo de la ficha
      const b = JMGoals.rateBand(Number(c.weekly_target), Number(lastW)); if (b) { inp.goal = b.l; if (b.s) inp.rP = Math.abs(b.pct); }
    }
    const box = document.createElement('details'); box.className = 'card calc'; if (!hasPlan) box.open = true;
    const o = (list, v) => list.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
    box.innerHTML = `<summary><b>${ic('chart')} Calculadora de necesidades y macros</b><small class="muted">Mifflin-St Jeor · actividad · objetivo</small></summary>
      <div class="form-grid three calc-in">
        <label>Género<select name="sex">${o(['Masculino', 'Femenino'], inp.sex)}</select></label>
        <label>Edad (años)<input name="age" type="number" min="12" max="99" value="${esc(inp.age)}"></label>
        <label>Altura (cm)<input name="cm" type="number" min="120" max="230" value="${esc(inp.cm)}"></label>
        <label>Peso (kg)${lastW ? ` <small class="muted">· último check-in ${fmtKg(lastW)}</small>` : ''}<input name="kg" type="number" step="0.1" min="30" max="250" value="${esc(inp.kg)}"></label>
        <label>Objetivo<select name="goal">${o(GOALS, inp.goal)}</select></label>
        <label data-rp>Ritmo (% del peso por semana)<input name="rP" type="number" step="0.05" min="0" max="2" inputmode="decimal" value="${esc(inp.rP || '')}"></label>
        <label>Nivel de actividad<select name="act">${o(ACT.map(a => a[0]), inp.act)}</select></label>
        <label>Proteína (g por kg)<input name="pR" type="number" step="0.1" min="0.8" max="3.5" inputmode="decimal" value="${esc(inp.pR || '')}"></label>
        <label>Grasas (g por kg)<input name="fR" type="number" step="0.1" min="0.3" max="2" inputmode="decimal" value="${esc(inp.fR || '')}"></label>
      </div>
      <p class="muted small">Pon los gramos por kilo de proteína y grasa que quieras (p. ej. 1,8 y 0,9): se multiplican por el peso y el resto de calorías del objetivo va a carbohidratos. Vacío = valor por defecto del objetivo.</p>
      <p class="muted small" data-actd></p>
      <div data-out></div>`;
    form.parentNode.insertBefore(box, form);
    const get = () => { const v = n => box.querySelector(`[name=${n}]`).value, dec = n => Number(String(v(n)).replace(',', '.')) || 0; return { sex: v('sex'), age: Number(v('age')), cm: Number(v('cm')), kg: Number(v('kg')), goal: v('goal'), act: v('act'), pR: dec('pR'), fR: dec('fR'), rP: dec('rP') }; };
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
      const def = nutriCalc(Object.assign({}, i, { pR: 0, fR: 0 }));
      box.querySelector('[name=pR]').placeholder = fmtKg(def.pR) + ' (por defecto)'; box.querySelector('[name=fR]').placeholder = fmtKg(def.fR) + ' (por defecto)';
      const rpI = box.querySelector('[name=rP]'), rpL = box.querySelector('[data-rp]'); rpL.hidden = !r.band.s;
      rpI.placeholder = r.band.s ? fmtKg(r.band.mid) + ' (' + r.band.txt.replace(' del peso/sem', '') + ')' : '';
      const outBand = r.band.s && r.ratePct && (r.ratePct < r.band.lo - 1e-9 || (r.band.k !== 'def_agr' && r.band.k !== 'vol_agr' && r.ratePct > r.band.hi + 1e-9));
      const sums = [0, 1, 2].map(j => d.reduce((s, row) => s + row[j], 0));
      out.innerHTML = `<div class="kpis small calc-k">
          <div class="kpi"><small>TMB</small><b>${R(r.tmb)}</b><span>kcal en reposo</span></div>
          <div class="kpi"><small>Mantenimiento</small><b>${R(r.get)}</b><span>práctico: ${R(r.practical)} kcal</span></div>
          <div class="kpi"><small>${esc(r.band.l || 'Objetivo')}</small><b>${R(r.kcal)}</b><span>${r.adj ? (r.adj > 0 ? '+' : '') + R(r.kcal - r.get) + ' kcal · ' : ''}${esc(r.rate)}</span></div>
          <div class="kpi"><small>Agua mínima</small><b>${fmtKg(Math.round(r.water * 10) / 10)} L</b><span>fibra ${r.fiber} g</span></div>
        </div>
        <table class="calc-t"><thead><tr><th></th><th>g/kg</th><th>g</th><th>kcal</th><th>%</th></tr></thead><tbody>
          <tr><td>Proteína</td><td>${fmtKg(r.pR)}</td><td><b>${R(r.p)}</b></td><td>${R(r.p * 4)}</td><td>${pc(r.p * 4 / r.kcal)}</td></tr>
          <tr><td>Grasas</td><td>${fmtKg(r.fR)}</td><td><b>${R(r.f)}</b></td><td>${R(r.f * 9)}</td><td>${pc(r.f * 9 / r.kcal)}</td></tr>
          <tr><td>Carbohidratos</td><td>${fmtKg(Math.round(r.c / i.kg * 100) / 100)}</td><td><b>${R(r.c)}</b></td><td>${R(r.c * 4)}</td><td>${pc(r.c * 4 / r.kcal)}</td></tr>
        </tbody></table>
        ${r.c < 0 ? '<p class="pill red">Con estos datos no quedan calorías para carbohidratos: revisa peso u objetivo.</p>' : ''}
        ${outBand ? `<p class="note small">${fmtKg(r.ratePct)} % por semana no es un «${esc(r.band.l.toLowerCase())}» (${esc(r.band.txt)}).</p>` : ''}
        ${r.kcal < r.tmb ? '<p class="note small">Las calorías quedan por debajo de su TMB: úsalo solo en plazos cortos.</p>' : ''}
        <h4>Reparto en 5 comidas</h4><p class="muted small">% de cada macro por comida (cada columna suma 100) y gramos resultantes.</p>
        <div class="tscroll"><table class="calc-t calc-d"><thead><tr><th>Comida</th><th>% P</th><th>% C</th><th>% G</th><th>P g</th><th>C g</th><th>G g</th></tr></thead><tbody>
          ${MEALS5.map((m, k) => `<tr><td><span class="lg">${m.split(' · ')[0]} · </span>${m.split(' · ')[1]}</td>${[0, 1, 2].map(j => `<td><input type="number" step="0.5" data-pct="${k},${j}" value="${Math.round(d[k][j] * 1000) / 10}"></td>`).join('')}<td><b>${R(d[k][0] * r.p)}</b></td><td><b>${R(d[k][1] * r.c)}</b></td><td><b>${R(d[k][2] * r.f)}</b></td></tr>`).join('')}
          <tr class="tot"><td>Total</td>${sums.map(x => `<td class="${Math.abs(x - 1) > 0.005 ? 'bad' : ''}">${Math.round(x * 1000) / 10}</td>`).join('')}<td>${R(d.reduce((s, row) => s + R(row[0] * r.p), 0))}</td><td>${R(d.reduce((s, row) => s + R(row[1] * r.c), 0))}</td><td>${R(d.reduce((s, row) => s + R(row[2] * r.f), 0))}</td></tr>
        </tbody></table></div>
        <div class="row gap wrap calc-actions">
          <button type="button" class="btn primary small" data-apply>Usar en el plan (kcal, macros, agua y ritmo en la ficha)</button>
          <button type="button" class="btn small" data-meals>Añadir reparto al menú</button>
          ${pct ? '<button type="button" class="btn ghost small" data-reset>Restablecer reparto</button>' : ''}
        </div>`;
      out.querySelectorAll('[data-pct]').forEach(el => el.onchange = () => { const [k, j] = el.dataset.pct.split(',').map(Number); pct = (pct || r.dist).map(row => row.slice()); pct[k][j] = (Number(el.value) || 0) / 100; draw(); });
      const rs = out.querySelector('[data-reset]'); if (rs) rs.onclick = () => { pct = null; draw(); };
      out.querySelector('[data-apply]').onclick = () => {
        const set = (n, v) => { form[n].value = v; };
        set('kcal', R(r.kcal)); set('protein', R(r.p)); set('carbs', Math.max(0, R(r.c))); set('fat', R(r.f)); set('water', fmtKg(Math.round(r.water * 10) / 10) + ' L');
        form.dispatchEvent(new Event('input'));
        DB.update('clients', c.id, { weekly_target: r.kgw }).then(() => { c.weekly_target = r.kgw; }).catch(e => console.warn(e));
        toast(`Valores puestos en el plan y ritmo en la ficha (${sgn(r.kgw)} kg/sem). Revisa y pulsa Guardar plan`, 'ok');
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
      <label class="check"><input type="checkbox" name="show_macros" ${p.show_macros === false ? '' : 'checked'}> Mostrar calorías y macros al cliente</label>
      <details ${p.meals ? 'open' : ''}><summary class="muted small">Menú en texto libre (opcional)</summary><label>Menú / distribución de comidas<textarea name="meals" rows="8" placeholder="Desayuno: …&#10;Comida: …&#10;Cena: …">${esc(p.meals)}</textarea></label></details>
      <label>Recomendaciones<textarea name="notes" rows="4" placeholder="Suplementación, comidas libres, intercambios…">${esc(p.notes)}</textarea></label>
      <div class="row"><small class="muted">${p.updated_at ? 'Actualizado ' + ago(p.updated_at) : 'Sin plan todavía'}</small><span class="grow"></span><button class="btn primary">Guardar plan</button></div>
    </form><div data-mealplan></div>`;
    const f = box.querySelector('[data-nf]');
    calcCard(c, f, !!p.kcal);
    if (window.JMNutri) window.JMNutri.coachEditor(c, box.querySelector('[data-mealplan]'), f).catch(e => { console.error(e); box.querySelector('[data-mealplan]').innerHTML = `<p class="empty">No se pudo cargar el plan por comidas: ${esc(e.message)}</p>`; });
    const calc = () => { const g = n => Number(f[n].value) || 0; const k = g('protein') * 4 + g('carbs') * 4 + g('fat') * 9; f.querySelector('[data-calc]').textContent = k ? `Los macros suman ${k} kcal${g('kcal') ? ` (objetivo ${g('kcal')} kcal)` : ''}.` : ''; };
    f.oninput = calc; calc();
    f.onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      ['kcal', 'protein', 'carbs', 'fat'].forEach(k => { d[k] = num(d[k]); });
      d.show_macros = !!f.show_macros.checked;
      await safe(() => DB.upsert('nutrition_plans', Object.assign({ client_id: c.id, updated_at: new Date().toISOString() }, d), 'client_id'), 'Plan de nutrición guardado');
    };
  }

  // ----- Progreso (compartido)
  const mondayOf = s => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.toISOString().slice(0, 10); };
  const avg = a => { const v = a.filter(x => x != null && !isNaN(x)).map(Number); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const sgn = v => (v == null ? '–' : (v > 0 ? '+' : '') + fmtKg(v));
  // Semanas (lunes a domingo) con el peso medio (pesajes diarios + check-ins) y las escalas del check-in
  function weeklyRows(checkins, daily) {
    const byDate = {};
    daily.forEach(d => { if (d.weight) (byDate[d.date] = byDate[d.date] || []).push(Number(d.weight)); });
    checkins.forEach(k => { if (k.weight) (byDate[k.date] = byDate[k.date] || []).push(Number(k.weight)); });
    const W = {};
    const wk = k => (W[k] = W[k] || { wk: k, w: [], ck: [] });
    Object.entries(byDate).forEach(([d, ws]) => wk(mondayOf(d)).w.push(avg(ws)));
    checkins.forEach(k => wk(mondayOf(k.date)).ck.push(k));
    const rows = Object.values(W).sort((a, b) => a.wk.localeCompare(b.wk)).map(r => {
      const sc = key => avg(r.ck.map(k => k[key]));
      return { wk: r.wk, avg: avg(r.w), n: r.w.length, fatigue: sc('fatigue'), stress: sc('stress'), energy: sc('energy10'), hunger: sc('hunger'), sleep_q: sc('sleep_q'), diet: sc('diet_adh'), train: sc('train_adh'), steps: sc('steps') };
    });
    let prev = null;
    rows.forEach(r => { r.delta = r.avg != null && prev != null ? r.avg - prev : null; if (r.avg != null) prev = r.avg; });
    return rows;
  }
  // Gráfica de líneas con varias series (null = sin dato) y línea de objetivo opcional
  function multiChart(labels, series, { min, max, goal, unit = '', label = 'Gráfica' } = {}) {
    const W = 600, H = 210, P = 44, n = labels.length;
    const all = series.flatMap(s => s.vals).filter(v => v != null).concat(goal != null ? [goal] : []);
    if (!all.length) return '';
    let lo = min != null ? min : Math.min(...all), hi = max != null ? max : Math.max(...all);
    if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
    const x = i => P + (i * (W - P * 2)) / Math.max(1, n - 1);
    const y = v => H - P - ((v - lo) * (H - P * 2)) / (hi - lo);
    const fmt = v => (unit === 'kg' ? fmtKg(v) : String(Math.round(v * 10) / 10).replace('.', ','));
    const paths = series.map(s => {
      let d = '', pen = false;
      s.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; pen = true; });
      const pts = s.vals.map((v, i) => (v == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" class="pt ${s.cls}"><title>${esc(s.name)} · semana del ${fmtDate(labels[i])}: ${fmt(v)}${unit ? ' ' + unit : ''}</title></circle>`)).join('');
      return `<path d="${d}" class="line ${s.cls}"/>${pts}`;
    }).join('');
    const step = Math.max(1, Math.ceil(n / 6));
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      <line x1="${P}" x2="${W - P}" y1="${y(hi)}" y2="${y(hi)}" class="grid"/><line x1="${P}" x2="${W - P}" y1="${y(lo)}" y2="${y(lo)}" class="grid"/>
      <text x="${W - P + 4}" y="${y(hi) + 4}" class="lbl">${fmt(hi)}</text><text x="${W - P + 4}" y="${y(lo) + 4}" class="lbl">${fmt(lo)}</text>
      ${goal != null ? `<line x1="${P}" x2="${W - P}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${P + 4}" y="${y(goal) - 6}" class="lbl goal-t">Objetivo ${fmt(goal)}</text>` : ''}
      ${paths}
      ${labels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" class="lbl" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${fmtDate(l)}</text>` : '')).join('')}
    </svg>${series.length > 1 ? `<div class="legend">${series.map(s => `<span><i class="${s.cls}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}`;
  }

  // Aviso compacto del check-in semanal (cliente): se resalta si toca enviarlo
  function ckCta(lastCk) {
    const days = lastCk ? Math.max(0, Math.floor((Date.now() - new Date(lastCk.date + 'T12:00:00')) / 864e5)) : null, due = days == null || days >= 6;
    return `<section class="ck-cta ${due ? 'due' : ''}"><span class="ck-ic">${ic('camera')}</span><span class="grow"><b>Check-in semanal</b><small>${lastCk ? (days === 0 ? 'Enviado hoy ✓' : `Último hace ${days} día${days === 1 ? '' : 's'}${due ? ' · toca enviarlo' : ''}`) : 'Aún no has enviado ninguno'}</small></span><button type="button" class="btn small ${due ? 'primary' : ''}" data-ck>${due ? 'Enviar' : 'Nuevo'}</button></section>`;
  }
  // Tarjetas plegables (vista del cliente): se ve solo la cabecera hasta tocarla; se recuerda en este dispositivo
  const FOLD_KEY = 'jmfit-folds';
  function foldify(root, scope, openByDefault = []) {
    let st = {}; try { st = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (e) { st = {}; }
    root.querySelectorAll(':scope > section.card, :scope > div > section.card').forEach(sec => {
      const h = [...sec.children].find(x => x.matches('h3, header')), t = h && (h.matches('h3') ? h : h.querySelector('h3'));
      if (!t || sec.classList.contains('fold')) return;
      const name = (t.childNodes[0] && t.childNodes[0].textContent || '').trim(), key = scope + ':' + name;
      sec.classList.add('fold'); h.classList.add('fold-h'); h.setAttribute('role', 'button'); h.tabIndex = 0;
      const set = open => { sec.classList.toggle('shut', !open); h.setAttribute('aria-expanded', String(open)); };
      set(key in st ? !!st[key] : openByDefault.some(k => name.startsWith(k)));
      const tog = e => {
        if (e.target !== h && e.target.closest('select, input, label, a, button')) return;
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); const open = sec.classList.contains('shut'); set(open); st[key] = open;
        try { localStorage.setItem(FOLD_KEY, JSON.stringify(st)); } catch (er) { /* sin almacenamiento: solo esta vez */ }
      };
      h.addEventListener('click', tog); h.addEventListener('keydown', tog);
    });
  }
  async function tabProgress(c, box, asCoach) {
    const [checkins, sessions, logs, daily, photos, progs, pweeks] = await Promise.all([
      DB.list('checkins', { eq: { client_id: c.id }, order: ['date', 'desc'] }),
      clientSessions(c.id),
      clientLogs(c.id),
      DB.list('daily_metrics', { eq: { client_id: c.id }, order: ['date', 'asc'] }).catch(() => []),
      DB.list('checkin_photos', { eq: { client_id: c.id } }).catch(() => []),
      DB.list('programs', { eq: { client_id: c.id } }).catch(() => []),
      DB.list('program_weeks', { eq: { client_id: c.id } }).catch(() => [])
    ]);
    const goals = await loadGoals(c.id);
    const H = exHistory(logs, sessions);
    const perf = Object.entries(H).map(([k, h]) => ({ name: (logs.find(l => String(l.exercise_name).trim().toLowerCase() === k) || {}).exercise_name || k, h, st: stallOf(h), lastDate: h[h.length - 1].date }))
      .sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate))).slice(0, 14);
    const chg4 = h => { const cut = Date.now() - 28 * 864e5; const old = h.filter(x => new Date(x.date) <= cut).pop() || h[0]; const lst = h[h.length - 1]; return old && lst !== old && old.e1 ? (lst.e1 - old.e1) / old.e1 * 100 : null; };
    const done = sessions.filter(s => s.finished_at);
    const best = {};
    logs.forEach(l => { if (l.weight && l.reps) { const e1 = l.weight * (1 + l.reps / 30); if (!best[l.exercise_name] || e1 > best[l.exercise_name].e1) best[l.exercise_name] = { e1, w: l.weight, r: l.reps }; } });
    const prs = Object.entries(best).sort((a, b) => b[1].e1 - a[1].e1).slice(0, 8);
    // Carga, bienestar y sugerencia de descarga (solo entrenador)
    let LP = null, volHtml = ''; const VZ = [];
    if (asCoach && window.JMLoad) {
      if (!S.exercises.length) await loadExercises().catch(() => []);
      const prog = progs.filter(p => p.status !== 'archived').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      const ws = prog ? pweeks.filter(w => w.program_id === prog.id).sort((a, b) => a.week_no - b.week_no) : [];
      const t = today(), past = ws.filter(w => w.start_date <= t), lastDl = past.filter(w => w.kind === 'deload').pop();
      LP = JMLoad.panel({ sessions, checkins, nStall: perf.filter(p => p.st.st === 'stall' || p.st.st === 'down').length,
        sinceDl: prog && past.length ? (lastDl ? past.filter(w => w.week_no > lastDl.week_no).length : past.length) : null,
        nextWeek: ws.find(w => w.start_date > t) || null, hasProgram: !!prog, compact: !!window.JMViz });
      volHtml = JMLoad.doneVolume(logs, S.exercises);
      if (window.JMViz) VZ.push(JMViz.acwr({ sessions, checkins, weeks: ws }));
    }
    const EX = window.JMViz ? JMViz.exercises({ logs, sessions, title: asCoach ? 'Evolución por ejercicio' : 'Tu evolución por ejercicio' }) : null;

    const rows = weeklyRows(checkins, daily), wrows = rows.filter(r => r.avg != null);
    const last = wrows[wrows.length - 1], first = wrows[0];
    const goal = c.goal_weight != null && c.goal_weight !== '' ? Number(c.goal_weight) : null;
    const target = c.weekly_target != null && c.weekly_target !== '' ? Number(c.weekly_target) : null;
    const recent = wrows.slice(-5).map(r => r.delta).filter(v => v != null);
    const pace = recent.length ? avg(recent) : null;
    const left = goal != null && last ? goal - last.avg : null;
    const etaW = left != null && pace && Math.sign(pace) === Math.sign(left) && Math.abs(left) > 0.2 ? Math.ceil(Math.abs(left / pace)) : null;
    const vsT = d => (target == null || d == null ? '' : Math.abs(d - target) <= 0.2 ? 'ok' : 'off');
    const labels = rows.map(r => r.wk);
    const hasFat = rows.some(r => r.fatigue != null || r.stress != null || r.energy != null);

    box.innerHTML = `
      ${!asCoach ? ckCta(checkins[0]) : ''}
      <div class="kpis small">
        <div class="kpi"><small>Peso medio esta semana</small><b>${last ? fmtKg(last.avg) + ' kg' : '–'}</b><span>${last ? `${last.n} pesaje${last.n === 1 ? '' : 's'} · semana del ${fmtDate(last.wk)}` : 'Apunta tu peso en el check-in'}</span></div>
        ${target != null ? (() => { const prevW = wrows.length > 1 ? wrows[wrows.length - 2] : null, exp = prevW ? Math.round((prevW.avg + target) * 10) / 10 : null, bd = window.JMGoals && last ? JMGoals.rateBand(target, last.avg) : null;
          return `<div class="kpi exp"><small>Cambio esperado</small><b>${sgn(target)} kg</b><span>por semana${bd ? ' (' + esc(bd.l.toLowerCase()) + ')' : ''}${exp != null ? ` · ≈ ${fmtKg(exp)} kg esta semana` : ''}</span></div>`; })() : ''}
        <div class="kpi ${last && last.delta != null && vsT(last.delta) === 'off' ? 'warn' : ''}"><small>Cambio semanal</small><b>${last && last.delta != null ? sgn(last.delta) + ' kg' : '–'}</b><span>${target != null && last && last.delta != null ? `${sgn(Math.round((last.delta - target) * 100) / 100)} kg vs lo esperado` : pace != null ? `media ${sgn(pace)} kg/sem` : 'falta otra semana'}</span></div>
        <div class="kpi"><small>${goal != null ? 'Peso objetivo' : 'Desde el inicio'}</small><b>${goal != null ? fmtKg(goal) + ' kg' : first && last && first !== last ? sgn(last.avg - first.avg) + ' kg' : '–'}</b><span>${goal != null && left != null ? (Math.abs(left) <= 0.2 ? '¡Conseguido! 🎉' : `faltan ${fmtKg(Math.abs(left))} kg${etaW ? ` · ~${etaW} sem.` : ''}`) : first && last && first !== last ? 'en ' + (wrows.length - 1) + ' semanas' : '—'}</span></div>
        <div class="kpi"><small>Entrenos · check-ins</small><b>${done.length} · ${checkins.length}</b><span>${checkins[0] ? 'Último check-in ' + fmtDate(checkins[0].date) : '—'}</span></div>
      </div>
      <div data-goals></div>
      ${VZ.map(v => v.html).join('')}
      ${LP ? LP.html : ''}
      ${wrows.length > 1 ? `<section class="card"><h3>Peso medio por semana</h3>${multiChart(labels, [{ name: 'Media semanal', cls: 's1', vals: rows.map(r => r.avg) }], { goal, unit: 'kg', label: 'Peso medio semanal' })}</section>` : ''}
      ${hasFat && !asCoach ? `<section class="card"><h3>Fatiga, estrés y energía</h3>${multiChart(labels, [
        { name: 'Fatiga central', cls: 's3', vals: rows.map(r => r.fatigue) },
        { name: 'Estrés', cls: 's4', vals: rows.map(r => r.stress) },
        { name: 'Energía', cls: 's2', vals: rows.map(r => r.energy) }], { min: 1, max: 10, label: 'Fatiga, estrés y energía (1-10)' })}<p class="muted small">Escala 1-10 de cada check-in semanal.</p></section>` : ''}
      ${wrows.length ? `<section class="card flush"><h3 class="pad">Semana a semana</h3><div class="tscroll"><table class="wk-t"><thead><tr><th>Semana</th><th>Media</th><th>Cambio</th>${target != null ? '<th>vs objetivo</th>' : ''}<th>Fatiga</th><th>Energía</th><th>Nutrición</th><th>Pasos</th></tr></thead><tbody>
        ${rows.slice().reverse().slice(0, 16).map(r => `<tr><td>${fmtDate(r.wk)}</td><td><b>${r.avg != null ? fmtKg(r.avg) : '–'}</b>${r.n > 1 ? `<small class="muted"> (${r.n})</small>` : ''}</td><td class="${r.delta == null ? '' : r.delta < 0 ? 'dn' : 'up'}">${sgn(r.delta)}</td>${target != null ? `<td><span class="pill ${vsT(r.delta) === 'ok' ? 'green' : vsT(r.delta) ? 'amber' : ''}">${r.delta == null ? '–' : sgn(r.delta - target)}</span></td>` : ''}<td>${r.fatigue != null ? fmtKg(r.fatigue) : '–'}</td><td>${r.energy != null ? fmtKg(r.energy) : '–'}</td><td>${r.diet != null ? fmtKg(r.diet) : '–'}</td><td>${r.steps != null ? Math.round(r.steps).toLocaleString('es-ES') : '–'}</td></tr>`).join('')}
      </tbody></table></div>${target != null ? '<p class="muted small pad">«vs objetivo»: diferencia entre lo que ha cambiado y lo que se buscaba esa semana (verde = dentro de ±0,2 kg).</p>' : ''}</section>` : ''}
      ${EX ? EX.html : ''}
      ${perfHtml()}
      ${volHtml}
      ${weeksHtml()}
      ${prs.length && !asCoach ? `<section class="card"><h3>Mejores marcas</h3><ul class="prs">${prs.map(([n, b]) => `<li><span>${esc(n)}</span><b>${fmtKg(b.w)} kg × ${b.r}</b><small>1RM est. ${Math.round(b.e1)} kg</small></li>`).join('')}</ul></section>` : ''}
      <div class="${asCoach ? '' : 'grid2'}">
        ${asCoach ? '' : `<section class="card"><h3>Mis check-ins <small class="muted">${checkins.length}</small></h3><div data-cks>${checkins.length ? '' : '<p class="empty">Aún no hay check-ins.</p>'}</div></section>`}
        <section class="card"><h3>Entrenos <small class="muted">${done.length}</small></h3><div data-ses>${done.length ? '' : '<p class="empty">Aún no hay entrenos registrados.</p>'}</div></section>
      </div>`;
    const ckBtn = box.querySelector('[data-ck]'); if (ckBtn) ckBtn.onclick = () => checkinForm(c);
    if (!asCoach) foldify(box, 'prog', ['Peso medio']);
    VZ.forEach(v => v.wire(box)); if (EX) EX.wire(box);
    goalsSection(c, box, { checkins, daily, logs, sessions }, goals, () => tabProgress(c, box, asCoach), mesoOf(progs, pweeks));
    if (LP) LP.wire(box, async wid => {
      const w = pweeks.find(x => x.id === wid);
      if (!(await confirmBox(`${weekLabel(w)} → descarga: baja al 60 % las series, mantiene las cargas y pone RIR 2. Puedes volver atrás en Rutinas.`, 'Aplicar'))) return;
      await safe(() => DB.rpc('set_week_kind', { p_week: wid, p_kind: 'deload' }), `Semana ${w.week_no}: descarga`);
      tabProgress(c, box, asCoach);
    });
    // Check-ins en lista compacta: solo se abre (y se cargan sus fotos) el que tocas
    const ckBox = box.querySelector('[data-cks]');
    let ckShown = 6;
    const drawCks = () => {
      ckBox.innerHTML = checkins.slice(0, ckShown).map((k, i) => {
        const prev = checkins.slice(i + 1).find(x => x.weight), dw = prev && k.weight ? Number(k.weight) - Number(prev.weight) : null;
        const np = photos.filter(p => p.checkin_id === k.id).length || (k.photo_path ? 1 : 0);
        return `<div class="ck-item" data-ck-i="${i}"><button type="button" class="ck-row ${asCoach && !k.coach_seen ? 'unseen' : ''}">
            <span class="ck-d">${fmtDate(k.date, { day: 'numeric', month: 'short' })}</span>
            <b>${k.weight ? fmtKg(k.weight) + ' kg' : '–'}</b>${dw != null ? `<small class="${dw < 0 ? 'dn' : 'up'}">${dw > 0 ? '+' : ''}${fmtKg(dw)}</small>` : '<small></small>'}
            <span class="ck-m">${k.fatigue != null ? `Fat ${k.fatigue}` : ''}${k.energy10 != null ? ` · En ${k.energy10}` : ''}${k.diet_adh != null ? ` · Nut ${k.diet_adh}` : ''}</span>
            <span class="ck-i">${np ? '📷' + (np > 1 ? np : '') : ''}${k.pains ? ' ⚠️' : ''}${k.coach_reply ? ' 💬' : ''}</span>${ic('down')}</button><div class="ck-open" hidden></div></div>`;
      }).join('') + (checkins.length > ckShown ? `<button type="button" class="btn small ghost block" data-ckmore>Ver más (${checkins.length - ckShown})</button>` : '');
      ckBox.querySelectorAll('.ck-item').forEach(el => {
        el.querySelector('.ck-row').onclick = () => {
          const o = el.querySelector('.ck-open'), i = +el.dataset.ckI;
          if (!o.hidden) { o.hidden = true; o.innerHTML = ''; el.classList.remove('open'); return; }
          const k = checkins[i];
          o.appendChild(checkinCard(k, asCoach, { prev: checkins.slice(i + 1).find(x => x.weight), photos: photos.filter(p => p.checkin_id === k.id) }));
          o.hidden = false; el.classList.add('open');
        };
      });
      const mb = ckBox.querySelector('[data-ckmore]'); if (mb) mb.onclick = () => { ckShown += 10; drawCks(); };
    };
    if (checkins.length && ckBox) drawCks();
    // Entrenos: los últimos; cada uno se abre en su propio apartado
    const sBox = box.querySelector('[data-ses]');
    let sShown = 8;
    const drawSes = () => {
      sBox.innerHTML = `<ul class="sessions">${done.slice(0, sShown).map(s => `<li class="${asCoach && !s.coach_seen ? 'unseen' : ''}"><button type="button" class="srow" data-s="${s.id}"><b>${esc(s.routine_name || 'Entreno')}</b><small>${fmtDate(s.started_at, { weekday: 'short', day: 'numeric', month: 'short' })} · ${Math.max(1, Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 6e4))} min${s.volume ? ' · ' + Math.round(s.volume).toLocaleString('es-ES') + ' kg vol.' : ''}${s.rpe ? ' · RPE ' + s.rpe : ''}</small></button></li>`).join('')}</ul>`
        + (done.length > sShown ? `<button type="button" class="btn small ghost block" data-smore>Ver más (${done.length - sShown})</button>` : '');
      sBox.querySelectorAll('[data-s]').forEach(b => b.onclick = () => sessionModal(byId(done, b.dataset.s), b.closest('li')));
      const mb = sBox.querySelector('[data-smore]'); if (mb) mb.onclick = () => { sShown += 10; drawSes(); };
    };
    if (done.length) drawSes();
    function sessionModal(s, li) {
      const sets = logs.filter(l => l.session_id === s.id).sort((a, b) => a.set_no - b.set_no);
      const prevS = done.find(x => x.routine_name === s.routine_name && x.started_at < s.started_at);
      const prevSets = prevS ? logs.filter(l => l.session_id === prevS.id) : [];
      const groups = {}; sets.forEach(l => { (groups[l.exercise_name] = groups[l.exercise_name] || []).push(l); });
      const top = ls => ls.reduce((m, l) => (e1rm(+l.weight, +l.reps) > e1rm(+m.weight, +m.reps) ? l : m), ls[0]);
      const body = Object.entries(groups).map(([n, ls]) => {
        const pv = prevSets.filter(l => l.exercise_name === n), t = top(ls), tp = pv.length ? top(pv) : null;
        const d = tp ? e1rm(+t.weight, +t.reps) - e1rm(+tp.weight, +tp.reps) : null;
        const st = stallOf((H[String(n).trim().toLowerCase()] || []).filter(x => String(x.date) <= String(s.started_at)));
        return `<div class="sx2"><div class="row gap"><b class="grow">${esc(n)}</b><span class="pill ${STALL_TXT[st.st][0]}">${STALL_TXT[st.st][1]}</span></div>
          <div class="sx-sets">${ls.map(l => `<span>${fmtKg(l.weight)} × ${l.reps ?? '–'}${l.failure ? ' <small>Fallo</small>' : l.rir != null ? ` <small>RIR ${fmtKg(l.rir)}</small>` : l.rpe != null ? ` <small>RPE ${fmtKg(l.rpe)}</small>` : ''}</span>`).join('')}</div>
          ${tp ? `<small class="muted">La vez anterior (${fmtDate(prevS.started_at, { day: 'numeric', month: 'short' })}): ${fmtKg(tp.weight)} × ${tp.reps} → hoy ${fmtKg(t.weight)} × ${t.reps} <b class="${d > 0.5 ? 'dn' : d < -0.5 ? 'up' : ''}">${d > 0.5 ? '▲ mejor' : d < -0.5 ? '▼ peor' : '= igual'}</b></small>` : ''}</div>`;
      }).join('') || '<p class="empty">Sin series registradas</p>';
      const m0 = modal(`${s.routine_name || 'Entreno'} · ${fmtDate(s.started_at, { weekday: 'long', day: 'numeric', month: 'long' })}`,
        `<p class="muted small">${Math.max(1, Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 6e4))} min${s.volume ? ' · ' + Math.round(s.volume).toLocaleString('es-ES') + ' kg de volumen' : ''}${s.rpe ? ' · RPE de la sesión ' + s.rpe : ''}</p>${body}${s.notes ? `<p class="note">${nl2br(s.notes)}</p>` : ''}
        ${asCoach ? `<div class="row gap wrap sx-acts"><button type="button" class="btn small" data-sedit>${ic('edit')} Editar entreno</button><button type="button" class="btn small ghost danger" data-sdel>${ic('trash')} Borrar entreno</button></div>` : ''}`, { wide: true });
      if (asCoach) {
        m0.querySelector('[data-sedit]').onclick = () => editSession(s, sets);
        m0.querySelector('[data-sdel]').onclick = async () => {
          if (!(await confirmBox(`Se borrará «${s.routine_name || 'Entreno'}» del ${fmtDate(s.started_at, { day: 'numeric', month: 'long' })} con sus ${sets.length} series. No se puede deshacer.`, 'Borrar'))) return;
          await safe(() => DB.remove('sessions', s.id), 'Entreno borrado');
          tabProgress(c, box, asCoach);
        };
      }
      if (asCoach && !s.coach_seen) { s.coach_seen = true; li && li.classList.remove('unseen'); DB.update('sessions', s.id, { coach_seen: true }).catch(() => {}); }
    }
    // Entrenador: corregir un entreno mal registrado (fecha, duración, RPE, nota y cada serie) o añadir/quitar series
    function editSession(s, sets0) {
      const rows = sets0.map(l => ({ id: l.id, ex: l.exercise_name, w: l.weight ?? '', r: l.reps ?? '', x: l.failure ? 'F' : l.rir != null ? String(Number(l.rir)) : '', rpe: l.rpe, rid: l.routine_item_id, lin: l.lineage_id }));
      const dur0 = Math.max(1, Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 6e4));
      const loc = d => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
      const exs = () => [...new Set(rows.map(r => r.ex))];
      const rowHtml = (r, k) => `<div class="se-row" data-k="${k}"><input inputmode="decimal" data-f="w" value="${esc(r.w)}" placeholder="kg" aria-label="kg"><span>×</span><input inputmode="numeric" data-f="r" value="${esc(r.r)}" placeholder="reps" aria-label="reps">
        <select data-f="x" aria-label="RIR"><option value="">RIR –</option>${['F', '0', '1', '2', '3', '4', '5', '6'].map(v => `<option value="${v}" ${r.x === v ? 'selected' : ''}>${v === 'F' ? 'Fallo' : 'RIR ' + v}</option>`).join('')}</select>
        <button type="button" class="icon-btn sm" data-rm aria-label="Quitar serie">${ic('trash')}</button></div>`;
      const m = modal('Editar entreno', `
        <div class="form-grid">
          <label>Rutina<input name="rn" value="${esc(s.routine_name || '')}" maxlength="120"></label>
          <label>Fecha y hora<input type="datetime-local" name="at" value="${loc(s.started_at)}" required></label>
          <label>Duración (min)<input type="number" name="dur" min="5" max="300" value="${dur0}"></label>
          <label>RPE de la sesión<input type="number" name="rpe" min="1" max="10" value="${esc(s.rpe ?? '')}"></label>
        </div>
        <label>Comentario<textarea name="notes" rows="2">${esc(s.notes || '')}</textarea></label>
        <div data-sets></div>
        <div class="row gap wrap"><input class="grow" list="se-ex" data-newex placeholder="Añadir otro ejercicio…"><datalist id="se-ex">${(S.exercises || []).map(e => `<option value="${esc(e.name)}">`).join('')}</datalist><button type="button" class="btn small" data-addex>${ic('plus')} Añadir</button></div>`, {
        submitLabel: 'Guardar cambios', wide: true,
        onSubmit: async (f, fd) => {
          const at = new Date(fd.get('at')), dur = Math.max(5, Math.min(300, parseInt(fd.get('dur'), 10) || dur0));
          if (isNaN(at)) { toast('Pon una fecha válida', 'err'); return false; }
          const ok = rows.filter(r => r.ex && (num(r.w) != null || parseInt(r.r, 10) > 0));
          let vol = 0; const n = {};
          await safe(async () => {
            const keep = new Set(ok.filter(r => r.id).map(r => r.id));
            for (const l of sets0) if (!keep.has(l.id)) await DB.remove('set_logs', l.id);
            for (const r of ok) {
              n[r.ex] = (n[r.ex] || 0) + 1;
              const kg = num(r.w), reps = parseInt(r.r, 10);
              const d = { exercise_name: r.ex, set_no: n[r.ex], weight: kg, reps: isNaN(reps) ? null : reps, rir: r.x === 'F' ? 0 : r.x === '' ? null : Number(r.x) };
              if (r.x === 'F') d.failure = true; else if (sets0.some(l => l.failure)) d.failure = false;
              if (kg && !isNaN(reps)) vol += kg * reps;
              if (r.id) await DB.update('set_logs', r.id, d);
              else await DB.insert('set_logs', [Object.assign({ session_id: s.id, client_id: c.id, created_at: at.toISOString() }, r.rid ? { routine_item_id: r.rid } : {}, r.lin ? { lineage_id: r.lin } : {}, d)]);
            }
            await DB.update('sessions', s.id, { routine_name: String(fd.get('rn') || '').trim() || s.routine_name, started_at: at.toISOString(), finished_at: new Date(at.getTime() + dur * 6e4).toISOString(), rpe: num(fd.get('rpe')), notes: fd.get('notes') || null, volume: Math.round(vol) });
          }, 'Entreno corregido');
          tabProgress(c, box, asCoach);
        }
      });
      const host = m.querySelector('[data-sets]');
      const draw = () => {
        host.innerHTML = exs().map(ex => `<div class="se-ex"><b>${esc(ex)}</b>${rows.map((r, k) => [r, k]).filter(([r]) => r.ex === ex).map(([r, k]) => rowHtml(r, k)).join('')}
          <button type="button" class="btn small ghost" data-adds="${esc(ex)}">${ic('plus')} Serie</button></div>`).join('') || '<p class="empty small">Sin series.</p>';
        host.querySelectorAll('.se-row').forEach(el => {
          const r = rows[+el.dataset.k];
          el.querySelectorAll('[data-f]').forEach(i => { i.oninput = i.onchange = () => { r[i.dataset.f] = String(i.value).replace(',', '.'); }; });
          el.querySelector('[data-rm]').onclick = () => { rows.splice(+el.dataset.k, 1); draw(); };
        });
        host.querySelectorAll('[data-adds]').forEach(b => b.onclick = () => { const ex = b.dataset.adds, last = [...rows].reverse().find(r => r.ex === ex) || {}; rows.splice(rows.lastIndexOf(last) + 1 || rows.length, 0, { ex, w: last.w ?? '', r: '', x: '', rid: last.rid, lin: last.lin }); draw(); });
      };
      m.querySelector('[data-addex]').onclick = () => { const i = m.querySelector('[data-newex]'), ex = i.value.trim(); if (!ex) return; rows.push({ ex, w: '', r: '', x: '' }); i.value = ''; draw(); };
      draw();
    }
    function perfHtml() {
      if (!perf.length) return '';
      const w4 = (() => { const r = wrows.slice(-5); return r.length > 1 ? r[r.length - 1].avg - r[0].avg : null; })();
      const ch = perf.map(p => chg4(p.h)).filter(v => v != null), mch = ch.length ? ch.sort((a, b) => a - b)[Math.floor(ch.length / 2)] : null;
      const nSt = perf.filter(p => p.st.st === 'stall' || p.st.st === 'down').length;
      let tip = '';
      if (w4 != null && mch != null) {
        if (w4 < -0.3 && mch >= -1) tip = `👍 Ha bajado ${fmtKg(Math.abs(w4))} kg en 4 semanas manteniendo o subiendo la fuerza (${mch >= 0 ? '+' : ''}${fmtKg(mch)} %).`;
        else if (w4 < -0.3) tip = `⚠️ Baja peso (${sgn(w4)} kg) y también rendimiento (${fmtKg(mch)} %): revisa calorías, sueño o mete una descarga.`;
        else if (w4 > 0.3 && mch > 1) tip = `👍 Sube peso (${sgn(w4)} kg) y fuerza (+${fmtKg(mch)} %).`;
        else if (w4 > 0.3) tip = `⚠️ Sube peso (${sgn(w4)} kg) sin mejorar la fuerza (${fmtKg(mch)} %).`;
        else tip = `Peso estable (${sgn(w4)} kg) · fuerza ${mch >= 0 ? '+' : ''}${fmtKg(mch)} % en 4 semanas.`;
      }
      return `<section class="card flush"><h3 class="pad">Rendimiento por ejercicio</h3>
        ${tip || nSt ? `<p class="small pad">${tip}${nSt ? `${tip ? '<br>' : ''}${nSt >= 2 ? '⚠️ ' : ''}${nSt} ejercicio${nSt > 1 ? 's' : ''} sin mejorar en 3+ sesiones${nSt >= 2 ? ': valora una descarga o cambiar el estímulo' : ''}.` : ''}</p>` : ''}
        <div class="tscroll"><table class="wk-t"><thead><tr><th>Ejercicio</th><th>Última</th><th>Mejor 1RM est.</th><th>4 sem.</th><th>Estado</th></tr></thead><tbody>
        ${perf.map(p => { const l = p.h[p.h.length - 1], b = p.h.reduce((m, x) => (x.e1 > m.e1 ? x : m), p.h[0]), c4 = chg4(p.h), [cls, txt] = STALL_TXT[p.st.st];
          return `<tr><td>${esc(p.name)}</td><td><b>${fmtKg(l.w)}×${l.r}</b> <small class="muted">${fmtDate(l.date, { day: 'numeric', month: 'short' })}</small></td><td>${Math.round(b.e1)} kg</td><td class="${c4 == null ? '' : c4 > 0.5 ? 'dn' : c4 < -0.5 ? 'up' : ''}">${c4 == null ? '–' : (c4 > 0 ? '+' : '') + fmtKg(c4) + ' %'}</td><td><span class="pill ${cls}">${txt}${p.st.st === 'stall' || p.st.st === 'down' ? ' · ' + p.st.since + ' ses.' : ''}</span></td></tr>`; }).join('')}
        </tbody></table></div><p class="muted small pad">1RM estimado con la mejor serie de cada sesión. «Estancado»: 3 o más sesiones sin superar su mejor marca.</p></section>`;
    }
    function weeksHtml() {
      const prog = progs.filter(p => p.status !== 'archived').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      if (!prog) return '';
      const ws = pweeks.filter(w => w.program_id === prog.id && (asCoach || w.published)).sort((a, b) => a.week_no - b.week_no);
      if (!ws.length) return '';
      const t = today(), cur = ws.filter(w => w.start_date <= t).pop();
      const cnt = k => ws.filter(w => (w.kind || 'normal') === k).length;
      const past = ws.filter(w => w.start_date <= t), lastDl = past.filter(w => w.kind === 'deload').pop();
      const sinceDl = lastDl ? past.filter(w => w.week_no > lastDl.week_no).length : past.length;
      return `<section class="card"><h3>Semanas del programa <small class="muted">${esc(prog.name)}</small></h3>
        <div class="wkline">${ws.map(w => `<span class="wkb k-${w.kind || 'normal'} ${cur && cur.id === w.id ? 'cur' : ''}" title="${esc(weekLabel(w))} · ${fmtDate(w.start_date)}">S${w.week_no}<small>${(KINDS[w.kind] || KINDS.normal)[0]}</small></span>`).join('')}</div>
        <div class="kpis small">
          <div class="kpi"><small>Normales</small><b>${cnt('normal')}</b></div><div class="kpi"><small>Mantenimiento</small><b>${cnt('maintenance')}</b></div>
          <div class="kpi"><small>Intensidad</small><b>${cnt('intensity')}</b></div><div class="kpi"><small>Descargas</small><b>${cnt('deload')}</b><span>${lastDl ? 'última: S' + lastDl.week_no : ws.some(w => w.kind === 'deload' && w.start_date > t) ? 'próxima: S' + ws.find(w => w.kind === 'deload' && w.start_date > t).week_no : 'ninguna aún'}</span></div>
        </div>
        <p class="small ${sinceDl >= 6 ? '' : 'muted'}">${sinceDl >= 6 ? '⚠️ ' : ''}${sinceDl} semana${sinceDl === 1 ? '' : 's'} desde la última descarga${sinceDl >= 6 ? ': suele tocar descarga cada 4-8 semanas, mira la fatiga y si hay ejercicios estancados.' : '.'}</p></section>`;
    }
  }

  // ----- Ficha del cliente (entrenador)
  const ageOf = b => { if (!b) return null; const d = new Date(b + 'T12:00:00'), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--; return a; };
  // ----- Revisiones del cliente: todos sus check-ins, con filtros; cada uno se abre entero al tocarlo
  async function tabReviews(c, box) {
    const [checkins, photos] = await Promise.all([
      DB.list('checkins', { eq: { client_id: c.id }, order: ['date', 'desc'] }),
      DB.list('checkin_photos', { eq: { client_id: c.id } }).catch(() => [])]);
    if (!checkins.length) { box.innerHTML = '<p class="empty">Este cliente todavía no ha enviado ninguna revisión.</p>'; return; }
    const nPh = k => photos.filter(p => p.checkin_id === k.id).length || (k.photo_path ? 1 : 0);
    const FIL = [['all', 'Todas'], ['pend', 'Sin revisar'], ['fotos', 'Con fotos'], ['dolor', 'Con molestias']];
    const test = { all: () => true, pend: k => !k.coach_seen, fotos: k => nPh(k) > 0, dolor: k => !!k.pains };
    let fil = 'all';
    const first = checkins[checkins.length - 1], lastW = checkins.find(k => k.weight), firstW = checkins.slice().reverse().find(k => k.weight);
    const draw = () => {
      const list = checkins.filter(test[fil]);
      box.innerHTML = `<div class="kpis small">
          <div class="kpi"><small>Revisiones</small><b>${checkins.length}</b><span>desde ${fmtDate(first.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
          <div class="kpi ${checkins.some(k => !k.coach_seen) ? 'warn' : ''}"><small>Sin revisar</small><b>${checkins.filter(k => !k.coach_seen).length}</b><span>${checkins[0] ? 'última ' + fmtDate(checkins[0].date, { day: 'numeric', month: 'short' }) : ''}</span></div>
          <div class="kpi"><small>Peso</small><b>${lastW ? fmtKg(lastW.weight) + ' kg' : '–'}</b><span>${lastW && firstW && lastW !== firstW ? sgn(lastW.weight - firstW.weight) + ' kg desde la primera' : '—'}</span></div>
        </div>
        <div class="np-plans">${FIL.map(([k, l]) => `<button type="button" class="chip ${fil === k ? 'on' : ''}" data-f="${k}">${l} <small>${checkins.filter(test[k]).length}</small></button>`).join('')}</div>
        <section class="card flush">${list.length ? list.map(k => {
          const i = checkins.indexOf(k), prev = checkins.slice(i + 1).find(x => x.weight), dw = prev && k.weight ? Number(k.weight) - Number(prev.weight) : null, np = nPh(k);
          return `<div class="ck-item" data-id="${k.id}"><button type="button" class="ck-row ${!k.coach_seen ? 'unseen' : ''}">
            <span class="ck-d">${fmtDate(k.date, { day: 'numeric', month: 'short', year: '2-digit' })}</span>
            <b>${k.weight ? fmtKg(k.weight) + ' kg' : '–'}</b>${dw != null ? `<small class="${dw < 0 ? 'dn' : 'up'}">${dw > 0 ? '+' : ''}${fmtKg(dw)}</small>` : '<small></small>'}
            <span class="ck-m">${[k.train_adh != null ? `Ent ${k.train_adh}` : '', k.diet_adh != null ? `Nut ${k.diet_adh}` : '', k.fatigue != null ? `Fat ${k.fatigue}` : '', k.energy10 != null ? `En ${k.energy10}` : ''].filter(Boolean).join(' · ')}</span>
            <span class="ck-i">${np ? '📷' + (np > 1 ? np : '') : ''}${k.pains ? ' ⚠️' : ''}${k.coach_reply ? ' 💬' : ''}${!k.coach_seen ? ' <i class="dot"></i>' : ''}</span>${ic('down')}</button><div class="ck-open" hidden></div></div>`;
        }).join('') : '<p class="empty">Ninguna revisión con este filtro.</p>'}</section>
        <p class="muted small">Toca una revisión para verla entera (medidas, respuestas, fotos) y responderla.</p>`;
      box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { fil = b.dataset.f; draw(); });
      box.querySelectorAll('.ck-item').forEach(el => {
        el.querySelector('.ck-row').onclick = () => {
          const o = el.querySelector('.ck-open');
          if (!o.hidden) { o.hidden = true; o.innerHTML = ''; el.classList.remove('open'); return; }
          const k = checkins.find(x => x.id === el.dataset.id), i = checkins.indexOf(k);
          o.appendChild(checkinCard(k, true, { prev: checkins.slice(i + 1).find(x => x.weight), photos: photos.filter(p => p.checkin_id === k.id) }));
          o.hidden = false; el.classList.add('open');
        };
      });
    };
    draw();
  }

  async function tabFicha(c, box) {
    const [checkins, daily, cons] = await Promise.all([
      DB.list('checkins', { eq: { client_id: c.id }, order: ['date', 'desc'] }),
      DB.list('daily_metrics', { eq: { client_id: c.id }, order: ['date', 'asc'] }).catch(() => []),
      'consent_version' in c ? DB.list('consents', { eq: { client_id: c.id }, order: ['created_at', 'desc'], limit: 10 }).catch(() => []) : Promise.resolve(null)
    ]);
    const wrows = weeklyRows(checkins, daily).filter(r => r.avg != null);
    const cur = wrows[wrows.length - 1], ini = wrows[0];
    const age = ageOf(c.birth_date), h = Number(c.height_cm) || null;
    const bmi = h && cur ? cur.avg / ((h / 100) ** 2) : null;
    const since = c.start_date || (ini && ini.wk) || (c.created_at && c.created_at.slice(0, 10));
    const weeks = since ? Math.max(0, Math.round((Date.now() - new Date(since + 'T12:00:00')) / (7 * 864e5))) : null;
    const lastCk = checkins[0];
    const refW = cur ? cur.avg : (checkins.find(k => k.weight) || {}).weight;
    const bandF = window.JMGoals && refW && c.weekly_target != null && c.weekly_target !== '' ? JMGoals.rateBand(Number(c.weekly_target), Number(refW)) : null;
    const item = (l, v) => `<div><small>${l}</small><b>${v}</b></div>`;
    box.innerHTML = `
      <section class="card"><h3>Resumen</h3><div class="ficha-sum">
        ${item('Edad', age != null ? age + ' años' : '–')}${item('Sexo', { male: 'Hombre', female: 'Mujer', other: 'Otro' }[c.sex] || '–')}${item('Altura', h ? fmtKg(h) + ' cm' : '–')}
        ${item('Peso inicial', ini ? fmtKg(ini.avg) + ' kg' : '–')}${item('Peso actual (media)', cur ? fmtKg(cur.avg) + ' kg' : '–')}${item('Cambio total', ini && cur && ini !== cur ? sgn(cur.avg - ini.avg) + ' kg' : '–')}
        ${item('Peso objetivo', c.goal_weight ? fmtKg(c.goal_weight) + ' kg' : '–')}${item('Ritmo buscado', c.weekly_target != null && c.weekly_target !== '' ? sgn(Number(c.weekly_target)) + ' kg/sem' + (bandF ? `<small class="muted"> · ${esc(bandF.l)}${bandF.s ? ' (' + fmtKg(Math.abs(bandF.pct)) + ' %)' : ''}</small>` : '') : '–')}${item('IMC', bmi ? fmtKg(bmi) : '–')}
        ${item('En el equipo', weeks != null ? weeks + ' semanas' : '–')}${item('Último check-in', lastCk ? fmtDate(lastCk.date) : '–')}${item('Fatiga (último)', lastCk && lastCk.fatigue ? lastCk.fatigue + '/10' : '–')}
      </div>${lastCk && (lastCk.pains || lastCk.fatigue_muscles) ? `<p class="small note">⚠️ ${esc([lastCk.pains, lastCk.fatigue_muscles].filter(Boolean).join(' · '))}</p>` : ''}</section>
      <form class="card" data-ficha><h3>Datos de la ficha</h3>
        <div class="form-grid">
          <label>Fecha de nacimiento<input type="date" name="birth_date" value="${esc(c.birth_date || '')}"></label>
          <label>Sexo<select name="sex">${[['', '—'], ['male', 'Hombre'], ['female', 'Mujer'], ['other', 'Otro']].map(([v, l]) => `<option value="${v}" ${(c.sex || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Altura (cm)<input type="number" step="0.5" inputmode="decimal" name="height_cm" value="${esc(c.height_cm ?? '')}"></label>
          <label>Empezó el<input type="date" name="start_date" value="${esc(c.start_date || '')}"></label>
          <label>Peso objetivo (kg)<input type="number" step="0.1" inputmode="decimal" name="goal_weight" value="${esc(c.goal_weight ?? '')}"></label>
          ${window.JMGoals ? `<label>Ritmo buscado${refW ? ` <small class="muted">con ${fmtKg(Math.round(refW * 10) / 10)} kg</small>` : ''}<select data-band ${refW ? '' : 'disabled title="Hace falta un peso registrado"'}><option value="">— elegir —</option>${JMGoals.RATES.map(r => `<option value="${r.k}" ${bandF && bandF.k === r.k ? 'selected' : ''}>${esc(r.l)} · ${esc(r.txt)}</option>`).join('')}</select></label>` : ''}
          <label>Cambio por semana buscado (kg)<input type="number" step="0.05" inputmode="decimal" name="weekly_target" value="${esc(c.weekly_target ?? '')}" placeholder="-0,5 para bajar · 0,25 para subir"></label>
          <label class="full">Objetivo<input name="goal" value="${esc(c.goal || '')}" placeholder="Ej: perder grasa manteniendo fuerza"></label>
          <label class="full">Actividad diaria y trabajo<textarea name="activity" rows="2" placeholder="Trabajo de oficina, 8.000 pasos, turnos…">${esc(c.activity || '')}</textarea></label>
          <label class="full">Lesiones o patologías<textarea name="injuries" rows="2">${esc(c.injuries || '')}</textarea></label>
          <label class="full">Notas privadas<textarea name="notes" rows="3">${esc(c.notes || '')}</textarea></label>
        </div>
        <p class="muted small">El peso objetivo y el ritmo semanal se usan en Progreso para ver si va bien cada semana (el cliente también lo ve).</p>
        <div class="row gap"><span class="grow"></span><button class="btn primary">Guardar ficha</button></div>
      </form>
      ${cons ? (() => { const acc = cons.find(k => k.action === 'accept'), g = cons.find(k => k.guardian_name);
        return `<section class="card priv-card"><h3>${ic('shield')} Privacidad ${privPill(c) || (c.consent_version ? '<span class="pill green">aceptada</span>' : '')}</h3>
        <ul class="list">
          <li><span class="grow">Consentimiento de datos y salud<small>${c.consent_version ? `Aceptado el ${fmtDate(String(c.consent_at).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })} · texto ${esc(c.consent_version)}` : c.user_id ? 'Aún no lo ha aceptado: se le pedirá al entrar' : 'Se le pedirá cuando entre por primera vez'}</small></span></li>
          <li><span class="grow">Fotos de progreso<small>${c.consent_photos === false ? 'No permite fotos' : 'Permitidas'}</small></span></li>
          ${g ? `<li><span class="grow">Autoriza (menor)<small>${esc(g.guardian_name)} · ${esc(g.guardian_relation || '')}</small></span></li>` : ''}
          ${c.data_request ? `<li><span class="grow">${c.data_request === 'delete' ? 'Ha pedido que se borren sus datos' : 'Ha retirado el consentimiento'}<small>${ago(c.data_request_at)}${c.data_request === 'delete' ? ' · para borrarlo: Editar → Eliminar' : ''}</small></span><button type="button" class="btn small" data-privok>Marcar como atendida</button></li>` : ''}
        </ul>${acc ? `<p class="muted small">Historial: ${cons.length} registro${cons.length === 1 ? '' : 's'}; el último el ${fmtDate(cons[0].created_at.slice(0, 10), { day: 'numeric', month: 'short' })}.</p>` : ''}</section>`; })() : ''}`;
    const pok = box.querySelector('[data-privok]');
    if (pok) pok.onclick = async () => { await safe(() => DB.rpc('clear_data_request', { p_client: c.id }), 'Solicitud marcada como atendida'); c.data_request = null; tabFicha(c, box); };
    if (window.JMForms) window.JMForms.clientBlock(c, box);
    const f = box.querySelector('[data-ficha]');
    const bsel = f.querySelector('[data-band]');
    if (bsel) {
      bsel.onchange = () => { if (bsel.value && refW) f.weekly_target.value = String(JMGoals.rateKg(bsel.value, Number(refW))); };
      f.weekly_target.addEventListener('input', () => { const b = JMGoals.rateBand(num(String(f.weekly_target.value).replace(',', '.')), Number(refW)); bsel.value = b ? b.k : ''; });
    }
    f.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(f), d = {};
      ['birth_date', 'sex', 'start_date', 'goal', 'activity', 'injuries', 'notes'].forEach(k => { d[k] = String(fd.get(k) || '').trim() || null; });
      ['height_cm', 'goal_weight', 'weekly_target'].forEach(k => { d[k] = num(String(fd.get(k) || '').replace(',', '.')); });
      if (d.weekly_target != null && Math.abs(d.weekly_target) > 2) { toast('El cambio por semana parece demasiado grande (máx. ±2 kg)', 'err'); return; }
      try { await safe(() => DB.update('clients', c.id, d), 'Ficha guardada'); render(); } catch (err) { /* ya avisado */ }
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
        dropSheet(); if (after) after(r);
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
    $app.querySelector('[data-refresh]').onclick = () => { dropSheet(); render(); };
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
        dropSheet();
        if (fd.get('url').trim()) { await safe(() => getSheet(true), 'Hoja conectada ✔'); }
        render();
      }
    });
  }

  // ----- Tarjeta de check-in (Progreso del cliente y bandeja de Revisiones)
  function checkinCard(k, asCoach, { who, prev, photos } = {}) {
    const el = document.createElement('article'); el.className = 'checkin' + (asCoach && !k.coach_seen ? ' unseen' : '');
    const meas = [['Cintura', k.waist], ['Cadera', k.hip], ['Pecho', k.chest], ['Brazo', k.arm], ['Muslo', k.thigh], ['Gemelo', k.calf], ['Cuello', k.neck], ['Hombros', k.shoulders], ['% grasa', k.body_fat]].filter(m => m[1]);
    const old = [['Energía', k.energy], ['Sueño', k.sleep], ['Adherencia', k.adherence]].filter(m => m[1]);
    const ten = Object.entries(CK_SCALES).filter(([key]) => k[key] != null);
    const short = { train_adh: 'Entreno', diet_adh: 'Nutrición', hunger: 'Hambre', satiety: 'Saciedad', fatigue: 'Fatiga', energy10: 'Energía', sleep_q: 'Sueño', stress: 'Estrés', motivation: 'Motivación' };
    const bad = key => ['hunger', 'fatigue', 'stress'].includes(key);       // aquí un número alto es mala señal
    const tone = (key, v) => { const g = bad(key) ? 11 - v : v; return g >= 7 ? 'g' : g >= 5 ? 'm' : 'b'; };
    const texts = Object.entries(CK_TEXTS).filter(([key]) => k[key]);
    const dw = prev && prev.weight && k.weight ? Number(k.weight) - Number(prev.weight) : null;
    el.innerHTML = `${who ? `<a class="ck-who" href="#/cliente/${who.id}/progreso">${esc(who.name)}</a>` : ''}<header><b>${fmtDate(k.date, { weekday: 'long', day: 'numeric', month: 'long' })}</b>${k.weight ? `<span class="pill">${fmtKg(k.weight)} kg${dw != null ? ` · ${dw > 0 ? '+' : ''}${fmtKg(dw)}` : ''}</span>` : ''}${k.source === 'harbiz' ? '<span class="pill">Harbiz</span>' : ''}
        ${asCoach ? `<span class="grow"></span><button type="button" class="icon-btn sm" data-delck aria-label="Borrar check-in" title="Borrar check-in">${ic('trash')}</button>` : ''}</header>
      ${ten.length ? `<div class="ck-grid">${ten.map(([key]) => `<span class="${tone(key, k[key])}"><small>${short[key]}</small><b>${k[key]}</b></span>`).join('')}</div>` : ''}
      ${k.steps != null || k.sleep_h != null ? `<p class="small">${[k.steps != null ? `👣 ${Number(k.steps).toLocaleString('es-ES')} pasos/día` : '', k.sleep_h != null ? `😴 ${fmtKg(k.sleep_h)} h de sueño` : ''].filter(Boolean).join(' · ')}</p>` : ''}
      ${old.length ? `<div class="scores">${old.map(m => `<span>${m[0]} <b>${'●'.repeat(m[1])}${'○'.repeat(Math.max(0, 5 - m[1]))}</b></span>`).join('')}</div>` : ''}
      ${meas.length ? `<p class="small">${meas.map(m => `${m[0]} ${fmtKg(m[1])}${m[0] === "% grasa" ? " %" : " cm"}`).join(' · ')}</p>` : ''}
      ${texts.map(([key, l]) => `<p class="ck-txt"><small>${esc(l)}</small>${nl2br(k[key])}</p>`).join('')}
      <div class="ck-pics" data-photos hidden></div>
      ${k.coach_reply ? `<p class="reply"><b>Respuesta:</b> ${nl2br(k.coach_reply)}</p>` : ''}
      ${asCoach ? `<form class="row gap" data-reply><input name="r" placeholder="${k.coach_reply ? 'Cambiar respuesta…' : 'Responder al check-in…'}"><button class="btn small">${k.coach_seen ? 'Responder' : 'Revisado'}</button></form>` : ''}`;
    // fotos: las de cada postura y, si es antiguo, la única foto que tenía
    const order = p => { const i = CK_POSES.findIndex(x => x[0] === p); return i < 0 ? 10 + (parseInt(String(p).replace(/\D/g, ''), 10) || 0) : i; };
    const label = p => (CK_POSES.find(x => x[0] === p) || [, ''])[1];
    const showPhotos = list => {
      const pics = list.slice().sort((a, b) => order(a.pose) - order(b.pose));
      if (k.photo_path && !pics.some(p => p.path === k.photo_path)) pics.unshift({ path: k.photo_path, pose: '' });
      if (!pics.length) return;
      const box = el.querySelector('[data-photos]'); box.hidden = false;
      box.innerHTML = pics.map((p, i) => `<figure data-pi="${i}"><div class="ph"></div>${label(p.pose) ? `<figcaption>${label(p.pose)}</figcaption>` : ''}</figure>`).join('');
      pics.forEach((p, i) => DB.photoUrl(p.path).then(u => { box.querySelector(`[data-pi="${i}"] .ph`).innerHTML = `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto ${esc(label(p.pose) || 'de progreso')}" loading="lazy"></a>`; }).catch(() => {}));
      el._paths = pics.map(p => p.path);
    };
    if (photos) showPhotos(photos); else DB.list('checkin_photos', { eq: { checkin_id: k.id } }).then(showPhotos).catch(() => showPhotos([]));
    const rf = el.querySelector('[data-reply]');
    if (rf) rf.onsubmit = async e => { e.preventDefault(); const v = rf.r.value.trim(); const patch = { coach_seen: true }; if (v) patch.coach_reply = v; await safe(() => DB.update('checkins', k.id, patch), 'Check-in revisado'); render(); };
    const del = el.querySelector('[data-delck]');
    if (del) del.onclick = async () => {
      if (!(await confirmBox(`¿Borrar el check-in del ${fmtDate(k.date, { day: 'numeric', month: 'long' })}${k.weight ? ` (${fmtKg(k.weight)} kg)` : ''} con sus fotos? No se puede deshacer.`))) return;
      try {
        await safe(() => DB.remove('checkins', k.id), 'Check-in borrado');
        DB.removePhotos(el._paths || []).catch(() => {});
        el.remove(); refreshReviewBadge();
      } catch (e) { /* ya avisado */ }
    };
    return el;
  }

  // ---------- Programas (por ahora: rutinas de cada cliente + catálogo)
  const PROGRAM_TABS = on => `<div class="tabs"><a href="#/programas" class="${on === 'rutinas' ? 'on' : ''}">Rutinas por cliente</a><a href="#/programas/plantillas" class="${on === 'plantillas' ? 'on' : ''}">Plantillas</a><a href="#/programas/ejercicios" class="${on === 'ejercicios' ? 'on' : ''}">Ejercicios</a></div>`;

  // ---------- Plantillas: semanas base (PPL, torso/pierna, anterior/posterior…) para copiar a un cliente y adaptarlas
  const TPL = (name, sets, reps, rest, rir) => ({ exercise_name: name, sets, reps, rest_sec: rest, target_rir: rir });
  const TEMPLATE_PRESETS = [
    { name: 'Push · Pull · Legs (3 días)', notes: 'Empuje, tirón y pierna. Repetible en 6 días para más frecuencia.', routines: [
      { name: 'PUSH', day: 1, items: [TPL('Press de banca', 4, '6-8', 150, 2), TPL('Press inclinado con mancuernas', 3, '8-10', 120, 2), TPL('Press militar', 3, '6-8', 150, 2), TPL('Elevaciones laterales', 3, '12-15', 60, 1), TPL('Fondos en paralelas', 3, '8-12', 90, 2), TPL('Extensión de tríceps en polea', 3, '10-12', 60, 1)] },
      { name: 'PULL', day: 3, items: [TPL('Dominadas', 4, '6-8', 150, 2), TPL('Remo con barra', 3, '8-10', 120, 2), TPL('Jalón al pecho', 3, '10-12', 90, 2), TPL('Face pull', 3, '12-15', 60, 1), TPL('Curl de bíceps con barra', 3, '8-10', 60, 1), TPL('Curl martillo', 3, '10-12', 60, 1)] },
      { name: 'LEGS', day: 5, items: [TPL('Sentadilla trasera', 4, '5-8', 180, 2), TPL('Peso muerto rumano', 3, '8-10', 150, 2), TPL('Prensa de piernas', 3, '10-12', 120, 2), TPL('Curl femoral tumbado', 3, '10-12', 90, 1), TPL('Extensión de cuádriceps', 3, '12-15', 60, 1), TPL('Elevación de gemelos de pie', 4, '10-15', 60, 1)] }] },
    { name: 'Torso / Pierna (4 días)', notes: 'Dos torsos y dos piernas por semana, A y B.', routines: [
      { name: 'Torso A', day: 1, items: [TPL('Press de banca', 4, '6-8', 150, 2), TPL('Remo con barra', 4, '6-8', 150, 2), TPL('Press de hombro con mancuernas', 3, '8-10', 90, 2), TPL('Jalón al pecho', 3, '10-12', 90, 2), TPL('Curl de bíceps con barra', 2, '10-12', 60, 1), TPL('Extensión de tríceps en polea', 2, '10-12', 60, 1)] },
      { name: 'Pierna A', day: 2, items: [TPL('Sentadilla trasera', 4, '5-8', 180, 2), TPL('Peso muerto rumano', 3, '8-10', 150, 2), TPL('Extensión de cuádriceps', 3, '12-15', 60, 1), TPL('Curl femoral tumbado', 3, '10-12', 60, 1), TPL('Elevación de gemelos de pie', 3, '10-15', 60, 1)] },
      { name: 'Torso B', day: 4, items: [TPL('Press inclinado con mancuernas', 4, '8-10', 120, 2), TPL('Dominadas', 4, '6-10', 150, 2), TPL('Remo en polea baja', 3, '10-12', 90, 2), TPL('Elevaciones laterales', 3, '12-15', 60, 1), TPL('Face pull', 3, '12-15', 60, 1), TPL('Curl martillo', 2, '10-12', 60, 1)] },
      { name: 'Pierna B', day: 5, items: [TPL('Peso muerto convencional', 3, '4-6', 180, 2), TPL('Prensa de piernas', 3, '10-12', 120, 2), TPL('Sentadilla búlgara', 3, '8-10', 90, 2), TPL('Hip thrust', 3, '8-12', 90, 1), TPL('Crunch abdominal en polea alta', 3, '12-15', 60, 1)] }] },
    { name: 'Anterior / Posterior (4 días)', notes: 'Cadena anterior (empujes y cuádriceps) y posterior (tirones, isquios y glúteo).', routines: [
      { name: 'Anterior A', day: 1, items: [TPL('Sentadilla trasera', 4, '5-8', 180, 2), TPL('Press de banca', 4, '6-8', 150, 2), TPL('Press militar', 3, '8-10', 120, 2), TPL('Extensión de cuádriceps', 3, '12-15', 60, 1), TPL('Elevaciones laterales', 3, '12-15', 60, 1), TPL('Plancha', 3, '30-45 s', 45, null)] },
      { name: 'Posterior A', day: 2, items: [TPL('Peso muerto rumano', 4, '6-8', 150, 2), TPL('Dominadas', 4, '6-8', 150, 2), TPL('Remo con barra', 3, '8-10', 120, 2), TPL('Curl femoral tumbado', 3, '10-12', 60, 1), TPL('Face pull', 3, '12-15', 60, 1), TPL('Curl de bíceps con barra', 3, '10-12', 60, 1)] },
      { name: 'Anterior B', day: 4, items: [TPL('Prensa de piernas', 4, '8-10', 120, 2), TPL('Press inclinado con mancuernas', 4, '8-10', 120, 2), TPL('Fondos en paralelas', 3, '8-12', 90, 2), TPL('Sentadilla búlgara', 3, '8-10', 90, 2), TPL('Extensión de tríceps en polea', 3, '10-12', 60, 1)] },
      { name: 'Posterior B', day: 5, items: [TPL('Hip thrust', 4, '8-10', 120, 2), TPL('Jalón al pecho', 4, '8-10', 120, 2), TPL('Remo en polea baja', 3, '10-12', 90, 2), TPL('Peso muerto rumano', 3, '10-12', 120, 2), TPL('Curl martillo', 3, '10-12', 60, 1), TPL('Elevación de gemelos de pie', 3, '10-15', 60, 1)] }] },
    { name: 'Full body (3 días)', notes: 'Todo el cuerpo en cada sesión; ideal para principiantes o poco tiempo.', routines: [
      { name: 'Full body A', day: 1, items: [TPL('Sentadilla trasera', 3, '6-8', 150, 2), TPL('Press de banca', 3, '6-8', 150, 2), TPL('Remo con barra', 3, '8-10', 120, 2), TPL('Elevaciones laterales', 2, '12-15', 60, 1), TPL('Plancha', 3, '30-45 s', 45, null)] },
      { name: 'Full body B', day: 3, items: [TPL('Peso muerto rumano', 3, '8-10', 150, 2), TPL('Press militar', 3, '6-8', 150, 2), TPL('Jalón al pecho', 3, '10-12', 90, 2), TPL('Sentadilla búlgara', 2, '8-10', 90, 2), TPL('Curl de bíceps con barra', 2, '10-12', 60, 1)] },
      { name: 'Full body C', day: 5, items: [TPL('Prensa de piernas', 3, '10-12', 120, 2), TPL('Press inclinado con mancuernas', 3, '8-10', 120, 2), TPL('Dominadas', 3, '6-10', 120, 2), TPL('Hip thrust', 3, '8-12', 90, 1), TPL('Extensión de tríceps en polea', 2, '10-12', 60, 1)] }] }
  ];
  const tplEmail = () => `plantilla-${crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : Date.now()}@plantillas.invalid`;
  async function createTemplate(name, notes, routines) {
    if (!S.exercises.length) await loadExercises().catch(() => []);
    const [c] = await DB.insert('clients', { name, email: tplEmail(), notes: notes || null, active: false, is_template: true });
    for (const [pos, r] of (routines || []).entries()) {
      const [nr] = await DB.insert('routines', { client_id: c.id, name: r.name, day: r.day || null, position: pos, notes: r.notes || '' });
      const its = r.items.map((i, k) => { const e = S.exercises.find(x => x.name.toLowerCase() === String(i.exercise_name).toLowerCase());
        const d = Object.assign({ routine_id: nr.id, client_id: c.id, position: k, exercise_id: e ? e.id : null, media_url: (e && e.media_url) || '', notes: '', progression: { type: 'none' } }, crypto.randomUUID ? { lineage_id: crypto.randomUUID() } : {}, i, repsRange(i.reps));
        d.load = loadLabel(d); return d; });
      if (its.length) await DB.insert('routine_items', its);
    }
    return c;
  }
  async function copyTemplateTo(tpl, target, replace) {
    const [rs0, its] = await Promise.all([DB.list('routines', { eq: { client_id: tpl.id } }), DB.list('routine_items', { eq: { client_id: tpl.id } })]);
    const rs = rs0.filter(r => !r.program_week_id).sort((a, b) => a.position - b.position);
    if (replace) { const cur = (await DB.list('routines', { eq: { client_id: target.id } })).filter(r => !r.program_week_id); for (const r of cur) await DB.remove('routines', r.id); }
    await copyRoutinesTo(target, rs, its); return rs.length;
  }
  function copyTemplateForm(tpl, after) {
    const cl = S.clients.filter(c => c.active !== false);
    if (!cl.length) return toast('No tienes clientes activos', 'err');
    modal('Copiar «' + tpl.name + '» a un cliente', `<label>Cliente<select name="to">${cl.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <div class="choices"><label class="choice"><input type="radio" name="mode" value="add" checked><span><b>Añadir a sus rutinas fijas</b><small>Lo que ya tiene se mantiene.</small></span></label>
      <label class="choice"><input type="radio" name="mode" value="replace"><span><b>Sustituir sus rutinas fijas</b><small>Borra sus rutinas fijas (no las semanas de programa ni lo entrenado) y pone las de la plantilla.</small></span></label></div>
      <p class="muted small">Después las adaptas al cliente en su ficha y, si quieres, creas un mesociclo a partir de ellas.</p>`, {
      submitLabel: 'Copiar', onSubmit: async (f, fd) => {
        const to = S.clients.find(c => c.id === fd.get('to')), rep = fd.get('mode') === 'replace';
        if (rep && !(await confirmBox(`Se borrarán las rutinas fijas actuales de ${to.name}.`, 'Sustituir'))) return false;
        const n = await safe(() => copyTemplateTo(tpl, to, rep), 'Plantilla copiada');
        if (n != null) { go('#/cliente/' + to.id + '/rutinas'); }
        return after && after();
      }
    });
  }
  function saveAsTemplate(c, routines, items) {
    if (!routines.length) return toast('No hay rutinas que guardar', 'err');
    modal('Guardar como plantilla', `<label>Nombre<input name="name" required maxlength="80" value="${esc(routines.map(r => r.name).join(' · ').slice(0, 60))}"></label><label>Descripción <small class="muted">opcional</small><input name="notes" maxlength="200"></label>
      <p class="muted small">Se guardan ${routines.length} rutina${routines.length === 1 ? '' : 's'} con sus ejercicios, series, reps, RIR y tipo de serie. Las cargas no se copian (son de ${esc(c.name)}).</p>`, {
      submitLabel: 'Guardar plantilla', onSubmit: async (f, fd) => {
        const rs = routines.map(r => ({ name: r.name, day: r.day, notes: r.notes, items: items.filter(i => i.routine_id === r.id).sort((a, b) => a.position - b.position)
          .map(i => ({ exercise_name: i.exercise_name, sets: i.base && i.base.sets != null ? i.base.sets : i.sets, reps: i.reps, rest_sec: i.rest_sec, target_rir: i.base && i.base.target_rir !== undefined ? i.base.target_rir : i.target_rir, target_rpe: i.target_rpe, tempo: i.tempo, notes: i.notes, media_url: i.media_url, progression: i.progression || { type: 'none' } })) }));
        await safe(() => createTemplate(String(fd.get('name')).trim() || 'Plantilla', String(fd.get('notes') || '').trim(), rs), 'Plantilla guardada en Programas');
      }
    });
  }
  async function coachTemplates() {
    shell(COACH_NAV, 'programas', loading(), { title: 'Programas', actions: `<button class="btn primary" data-new>${ic('plus')}<span>Nueva plantilla</span></button>` });
    await loadClients();
    const tpls = S.templates || [];
    const [rs, its] = tpls.length ? await Promise.all([DB.list('routines', { in: { client_id: tpls.map(t => t.id) } }), DB.list('routine_items', { in: { client_id: tpls.map(t => t.id) } })]) : [[], []];
    const box = $app.querySelector('.content');
    const missing = TEMPLATE_PRESETS.filter(p => !tpls.some(t => t.name === p.name));
    box.innerHTML = `${PROGRAM_TABS('plantillas')}
      <p class="muted small">Semanas base para no empezar de cero: ábrelas para ajustarlas, cópialas a un cliente y adáptalas a él. También puedes guardar como plantilla las rutinas de cualquier cliente (botón en su pestaña Rutinas).</p>
      ${missing.length ? `<section class="card"><div class="row gap wrap"><span class="grow"><b>Plantillas base</b><small class="muted">${missing.map(p => esc(p.name)).join(' · ')}</small></span><button class="btn small primary" data-seed>${ic('plus')} Añadir ${missing.length === TEMPLATE_PRESETS.length ? 'las plantillas base' : 'las que faltan'}</button></div></section>` : ''}
      <div class="tpl-grid">${tpls.map(t => { const r = rs.filter(x => x.client_id === t.id && !x.program_week_id).sort((a, b) => (a.day || 9) - (b.day || 9));
        return `<section class="card tpl"><header><b>${esc(t.name)}</b><small class="muted">${r.length} rutina${r.length === 1 ? '' : 's'}${t.notes ? ' · ' + esc(t.notes) : ''}</small></header>
          <ul class="tpl-days">${r.map(x => `<li><span>${x.day ? DIAS[x.day].slice(0, 3) : 'Libre'}</span><b>${esc(x.name)}</b><small>${its.filter(i => i.routine_id === x.id).length} ej.</small></li>`).join('') || '<li class="muted">Sin rutinas</li>'}</ul>
          <div class="row gap wrap"><button class="btn small primary" data-copy="${t.id}">${ic('copy')} Copiar a cliente</button><a class="btn small" href="#/cliente/${t.id}/rutinas">${ic('edit')} Editar</a><button class="btn small ghost" data-dup="${t.id}">Duplicar</button><button class="icon-btn danger" data-del="${t.id}" title="Borrar plantilla">${ic('trash')}</button></div></section>`; }).join('')}</div>
      ${!tpls.length && !missing.length ? '<p class="empty">Sin plantillas.</p>' : ''}`;
    const byT = id => tpls.find(t => t.id === id);
    $app.querySelector('[data-new]').onclick = () => modal('Nueva plantilla', '<label>Nombre<input name="name" required maxlength="80" placeholder="Ej: Torso / Pierna 5 días"></label><label>Descripción <small class="muted">opcional</small><input name="notes" maxlength="200"></label>', {
      submitLabel: 'Crear y editar', onSubmit: async (f, fd) => { const t = await safe(() => createTemplate(String(fd.get('name')).trim() || 'Plantilla', String(fd.get('notes') || '').trim(), []), 'Plantilla creada'); if (t) go('#/cliente/' + t.id + '/rutinas'); } });
    const sd = box.querySelector('[data-seed]'); if (sd) sd.onclick = async () => { sd.disabled = true; await safe(async () => { for (const p of missing) await createTemplate(p.name, p.notes, p.routines); }, 'Plantillas base añadidas'); coachTemplates(); };
    box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copyTemplateForm(byT(b.dataset.copy)));
    box.querySelectorAll('[data-dup]').forEach(b => b.onclick = async () => { const t = byT(b.dataset.dup);
      await safe(async () => { const [c] = await DB.insert('clients', { name: t.name + ' (copia)', email: tplEmail(), notes: t.notes, active: false, is_template: true }); await copyTemplateTo(t, c, false); }, 'Plantilla duplicada'); coachTemplates(); });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const t = byT(b.dataset.del); if (!(await confirmBox(`Se borrará la plantilla «${t.name}». Los clientes a los que ya la copiaste no cambian.`))) return; await safe(() => DB.remove('clients', t.id), 'Plantilla borrada'); coachTemplates(); });
  }
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
    const photos = list.length ? await DB.list('checkin_photos', { in: { checkin_id: list.map(k => k.id) } }).catch(() => []) : [];
    list.forEach(k => {
      const who = byId(clients, k.client_id) || { id: k.client_id, name: 'Cliente' };
      const idx = checkins.indexOf(k);
      const prev = checkins.slice(idx + 1).find(x => x.client_id === k.client_id && x.weight);
      wrap.appendChild(checkinCard(k, true, { who, prev, photos: photos.filter(p => p.checkin_id === k.id) }));
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
      <label class="full">Indicaciones técnicas<textarea name="notes" rows="3">${esc(e.notes)}</textarea></label>
      <div class="full alt-ed" data-alted></div></div>`, {
      danger: isNew ? null : { label: 'Eliminar', run: async () => { if (await confirmBox('¿Eliminar "' + e.name + '" del catálogo? Las rutinas que ya lo usan no cambian.')) { await safe(() => DB.remove('exercises', e.id), 'Eliminado'); render(); } } },
      onSubmit: async (f, fd) => {
        const d = Object.fromEntries(fd); if (!d.name.trim()) return false;
        delete d.alt_add; d.alternatives = altCustom ? alts.slice() : null;
        // sin la actualización 023 la columna no existe: se guarda el resto
        const noAlt = er => /alternatives/.test(er && er.message || '');
        const run = x => (isNew ? DB.insert('exercises', x) : DB.update('exercises', e.id, x));
        await safe(() => run(d).catch(er => { if (!noAlt(er)) throw er; const x = Object.assign({}, d); delete x.alternatives; return run(x); }), isNew ? 'Ejercicio añadido' : 'Guardado');
        render();
      }
    });
    // Cambios en el entreno: los que verá el cliente al pulsar «Cambiar» (automáticos por familia, o los que fijes tú)
    const SW = window.JMSwap, ae = mf.querySelector('[data-alted]');
    let altCustom = Array.isArray(e.alternatives) && e.alternatives.length > 0, alts = [];
    const autoAlts = () => (SW ? SW.altsFor(mf.querySelector('[name=name]').value || e.name || '', S.exercises.map(x => Object.assign({}, x, { alternatives: null }))).list.map(x => x.name) : []);
    alts = altCustom ? e.alternatives.slice() : autoAlts();
    const drawAlt = () => {
      const fam = SW && SW.familyOf(mf.querySelector('[name=name]').value || e.name || '');
      ae.innerHTML = `<h4>Cambios en el entreno <small class="muted">· ${altCustom ? 'los has fijado tú' : fam ? 'automáticos: ' + esc(fam.title.toLowerCase()) : 'sin familia: añade los que quieras'}</small></h4>
        <p class="muted small">Lo que verá el cliente al pulsar «Cambiar» si la máquina está ocupada, en este orden. Quita, ordena o añade; al tocar algo pasan a ser tuyos.</p>
        <ol class="alt-list">${alts.map((n, i) => `<li><span class="grow">${esc(n)}</span><button type="button" class="icon-btn sm" data-aup="${i}" title="Subir">${ic('up')}</button><button type="button" class="icon-btn sm danger" data-adel="${i}" title="Quitar">${ic('trash')}</button></li>`).join('') || '<li class="muted small">Sin cambios: el cliente solo podrá escribir otro.</li>'}</ol>
        <div class="row gap"><input name="alt_add" list="exlist-alt" placeholder="Añadir ejercicio…" class="grow"><button type="button" class="btn small" data-aadd>${ic('plus')} Añadir</button>${altCustom ? '<button type="button" class="btn small ghost" data-areset>Volver a automáticos</button>' : ''}</div>
        <datalist id="exlist-alt">${S.exercises.map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>`;
      const mine = () => { altCustom = true; };
      ae.querySelectorAll('[data-adel]').forEach(b => b.onclick = () => { mine(); alts.splice(+b.dataset.adel, 1); drawAlt(); });
      ae.querySelectorAll('[data-aup]').forEach(b => b.onclick = () => { const i = +b.dataset.aup; if (i > 0) { mine(); [alts[i - 1], alts[i]] = [alts[i], alts[i - 1]]; drawAlt(); } });
      const add = () => { const inp = ae.querySelector('[name=alt_add]'), v = inp.value.trim(); if (!v) return; if (!alts.some(n => n.toLowerCase() === v.toLowerCase())) { mine(); alts.push(v); } drawAlt(); };
      ae.querySelector('[data-aadd]').onclick = add;
      ae.querySelector('[name=alt_add]').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
      const rs = ae.querySelector('[data-areset]'); if (rs) rs.onclick = () => { altCustom = false; alts = autoAlts(); drawAlt(); };
    };
    drawAlt();
    mf.querySelector('[name=name]').addEventListener('change', () => { if (!altCustom) { alts = autoAlts(); drawAlt(); } });
    const pv = mf.querySelector('[data-mprev]'), mi = mf.querySelector('[name=media_url]');
    let shown = mi.value; bindMedia(pv); mi.addEventListener('change', () => { if (mi.value === shown) return; shown = mi.value; pv.innerHTML = mediaFacade(mi.value); bindMedia(pv); });
  }

  // ================================================================ CLIENTE
  const CLIENT_NAV = [
    { key: 'hoy', href: '', icon: 'dumbbell', label: 'Entreno' },
    { key: 'nutricion', href: 'nutricion', icon: 'apple', label: 'Nutrición' },
    { key: 'progreso', href: 'progreso', icon: 'chart', label: 'Progreso' }
  ];

  // ---------- Privacidad (migración 019): consentimiento, mis datos, borrado
  const CONSENT_V = '2026-11-v1';   // cambiar si cambia el texto: se vuelve a pedir la aceptación
  async function refreshClient() { try { const c = await DB.myClient(); if (c) { S.client = c; localStorage.setItem(BOOT_KEY, JSON.stringify({ profile: S.profile, client: c })); } } catch (e) { /* se queda lo que había */ } }
  function consentScreen() {
    const c = S.client, age = ageOf(c.birth_date), minor = age != null && age < 18, under14 = age != null && age < 14;
    $app.innerHTML = `<main class="login consent"><div class="login-card wide">
      <div class="brand big"><img class="brand-logo" src="logo.webp" alt="TEAM JMFIT" width="420" height="219"></div>
      <h2>Antes de empezar, ${esc(c.name.split(' ')[0])}</h2>
      <p class="muted">Para preparar tus entrenos y tu nutrición necesito guardar algunos datos tuyos. Esto es lo que hay que saber:</p>
      <ul class="cs-list">
        <li>${ic('dumbbell')}<span><b>Qué guardo</b>Tus entrenos, tu peso y medidas, cómo te encuentras (sueño, energía, estrés), molestias o lesiones, tu alimentación y, si quieres, fotos de progreso.</span></li>
        <li>${ic('shield')}<span><b>Para qué</b>Solo para planificar y ajustar tu entrenamiento y tu nutrición. No se vende ni se usa para publicidad.</span></li>
        <li>${ic('users')}<span><b>Quién lo ve</b>Solo tú y tu entrenador de TEAM JMFIT. Se guarda en servidores protegidos.</span></li>
        <li>${ic('download')}<span><b>Tus derechos</b>Puedes descargar tus datos, pedir que se borren o retirar este permiso cuando quieras, desde el escudo de arriba.</span></li>
      </ul>
      <form id="cs" class="stack">
        <label class="check"><input type="checkbox" name="policy" required><span>He leído la <a href="privacidad.html" target="_blank" rel="noopener">política de privacidad</a> y acepto el tratamiento de mis datos para el servicio.</span></label>
        <label class="check"><input type="checkbox" name="health" required><span>Doy mi <b>consentimiento explícito</b> para el tratamiento de mis datos de salud (peso, medidas, lesiones, sueño, alimentación y sensaciones) con esta finalidad.</span></label>
        <label class="check"><input type="checkbox" name="photos" checked><span>Acepto subir fotos de progreso en los check-ins <small class="muted">(opcional)</small></span></label>
        ${minor ? `<fieldset class="cs-tutor"><legend>${under14 ? 'Autorización del padre, madre o tutor (obligatoria)' : 'Datos del padre, madre o tutor (recomendado)'}</legend>
          <p class="muted small">${under14 ? 'Como tienes menos de 14 años, tu padre, madre o tutor legal tiene que dar el permiso.' : 'Como eres menor de edad, es recomendable que tu padre, madre o tutor conozca y acepte el servicio.'}</p>
          <div class="form-grid"><label>Nombre y apellidos<input name="g_name" ${under14 ? 'required' : ''} maxlength="120" autocomplete="off"></label>
          <label>Relación<select name="g_rel"><option>Madre</option><option>Padre</option><option>Tutor/a legal</option></select></label></div>
          <label class="check"><input type="checkbox" name="g_ok" ${under14 ? 'required' : ''}><span>Soy su padre, madre o tutor legal y autorizo el tratamiento de sus datos.</span></label></fieldset>` : ''}
        <button class="btn primary block big" type="submit">Aceptar y continuar</button>
        <button class="btn ghost block small" type="button" data-out>Ahora no (salir)</button>
      </form></div></main>`;
    $app.querySelector('[data-out]').onclick = async () => { await DB.signOut(); S.profile = null; location.hash = ''; render(); };
    const f = $app.querySelector('#cs');
    f.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(f), gn = String(fd.get('g_name') || '').trim();
      if (minor && gn && !fd.get('g_ok')) { toast('Falta la casilla del padre, madre o tutor', 'err'); return; }
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        await safe(() => DB.rpc('accept_consent', { p_version: CONSENT_V, p_photos: !!fd.get('photos'), p_guardian_name: gn || null, p_guardian_relation: gn ? fd.get('g_rel') : null }), '¡Gracias! Ya puedes empezar 💪');
      } catch (er) { btn.disabled = false; return; }
      await refreshClient(); if (S.client.consent_version !== CONSENT_V) S.client.consent_version = CONSENT_V;
      window.scrollTo(0, 0); go('#/');
    };
  }
  async function privacyModal() {
    const c = S.client; if (!c) return;
    const req = c.data_request === 'delete';
    modal('Privacidad y mis datos', `
      <p>${c.consent_at ? `Aceptaste el uso de tus datos el <b>${fmtDate(c.consent_at.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}</b>.` : 'Uso de datos aceptado.'} <a href="privacidad.html" target="_blank" rel="noopener">Ver la política de privacidad</a></p>
      <label class="check"><input type="checkbox" name="photos" ${c.consent_photos !== false ? 'checked' : ''}> Permitir fotos de progreso en los check-ins</label>
      <div class="priv-acts">
        <button type="button" class="btn block" data-exp>${ic('download')} Descargar mis datos</button>
        <button type="button" class="btn block ${req ? '' : 'ghost'}" data-del ${req ? 'disabled' : ''}>${ic('trash')} ${req ? 'Borrado solicitado' : 'Pedir que se borren mis datos'}</button>
        <button type="button" class="btn ghost block danger" data-wd>Retirar mi consentimiento</button>
      </div>
      <p class="muted small">Si retiras el consentimiento, no podrás usar la app hasta volver a aceptarlo. Para cualquier duda sobre tus datos, habla con tu entrenador.</p>`, {
      submitLabel: 'Guardar',
      onSubmit: async (f, fd) => {
        const ph = !!fd.get('photos'); if (ph === (c.consent_photos !== false)) return;
        await safe(() => DB.rpc('accept_consent', { p_version: CONSENT_V, p_photos: ph, p_guardian_name: null, p_guardian_relation: null }), 'Guardado');
        await refreshClient();
      }
    });
    const m = document.querySelector('.modal');
    m.querySelector('[data-exp]').onclick = async e => { e.target.disabled = true; try { await exportMyData(c); } finally { e.target.disabled = false; } };
    m.querySelector('[data-del]').onclick = async () => {
      if (!await confirmBox('Tu entrenador recibirá la petición y borrará tus datos y tu cuenta. ¿Quieres pedirlo?', 'Pedir borrado')) return;
      await safe(() => DB.rpc('request_data_deletion', {}), 'Petición enviada a tu entrenador'); await refreshClient(); closeModal();
    };
    m.querySelector('[data-wd]').onclick = async () => {
      if (!await confirmBox('Dejarás de poder usar la app hasta que vuelvas a aceptar. Tu entrenador lo verá. ¿Retirar el consentimiento?', 'Retirar')) return;
      await safe(() => DB.rpc('withdraw_consent', {}), 'Consentimiento retirado'); await refreshClient(); closeModal(); render();
    };
  }
  // Derecho de acceso y portabilidad: todos sus datos en un archivo JSON
  async function exportMyData(c) {
    const tabs = ['checkins', 'daily_metrics', 'sessions', 'set_logs', 'goals', 'programs', 'program_weeks', 'routines', 'routine_items', 'nutrition_plans', 'calendar_events', 'consents'];
    const out = { app: 'TEAM JMFIT', generado: new Date().toISOString(), cliente: Object.assign({}, c) };
    for (const t of tabs) out[t] = await DB.list(t, { eq: { client_id: c.id } }).catch(() => []);
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mis-datos-teamjmfit-${today()}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('Descargando tus datos', 'ok');
  }

  // ---------- Instalar la app en el móvil (PWA): aviso en el inicio del cliente hasta que la instale o lo oculte
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
  const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  function installCardHtml() {
    let off = false; try { off = localStorage.getItem('jmfit-install-off') === '1'; } catch (e) { /* sin almacenamiento */ }
    if (isStandalone() || off || !(window.matchMedia && matchMedia('(pointer: coarse)').matches)) return '';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const steps = ios ? 'En Safari, toca <b>Compartir</b> (el cuadrado con la flecha) y después <b>«Añadir a pantalla de inicio»</b>.'
      : deferredInstall ? 'Tenla como una app más, con su icono y a pantalla completa.' : 'En Chrome, abre el menú <b>⋮</b> y toca <b>«Instalar aplicación»</b> o «Añadir a pantalla de inicio».';
    return `<section class="notice n-inst" data-inst><span class="n-ic">${ic('download')}</span><span class="grow"><b>Instala la app en tu móvil</b><small>${steps}</small></span>
      ${!ios && deferredInstall ? '<button type="button" class="btn small primary" data-inst-go>Instalar</button>' : ''}<button type="button" class="icon-btn" data-inst-off aria-label="Ocultar este aviso">✕</button></section>`;
  }
  function wireInstall(root) {
    const card = root.querySelector('[data-inst]'); if (!card) return;
    const off = () => { try { localStorage.setItem('jmfit-install-off', '1'); } catch (e) { /* solo esta vez */ } card.remove(); };
    card.querySelector('[data-inst-off]').onclick = off;
    const go1 = card.querySelector('[data-inst-go]');
    if (go1) go1.onclick = async () => { const ev = deferredInstall; deferredInstall = null; if (!ev) return; ev.prompt(); try { const r = await ev.userChoice; if (r && r.outcome === 'accepted') off(); } catch (e) { /* nada */ } };
  }

  async function renderClient() {
    document.body.dataset.role = 'client';
    if (!S.client) {
      $app.innerHTML = `<main class="login"><div class="login-card"><div class="brand big"><img class="brand-logo" src="logo.webp" alt="TEAM JMFIT" width="420" height="219"></div>
        <h2>¡Ya casi está!</h2><p>Tu cuenta (<b>${esc(S.profile.email)}</b>) todavía no está vinculada a un plan. Pide a tu entrenador que te dé de alta con este mismo correo y vuelve a entrar.</p>
        <button class="btn primary block" data-retry>Comprobar de nuevo</button><button class="btn ghost block" data-out>Salir</button></div></main>`;
      $app.querySelector('[data-retry]').onclick = boot;
      $app.querySelector('[data-out]').onclick = () => DB.signOut();
      return;
    }
    // RGPD: antes de usar la app, el cliente acepta el uso de sus datos (y de los de salud, de forma explícita)
    if ('consent_version' in S.client && S.client.consent_version !== CONSENT_V) return consentScreen();
    const [r0, r1] = S.route;
    if (r0 === 'entreno') return workout(r1);
    if (!r0) return clientToday();
    if (r0 === 'nutricion') return clientNutrition();
    if (r0 === 'progreso') { shell(CLIENT_NAV, 'progreso', loading(), { title: 'Mi progreso' }); return tabProgress(S.client, $app.querySelector('.content'), false); }
    go('#/');
  }

  async function clientToday() {
    const c = S.client;
    shell(CLIENT_NAV, 'hoy', loading(), { title: `Hola, ${c.name.split(' ')[0]}`, sub: cap1(fmtDate(today(), { weekday: 'long', day: 'numeric', month: 'long' })) });
    const progs0 = await DB.list('programs', { eq: { client_id: c.id } }).catch(() => []);
    if (await rollWeeks(progs0)) DB.clearCache && DB.clearCache();
    const [allRoutines, sessions, programs, weeks] = await Promise.all([
      DB.list('routines', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
      DB.list('sessions', { eq: { client_id: c.id }, order: ['started_at', 'desc'], limit: 30 }),
      DB.list('programs', { eq: { client_id: c.id } }).catch(() => []),
      DB.list('program_weeks', { eq: { client_id: c.id, published: true } }).catch(() => [])
    ]);
    const t0 = today();
    const goalsC = window.JMGoals ? await loadGoals(c.id) : null, pg = primaryGoal(goalsC);
    const gData = pg ? await goalData(c, pg.metric === 'e1rm' ? 'e1rm' : 'w') : null;
    const [events, ckins] = await Promise.all([loadEvents(c.id, addDays(t0, -7), addDays(t0, 13)).then(x => (x || []).filter(e => e.visible !== false)), DB.list('checkins', { eq: { client_id: c.id }, order: ['date', 'desc'], limit: 10 }).catch(() => [])]);
    const cw = currentWeek(weeks, programs);
    const routines = allRoutines.filter(r => (cw ? r.program_week_id === cw.id : !r.program_week_id));
    routines.sort((a, b) => (a.day || 9) - (b.day || 9));
    // solo los ejercicios de la semana en curso (y de los entrenos puntuales del calendario)
    const evR = (events || []).map(e => e.routine_id).filter(Boolean);
    const rIds = [...new Set(routines.map(r => r.id).concat(evR))];
    const items = rIds.length ? await DB.list('routine_items', { in: { routine_id: rIds }, order: ['position', 'asc'] }).catch(() => []) : [];
    const d = isoDay();
    const todays = routines.filter(r => r.day === d);
    const doneToday = new Set(sessions.filter(s => s.finished_at && s.started_at.slice(0, 10) === today()).map(s => s.routine_id));
    const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - (d - 1));
    const doneWeek = sessions.filter(s => s.finished_at && new Date(s.started_at) >= weekStart);
    const planned = routines.filter(r => r.day).length;
    const next = routines.filter(r => r.day && r.day > d)[0] || routines.filter(r => r.day)[0];
    const mins = its => Math.round(its.reduce((s, i) => s + i.sets * (45 + i.rest_sec), 0) / 60);
    const doneWk = new Set(doneWeek.map(s => s.routine_id));
    const rrow = r => { const its = items.filter(i => i.routine_id === r.id);
      return `<li><a href="#/entreno/${r.id}" class="${doneWk.has(r.id) ? 'did' : ''}"><span class="rday">${r.day ? esc(DIAS[r.day].slice(0, 3)) : '—'}</span><span class="grow"><b>${esc(r.name)}</b><small>${its.length} ejercicios · ~${mins(its)} min${doneWk.has(r.id) ? ' · hecho esta semana' : ''}</small></span><span class="rgo">${ic(doneWk.has(r.id) ? 'check' : 'play')}</span></a></li>`; };
    const pending = getActiveWorkout();
    const wkS = ymd(weekStart), wkE = addDays(wkS, 6);
    const evToday = events.filter(e => e.date === t0), evNext = events.filter(e => e.date > t0 && e.date <= addDays(t0, 6));
    // revisiones o fotos pendientes de días anteriores de esta semana también se muestran hoy
    const evLate = events.filter(e => e.date < t0 && e.date >= wkS && ['checkin', 'photos'].includes(e.kind) && !evDone(e, sessions, ckins));
    const evRow = (e, big) => {
      const dn = evDone(e, sessions, ckins), r = e.routine_id && byId(allRoutines, e.routine_id);
      const act = r ? `<a class="btn small ${big && !dn ? 'primary' : ''}" href="#/entreno/${r.id}">${ic('play')} Empezar</a>`
        : ['checkin', 'photos'].includes(e.kind) ? (dn ? '' : `<button class="btn small primary" data-evck>${ic(e.kind === 'photos' ? 'camera' : 'inbox')} ${e.kind === 'photos' ? 'Subir fotos' : 'Hacer revisión'}</button>`)
        : e.kind === 'note' ? '' : `<button class="btn small ${dn ? '' : 'primary'}" data-evdone="${e.id}" data-on="${dn ? 0 : 1}">${ic('check')} ${dn ? 'Hecho ✓' : 'Marcar hecho'}</button>`;
      return `<li class="ev k-${e.kind} ${dn ? 'done' : ''}"><span class="evic">${ic(EV_KINDS[e.kind][1])}</span><div class="grow"><b>${esc(evTitle(e))}</b><small>${big ? '' : esc(cap1(fmtDate(e.date, { weekday: 'long', day: 'numeric' }))) + ' · '}${esc([EV_KINDS[e.kind][0], r ? r.name : '', e.minutes ? e.minutes + ' min' : ''].filter((x, i, a) => x && a.indexOf(x) === i && x !== evTitle(e)).join(' · '))}${e.date < t0 && big ? ' · pendiente' : ''}</small>${e.notes && big ? `<p class="small">${nl2br(e.notes)}</p>` : ''}</div>${big ? act : ''}</li>`;
    };
    const pctW = planned ? Math.min(100, Math.round(doneWeek.length / planned * 100)) : 0;
    const others = routines.filter(r => !todays.includes(r));
    const dateOf = n => addDays(wkS, n - 1);
    // día elegido en la semana (por defecto, hoy): se ve lo que toca y se puede apuntar el peso de ese día
    let sel = S.daySel && S.daySel.wk === wkS ? S.daySel.n : d;
    let dm = await DB.list('daily_metrics', { eq: { client_id: c.id }, gte: { date: wkS }, order: ['date', 'asc'] }).catch(() => null);
    const notices = clientNotices(c, ckins, wkS, d, t0);
    const stripHtml = () => [1, 2, 3, 4, 5, 6, 7].map(n => { const ds = dateOf(n), has = routines.some(r => r.day === n), hasEv = events.some(e => e.date === ds && e.kind !== 'note');
      const did = doneWeek.some(s => String(s.started_at).slice(0, 10) === ds) || events.some(e => e.date === ds && e.kind !== 'note' && evDone(e, sessions, ckins));
      return `<button type="button" data-dsel="${n}" aria-pressed="${n === sel}" aria-label="${esc(DIAS[n])} ${+ds.slice(8)}" class="${n === d ? 'today' : ''} ${n === sel ? 'sel' : ''} ${has || hasEv ? 'has' : ''} ${did ? 'did' : ''}"><small>${DIAS_C[n]}</small><b>${+ds.slice(8)}</b><i></i></button>`; }).join('');
    $app.querySelector('.content').innerHTML = `<div class="c-home">
      ${pending ? `<a class="resume" href="#/entreno/${esc(pending.routine_id)}">${ic('play')}<span class="grow"><b>Tienes un entreno a medias</b><small>${esc(pending.routine_name)} · empezado ${ago(pending.started_at)}</small></span><span class="btn small primary">Continuar</span></a>` : ''}
      ${installCardHtml()}
      ${notices.map(nt => `<section class="notice n-${nt.k}"><span class="n-ic">${ic(nt.ic)}</span><span class="grow"><b>${esc(nt.t)}</b><small>${esc(nt.s)}</small></span>${nt.k === 'ck' ? `<button type="button" class="btn small primary" data-evck>${esc(nt.btn)}</button>` : ''}</section>`).join('')}
      <section class="card wk-card"><div class="wk-head"><b>Esta semana</b>${cw ? `<small>${esc(weekLabel(cw))}</small>` : ''}<span class="grow"></span><span class="wk-n"><b>${doneWeek.length}</b>/${planned || '–'} entrenos</span></div>
        <div class="wk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctW}"><i style="width:${pctW}%"></i></div>
        <div class="weekstrip" data-strip>${stripHtml()}</div></section>
      <div data-day></div>
      ${pg ? `<section class="card gl-home"><header class="row gap"><h3 class="grow">Mi objetivo</h3><a class="small link-a" href="#/progreso">Ver progreso ›</a></header>${goalCard(pg, gData, { big: true, actions: false, compact: true })}</section>` : ''}
      ${others.length ? `<section class="card rlist-card"><h3>Mis rutinas</h3><ul class="rlist">${others.map(rrow).join('')}</ul></section>` : ''}
      ${evNext.length ? `<section class="card"><h3>Próximos días</h3><ul class="evlist">${evNext.map(e => evRow(e, false)).join('')}</ul></section>` : ''}
      ${!routines.length && !events.length ? '<p class="empty">Tu entrenador todavía no ha publicado tus rutinas.</p>' : ''}</div>`;
    const box = $app.querySelector('.content'), dayBox = box.querySelector('[data-day]');
    const wire = root => {
      root.querySelectorAll('[data-evck]').forEach(b => b.onclick = () => checkinForm(c));
      root.querySelectorAll('[data-evdone]').forEach(b => b.onclick = async () => { b.disabled = true; try { await safe(() => DB.rpc('set_event_done', { p_id: b.dataset.evdone, p_done: b.dataset.on === '1' }), b.dataset.on === '1' ? '¡Hecho! 💪' : ''); } catch (e) { b.disabled = false; return; } clientToday(); });
    };
    function drawDay() {
      const n = sel, ds = dateOf(n), isToday = n === d, rs = routines.filter(r => r.day === n);
      const dn = r => (isToday ? doneToday.has(r.id) : sessions.some(s => s.finished_at && s.routine_id === r.id && String(s.started_at).slice(0, 10) === ds));
      const label = isToday ? 'Hoy · ' + DIAS[n] : `${DIAS[n]} ${+ds.slice(8)}${ds < t0 ? ' · ya pasó' : ''}`;
      const evs = isToday ? [...evLate, ...evToday] : events.filter(e => e.date === ds);
      const heroD = r => { const its = items.filter(i => i.routine_id === r.id), done = dn(r);
        return `<section class="hero-ink ${done ? 'done' : ''} ${isToday ? '' : 'other'}"><div class="hx-top"><small>${esc(label)}</small>${done ? '<span class="pill green">Hecho ✓</span>' : ''}</div>
          <h2>${esc(r.name)}</h2>
          <div class="hx-meta"><span>${ic('dumbbell', 'xs')} ${its.length} ejercicios</span><span>${ic('clock', 'xs')} ~${mins(its)} min</span>${cw ? `<span>${esc(weekLabel(cw))}</span>` : ''}</div>
          ${its.length ? `<details class="hx-list"><summary>Ver ejercicios</summary><ol>${its.map(i => `<li><b>${esc(i.exercise_name)}</b><span>${i.sets}×${esc(i.reps)}</span></li>`).join('')}</ol></details>` : ''}
          <a class="btn primary big block" href="#/entreno/${r.id}">${ic('play')} ${done ? 'Repetir entreno' : 'Empezar entreno'}</a></section>`; };
      const rest = isToday
        ? `<section class="hero-ink day-off"><div class="hx-top"><small>Hoy</small></div><h2>Día de descanso 😌</h2><p>${next ? `Tu próximo entreno es <b>${esc(next.name)}</b> el ${DIAS[next.day].toLowerCase()}.` : 'Tu entrenador aún no te ha asignado entrenos con día.'}</p></section>`
        : `<section class="hero-ink day-off other"><div class="hx-top"><small>${esc(label)}</small></div><h2>Descanso</h2><p>Ese día no tienes entreno asignado.</p></section>`;
      const m = (dm || []).find(x => x.date === ds) || {}, wts = (dm || []).filter(x => x.weight != null);
      const avgW = wts.length ? wts.reduce((a, x) => a + Number(x.weight), 0) / wts.length : null;
      dayBox.innerHTML = `${dm && ds <= t0 ? `<section class="card dm-card"><h3>Registro ${isToday ? 'de hoy' : 'del ' + DIAS[n].toLowerCase() + ' ' + (+ds.slice(8))}${m.date ? ' <span class="pill green">guardado</span>' : ''}</h3>
          <form class="dm-form" data-dm><label>Peso<span class="u-in"><input name="weight" type="number" step="0.05" min="20" max="350" inputmode="decimal" value="${m.weight ?? ''}" placeholder="–"><i>kg</i></span></label>
            <label>Pasos<input name="steps" type="number" min="0" max="100000" step="1" inputmode="numeric" value="${m.steps ?? ''}" placeholder="–"></label>
            <label>Sueño<span class="u-in"><input name="sleep_h" type="number" step="0.5" min="0" max="24" inputmode="decimal" value="${m.sleep_h ?? ''}" placeholder="–"><i>h</i></span></label>
            <button class="btn small primary">${m.date ? 'Actualizar' : 'Guardar'}</button></form>
          <p class="muted small">${avgW != null ? `Media de la semana: <b>${fmtKg(avgW)} kg</b> (${wts.length} día${wts.length === 1 ? '' : 's'}).` : 'Pésate en ayunas, nada más levantarte: lo que cuenta es la media semanal.'}</p></section>` : ''}
        ${rs.length ? rs.map(heroD).join('') : evs.some(e => e.kind !== 'note') ? '' : rest}
        ${evs.length ? `<section class="card"><h3>${isToday ? (rs.length ? 'Hoy también' : 'Hoy') : 'Ese día'}</h3><ul class="evlist">${evs.map(e => evRow(e, true)).join('')}</ul></section>` : ''}`;
      wire(dayBox);
      const fm = dayBox.querySelector('[data-dm]');
      if (fm) fm.onsubmit = async e => {
        e.preventDefault();
        const v = k => { const x = String(fm[k].value).replace(',', '.').trim(); return x === '' ? null : Number(x); };
        const row = { client_id: c.id, date: ds, weight: v('weight'), steps: v('steps') == null ? null : Math.round(v('steps')), sleep_h: v('sleep_h') };
        if (row.weight == null && row.steps == null && row.sleep_h == null) { toast('Apunta al menos un dato', 'err'); return; }
        const btn = fm.querySelector('button'); btn.disabled = true;
        try { await safe(() => DB.upsert('daily_metrics', row, 'client_id,date'), 'Guardado ✓'); } catch (er) { btn.disabled = false; return; }
        dm = (dm || []).filter(x => x.date !== ds).concat(row); drawDay();
      };
    }
    box.querySelector('[data-strip]').addEventListener('click', e => {
      const b = e.target.closest('[data-dsel]'); if (!b) return;
      sel = +b.dataset.dsel; S.daySel = { wk: wkS, n: sel };
      box.querySelector('[data-strip]').innerHTML = stripHtml(); drawDay();
    });
    wire(box.querySelector('.c-home'));
    wireInstall(box);
    drawDay();
    noticePopup(c, notices.filter(nt => nt.k !== 'ck' || d === 5), t0);
  }

  // ---------- Avisos al cliente: check-in pendiente (desde el viernes) y renovación del plan (2 días antes, 1 día antes y el día)
  // El entrenador los activa o desactiva por cliente en «Editar cliente».
  function clientNotices(c, ckins, wkS, d, t0) {
    const out = [];
    if (c.remind_checkin !== false && d >= 5 && !(ckins || []).some(k => String(k.date) >= wkS))
      out.push({ k: 'ck', ic: 'inbox', t: d === 5 ? 'Hoy toca tu check-in semanal' : 'Tienes el check-in semanal pendiente', s: 'Cuéntale a tu entrenador cómo ha ido la semana: peso, sensaciones y fotos.', btn: 'Hacer check-in' });
    if (c.remind_payment !== false && c.pay_due) {
      const dd = Math.round((new Date(c.pay_due + 'T12:00:00') - new Date(t0 + 'T12:00:00')) / 864e5);
      if (dd >= 0 && dd <= 2) out.push({ k: 'pay', ic: 'euro', t: dd === 0 ? 'Hoy toca renovar tu plan' : dd === 1 ? 'Mañana toca renovar tu plan' : 'Tu plan se renueva en 2 días',
        s: `${c.pay_plan ? c.pay_plan + ' · ' : ''}${c.pay_amount ? eur(c.pay_amount) + ' · ' : ''}${cap1(fmtDate(c.pay_due, { weekday: 'long', day: 'numeric', month: 'long' }))}. Si ya lo has pagado, ignora este aviso.` });
    }
    return out;
  }
  // Ventana al entrar, una vez al día por aviso
  function noticePopup(c, list, t0) {
    if (!list.length || document.querySelector('.modal-back')) return;
    const key = 'jmfit-avisos-' + t0; let seen = [];
    try { seen = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { seen = []; }
    const fresh = list.filter(nt => !seen.includes(nt.k)); if (!fresh.length) return;
    try { localStorage.setItem(key, JSON.stringify(seen.concat(fresh.map(nt => nt.k)))); } catch (e) { /* sin almacenamiento: se volverá a mostrar */ }
    const ck = fresh.some(nt => nt.k === 'ck');
    modal(fresh.length > 1 ? 'Tienes avisos' : 'Aviso', `<div class="notice-list">${fresh.map(nt => `<div class="notice n-${nt.k}"><span class="n-ic">${ic(nt.ic)}</span><span class="grow"><b>${esc(nt.t)}</b><small>${esc(nt.s)}</small></span></div>`).join('')}</div>`, {
      submitLabel: ck ? 'Hacer check-in ahora' : 'Entendido',
      onSubmit: () => { if (ck) setTimeout(() => checkinForm(c), 60); }
    });
  }

  async function clientNutrition() {
    shell(CLIENT_NAV, 'nutricion', loading(), { title: 'Mi nutrición' });
    const [p0, d] = await Promise.all([DB.get('nutrition_plans', S.client.id, 'client_id'), DB.rpc('get_my_nutrition').catch(() => null)]);
    const box = $app.querySelector('.content');
    const hasBlocks = !!(d && d.blocks && d.blocks.length && window.JMNutri);
    let p = p0 && d && d.show_macros === false ? Object.assign({}, p0, { kcal: null, protein: null, carbs: null, fat: null }) : p0;
    if (!p && !hasBlocks) { box.innerHTML = `<div class="hero-empty">${ic('apple', 'xl')}<h2>Aún no tienes plan de nutrición</h2><p>Cuando tu entrenador lo publique, lo verás aquí.</p></div>`; return; }
    p = p || { updated_at: d && d.updated_at };
    // Cabecera de macros: la del plan del día que tenga elegido (Día de entreno / descanso…); si ese plan no tiene objetivo propio, el general
    const groups = hasBlocks && JMNutri.planGroups ? JMNutri.planGroups(d) : [];
    const showM = !(d && d.show_macros === false);
    const macroCard = gi => {
      const g = groups[gi], sum = g && g.sum.kcal ? { kcal: Math.round(g.sum.kcal), protein: Math.round(g.sum.protein), carbs: Math.round(g.sum.carbs), fat: Math.round(g.sum.fat) } : null;
      // objetivo propio del plan → si hay varios planes, lo que suma ese día → objetivo general
      const t = g && g.targets ? g.targets : groups.length > 1 && sum ? sum : p.kcal ? p : sum;
      if (!t || !t.kcal || !showM) return '';
      const tt = (t.protein || 0) * 4 + (t.carbs || 0) * 4 + (t.fat || 0) * 9, pc = v => (tt ? Math.round(v / tt * 100) : 0);
      const mx = [['p', 'Proteína', t.protein, 4], ['c', 'Carbohidratos', t.carbs, 4], ['f', 'Grasas', t.fat, 9]], top = Math.max(1, ...mx.map(m => pc((m[2] || 0) * m[3])));
      return `<div class="kcal"><b>${t.kcal}</b><small>kcal ${groups.length > 1 && g && g.name ? '· ' + esc(g.name) : 'al día'}</small>${p.water ? `<span class="mx-w">💧 ${esc(p.water)}</span>` : ''}</div>
        <div class="mx">${mx.map(([k, l, gr, f]) => `<div class="mx-r ${k}"><span>${l}</span><b>${gr ?? '–'} g</b><i><em style="width:${tt ? Math.round(pc((gr || 0) * f) / top * 100) : 0}%"></em></i><small>${tt ? pc((gr || 0) * f) + ' %' : ''}</small></div>`).join('')}</div>`;
    };
    const mc0 = macroCard(0);
    box.innerHTML = `
      <section class="card macros2" data-mcard ${mc0 ? '' : 'hidden'}>${mc0}</section>
      ${hasBlocks ? window.JMNutri.clientView(d) : ''}
      ${p.meals && !hasBlocks ? `<section class="card"><h3>Mis comidas</h3><div class="meals">${esc(p.meals).split('\n').filter(Boolean).map(l => { const m = l.match(/^([^:]{1,30}):(.*)$/); return m ? `<div class="meal"><b>${m[1]}</b><p>${m[2]}</p></div>` : `<p>${l}</p>`; }).join('')}</div></section>` : ''}
      ${p.notes ? `<section class="card"><h3>Recomendaciones</h3><p>${nl2br(p.notes)}</p></section>` : ''}
      <p class="muted small">Actualizado ${ago(p.updated_at)}</p>`;
    if (hasBlocks) window.JMNutri.wireClient(box, d, S.client && S.client.id, gi => { const mc = box.querySelector('[data-mcard]'), h = macroCard(gi); mc.innerHTML = h; mc.hidden = !h; });
  }

  // ---------- Check-in (cliente): el mismo formulario «Valoración semanal» de Harbiz
  const CK_POSES = [['front', 'Frente'], ['side', 'Perfil'], ['back', 'Espalda']];
  const CK_SCALES = {
    train_adh: ['Cumplimiento del entrenamiento', '1 nada · 10 todo'],
    diet_adh: ['Cumplimiento de la nutrición', '1 nada · 10 todo'],
    hunger: ['Hambre', '1 sin hambre · 10 mucha hambre'],
    satiety: ['Saciedad', '1 me quedo vacío · 10 muy lleno'],
    fatigue: ['Fatiga central (sistema nervioso)', '1 nada · 10 muchísima'],
    energy10: ['Energía general', '1 muy baja · 10 muy alta'],
    sleep_q: ['Calidad del sueño', '1 muy mala · 10 muy buena'],
    stress: ['Estrés', '1 nada · 10 muchísimo'],
    motivation: ['Motivación para la semana que viene', '1 nada · 10 muchísima']
  };
  const CK_TEXTS = { fatigue_muscles: 'Fatiga periférica (músculos sin recuperar)', pains: 'Molestias o dolores', misses: '¿Has fallado en algo esta semana?', notes: 'Dudas o comentarios para Jorge' };
  function checkinForm(c) {
    const scale = n => `<fieldset class="scale ten"><legend>${CK_SCALES[n][0]} <small>${CK_SCALES[n][1]}</small></legend>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => `<label><input type="radio" name="${n}" value="${v}"><span>${v}</span></label>`).join('')}</fieldset>`;
    const text = (n, rows = 1, ph = '') => `<label>${CK_TEXTS[n]}${rows > 1 ? `<textarea name="${n}" rows="${rows}" placeholder="${ph}"></textarea>` : `<input name="${n}" placeholder="${ph}">`}</label>`;
    const f = modal('Valoración semanal', `
      <p class="muted small">Este formulario es la pieza más importante de nuestro trabajo juntos: sé sincero, así puedo ajustar tu plan.</p>
      <div class="form-grid">
        <label>Fecha<input name="date" type="date" value="${today()}" required></label>
        <label>Peso en ayunas (kg)<input name="weight" type="number" step="0.05" inputmode="decimal" required><small class="muted">Nada más levantarte, después de hacer pis, sin comer ni beber.</small></label>
      </div>
      ${scale('train_adh')}${scale('diet_adh')}
      <label>Media de pasos de la semana<input name="steps" type="number" inputmode="numeric" min="0" step="100" placeholder="Ej: 9000"></label>
      ${scale('hunger')}${scale('satiety')}${scale('fatigue')}
      ${text('fatigue_muscles', 1, 'Ej: piernas cargadas desde el martes')}${text('pains', 1, 'Dónde y desde cuándo')}${text('misses', 2, 'Comidas, entrenos, descanso…')}
      ${scale('energy10')}
      <label>Horas de sueño (media por noche)<input name="sleep_h" type="number" step="0.5" min="0" max="24" inputmode="decimal" placeholder="Ej: 7,5"></label>
      ${scale('sleep_q')}${scale('stress')}${scale('motivation')}
      ${text('notes', 3)}
      <details><summary>Medidas (cm, opcional)</summary><div class="form-grid three">
        ${[['waist', 'Cintura'], ['hip', 'Cadera'], ['chest', 'Pecho'], ['arm', 'Brazo'], ['thigh', 'Muslo'], ['calf', 'Gemelo'], ['neck', 'Cuello'], ['shoulders', 'Hombros']].map(([k, l]) => `<label>${l}<input name="${k}" type="number" step="0.1" inputmode="decimal"></label>`).join('')}
        <label>% de grasa <small class="muted">si lo mides</small><input name="body_fat" type="number" step="0.1" min="2" max="70" inputmode="decimal"></label></div></details>
      ${c.consent_photos === false ? '<p class="muted small">Has desactivado las fotos de progreso (escudo de arriba → Privacidad).</p>' : `<fieldset class="ck-photos"><legend>Fotos de progreso <small>con la misma luz y postura cada semana</small></legend>
        ${CK_POSES.map(([p, l]) => `<label class="ck-ph" data-pose="${p}"><input type="file" accept="image/*" name="ph_${p}" hidden><span class="ck-prev">${ic('camera')}</span><b>${l}</b></label>`).join('')}
        <label class="ck-ph more"><input type="file" accept="image/*" name="ph_extra" multiple hidden><span class="ck-prev">${ic('plus')}</span><b data-extra>Más fotos</b></label>
      </fieldset>`}`, {
      submitLabel: 'Enviar check-in',
      onSubmit: async (form, fd) => {
        const d = { client_id: c.id, date: fd.get('date') || today() };
        const n = k => num(String(fd.get(k) || '').replace(',', '.'));
        ['weight', 'waist', 'hip', 'chest', 'arm', 'thigh', 'calf', 'neck', 'shoulders', 'body_fat', 'steps', 'sleep_h', ...Object.keys(CK_SCALES)].forEach(k => { const v = n(k); if (v != null) d[k] = v; });
        if (d.steps != null) d.steps = Math.round(d.steps);
        Object.keys(CK_TEXTS).forEach(k => { const v = String(fd.get(k) || '').trim(); if (v) d[k] = v; });
        if (!d.weight) { toast('Pon tu peso en ayunas', 'err'); return false; }
        const files = CK_POSES.map(([p]) => [p, form['ph_' + p] && form['ph_' + p].files[0]]).filter(x => x[1]);
        [...(form.ph_extra ? form.ph_extra.files : [])].slice(0, 6).forEach((file, i) => files.push(['extra' + (i + 1), file]));
        try { await safe(async () => {
          const [k] = await DB.insert('checkins', d);
          const rows = [];
          for (const [pose, file] of files) rows.push({ checkin_id: k.id, client_id: c.id, pose, path: await DB.uploadPhoto(c.id, await shrink(file)) });
          if (rows.length) { await DB.insert('checkin_photos', rows); await DB.update('checkins', k.id, { photo_path: rows[0].path }); }
        }, '¡Check-in enviado! 💪'); } catch (e) { return false; }
        render();
      }
    });
    f.querySelectorAll('.ck-ph input').forEach(inp => inp.onchange = () => {
      const lab = inp.closest('.ck-ph'), fl = [...inp.files];
      if (inp.name === 'ph_extra') { lab.querySelector('[data-extra]').textContent = fl.length ? `${Math.min(6, fl.length)} foto${fl.length > 1 ? 's' : ''} más` : 'Más fotos'; }
      const pv = lab.querySelector('.ck-prev');
      if (fl[0]) { pv.innerHTML = `<img alt="" src="${URL.createObjectURL(fl[0])}">`; lab.classList.add('has'); }
    });
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
          it: i.target_rir != null ? 'rir' : i.target_rpe != null ? 'rpe' : null, target: i.target_rir != null ? i.target_rir : i.target_rpe, tFail: isFailT(i),
          prev: (prev[i.id] || []).map(l => ({ w: l.weight, r: l.reps, x: l.failure ? 'F' : l.rir != null ? l.rir : l.rpe })), prevAt: prev[i.id] ? prev[i.id].at : null,
          scheme: schemeLabel(i.progression), sets: schemeSets(i.sets, i.progression)
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
          <header><span class="num">${ei + 1}</span><div class="grow"><b>${esc(e.name)}</b>${e.orig ? `<small class="wk-swapped">Cambiado · antes: ${esc(e.orig)} <button type="button" class="link" data-unswap>Deshacer</button></small>` : ''}<small>${e.sets.filter(x => x.tag !== 'D').length} × ${esc(e.reps)}${e.load ? ' · ' + esc(e.load) : ''} · ${ic('clock', 'xs')} ${e.rest}"</small>${e.scheme ? `<small class="wk-scheme">${esc(e.scheme)}</small>` : ''}</div>
            ${mediaInfo(e.media) ? `<button type="button" class="icon-btn ${openMedia.has(ei) ? 'on' : ''}" data-media title="Ver técnica" aria-label="Ver técnica">${ic('video')}</button>` : ''}</header>
          ${openMedia.has(ei) ? mediaFacade(e.media) : ''}
          ${e.prevAt ? `<p class="muted small last">Última vez ${esc(ago(e.prevAt))}: ${e.prev.map(p => `${p.w != null ? fmtKg(p.w) + ' kg' : '–'} × ${p.r ?? '–'} reps`).join(' · ')}</p>` : ''}
          ${e.notes ? `<p class="note">${esc(e.notes)}</p>` : ''}
          <div class="sets ${e.it ? 'with-x' : ''}"><div class="sets-h"><span>Serie</span><span>Anterior</span><span>kg</span><span>Reps</span>${e.it ? `<span>${e.it.toUpperCase()}</span>` : ''}<span></span></div>
          ${(() => { let n = 0; return e.sets.map(s => (s.tag === 'D' ? '' : String(++n))); })().map((lbl, si) => [lbl, e.sets[si], si]).map(([lbl, s, si]) => `<div class="set ${s.done ? 'done' : ''} ${s.tag ? 'tag-' + s.tag : ''}" data-si="${si}"><span class="sn">${s.tag === 'TOP' ? 'TOP' : s.tag === 'BO' ? 'BO' : s.tag === 'D' ? '↓' : lbl}</span>
            <span class="prev">${e.prev[si] ? `${e.prev[si].w != null ? fmtKg(e.prev[si].w) : '–'}×${e.prev[si].r ?? '–'}${e.prev[si].x != null ? `<small> @${e.prev[si].x === 'F' ? 'Fallo' : fmtKg(e.prev[si].x)}</small>` : ''}` : '–'}</span>
            <input inputmode="decimal" data-f="w" value="${esc(s.w)}" placeholder="${s.pct ? '−' + s.pct + ' %' : '–'}" aria-label="Kilos serie ${si + 1}${s.tag === 'D' ? ' (bajada)' : s.tag === 'BO' ? ' (back-off)' : s.tag === 'TOP' ? ' (top set)' : ''}">
            <input inputmode="numeric" data-f="r" value="${esc(s.r)}" placeholder="–" aria-label="Repeticiones serie ${si + 1}">
            ${e.it === 'rir' ? `<select data-f="x" class="rir-sel ${s.x === 'F' ? 'fail' : ''}" aria-label="RIR serie ${si + 1}"><option value="">${e.tFail ? 'Fallo' : e.target != null ? esc(fmtKg(e.target)) : '–'}</option>${RIR_OPTS.map(v => `<option value="${v}" ${String(s.x) === v ? 'selected' : ''}>${v === 'F' ? 'Fallo' : v}</option>`).join('')}</select>`
              : e.it ? `<input inputmode="decimal" data-f="x" value="${esc(s.x || '')}" placeholder="${e.target != null ? esc(fmtKg(e.target)) : ''}" aria-label="${e.it.toUpperCase()} serie ${si + 1}">` : ''}
            <button class="tick" data-tick aria-label="Serie hecha">${ic('check')}</button></div>${s.hint ? `<p class="set-hint ${s.hint[0]}">${esc(s.hint[1])}</p>` : ''}`).join('')}</div>
          ${e.fb ? `<p class="wk-cmt">${ic('msg', 'xs')} <span>${esc(e.fb)}</span></p>` : ''}
          <div class="row gap wrap wk-acts"><button class="btn ghost small" data-addset>${ic('plus')} Serie</button>${e.sets.length > 1 ? '<button class="btn ghost small" data-delset>Quitar serie</button>' : ''}<span class="grow"></span>
            <button class="icon-btn ${e.fb ? 'on' : ''}" data-cmt title="Dejar un comentario a tu entrenador" aria-label="Comentario para tu entrenador">${ic('msg')}</button>
            <button class="btn ghost small" data-swap title="Cambiar por otro ejercicio parecido">${ic('swap')} Cambiar</button></div>
        </section>`).join('')}</div>
      <div class="rest-done" data-restdone hidden></div>
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
        row.querySelectorAll('select[data-f]').forEach(sel => sel.onchange = () => { s.x = sel.value; sel.classList.toggle('fail', sel.value === 'F'); if (s.done) { s.hint = setHint(e, s); } saveWorkout(w); if (s.done) drawWorkout(w); });
        row.querySelector('[data-tick]').onclick = () => {
          s.done = !s.done;
          if (s.done) {
            if (s.r === '' || s.r == null) { const def = parseInt(String(e.reps).split(/[-–]/).pop(), 10); if (!isNaN(def)) s.r = String(def); }
            // propaga el peso a las series siguientes vacías: back-off = top set − %, bajadas del dropset en cadena
            if (s.w !== '' && !isNaN(+s.w)) {
              const r05 = x => String(Math.round(x * 2) / 2);
              let chain = true, ref = +s.w;
              e.sets.slice(si + 1).forEach(n => {
                if (n.tag === 'D') { if (chain) { ref = ref * (1 - (n.pct || 20) / 100); if (n.w === '') n.w = r05(ref); } return; }
                chain = false;
                if (n.w !== '' || s.tag === 'D') return;
                if (s.tag === 'TOP' && n.tag === 'BO') n.w = r05(+s.w * (1 - (n.pct || 10) / 100));
                else if ((n.tag || '') === (s.tag || '')) n.w = s.w;
              });
            }
            s.hint = setHint(e, s);
            if (navigator.vibrate) navigator.vibrate(s.hint && s.hint[0] === 'warn' ? [30, 60, 30] : 30);
            if (e.rest > 0) startRest(e.rest, nextSetLabel(w, ei, si));
          } else s.hint = null;
          saveWorkout(w); drawWorkout(w);
        };
      });
      sec.querySelector('[data-addset]').onclick = () => { const l = [...e.sets].reverse().find(x => x.tag !== 'D'); e.sets.push({ w: l ? l.w : '', r: '', done: false, tag: l && l.tag === 'TOP' ? 'BO' : (l && l.tag) || '', pct: l && (l.tag === 'BO' || l.tag === 'TOP') ? (l.pct || 10) : null }); saveWorkout(w); drawWorkout(w); };
      const ds = sec.querySelector('[data-delset]'); if (ds) ds.onclick = () => { e.sets.pop(); saveWorkout(w); drawWorkout(w); };
      sec.querySelector('[data-cmt]').onclick = () => modal(`Comentario · ${e.name}`, `<p class="muted small">Le llega a tu entrenador al terminar el entreno.</p>
        <div class="np-opts">${['Molestia en la articulación', 'Muy fácil', 'Muy duro', 'Máquina ocupada', 'No noto el músculo'].map(t => `<button type="button" class="chip" data-qc="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <label>Comentario<textarea name="fb" rows="3" maxlength="2000" placeholder="Ej: molestia en el hombro al bajar">${esc(e.fb || '')}</textarea></label>`, {
        submitLabel: 'Guardar', onSubmit: (f, fd) => { e.fb = String(fd.get('fb') || '').trim() || null; saveWorkout(w); drawWorkout(w); }
      }).querySelectorAll('[data-qc]').forEach(b => b.onclick = () => { const ta = b.closest('form').querySelector('textarea'); ta.value = (ta.value ? ta.value.replace(/\s*$/, '. ') : '') + b.dataset.qc; ta.focus(); });
      sec.querySelector('[data-swap]').onclick = () => swapModal(w, e);
      const us = sec.querySelector('[data-unswap]'); if (us) us.onclick = () => { Object.assign(e, { name: e.orig, lin: e.origLin || null, media: e.origMedia, prev: e.origPrev || [], prevAt: e.origPrevAt || null }); e.orig = null; saveWorkout(w); drawWorkout(w); };
    });
    $app.querySelector('[data-exit]').onclick = async () => {
      if (done === 0 || await confirmBox('Tu progreso se queda guardado en este móvil y podrás seguir luego. ¿Salir?', 'Salir')) { if (done === 0) clearWorkout(); stopRest(); openMedia.clear(); go('#/'); }
    };
    $app.querySelector('[data-finish]').onclick = () => finishWorkout(w, done);
    if (restTimer) bindRest();
  }

  // ---- Avisos por serie: RIR muy alto o repeticiones lejos de lo pautado
  const RIR_OPTS = ['F', '0', '1', '2', '3', '4', '5', '6'];
  function setHint(e, s) {
    const r = parseInt(s.r, 10), kg = num(s.w);
    if (e.it === 'rir' && e.target != null && s.x !== '' && s.x != null && s.x !== 'F') {
      const x = num(s.x);
      if (x != null && e.target <= 2 && x >= e.target + 2) return ['warn', `RIR ${fmtKg(x)} con ${e.tFail ? 'la serie al fallo' : 'RIR ' + fmtKg(e.target)} pautado: para maximizar la hipertrofia, esta serie debe estar cerca del fallo. ¿Seguro que no puedes subir ${kg && kg >= 20 ? '2,5' : '1–2'} kg en la siguiente?`];
    }
    const m = String(e.reps || '').match(/(\d+)\s*(?:[-–a]\s*(\d+))?/);
    if (m && !isNaN(r)) {
      const lo = +m[1], hi = m[2] ? +m[2] : lo, tol = hi - lo >= 4 ? 1 : 2;
      if (r > hi + tol) return ['info', `${r} reps (pautado ${e.reps}): te sobra. Sube la carga en la siguiente serie${kg ? ` (≈ ${fmtKg(Math.round(kg * 1.05 * 2) / 2)} kg)` : ''}.`];
      if (r < lo - tol) return ['info', `${r} reps (pautado ${e.reps}): te cuesta. Baja un poco la carga en la siguiente${kg ? ` (≈ ${fmtKg(Math.round(kg * 0.92 * 2) / 2)} kg)` : ''}.`];
    }
    if (s.x === 'F' && e.it === 'rir' && e.target != null && e.target >= 2 && !e.tFail) return ['info', `Serie al fallo con RIR ${fmtKg(e.target)} pautado: guarda algo de margen en la siguiente.`];
    return null;
  }
  function nextSetLabel(w, ei, si) {
    for (let i = ei; i < w.ex.length; i++) {
      const e = w.ex[i], k = e.sets.findIndex((x, j) => !x.done && (i > ei || j > si));
      if (k >= 0) { const n = e.sets.slice(0, k + 1).filter(x => x.tag !== 'D').length; return `${e.name} · serie ${n}`; }
    }
    return null;
  }
  const MOTIV = ['Cada serie cuenta. ¡Vamos!', 'Concéntrate en la técnica y aprieta.', 'Hoy eres más fuerte que ayer.', 'Una más, con la cabeza fría.', 'Controla la bajada, explota al subir.', 'La constancia gana. ¡A por ella!', 'Respira, prepara y a muerte con la técnica.', 'El progreso está en esta serie.'];
  function restDone(next) {
    const b = document.querySelector('[data-restdone]'); if (!b) { toast('¡A por la siguiente serie!', 'ok'); return; }
    b.innerHTML = `<b>⏱️ ¡Toca la siguiente serie!</b>${next ? `<small>${esc(next)}</small>` : ''}<span>${esc(MOTIV[Math.floor(Math.random() * MOTIV.length)])}</span>`;
    b.hidden = false; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(restDone.t); restDone.t = setTimeout(() => { b.hidden = true; }, 7000);
    b.onclick = () => { b.hidden = true; };
  }
  // ---- Cambiar un ejercicio por otro del mismo patrón de movimiento
  const PATTERNS = [
    [/curl femoral|femoral (tumbado|sentado)|nordic/i, 'Flexión de rodilla'],
    [/extensi[oó]n de cu[aá]driceps|sissy/i, 'Extensión de rodilla'],
    [/sentadilla|prensa|hack|zancada|b[uú]lgara|split|step.?up|subida al caj/i, 'Dominante de rodilla'],
    [/peso muerto|rumano|hip thrust|puente de gl|good morning|buenos d[ií]as|pull.?through|hiperextensi/i, 'Bisagra de cadera'],
    [/patada de tr|tr[ií]ceps|press franc|extensi[oó]n de codo|fondos en banco/i, 'Extensión de codo'],
    [/aperturas|cruce de poleas|contractor|pec ?deck|fly/i, 'Aperturas de pecho'],
    [/press de banca|banca|press inclinado|press declinado|flexiones|fondos|press de pecho|chest press/i, 'Empuje horizontal'],
    [/press militar|press de hombro|arnold|press por encima|landmine press/i, 'Empuje vertical'],
    [/elevaci[oó]n(es)? lateral/i, 'Elevación lateral'],
    [/dominada|jal[oó]n|pull.?down|pull.?up/i, 'Tracción vertical'],
    [/face pull|p[aá]jaros|deltoides posterior|rear delt/i, 'Hombro posterior'],
    [/remo/i, 'Tracción horizontal'],
    [/pullover/i, 'Extensión de hombro'],
    [/curl/i, 'Flexión de codo'],
    [/gemelo|tal[oó]n|calf/i, 'Gemelo'],
    [/abducci[oó]n|patada de gl[uú]teo|glute kick/i, 'Glúteo (cadera)'],
    [/plancha|crunch|abdominal|rueda|pallof|elevaci[oó]n de piernas/i, 'Core']
  ];
  const patternOf = n => (PATTERNS.find(p => p[0].test(String(n || ''))) || [null, null])[1];
  const profileOf = eq => (/polea|m[aá]quina|cable|smith/i.test(eq || '') ? 'tensión constante' : /goma|banda/i.test(eq || '') ? 'más duro arriba' : eq ? 'peso libre' : '');
  async function swapModal(w, e) {
    let lib = S.exercises;
    if (!lib) { try { lib = S.exercises = await DB.list('exercises', { order: ['name', 'asc'] }); } catch (er) { lib = []; } }
    const seen = new Set(), all = [];
    lib.concat((window.JMFIT_EXERCISES || []).map(([name, muscle, equipment]) => ({ name, muscle, equipment }))).forEach(x => { const k = String(x.name).toLowerCase(); if (!seen.has(k)) { seen.add(k); all.push(x); } });
    const curName = e.orig || e.name, me = all.find(x => x.name.toLowerCase() === curName.toLowerCase()) || { name: curName };
    const pat = patternOf(curName), prof = profileOf(me.equipment), mus = String(me.muscle || '').split('/')[0].trim().toLowerCase();
    // 1.º los cambios que fijó el entrenador en el catálogo; si no, la familia del ejercicio (mismo movimiento, otro material)
    const sw = window.JMSwap ? JMSwap.altsFor(curName, all) : { list: [] };
    const alts = sw.list.length ? sw.list : all.filter(x => x.name.toLowerCase() !== curName.toLowerCase() && (pat ? patternOf(x.name) === pat : mus && String(x.muscle || '').toLowerCase().startsWith(mus)))
      .map(x => ({ x, sc: (profileOf(x.equipment) === prof ? 2 : 0) + (mus && String(x.muscle || '').toLowerCase().startsWith(mus) ? 1 : 0) }))
      .sort((a, b) => b.sc - a.sc || a.x.name.localeCompare(b.x.name)).slice(0, 3).map(a => a.x);
    const m = modal(`Cambiar ${curName}`, `<p class="muted small">${sw.list.length ? (sw.custom ? 'Los cambios que ha preparado tu entrenador para este ejercicio, por orden de preferencia.' : `Ejercicios que trabajan igual (<b>${esc(sw.family.title.toLowerCase())}</b>) con otro material o máquina, por orden de preferencia.`) : pat ? `Alternativas con el mismo patrón (<b>${esc(pat.toLowerCase())}</b>)${prof ? ` y, si puede ser, el mismo perfil de resistencia (${esc(prof)})` : ''}.` : 'Alternativas para el mismo músculo.'} Tu entrenador verá el cambio.</p>
      ${alts.length ? `<ul class="list swap-list">${alts.map((x, i) => `<li><button type="button" class="swap-opt" data-alt="${i}"><span class="grow"><b>${esc(x.name)}</b><small>${esc(x.equipment || '')}</small></span>${ic('swap')}</button></li>`).join('')}</ul>` : '<p class="empty small">No hay alternativas en la biblioteca para este ejercicio.</p>'}
      <label>Otro ejercicio<input name="other" list="swap-all" placeholder="Escribe el nombre"></label><datalist id="swap-all">${all.map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>
      <label>¿Por qué? (opcional)<input name="why" maxlength="200" placeholder="Máquina ocupada, molestia…"></label>`, {
      submitLabel: 'Usar este', onSubmit: (f, fd) => { const o = String(fd.get('other') || '').trim(); if (!o) { toast('Elige una alternativa o escribe otra', 'err'); return false; } apply(all.find(x => x.name.toLowerCase() === o.toLowerCase()) || { name: o }, fd.get('why')); }
    });
    const apply = (x, why) => {
      if (!e.orig) Object.assign(e, { orig: e.name, origLin: e.lin, origMedia: e.media, origPrev: e.prev, origPrevAt: e.prevAt });
      Object.assign(e, { name: x.name, lin: null, media: x.media_url || null, prev: [], prevAt: null, swapWhy: String(why || '').trim() || null });
      if (e.name.toLowerCase() === String(e.orig).toLowerCase()) { e.orig = null; }
      closeModal(); saveWorkout(w); drawWorkout(w); toast('Ejercicio cambiado: tu entrenador lo verá', 'ok');
    };
    m.querySelectorAll('[data-alt]').forEach(b => b.onclick = () => apply(alts[+b.dataset.alt], m.querySelector('[name=why]').value));
  }

  function startRest(sec, next) { restTimer = { end: Date.now() + sec * 1000, total: sec, next }; bindRest(); }
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
      if (left <= 0) { const nx = restTimer.next; beep(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); stopRest(); restDone(nx); }
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
    const realMin = Math.max(1, Math.round((Date.now() - new Date(w.started_at)) / 6e4)), longMin = realMin > 150;
    modal('¡Entreno terminado! 🎉', `
      <p>${done} series completadas.</p>
      <fieldset class="dur"><legend>¿Cuánto duró el entreno?</legend>
        <label><input name="dur_h" type="number" inputmode="numeric" min="0" max="3" step="1" value="${longMin ? '' : Math.floor(realMin / 60)}" placeholder="1"><span>h</span></label>
        <label><input name="dur_m" type="number" inputmode="numeric" min="0" max="59" step="1" value="${longMin ? '' : realMin % 60}" placeholder="15"><span>min</span></label></fieldset>
      <p class="small ${longMin ? 'note' : 'muted'}" data-durhint>${longMin ? `⏱️ El contador marca ${Math.floor(realMin / 60)} h ${realMin % 60} min: si se te olvidó pararlo, pon lo que duró de verdad.` : 'Se rellena con el tiempo del contador. Si se te olvidó pararlo, corrígelo.'}</p>
      <fieldset class="scale wide"><legend>¿Qué tan duro fue? (RPE 1–10)</legend>${[5, 6, 7, 8, 9, 10].map(v => `<label><input type="radio" name="rpe" value="${v}"><span>${v}</span></label>`).join('')}</fieldset>
      <label>Comentario para tu entrenador (opcional)<textarea name="notes" rows="3" placeholder="Molestias, sensaciones, cambios…"></textarea></label>`, {
      submitLabel: 'Guardar entreno',
      onSubmit: async (f, fd) => {
        const c = S.client;
        const hh = parseInt(fd.get('dur_h'), 10) || 0, mm = parseInt(fd.get('dur_m'), 10) || 0, dur = hh * 60 + mm;
        if (mm > 59 || hh < 0 || mm < 0 || !(dur >= 5 && dur <= 180)) { toast('Pon cuánto duró: entre 5 minutos y 3 horas', 'err'); throw new Error('dur'); }
        const finished = new Date(Math.min(Date.now(), new Date(w.started_at).getTime() + dur * 6e4)).toISOString();
        const logs = []; let vol = 0;
        const inRange = (v, a, b) => (v != null && v >= a && v <= b ? Math.round(v * 2) / 2 : null);
        w.ex.forEach(e => { let n = 0; e.sets.forEach(s => {
          if (!s.done) return; n++; const kg = num(s.w), r = parseInt(s.r, 10), x = num(s.x);
          const l = { exercise_name: e.name, set_no: n, weight: kg, reps: isNaN(r) ? null : r };
          if (e.id) l.routine_item_id = e.id; if (e.lin) l.lineage_id = e.lin;
          if (e.it === 'rir') { if (s.x === 'F') { l.rir = 0; l.failure = true; } else l.rir = inRange(x, 0, 10); } if (e.it === 'rpe') l.rpe = inRange(x, 1, 10);
          logs.push(l); if (kg && !isNaN(r)) vol += kg * r; }); });
        await safe(async () => {
          const [s] = await DB.insert('sessions', { client_id: c.id, routine_id: w.routine_id, routine_name: w.routine_name, started_at: w.started_at, finished_at: finished, rpe: num(fd.get('rpe')), notes: fd.get('notes'), volume: vol });
          const rows = logs.map(l => Object.assign({ session_id: s.id, client_id: c.id }, l));
          if (rows.length) {
            try { await DB.insert('set_logs', rows); }
            catch (er) { if (!/failure/i.test(er.message || '')) throw er; rows.forEach(r => { delete r.failure; }); await DB.insert('set_logs', rows); }   // sin la migración 020
          }
          const fb = [];
          w.ex.forEach(e => {
            if (e.orig) fb.push({ kind: 'swap', exercise_name: e.orig, swap_to: e.name, body: e.swapWhy || null });
            if (e.fb) fb.push({ kind: 'comment', exercise_name: e.name, body: e.fb });
            fb.forEach(x => { if (!x.client_id) Object.assign(x, { client_id: c.id, session_id: s.id }, e.id ? { routine_item_id: e.id } : {}); });
          });
          if (fb.length) await DB.insert('workout_feedback', fb).catch(er => console.warn('workout_feedback', er));
        }, 'Entreno guardado 💪');
        clearWorkout(); stopRest(); openMedia.clear(); if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
        location.hash = '#/progreso';
      }
    });
  }

  window.JMUI = { esc, nl2br, fmtKg, ic, toast, safe, modal, closeModal, confirmBox, loading, ago, today };

  // ------------------------------------------------------------ PWA
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadSW = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // La app abre desde lo guardado; cuando hay versión nueva, se avisa para cargarla (sin cortar un entreno)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadSW || document.querySelector('.upd-bar')) return;
      const b = document.createElement('button'); b.className = 'upd-bar'; b.type = 'button';
      b.textContent = 'Hay una versión nueva de la app · Toca para actualizar';
      b.onclick = () => location.reload(); document.body.appendChild(b);
    });
  }

  // Arranca cuando ya están cargados los módulos (analítica, objetivos, mesociclos): si no, al recargar faltaban secciones
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
