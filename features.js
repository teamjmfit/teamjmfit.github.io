/* TEAM JMFIT · Métricas diarias + cumplimiento % */
(function () {
  'use strict';
  var cfg = window.JMFIT_CONFIG || {};
  if (!cfg.SUPABASE_URL || !window.supabase) return;
  var sb = (window.DB && window.DB.sb) || window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var me = null, busy = {}, cmpCache = null;
  function iso(d) { var x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
  function avg(a) { a = a.filter(function (v) { return v != null && !isNaN(v); }); return a.length ? a.reduce(function (s, v) { return s + Number(v); }, 0) / a.length : null; }
  function f1(v) { return v == null ? '–' : (Math.round(v * 10) / 10).toString().replace('.', ','); }
  async function who() {
    if (me) return me;
    var s = (await sb.auth.getSession()).data.session; if (!s) return null;
    var q = await Promise.all([sb.from('profiles').select('role').eq('id', s.user.id), sb.from('clients').select('id').eq('user_id', s.user.id)]);
    var p = q[0].data, c = q[1].data;
    me = { role: p && p[0] ? p[0].role : 'client', clientId: c && c[0] ? c[0].id : null };
    return me;
  }
  function weeksSummary(rows) {
    var now = Date.now(), w1 = [], w0 = [];
    rows.forEach(function (r) { var age = (now - new Date(r.date + 'T12:00:00')) / 864e5; if (age < 7) w1.push(r); else if (age < 14) w0.push(r); });
    var a1 = avg(w1.map(function (r) { return r.weight; })), a0 = avg(w0.map(function (r) { return r.weight; }));
    return { a1: a1, a0: a0, steps: avg(w1.map(function (r) { return r.steps; })), sleep: avg(w1.map(function (r) { return r.sleep_h; })), n: w1.length };
  }
  function summaryHtml(s) {
    var diff = s.a1 != null && s.a0 != null ? s.a1 - s.a0 : null;
    return '<div class="kpis small" style="margin:0"><div class="kpi"><small>Peso medio 7 días</small><b>' + f1(s.a1) + '</b><span>' + (diff == null ? s.n + ' registros' : (diff > 0 ? '+' : '') + f1(diff) + ' kg vs semana anterior') + '</span></div>' +
      '<div class="kpi"><small>Pasos/día</small><b>' + (s.steps == null ? '–' : Math.round(s.steps).toLocaleString('es-ES')) + '</b><span>media 7 días</span></div>' +
      '<div class="kpi"><small>Sueño</small><b>' + f1(s.sleep) + ' h</b><span>media 7 días</span></div></div>';
  }
  // Cliente: tarjeta "Registro de hoy" en Entreno (ya no se usa: el registro del día está en el inicio del cliente, app.js)
  async function clientCard() {
    var strip = document.querySelector('.weekstrip'); if (!strip || document.querySelector('[data-dm]') || busy.c) return;
    busy.c = true;
    try {
      var u = await who(); if (!u || !u.clientId) return;
      var rows = (await sb.from('daily_metrics').select('*').eq('client_id', u.clientId).gte('date', iso(Date.now() - 14 * 864e5)).order('date', { ascending: false })).data || [];
      var t = rows.find(function (r) { return r.date === iso(Date.now()); }) || {};
      if (document.querySelector('[data-dm]')) return;
      var card = document.createElement('section'); card.className = 'card'; card.setAttribute('data-dm', '');
      card.innerHTML = '<h3>Registro de hoy</h3><form class="form-grid three" data-f>' +
        '<label>Peso (kg)<input name="weight" type="number" step="0.1" inputmode="decimal" value="' + (t.weight || '') + '"></label>' +
        '<label>Pasos<input name="steps" type="number" inputmode="numeric" value="' + (t.steps || '') + '"></label>' +
        '<label>Sueño (h)<input name="sleep_h" type="number" step="0.5" inputmode="decimal" value="' + (t.sleep_h || '') + '"></label>' +
        '<button class="btn primary full" style="grid-column:1/-1">' + (t.date ? 'Actualizar' : 'Guardar') + '</button></form><div style="margin-top:12px" data-s>' + summaryHtml(weeksSummary(rows)) + '</div>' +
        '<p class="muted small" style="margin-top:8px">Pésate cada mañana en ayunas tras ir al baño: la media semanal es lo que cuenta, no el dato de un día.</p>';
      (strip.nextElementSibling || strip).after(card);
      card.querySelector('[data-f]').onsubmit = async function (e) {
        e.preventDefault(); var f = e.target, n = function (k) { return f[k].value === '' ? null : Number(f[k].value); };
        var r = await sb.from('daily_metrics').upsert({ client_id: u.clientId, date: iso(Date.now()), weight: n('weight'), steps: n('steps'), sleep_h: n('sleep_h') }, { onConflict: 'client_id,date' });
        if (r.error) { alert('Error: ' + r.error.message); return; }
        f.querySelector('button').textContent = 'Guardado ✓';
        var rows2 = (await sb.from('daily_metrics').select('*').eq('client_id', u.clientId).gte('date', iso(Date.now() - 14 * 864e5))).data || [];
        card.querySelector('[data-s]').innerHTML = summaryHtml(weeksSummary(rows2));
      };
    } finally { busy.c = false; }
  }
  // Progreso (entrenador y cliente): métricas diarias de 14 días
  async function progressCard() {
    var m = location.hash.match(/^#\/(?:cliente\/([^/]+)\/progreso|progreso)$/); if (!m) return;
    var kpis = document.querySelector('.content .kpis'); if (!kpis || document.querySelector('[data-dmp]') || busy.p) return;
    busy.p = true;
    try {
      var u = await who(); var cid = m[1] || (u && u.clientId); if (!cid) return;
      var rows = (await sb.from('daily_metrics').select('*').eq('client_id', cid).gte('date', iso(Date.now() - 14 * 864e5)).order('date', { ascending: false })).data || [];
      if (document.querySelector('[data-dmp]')) return;
      var card = document.createElement('section'); card.className = 'card'; card.setAttribute('data-dmp', '');
      card.innerHTML = '<h3>Métricas diarias</h3>' + summaryHtml(weeksSummary(rows)) + (rows.length ? '<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Día</th><th class="r">Peso</th><th class="r">Pasos</th><th class="r">Sueño</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td>' + new Date(r.date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) + '</td><td class="r">' + f1(r.weight) + '</td><td class="r">' + (r.steps == null ? '–' : r.steps.toLocaleString('es-ES')) + '</td><td class="r">' + f1(r.sleep_h) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">Sin registros diarios todavía.</p>');
      kpis.parentNode.insertBefore(card, kpis.nextSibling);
    } finally { busy.p = false; }
  }
  // Entrenador: cumplimiento en la lista de clientes
  async function compliance() {
    if (document.body.dataset.role !== 'coach' || !/^#\/clientes\/?$/.test(location.hash)) return;
    var links = document.querySelectorAll('.list.big li > a[href^="#/cliente/"]'); if (!links.length || document.querySelector('[data-cmp]') || busy.k) return;
    busy.k = true;
    try {
      var pend = [].some.call(document.querySelectorAll('.list.big li > a[href^="#/cliente/"]'), function (a) { return !a.querySelector('[data-cmp]'); });
      if (!pend) return;
      if (!cmpCache || Date.now() - cmpCache.at > 60000) {
        var q = await Promise.all([sb.from('routines').select('client_id,day'), sb.from('sessions').select('client_id,started_at,finished_at').gte('started_at', new Date(Date.now() - 28 * 864e5).toISOString())]);
        cmpCache = { at: Date.now(), r1: q[0].data || [], r2: q[1].data || [] };
      }
      var r1 = cmpCache.r1, r2 = cmpCache.r2;
      var plan = {}, d7 = {}, d28 = {};
      r1.forEach(function (r) { if (r.day) plan[r.client_id] = (plan[r.client_id] || 0) + 1; });
      r2.forEach(function (s) { if (!s.finished_at) return; d28[s.client_id] = (d28[s.client_id] || 0) + 1; if (Date.now() - new Date(s.started_at) < 7 * 864e5) d7[s.client_id] = (d7[s.client_id] || 0) + 1; });
      document.querySelectorAll('.list.big li > a[href^="#/cliente/"]').forEach(function (a) {
        if (a.querySelector('[data-cmp]')) return;
        var id = a.getAttribute('href').split('/')[2], p = plan[id];
        var pc = function (done, weeks) { return p ? Math.min(100, Math.round((done || 0) / (p * weeks) * 100)) : null; };
        var s = pc(d7[id], 1), mth = pc(d28[id], 4);
        var el = document.createElement('small'); el.setAttribute('data-cmp', '');
        el.textContent = p ? 'Cumplimiento S ' + s + '% · M ' + mth + '%' : 'Sin rutinas con día';
        el.style.color = !p ? '' : s >= 80 ? 'var(--green)' : s >= 50 ? 'var(--amber)' : 'var(--red)';
        var right = a.querySelector('.right'); (right || a).appendChild(el);
      });
    } finally { busy.k = false; }
  }
  var timer;
  function run() { clearTimeout(timer); timer = setTimeout(function () { progressCard(); compliance(); }, 150); }
  new MutationObserver(run).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') me = null; });
  window.addEventListener('hashchange', run);
  run();
})();
