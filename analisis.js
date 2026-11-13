// TEAM JMFIT · Analizador semanal: cruza el check-in con los entrenos de esa semana y de las 4 anteriores.
// Reglas fijas (criterios M4 y Tema 2 de la uni, ver claude/criterios-entrenamiento-uni.md): mismos datos → mismo resultado.
(function () {
  const RULES_V = 1;
  const ymd = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const addD = (k, n) => { const x = new Date(k + 'T12:00:00'); x.setDate(x.getDate() + n); return ymd(x); };
  const day = v => (v ? ymd(v) : '');
  const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const e1 = (w, r) => (w > 0 && r > 0 && r <= 20 ? w * (1 + Math.min(r, 12) / 30) : 0);
  const pct = (a, b) => (b ? (a / b - 1) * 100 : null);
  const r1 = v => Math.round(v * 10) / 10;

  // Datos: { client, checkin, checkins, sessions, logs, items (rutinas de esa semana), exercises }
  function run(D) {
    const k = D.checkin, end = String(k.date).slice(0, 10), start = addD(end, -6), prevStart = addD(end, -34);
    const inW = v => { const x = day(v); return x >= start && x <= end; }, inPrev = v => { const x = day(v); return x >= prevStart && x < start; };
    const logs = (D.logs || []).filter(l => l.weight != null && l.reps != null);
    const wLogs = logs.filter(l => inW(l.created_at)), pLogs = logs.filter(l => inPrev(l.created_at));
    const sess = (D.sessions || []).filter(s => s.finished_at), wSess = sess.filter(s => inW(s.started_at));

    // ---- Rendimiento: mejor 1RM estimado de la semana frente al mejor de las 4 anteriores (cambio real ≥ 2,5 %)
    const byEx = {}; wLogs.forEach(l => { const v = e1(Number(l.weight), Number(l.reps)); const n = l.exercise_name; if (!byEx[n]) byEx[n] = { now: 0, sets: 0 }; byEx[n].now = Math.max(byEx[n].now, v); byEx[n].sets++; });
    const perf = Object.entries(byEx).map(([ex, o]) => {
      const prevVals = pLogs.filter(l => l.exercise_name === ex).map(l => e1(Number(l.weight), Number(l.reps)));
      const before = prevVals.length ? Math.max(...prevVals) : null;
      // estancado: 3 semanas seguidas sin superar el mejor previo en más de un 1 %
      const wk = n => { const a = addD(start, -7 * n), b = addD(end, -7 * n); const v = logs.filter(l => l.exercise_name === ex && day(l.created_at) >= a && day(l.created_at) <= b).map(l => e1(Number(l.weight), Number(l.reps))); return v.length ? Math.max(...v) : null; };
      const w0 = o.now, w1 = wk(1), w2 = wk(2), w3 = wk(3);
      const stall = w1 && w2 && w3 && Math.max(w0, w1, w2) <= w3 * 1.01;
      const d = before ? pct(o.now, before) : null;
      return { ex, now: r1(o.now), before: before ? r1(before) : null, delta: d == null ? null : r1(d), sets: o.sets,
        status: d == null ? 'nuevo' : stall ? 'estancado' : d >= 2.5 ? 'mejora' : d <= -3 ? 'baja' : 'igual' };
    }).sort((a, b) => b.sets - a.sets).slice(0, 8);

    // ---- Esfuerzo: RIR real frente al pautado, series al fallo
    const rirs = wLogs.map(l => l.rir).filter(v => v != null).map(Number);
    const plan = (D.items || []).map(i => i.target_rir).filter(v => v != null).map(Number);
    const effort = { real: rirs.length ? r1(mean(rirs)) : null, plan: plan.length ? r1(mean(plan)) : null, fails: wLogs.filter(l => l.failure || Number(l.rir) === 0).length };
    effort.state = effort.real == null || effort.plan == null ? null : effort.real >= effort.plan + 1 ? 'sobrado' : effort.real <= effort.plan - 1 ? 'al_limite' : 'en_pauta';

    // ---- Cumplimiento: entrenos y series hechas frente a lo planificado esa semana
    const routinesPlanned = [...new Set((D.items || []).map(i => i.routine_id))].length;
    const setsPlanned = (D.items || []).reduce((s, i) => s + (Number(i.sets) || 0), 0);
    const adh = { sessions: wSess.length, planned: routinesPlanned || null, sets: wLogs.length, setsPlanned: setsPlanned || null };
    adh.pct = adh.setsPlanned ? Math.min(100, Math.round(adh.sets / adh.setsPlanned * 100)) : adh.planned ? Math.min(100, Math.round(adh.sessions / adh.planned * 100)) : null;

    // ---- Fatiga: bienestar del check-in en z (vs sus 8 anteriores), ratio agudo:crónico y señales del formulario
    const L = window.JMLoad;
    const well = L && L.wellness ? L.wellness(D.checkins || []).find(w => String(w.date).slice(0, 10) === end) : null;
    const ld = L && L.load ? L.load(sess.filter(s => day(s.started_at) <= end)) : null;
    const acwr = ld && ld.days && ld.days.length >= 21 && ld.days[ld.days.length - 1].r != null ? Math.round(ld.days[ld.days.length - 1].r * 100) / 100 : null;
    const z = well ? r1(well.z) : null;
    const sig = [];
    let score = 40;
    if (z != null) score -= z * 15;
    if (acwr != null && acwr > 1.3) { score += 12; sig.push(`carga subiendo rápido (ratio ${String(acwr).replace('.', ',')})`); }
    if (acwr != null && acwr > 1.5) score += 12;
    if (k.fatigue != null && k.fatigue >= 7) { score += 10; sig.push(`fatiga ${k.fatigue}/10`); }
    if (k.sleep_h != null && k.sleep_h < 6) { score += 10; sig.push(`duerme ${String(k.sleep_h).replace('.', ',')} h`); }
    if (k.stress != null && k.stress >= 8) { score += 6; sig.push(`estrés ${k.stress}/10`); }
    if (k.fatigue_muscles) sig.push('agujetas/carga: ' + String(k.fatigue_muscles).slice(0, 60));
    if (z != null && z <= -1) sig.push(`bienestar por debajo de lo normal (z ${String(z).replace('.', ',')})`);
    score = Math.max(0, Math.min(100, Math.round(score)));
    const fatigue = { score, zone: score >= 65 ? 'red' : score >= 45 ? 'amber' : 'green', z, acwr, signals: sig };

    // ---- Peso: cambio frente al check-in anterior y ritmo buscado de la ficha
    const prevK = (D.checkins || []).filter(x => String(x.date) < end && x.weight).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const weeksBetween = prevK ? Math.max(1, Math.round((new Date(end) - new Date(prevK.date)) / (7 * 864e5))) : null;
    const rate = prevK && k.weight ? r1((Number(k.weight) - Number(prevK.weight)) / weeksBetween * 100) / 100 : null;
    const target = D.client && D.client.weekly_target != null ? Number(D.client.weekly_target) : null;
    const weight = { now: k.weight != null ? Number(k.weight) : null, rate, target, off: rate != null && target != null && Math.abs(rate - target) > Math.max(0.15, Math.abs(target) * 0.5) };

    // ---- Decisiones (la primera que encaja manda; se añaden las compatibles)
    const dec = [];
    const ups = perf.filter(p => p.status === 'mejora'), downs = perf.filter(p => p.status === 'baja'), stalls = perf.filter(p => p.status === 'estancado');
    const strongFat = (z != null && z <= -2) || (acwr != null && acwr > 1.5) || sig.length >= 3;
    if (strongFat) dec.push({ k: 'deload', t: 'Semana de descarga', why: 'Varias señales de fatiga a la vez: conviene bajar volumen (−40 % series) y carga (−10 %) una semana para asimilar.', action: 'rutinas' });
    else {
      if (stalls.length) dec.push({ k: 'variant', t: `Cambiar el estímulo en ${stalls.map(s => s.ex).slice(0, 2).join(' y ')}`, why: '3 semanas sin superar la marca con la fatiga en rango: cambia la variante o el rango de repeticiones.', action: 'rutinas' });
      if (ups.length && effort.state === 'sobrado') dec.push({ k: 'up', t: `Subir carga un 2,5–5 % en ${ups.map(s => s.ex).slice(0, 3).join(', ')}`, why: `Ha mejorado y le sobran repeticiones (RIR real ${String(effort.real).replace('.', ',')} frente a ${String(effort.plan).replace('.', ',')} pautado).`, action: 'rutinas' });
      else if (ups.length) dec.push({ k: 'keep', t: 'Mantener la progresión prevista', why: `Mejora en ${ups.length} ejercicio${ups.length > 1 ? 's' : ''} con la fatiga controlada.` });
      if (downs.length && z != null && z <= -1) dec.push({ k: 'recover', t: 'Mantener cargas y cuidar la recuperación', why: 'El rendimiento baja a la vez que el bienestar: revisa sueño, estrés y calorías antes de subir nada.' });
    }
    if (adh.pct != null && adh.pct < 70) dec.push({ k: 'adh', t: 'Ajustar días o duración de las sesiones', why: `Ha hecho el ${adh.pct} % de lo planificado: mejor un plan que pueda cumplir que subir la carga.` });
    if (weight.off) dec.push({ k: 'kcal', t: `Ajuste nutricional (${weight.rate > (weight.target || 0) ? '−' : '+'}150–200 kcal)`, why: `Ritmo de ${String(weight.rate).replace('.', ',')} kg/sem frente a ${String(weight.target).replace('.', ',')} buscado.`, action: 'nutricion' });
    if (!dec.length) dec.push({ k: 'ok', t: 'Seguir con el plan', why: 'Sin señales que pidan cambios esta semana.' });

    const light = strongFat || fatigue.zone === 'red' || downs.length >= 2 ? 'red' : fatigue.zone === 'amber' || stalls.length || (adh.pct != null && adh.pct < 70) || downs.length ? 'amber' : 'green';
    return { v: RULES_V, week: { start, end }, perf, effort, adh, fatigue, weight, decisions: dec.slice(0, 4), light };
  }

  // ---- Pantalla. asCoach: todas las cifras; cliente: lenguaje sencillo
  function render(a, asCoach) {
    const { esc } = window.JMUI, f = n => String(n).replace('.', ',');
    const LT = { green: ['🟢', 'Semana sólida'], amber: ['🟡', 'Semana con algo que vigilar'], red: ['🔴', 'Semana para frenar y recuperar'] }[a.light];
    const ST = { mejora: ['up', '▲ Mejora'], baja: ['down', '▼ Baja'], igual: ['eq', '= Igual'], estancado: ['stall', '⏸ Estancado'], nuevo: ['eq', 'Nuevo'] };
    const good = a.perf.filter(p => p.status === 'mejora'), watch = a.perf.filter(p => p.status === 'baja' || p.status === 'estancado');
    const fz = { green: 'Baja', amber: 'Moderada', red: 'Alta' }[a.fatigue.zone];
    return `<div class="an an-${a.light}">
      <div class="an-head"><span class="an-light">${LT[0]}</span><div><b>${LT[1]}</b><small>${esc(a.week.start.split('-').reverse().slice(0, 2).join('/'))} – ${esc(a.week.end.split('-').reverse().slice(0, 2).join('/'))}</small></div></div>
      <div class="an-kpis">
        <div><small>Cumplimiento</small><b>${a.adh.pct != null ? a.adh.pct + ' %' : a.adh.sessions + ' entrenos'}</b>${asCoach ? `<i>${a.adh.sets}${a.adh.setsPlanned ? '/' + a.adh.setsPlanned : ''} series</i>` : ''}</div>
        <div class="fz-${a.fatigue.zone}"><small>Fatiga</small><b>${fz}</b>${asCoach ? `<i>${a.fatigue.score}/100</i>` : ''}<span class="an-bar"><em style="width:${a.fatigue.score}%"></em></span></div>
        <div><small>Esfuerzo (RIR)</small><b>${a.effort.real != null ? f(a.effort.real) : '–'}</b>${a.effort.plan != null ? `<i>pautado ${f(a.effort.plan)}</i>` : ''}</div>
        ${a.weight.rate != null ? `<div><small>Peso</small><b>${a.weight.rate > 0 ? '+' : ''}${f(a.weight.rate)} kg/sem</b>${a.weight.target != null ? `<i>objetivo ${a.weight.target > 0 ? '+' : ''}${f(a.weight.target)}</i>` : ''}</div>` : ''}
      </div>
      ${asCoach ? `<table class="an-t"><thead><tr><th>Ejercicio</th><th>1RM est.</th><th>vs 4 sem</th><th></th></tr></thead><tbody>${a.perf.map(p => `<tr><td>${esc(p.ex)}</td><td>${f(p.now)} kg</td><td>${p.delta != null ? (p.delta > 0 ? '+' : '') + f(p.delta) + ' %' : '–'}</td><td><span class="an-st ${ST[p.status][0]}">${ST[p.status][1]}</span></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin series con kg y reps esta semana</td></tr>'}</tbody></table>`
        : `${good.length ? `<p class="an-good">💪 <b>Lo que ha ido bien:</b> has superado tus marcas en ${esc(good.map(p => p.ex).slice(0, 3).join(', '))}.</p>` : ''}
           ${watch.length ? `<p class="an-watch">👀 <b>A vigilar:</b> ${esc(watch.map(p => p.ex).slice(0, 3).join(', '))}.</p>` : ''}`}
      ${a.fatigue.signals.length ? `<p class="small muted">Señales de fatiga: ${esc(a.fatigue.signals.join(' · '))}${asCoach && a.fatigue.acwr != null ? ` · ratio agudo:crónico ${f(a.fatigue.acwr)}` : ''}</p>` : ''}
      <h4>${asCoach ? 'Propuestas' : 'Lo que propone tu entrenador revisar'}</h4>
      <ol class="an-dec">${a.decisions.map(d => `<li><b>${esc(d.t)}</b><small>${esc(d.why)}</small>${asCoach && d.action ? `<a class="btn small" data-an-go="${d.action}">${d.action === 'rutinas' ? 'Ir a Rutinas' : 'Ir a Nutrición'}</a>` : ''}</li>`).join('')}</ol>
      ${asCoach ? '' : '<p class="muted small">Los cambios de rutina o dieta los confirma tu entrenador al revisar tu check-in.</p>'}
    </div>`;
  }
  window.JMAnalysis = { run, render, RULES_V };
})();
