/* TEAM JMFIT · Analítica visual: panel interactivo de carga aguda vs crónica (estado de asimilación)
   y gráficas de evolución por ejercicio (1RM estimado, carga máxima, tonelaje, RIR/RPE).
   Usa JMLoad.load (carga.js) para las medias exponenciales de 7 y 28 días. */
(function () {
  'use strict';
  const U = () => window.JMUI;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = v => (v == null ? '–' : String(Math.round(v * 10) / 10).replace('.', ','));
  const int = v => (v == null ? '–' : Math.round(v).toLocaleString('es-ES'));
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addD = (k, n) => { const x = new Date(k + 'T12:00:00'); x.setDate(x.getDate() + n); return ymd(x); };
  const fd = (k, o = { day: 'numeric', month: 'short' }) => new Date(String(k).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-ES', o);
  const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const zone = r => (r == null ? 'na' : r > 1.5 ? 'red' : r > 1.3 ? 'amber' : r < 0.8 ? 'blue' : 'green');
  let uid = 0;

  // Tooltip compartido que sigue al puntero dentro de un gráfico
  function hover(root, svg, n, xOf, html) {
    const wrap = svg.parentElement, tip = wrap.querySelector('.vz-tip'), cur = svg.querySelector('.vz-cur');
    const vb = svg.viewBox.baseVal;
    const pick = ev => {
      const r = svg.getBoundingClientRect(), px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * vb.width / r.width;
      let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.abs(xOf(i) - px); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    const show = ev => {
      const i = pick(ev), x = xOf(i), r = svg.getBoundingClientRect();
      cur.setAttribute('x1', x); cur.setAttribute('x2', x); cur.style.opacity = 1;
      tip.innerHTML = html(i); tip.hidden = false;
      const left = x * r.width / vb.width, w = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(r.width - w, left - w / 2)) + 'px';
    };
    const hide = () => { cur.style.opacity = 0; tip.hidden = true; };
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', hide);
    svg.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  }

  // ---------- 1) Estrés y fatiga: carga aguda (7 d) vs crónica (28 d)
  function stateOf(last, wb, inDeload, chronTrend) {
    if (!last || last.r == null) return { c: 'na', t: 'Faltan datos', d: 'Hacen falta 3 semanas de entrenos con RPE para valorar el ratio.' };
    const r = last.r;
    if (r > 1.5) return { c: 'red', t: 'Riesgo de sobrecarga', d: 'La carga de esta semana es mucho mayor que la que tiene asimilada. Baja volumen o mete la descarga.' };
    if (r > 1.3) return { c: 'amber', t: 'Subida rápida de carga', d: 'Está por encima de lo que suele asimilar. Vigila la fatiga y no subas más esta semana.' };
    if (r < 0.8) return inDeload ? { c: 'blue', t: 'Descarga: disipando fatiga', d: 'Es lo esperado en la semana de descarga; la forma debería mejorar.' }
      : { c: 'blue', t: 'Carga baja', d: 'Entrena por debajo de lo habitual: si se mantiene, puede perder adaptaciones.' };
    if (wb != null && wb <= -1) return { c: 'amber', t: 'Carga en rango, pero no la asimila bien', d: 'El bienestar del último check-in está por debajo de su normalidad. Revisa sueño, estrés y nutrición.' };
    return { c: 'green', t: chronTrend > 0.03 ? 'Asimilando bien: forma en aumento' : 'Estado óptimo', d: 'La carga reciente está en proporción con la que tiene asimilada (0,8–1,3).' };
  }

  function acwr({ sessions, checkins = [], weeks = [], range = 84 }) {
    const L = window.JMLoad ? window.JMLoad.load(sessions) : {};
    const id = 'vz' + (++uid);
    if (!L.days || L.days.length < 7) return { html: `<section class="card"><h3>Estrés y fatiga</h3><p class="empty">${L.total ? `Faltan entrenos con RPE (${L.missing} de ${L.total} no lo tienen).` : 'Aún no hay entrenos registrados.'} Con 1 semana se ve la carga; con 3, el ratio.</p></section>`, wire() {} };
    const wb = window.JMLoad.wellness(checkins), lastWb = wb[wb.length - 1];
    const t = ymd(new Date()), inDeload = weeks.some(w => w.kind === 'deload' && w.start_date <= t && t <= addD(w.start_date, 6));
    const all = L.days, lastI = all.length - 1, last = lastI >= 20 ? all[lastI] : null;
    const c14 = all[Math.max(0, lastI - 14)].c, chronTrend = c14 ? (all[lastI].c - c14) / c14 : 0;
    const st = stateOf(last, lastWb ? lastWb.z : null, inDeload, chronTrend);
    const kp = (t, v, s, cls = '') => `<div class="kpi ${cls}"><small>${t}</small><b>${v}</b><span>${s}</span></div>`;
    const html = `<section class="card vz" id="${id}"><header class="row gap wrap"><h3 class="grow">Estrés y fatiga <small class="muted">carga aguda vs crónica</small></h3>
        <div class="seg" role="group" aria-label="Periodo">${[[56, '8 sem'], [84, '12 sem'], [168, '24 sem']].map(([d, l]) => `<button type="button" data-rg="${d}" class="${d === range ? 'on' : ''}">${l}</button>`).join('')}</div></header>
      <div class="vz-state ${st.c}"><b>${esc(st.t)}</b><span>${esc(st.d)}</span></div>
      <div class="kpis small">
        ${kp('Carga aguda (7 d)', int(all[lastI].a), 'estrés reciente · UA/día')}
        ${kp('Carga crónica (28 d)', int(all[lastI].c), `fatiga asimilada · ${chronTrend > 0.03 ? '▲ subiendo' : chronTrend < -0.03 ? '▼ bajando' : '= estable'}`)}
        ${kp('Ratio agudo:crónico', last ? r1(last.r) : '–', last ? { green: 'zona óptima', amber: 'subida rápida', red: 'pico de carga', blue: 'por debajo' }[zone(last.r)] : `faltan ${21 - all.length} días`, last && ['red', 'amber'].includes(zone(last.r)) ? 'warn' : '')}
        ${kp('Bienestar', lastWb && lastWb.z != null ? r1(lastWb.z) : '–', lastWb ? 'vs su normalidad (z)' : 'necesita 4+ check-ins', lastWb && lastWb.z <= -1 ? 'warn' : '')}
      </div>
      <div class="vz-wrap" data-chart></div>
      <div class="legend"><span><i class="vz-k-ac"></i>Aguda (7 d)</span><span><i class="vz-k-ch"></i>Crónica (28 d)</span><span><i class="vz-k-d"></i>Carga del día</span><span><i class="vz-k-dl"></i>Semana de descarga</span><span><i class="vz-k-ok"></i>Ratio 0,8–1,3</span></div>
      <p class="muted small">Carga de cada entreno = RPE al terminar × minutos. Arriba: estrés de la última semana (aguda) frente a la carga del último mes (crónica). Abajo: su cociente. Si la aguda se dispara por encima de la crónica, sube el riesgo; si está muy por debajo, se pierde forma. Toca el gráfico para ver cada día.</p>
    </section>`;
    function draw(root, days) {
      const W = 640, H = 270, PL = 40, PR = 14, T0 = 12, T1 = 160, B0 = 182, B1 = 246;
      const n = days.length, x = i => PL + (W - PL - PR) * (n > 1 ? i / (n - 1) : 0.5), bw = Math.max(1.5, (W - PL - PR) / n * 0.7);
      const mx = Math.max(1, ...days.map(d => Math.max(d.v, d.a, d.c))) * 1.08, y = v => T1 - (T1 - T0) * v / mx;
      const yr = v => B1 - (B1 - B0) * Math.min(Math.max(v, 0), 2) / 2;
      const off = all.length - n;
      const path = (f, ok = () => true) => { let d = '', pen = false; days.forEach((p, i) => { const v = f(p); if (v == null || !ok(i)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${v.toFixed(1)} `; pen = true; }); return d; };
      const rOk = i => off + i >= 20;
      const area = `M${x(0)},${T1} ` + days.map((p, i) => `L${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(' ') + ` L${x(n - 1)},${T1} Z`;
      const dl = weeks.filter(w => w.kind === 'deload').map(w => { const a = days.findIndex(d => d.k >= w.start_date), b = days.findIndex(d => d.k > addD(w.start_date, 6)); if (a < 0) return ''; const e = b < 0 ? n - 1 : b - 1; return e < a ? '' : `<rect class="vz-dl" x="${(x(a) - 3).toFixed(1)}" width="${(x(e) - x(a) + 6).toFixed(1)}" y="${T0}" height="${B1 - T0}"><title>Descarga · semana del ${fd(w.start_date)}</title></rect>`; }).join('');
      const step = Math.max(1, Math.round(n / 6)), ticks = days.map((d, i) => (i % step === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="vz-lbl" text-anchor="middle">${esc(fd(d.k))}</text>` : '')).join('');
      root.querySelector('[data-chart]').innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="vz-svg" role="img" tabindex="0" aria-label="Carga aguda, crónica y ratio de los últimos ${n} días">
        ${dl}
        <rect class="vz-band blue" x="${PL}" width="${W - PL - PR}" y="${yr(0.8)}" height="${yr(0) - yr(0.8)}"/><rect class="vz-band green" x="${PL}" width="${W - PL - PR}" y="${yr(1.3)}" height="${yr(0.8) - yr(1.3)}"/>
        <rect class="vz-band amber" x="${PL}" width="${W - PL - PR}" y="${yr(1.5)}" height="${yr(1.3) - yr(1.5)}"/><rect class="vz-band red" x="${PL}" width="${W - PL - PR}" y="${yr(2)}" height="${yr(1.5) - yr(2)}"/>
        <line class="vz-grid" x1="${PL}" x2="${W - PR}" y1="${T1}" y2="${T1}"/><line class="vz-grid" x1="${PL}" x2="${W - PR}" y1="${yr(1)}" y2="${yr(1)}"/>
        <text class="vz-lbl" x="${PL - 6}" y="${y(mx / 1.08) + 4}" text-anchor="end">${int(mx / 1.08)}</text><text class="vz-lbl" x="${PL - 6}" y="${T1 + 4}" text-anchor="end">0</text>
        <text class="vz-lbl" x="${PL - 6}" y="${yr(1.3) + 4}" text-anchor="end">1,3</text><text class="vz-lbl" x="${PL - 6}" y="${yr(0.8) + 4}" text-anchor="end">0,8</text>
        <text class="vz-lbl" x="${PL}" y="${B0 - 6}">Ratio agudo:crónico</text>
        ${days.map((d, i) => (d.v > 0 ? `<rect class="vz-day" x="${(x(i) - bw / 2).toFixed(1)}" width="${bw.toFixed(1)}" y="${y(d.v).toFixed(1)}" height="${(T1 - y(d.v)).toFixed(1)}" rx="1"/>` : '')).join('')}
        <path class="vz-area" d="${area}"/><path class="vz-ch" d="${path(p => y(p.c))}"/><path class="vz-ac" d="${path(p => y(p.a))}"/>
        <path class="vz-r" d="${path(p => (p.r == null ? null : yr(p.r)), rOk)}"/>
        ${(() => { const i = n - 1, p = days[i]; return p.r != null && rOk(i) ? `<circle class="vz-pt ${zone(p.r)}" cx="${x(i)}" cy="${yr(p.r)}" r="4"/>` : ''; })()}
        ${ticks}<line class="vz-cur" x1="0" x2="0" y1="${T0}" y2="${B1}"/></svg><div class="vz-tip" hidden></div>`;
      hover(root, root.querySelector('svg'), n, x, i => { const p = days[i], z = rOk(i) && p.r != null ? zone(p.r) : 'na';
        return `<b>${esc(fd(p.k, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><span>Carga del día: ${int(p.v)} UA</span><span>Aguda ${int(p.a)} · Crónica ${int(p.c)}</span><span class="${z}">Ratio ${rOk(i) && p.r != null ? r1(p.r) : '–'}</span>`; });
    }
    return {
      html,
      wire(root) {
        const sec = root.querySelector('#' + id); if (!sec) return;
        const go = d => { sec.querySelectorAll('[data-rg]').forEach(b => b.classList.toggle('on', +b.dataset.rg === d)); draw(sec, all.slice(-d)); };
        sec.querySelectorAll('[data-rg]').forEach(b => b.onclick = () => go(+b.dataset.rg));
        go(range);
      }
    };
  }

  // ---------- 2) Evolución por ejercicio
  const keyOf = n => String(n || '').trim().toLowerCase();
  function exerciseData(logs, sessions) {
    const sd = {}, sTon = {}; (sessions || []).forEach(s => { sd[s.id] = s; });
    logs.forEach(l => { const w = +l.weight || 0, r = +l.reps || 0; sTon[l.session_id] = (sTon[l.session_id] || 0) + w * r; });
    const by = {};
    logs.forEach(l => {
      const k = keyOf(l.exercise_name); if (!k) return;
      const s = sd[l.session_id], date = s ? s.started_at : l.created_at; if (!date) return;
      const g = (by[k] = by[k] || { name: l.exercise_name, ss: {} });
      const e = (g.ss[l.session_id] = g.ss[l.session_id] || { sid: l.session_id, date, sets: [], srpe: s ? s.rpe : null });
      e.sets.push(l);
    });
    return Object.values(by).map(g => {
      const rows = Object.values(g.ss).map(e => {
        const ok = e.sets.filter(x => +x.weight > 0 && +x.reps > 0);
        const rir = e.sets.map(x => x.rir).filter(v => v != null && v !== '').map(Number), rpe = e.sets.map(x => x.rpe).filter(v => v != null && v !== '').map(Number);
        return { date: e.date, sid: e.sid, n: e.sets.length, top: ok.length ? Math.max(...ok.map(x => +x.weight)) : null,
          e1: ok.length ? Math.max(...ok.map(x => +x.weight * (1 + +x.reps / 30))) : null, reps: e.sets.reduce((a, x) => a + (+x.reps || 0), 0),
          ton: ok.reduce((a, x) => a + x.weight * x.reps, 0), rir: rir.length ? mean(rir) : null, rpe: rpe.length ? mean(rpe) : null, sTon: sTon[e.sid] || 0,
          best: ok.sort((a, b) => b.weight * (1 + b.reps / 30) - a.weight * (1 + a.reps / 30))[0] || null };
      }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return { key: keyOf(g.name), name: g.name, rows, lastDate: rows.length ? rows[rows.length - 1].date : '' };
    }).filter(g => g.rows.length).sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate)));
  }
  // Pendiente (kg/semana) del 1RM estimado en las últimas 8 semanas
  function slope(rows) {
    const cut = Date.now() - 56 * 864e5, p = rows.filter(r => r.e1 && new Date(r.date) >= cut).map(r => [new Date(r.date) / 864e5 / 7, r.e1]);
    if (p.length < 3) return null;
    const mx = mean(p.map(q => q[0])), my = mean(p.map(q => q[1])), den = p.reduce((a, q) => a + (q[0] - mx) ** 2, 0);
    return den ? p.reduce((a, q) => a + (q[0] - mx) * (q[1] - my), 0) / den : null;
  }

  function exercises({ logs, sessions, title = 'Evolución por ejercicio' }) {
    const data = exerciseData(logs, sessions), id = 'vz' + (++uid);
    if (!data.length) return { html: '', wire() {} };
    const html = `<section class="card vz" id="${id}"><header class="row gap wrap"><h3 class="grow">${esc(title)}</h3>
        <label class="vz-sel"><span class="sr-only">Ejercicio</span><select data-ex>${data.map((g, i) => `<option value="${i}">${esc(g.name)} (${g.rows.length})</option>`).join('')}</select></label></header>
      <div class="seg wrap" role="group" aria-label="Métricas">${[['e1', '1RM estimado'], ['top', 'Carga máx.'], ['ton', 'Tonelaje'], ['eff', 'RIR / RPE']].map(([k, l]) => `<button type="button" data-m="${k}" class="on" aria-pressed="true"><i class="vz-k-${k}"></i>${l}</button>`).join('')}</div>
      <div data-kp class="kpis small"></div><div class="vz-wrap" data-chart></div><div data-list></div></section>`;
    function draw(sec, g, on) {
      const rows = g.rows.slice(-24), n = rows.length, last = rows[n - 1];
      const firstE = rows.find(r => r.e1), bestE = Math.max(0, ...g.rows.map(r => r.e1 || 0)), sl = slope(g.rows);
      const ton4 = rows.slice(-5, -1).map(r => r.ton).filter(Boolean), tonAvg = mean(ton4);
      const kp = (t, v, s, cls = '') => `<div class="kpi ${cls}"><small>${t}</small><b>${v}</b><span>${s}</span></div>`;
      sec.querySelector('[data-kp]').innerHTML = `
        ${kp('1RM estimado', last.e1 ? r1(last.e1) + ' kg' : '–', `mejor ${r1(bestE)} kg${firstE && last.e1 && firstE !== last ? ' · ' + (last.e1 >= firstE.e1 ? '+' : '') + r1((last.e1 - firstE.e1) / firstE.e1 * 100) + ' %' : ''}`)}
        ${kp('Tendencia (8 sem)', sl == null ? '–' : (sl >= 0 ? '+' : '') + r1(sl) + ' kg/sem', sl == null ? 'faltan sesiones' : sl > 0.25 ? 'progresando' : sl < -0.25 ? 'bajando' : 'estable', sl != null && sl < -0.25 ? 'warn' : '')}
        ${kp('Tonelaje última sesión', int(last.ton) + ' kg', tonAvg ? `${last.ton >= tonAvg ? '+' : ''}${r1((last.ton - tonAvg) / tonAvg * 100)} % vs sus 4 anteriores` : `${last.n} series`)}
        ${kp('Esfuerzo última sesión', last.rir != null ? 'RIR ' + r1(last.rir) : last.rpe != null ? 'RPE ' + r1(last.rpe) : '–', last.rir != null && last.rpe != null ? 'RPE ' + r1(last.rpe) : 'media de las series')}`;
      const W = 640, H = 250, PL = 42, PR = 46, T0 = 14, T1 = 168, E0 = 188, E1 = 228;
      const x = i => PL + (W - PL - PR) * (n > 1 ? i / (n - 1) : 0.5), bw = Math.min(28, (W - PL - PR) / Math.max(n, 1) * 0.6);
      const kgV = rows.flatMap(r => [on.e1 ? r.e1 : null, on.top ? r.top : null]).filter(v => v != null);
      const kmin = kgV.length ? Math.min(...kgV) * 0.92 : 0, kmax = kgV.length ? Math.max(...kgV) * 1.04 : 1;
      const yk = v => T1 - (T1 - T0) * (v - kmin) / ((kmax - kmin) || 1);
      const tmax = Math.max(1, ...rows.map(r => r.ton)), yt = v => T1 - (T1 - T0) * 0.85 * v / tmax;
      const ye = v => E0 + (E1 - E0) * Math.min(Math.max(v, 0), 5) / 5;   // RIR 0 arriba (más cerca del fallo)
      const line = (f, cls) => { let d = '', pen = false; rows.forEach((r, i) => { const v = f(r); if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${v.toFixed(1)} `; pen = true; }); return `<path class="${cls}" d="${d}"/>` + rows.map((r, i) => (f(r) == null ? '' : `<circle class="${cls}-pt" cx="${x(i).toFixed(1)}" cy="${f(r).toFixed(1)}" r="3"/>`)).join(''); };
      const step = Math.max(1, Math.round(n / 6));
      const effV = r => (r.rir != null ? r.rir : r.rpe != null ? 10 - r.rpe : null);
      sec.querySelector('[data-chart]').innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="vz-svg" role="img" tabindex="0" aria-label="Evolución de ${esc(g.name)}">
        <line class="vz-grid" x1="${PL}" x2="${W - PR}" y1="${T1}" y2="${T1}"/>
        ${kgV.length ? `<text class="vz-lbl" x="${PL - 6}" y="${yk(kmax / 1.04) + 4}" text-anchor="end">${r1(kmax / 1.04)}</text><text class="vz-lbl" x="${PL - 6}" y="${yk(kmin / 0.92) + 4}" text-anchor="end">${r1(kmin / 0.92)}</text><text class="vz-lbl" x="${PL - 6}" y="${T0 - 2}" text-anchor="end">kg</text>` : ''}
        ${on.ton ? `<text class="vz-lbl" x="${W - PR + 6}" y="${yt(tmax) + 4}">${int(tmax)}</text><text class="vz-lbl" x="${W - PR + 6}" y="${T0 - 2}">ton.</text>` + rows.map((r, i) => (r.ton ? `<rect class="vz-ton" x="${(x(i) - bw / 2).toFixed(1)}" width="${bw.toFixed(1)}" y="${yt(r.ton).toFixed(1)}" height="${(T1 - yt(r.ton)).toFixed(1)}" rx="2"/>` : '')).join('') : ''}
        ${on.top ? line(r => (r.top == null ? null : yk(r.top)), 'vz-top') : ''}
        ${on.e1 ? line(r => (r.e1 == null ? null : yk(r.e1)), 'vz-e1') : ''}
        ${on.eff ? `<text class="vz-lbl" x="${PL}" y="${E0 - 5}">RIR (RPE → 10 − RPE) · arriba = más cerca del fallo</text><line class="vz-grid" x1="${PL}" x2="${W - PR}" y1="${E1}" y2="${E1}"/><text class="vz-lbl" x="${PL - 6}" y="${E0 + 4}" text-anchor="end">0</text><text class="vz-lbl" x="${PL - 6}" y="${E1 + 4}" text-anchor="end">5</text>` + rows.map((r, i) => { const v = effV(r); return v == null ? '' : `<circle class="vz-eff" cx="${x(i).toFixed(1)}" cy="${ye(v).toFixed(1)}" r="4"/>`; }).join('') : ''}
        ${rows.map((r, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="vz-lbl" text-anchor="middle">${esc(fd(r.date))}</text>` : '')).join('')}
        <line class="vz-cur" x1="0" x2="0" y1="${T0}" y2="${E1}"/></svg><div class="vz-tip" hidden></div>`;
      hover(sec, sec.querySelector('svg'), n, x, i => { const r = rows[i];
        return `<b>${esc(fd(r.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</b>${r.best ? `<span>Mejor serie: ${r1(+r.best.weight)} kg × ${r.best.reps}</span>` : ''}<span>1RM est. ${r1(r.e1)} kg · carga máx. ${r1(r.top)} kg</span><span>Tonelaje ${int(r.ton)} kg (${r.n} series, ${r.reps} reps)</span><span>Sesión completa: ${int(r.sTon)} kg</span>${r.rir != null || r.rpe != null ? `<span>${r.rir != null ? 'RIR ' + r1(r.rir) : ''}${r.rir != null && r.rpe != null ? ' · ' : ''}${r.rpe != null ? 'RPE ' + r1(r.rpe) : ''}</span>` : ''}`; });
    }
    return {
      html,
      wire(root) {
        const sec = root.querySelector('#' + id); if (!sec) return;
        const on = { e1: true, top: true, ton: true, eff: true };
        let cur = 0; const sel = sec.querySelector('[data-ex]');
        try { const k = localStorage.getItem('jm-vz-ex'); const i = data.findIndex(g => g.key === k); if (i >= 0) { cur = i; sel.value = String(i); } } catch (e) { /* sin almacenamiento */ }
        const go = () => draw(sec, data[cur], on);
        sel.onchange = () => { cur = +sel.value; try { localStorage.setItem('jm-vz-ex', data[cur].key); } catch (e) { /* nada */ } go(); };
        sec.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const k = b.dataset.m; if (Object.values(on).filter(Boolean).length === 1 && on[k]) return; on[k] = !on[k]; b.classList.toggle('on', on[k]); b.setAttribute('aria-pressed', on[k]); go(); });
        go();
      }
    };
  }

  window.JMViz = { acwr, exercises, exerciseData, stateOf };
})();
