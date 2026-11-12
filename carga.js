// TEAM JMFIT · control de la carga (criterios de la asignatura de Evaluación y Control, ULL):
// carga de sesión (RPE × minutos), ratio agudo:crónico con medias exponenciales (7 y 28 días),
// monotonía y strain, bienestar del check-in comparado con su propia normalidad (z-score),
// series por músculo y semana, y sugerencia de descarga. Solo lo ve el entrenador.
(function () {
  const U = () => window.JMUI;
  const DAY = 864e5;
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dKey = s => (String(s).length === 10 ? String(s) : ymd(new Date(s)));
  const addD = (k, n) => { const x = new Date(k + 'T12:00:00'); x.setDate(x.getDate() + n); return ymd(x); };
  const monday = k => { const x = new Date(k + 'T12:00:00'); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return ymd(x); };
  const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  const r1 = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const int = v => Math.round(v).toLocaleString('es-ES');

  // ---------- Carga de sesión y ratio agudo:crónico
  const sessMin = s => Math.min(180, Math.max(5, Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 6e4)));
  function load(sessions) {
    const done = sessions.filter(s => s.finished_at);
    const withR = done.filter(s => s.rpe != null && s.rpe !== '');
    const out = { missing: done.length - withR.length, total: done.length };
    if (!withR.length) return out;
    const daily = {};
    withR.forEach(s => { const k = dKey(s.started_at); daily[k] = (daily[k] || 0) + Number(s.rpe) * sessMin(s); });
    const today = ymd(new Date());
    const first = Object.keys(daily).sort()[0];
    const days = []; for (let k = first; k <= today; k = addD(k, 1)) days.push({ k, v: daily[k] || 0 });
    // Las medias exponenciales arrancan con la media de los primeros 28 días (si no, las primeras semanas inflan el ratio)
    const seed = mean(days.slice(0, 28).map(d => d.v)) || 0;
    const la = 2 / (7 + 1), lc = 2 / (28 + 1);
    let a = seed, c = seed;
    days.forEach(d => { a = d.v * la + (1 - la) * a; c = d.v * lc + (1 - lc) * c; d.a = a; d.c = c; d.r = c > 0 ? a / c : null; });
    out.days = days; out.history = days.length;
    out.acwr = days.length >= 21 ? days[days.length - 1].r : null;
    // Semanas (lunes-domingo): carga total, monotonía y strain
    const W = {};
    days.forEach(d => { const m = monday(d.k); (W[m] = W[m] || []).push(d); });
    out.weeks = Object.entries(W).sort(([x], [y]) => x.localeCompare(y)).map(([wk, ds]) => {
      const vals = ds.map(d => d.v); while (vals.length < 7 && wk !== monday(today)) vals.push(0);
      const tot = vals.reduce((s, x) => s + x, 0), s = sd(vals), mono = s ? mean(vals) / s : null;
      const lastD = ds[ds.length - 1];
      return { wk, tot, mono, strain: mono != null ? tot * mono : null, n: ds.filter(d => d.v > 0).length, r: days.indexOf(lastD) >= 20 ? lastD.r : null, partial: wk === monday(today) };
    }).slice(-12);
    return out;
  }
  const acwrZone = r => (r == null ? ['', 'Faltan datos'] : r > 1.5 ? ['red', 'Pico de carga'] : r > 1.3 ? ['amber', 'Subida rápida'] : r < 0.8 ? ['blue', 'Carga baja'] : ['green', 'En rango']);

  function loadChart(weeks) {
    const W = 600, H = 220, P = 44, n = weeks.length;
    const maxT = Math.max(...weeks.map(w => w.tot), 1), rMax = 2;
    const bw = (W - P * 2) / n, x = i => P + bw * i + bw / 2;
    const yT = v => H - P - (v * (H - P * 2)) / maxT, yR = v => H - P - (Math.min(v, rMax) * (H - P * 2)) / rMax;
    const { esc } = U();
    let d = '', pen = false;
    weeks.forEach((w, i) => { if (w.r == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${yR(w.r).toFixed(1)} `; pen = true; });
    const fd = k => new Date(k + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const step = Math.max(1, Math.ceil(n / 6));
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Carga semanal y ratio agudo:crónico">
      <rect x="${P}" width="${W - P * 2}" y="${yR(1.3)}" height="${yR(0.8) - yR(1.3)}" class="band"/>
      <line x1="${P}" x2="${W - P}" y1="${yR(1)}" y2="${yR(1)}" class="grid"/>
      <text x="${W - P + 4}" y="${yR(1.3) + 4}" class="lbl">1,3</text><text x="${W - P + 4}" y="${yR(0.8) + 4}" class="lbl">0,8</text>
      <text x="${P - 6}" y="${yT(maxT) + 4}" class="lbl" text-anchor="end">${int(maxT)}</text>
      ${weeks.map((w, i) => `<rect x="${(x(i) - bw * 0.32).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" y="${yT(w.tot).toFixed(1)}" height="${(H - P - yT(w.tot)).toFixed(1)}" rx="3" class="bar ${w.partial ? 'partial' : ''}"><title>Semana del ${fd(w.wk)}: ${int(w.tot)} UA en ${w.n} día${w.n === 1 ? '' : 's'}${w.partial ? ' (en curso)' : ''}</title></rect>`).join('')}
      <path d="${d}" class="line s4"/>
      ${weeks.map((w, i) => (w.r == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${yR(w.r).toFixed(1)}" r="3.5" class="pt s4"><title>Ratio agudo:crónico ${r1(w.r)}</title></circle>`)).join('')}
      ${weeks.map((w, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" class="lbl" text-anchor="middle">${esc(fd(w.wk))}</text>` : '')).join('')}
    </svg><div class="legend"><span><i class="bar"></i>Carga semanal (RPE × min)</span><span><i class="s4"></i>Ratio agudo:crónico</span><span><i class="band"></i>Zona 0,8–1,3</span></div>`;
  }

  // ---------- Bienestar: cada check-in contra los 8 anteriores del mismo cliente
  const WELL = [['fatigue', 'Fatiga', -1], ['stress', 'Estrés', -1], ['sleep_q', 'Sueño', 1], ['energy10', 'Energía', 1], ['motivation', 'Motivación', 1]];
  function wellness(checkins) {
    const ck = checkins.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return ck.map((k, i) => {
      const base = ck.slice(Math.max(0, i - 8), i);
      const items = WELL.map(([key, name, dir]) => {
        if (k[key] == null || k[key] === '') return null;
        const hist = base.map(b => b[key]).filter(v => v != null && v !== '').map(Number);
        if (hist.length < 3) return null;
        const z = dir * (Number(k[key]) - mean(hist)) / Math.max(0.75, sd(hist) || 0);
        return { key, name, z, v: Number(k[key]), m: mean(hist) };
      }).filter(Boolean);
      return { date: k.date, items, z: items.length ? mean(items.map(x => x.z)) : null };
    }).filter(r => r.z != null);
  }
  const zZone = z => (z == null ? ['', '–'] : z <= -2 ? ['red', 'Muy por debajo de lo normal'] : z <= -1 ? ['amber', 'Por debajo de lo normal'] : z >= 1 ? ['green', 'Mejor de lo normal'] : ['', 'Normal']);

  function wellChart(rows) {
    const W = 600, H = 200, P = 44, n = rows.length, lo = -3, hi = 2;
    const x = i => P + (i * (W - P * 2)) / Math.max(1, n - 1), y = v => H - P - ((Math.max(lo, Math.min(hi, v)) - lo) * (H - P * 2)) / (hi - lo);
    const fd = k => new Date(String(k).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const d = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.z).toFixed(1)}`).join(' ');
    const step = Math.max(1, Math.ceil(n / 6));
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bienestar respecto a su normalidad">
      <rect x="${P}" width="${W - P * 2}" y="${y(-1)}" height="${y(-2) - y(-1)}" class="zone-a"/><rect x="${P}" width="${W - P * 2}" y="${y(-2)}" height="${y(lo) - y(-2)}" class="zone-r"/>
      <line x1="${P}" x2="${W - P}" y1="${y(0)}" y2="${y(0)}" class="grid"/>
      <text x="${W - P + 4}" y="${y(0) + 4}" class="lbl">0</text><text x="${W - P + 4}" y="${y(-1) + 4}" class="lbl">−1</text><text x="${W - P + 4}" y="${y(-2) + 4}" class="lbl">−2</text>
      <path d="${d}" class="line"/>
      ${rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.z).toFixed(1)}" r="4" class="pt ${zZone(r.z)[0]}"><title>${fd(r.date)}: ${r1(r.z)} · ${r.items.map(t => `${t.name} ${t.v}`).join(', ')}</title></circle>`).join('')}
      ${rows.map((r, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" class="lbl" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${fd(r.date)}</text>` : '')).join('')}
    </svg>`;
  }

  // ---------- Series por grupo muscular (la 2.ª parte del nombre cuenta media serie: «Pecho / Tríceps»)
  // Se compara sin tildes ni mayúsculas («Extensión de rodilla» = «Extension de rodilla»)
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const NOVOL = new Set(['movilidad', 'cardio', 'estiramiento', 'calentamiento']);   // no cuentan como series de fuerza
  function muscleOf(name, exercises) {
    const k = norm(name), e = exercises.find(x => norm(x.name) === k);
    const m = e && e.muscle ? e.muscle : 'Sin grupo';
    return m.split('/').map(s => s.trim()).filter(Boolean);
  }
  function addSets(acc, name, n, exercises) { const ms = muscleOf(name, exercises); if (NOVOL.has(norm(ms[0]))) return; ms.forEach((m, i) => { acc[m] = (acc[m] || 0) + n * (i ? 0.5 : 1); }); }
  function plannedSets(items, exercises) { const acc = {}; items.forEach(i => addSets(acc, i.exercise_name, Number(i.sets) || 0, exercises)); return acc; }
  const vClass = v => (v < 10 ? 'lo' : v > 20 ? 'hi' : 'ok');

  // Panel de la semana en Rutinas: series pautadas por músculo y cambio frente a la semana anterior
  function weekVolume(items, prevItems, exercises, { label = 'esta semana' } = {}) {
    const { esc } = U();
    const cur = plannedSets(items, exercises); const keys = Object.keys(cur).filter(k => cur[k] > 0);
    if (!keys.length) return '';
    const prev = prevItems ? plannedSets(prevItems, exercises) : null;
    const tot = keys.reduce((s, k) => s + cur[k], 0), ptot = prev ? Object.values(prev).reduce((s, x) => s + x, 0) : 0;
    const ch = prev && ptot ? (tot - ptot) / ptot * 100 : null;
    const max = Math.max(25, ...keys.map(k => cur[k]));
    const rows = keys.sort((a, b) => cur[b] - cur[a]).map(k => {
      const v = cur[k], p = prev ? prev[k] || 0 : null, d = p ? (v - p) / p * 100 : null;
      return `<div class="vrow"><span class="vname">${esc(k)}</span><span class="vbar"><i class="vzone" style="left:${10 / max * 100}%;width:${10 / max * 100}%"></i><b class="${k === 'Sin grupo' ? '' : vClass(v)}" style="width:${Math.min(100, v / max * 100)}%"></b></span>
        <span class="vnum">${r1(v)}${d != null && Math.abs(d) >= 1 ? ` <small class="${d > 25 ? 'up' : ''}">${d > 0 ? '+' : ''}${Math.round(d)} %</small>` : ''}</span></div>`;
    }).join('');
    const warn = keys.filter(k => k !== 'Sin grupo' && prev && prev[k] && (cur[k] - prev[k]) / prev[k] > 0.25);
    return `<section class="card vol"><h3>Series por músculo <small class="muted">${esc(label)} · ${r1(tot)} en total${ch != null ? ` · ${ch > 0 ? '+' : ''}${Math.round(ch)} % vs la anterior` : ''}</small></h3>${rows}
      <p class="muted small">Franja gris: 10–20 series a la semana, el rango habitual para hipertrofia (en fuerza suele bastar con 10–15). El 2.º grupo de un ejercicio («Pecho / Tríceps») cuenta media serie; la movilidad y el cardio no cuentan.${warn.length ? `<br>⚠️ Sube más de un 25 % en ${warn.map(esc).join(', ')}: mejor subir el volumen poco a poco (≈20 % cada vez).` : ''}${cur['Sin grupo'] ? '<br>«Sin grupo»: ejercicios que no están en tu catálogo o no tienen grupo muscular.' : ''}</p></section>`;
  }

  // Series realizadas por músculo en las últimas semanas (tabla de calor)
  function doneVolume(logs, exercises, weeksN = 8) {
    const { esc } = U();
    const cut = monday(addD(ymd(new Date()), -7 * (weeksN - 1)));
    const W = {};
    logs.forEach(l => { const k = dKey(l.created_at); if (k < cut) return; const m = monday(k); W[m] = W[m] || {}; addSets(W[m], l.exercise_name, 1, exercises); });
    const wks = []; for (let k = cut; k <= monday(ymd(new Date())); k = addD(k, 7)) wks.push(k);
    const ms = [...new Set(Object.values(W).flatMap(o => Object.keys(o)))];
    if (!ms.length) return '';
    const tot = m => wks.reduce((s, w) => s + ((W[w] || {})[m] || 0), 0);
    ms.sort((a, b) => tot(b) - tot(a));
    const fd = k => new Date(k + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    return `<section class="card flush"><h3 class="pad">Series hechas por músculo</h3><div class="tscroll"><table class="heat"><thead><tr><th></th>${wks.map(w => `<th>${fd(w)}</th>`).join('')}</tr></thead><tbody>
      ${ms.map(m => `<tr><th>${esc(m)}</th>${wks.map((w, i) => { const v = (W[w] || {})[m] || 0; return `<td class="${v ? (m === 'Sin grupo' ? 'na' : vClass(v)) : 'z'}${i === wks.length - 1 ? ' cur' : ''}">${v ? r1(v) : ''}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div><p class="muted small pad">Series registradas por el cliente cada semana (la última columna es la semana en curso). <span class="hl lo">menos de 10</span> <span class="hl ok">10–20</span> <span class="hl hi">más de 20</span></p></section>`;
  }

  // ---------- Panel «Carga y estado» de Progreso + sugerencia de descarga
  function panel({ sessions, checkins, nStall = 0, sinceDl = null, nextWeek = null, hasProgram = false }) {
    const { esc } = U();
    const L = load(sessions), WB = wellness(checkins);
    const lastW = L.weeks ? L.weeks.filter(w => !w.partial).pop() : null;
    const lastWb = WB[WB.length - 1];
    const [ac, at] = acwrZone(L.acwr), [wc, wt] = zZone(lastWb ? lastWb.z : null);
    // Señales de descarga
    const sig = [];
    if (nStall >= 2) sig.push(`${nStall} ejercicios sin mejorar en 3+ sesiones`);
    if (lastWb && lastWb.z <= -1) sig.push(`bienestar ${r1(lastWb.z)} respecto a su normalidad en el último check-in`);
    if (L.acwr != null && L.acwr > 1.3) sig.push(`ratio agudo:crónico ${r1(L.acwr)} (subida de carga rápida)`);
    if (sinceDl != null && sinceDl >= 6) sig.push(`${sinceDl} semanas sin descarga`);
    let sug = '';
    if (sig.length >= 2) {
      const act = nextWeek ? (nextWeek.kind === 'deload' ? `<p class="small">✓ La S${nextWeek.week_no} ya está marcada como descarga.</p>` : `<button class="btn small primary" data-dl="${nextWeek.id}">Convertir la S${nextWeek.week_no} en descarga</button>`)
        : `<p class="small muted">${hasProgram ? 'Crea la semana siguiente en Rutinas y márcala como descarga.' : 'Valora bajar el volumen la semana que viene.'}</p>`;
      sug = `<section class="card sug-dl"><h3>💡 Sugerencia: semana de descarga</h3><ul class="small">${sig.map(s => `<li>${esc(s)}</li>`).join('')}</ul>${act}
        <p class="muted small">Coinciden ${sig.length} señales de fatiga acumulada. Es solo una sugerencia: decides tú.</p></section>`;
    }
    const kp = (t, v, s, cls = '') => `<div class="kpi ${cls}"><small>${t}</small><b>${v}</b><span>${s}</span></div>`;
    const hasLoad = L.weeks && L.weeks.length;
    const body = `<section class="card"><h3>Carga y estado <small class="muted">solo lo ves tú</small></h3>
      <div class="kpis small">
        ${kp('Carga última semana', lastW ? int(lastW.tot) + ' UA' : '–', lastW ? `${lastW.n} día${lastW.n === 1 ? '' : 's'} de entreno` : 'necesita entrenos con RPE')}
        ${kp('Ratio agudo:crónico', L.acwr != null ? r1(L.acwr) : '–', L.acwr != null ? at : L.history ? `faltan ${21 - L.history} días de historial` : 'sin datos', ac === 'red' || ac === 'amber' ? 'warn' : '')}
        ${kp('Monotonía', lastW && lastW.mono != null ? r1(lastW.mono) : '–', lastW && lastW.mono != null ? (lastW.mono > 2 ? 'muy repetitiva (>2)' : 'variada') : '—', lastW && lastW.mono > 2 ? 'warn' : '')}
        ${kp('Bienestar', lastWb ? r1(lastWb.z) : '–', lastWb ? wt : 'necesita 4+ check-ins', wc === 'red' || wc === 'amber' ? 'warn' : '')}
      </div>
      ${hasLoad ? loadChart(L.weeks) : ''}
      <p class="muted small">Carga de cada entreno = RPE que pone el cliente al terminar × minutos (máx. 180). El ratio compara la última semana con el último mes (medias exponenciales de 7 y 28 días): entre 0,8 y 1,3 es lo habitual; por encima, la carga ha subido muy rápido.${L.missing ? ` ${L.missing} de ${L.total} entrenos no tienen RPE y no cuentan.` : ''}</p>
      ${WB.length >= 2 ? `<h4>Bienestar respecto a su normalidad</h4>${wellChart(WB.slice(-16))}
        ${lastWb ? `<div class="wb-chips">${lastWb.items.map(t => { const [c] = zZone(t.z); return `<span class="pill ${c}">${t.name} ${t.v} <small>(suele ${r1(t.m)})</small></span>`; }).join('')}</div>` : ''}
        <p class="muted small">Cada check-in se compara con los 8 anteriores del propio cliente (fatiga y estrés cuentan al revés). 0 = como siempre; por debajo de −1, peor de lo normal; por debajo de −2, bastante peor. Un solo punto bajo puede ser ruido: fíjate en la tendencia.</p>` : ''}
    </section>`;
    return { html: sug + body, wire(root, onDeload) { const b = root.querySelector('[data-dl]'); if (b) b.onclick = () => onDeload(b.dataset.dl); } };
  }

  window.JMLoad = { load, wellness, panel, weekVolume, doneVolume, plannedSets };
})();
