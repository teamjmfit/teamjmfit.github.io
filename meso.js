/* TEAM JMFIT · Mesociclos cerrados (4 o 6 semanas): proyección de la sobrecarga progresiva
   y semana de descarga final. La misma lógica está en SQL (create_mesocycle, migración 012);
   este archivo sirve para la vista previa y para el modo demo. */
(function () {
  'use strict';
  const DEF = { offset: 0, prog: 'auto', inc_kg: 2.5, inc_reps: 1, rir_ramp: true, deload_vol: 0.4, deload_int: 0.1, publish: true };
  const roundLoad = (x, step = 0.25) => (x == null ? null : Math.round(x / step) * step);
  const repsText = (a, b) => (a === b ? String(a) : a + '-' + b);
  const num = v => (v === '' || v == null || isNaN(+v) ? null : +v);

  // Regla de cada ejercicio: la suya si la tiene; si no, la elegida para el bloque
  function ruleFor(it, o) {
    it = withReps(it);
    const p = it.progression || {};
    if (p.type === 'load' || p.type === 'double') return { t: num(it.load_kg) != null ? 'load' : 'reps', kg: +(p.inc_kg || o.inc_kg), r: +o.inc_reps };
    if (p.type === 'reps') return { t: 'reps', kg: +o.inc_kg, r: +(p.inc || o.inc_reps) };
    let t = o.prog;
    if (t === 'auto') t = num(it.load_kg) != null ? 'load' : (it.reps_min != null ? 'reps' : 'sets');
    if (t === 'load' && num(it.load_kg) == null) t = it.reps_min != null ? 'reps' : 'none';
    if (t === 'reps' && it.reps_min == null) t = 'none';
    return { t, kg: +o.inc_kg, r: +o.inc_reps };
  }

  const withReps = it => {
    if (it.reps_min != null || !/^\s*\d/.test(it.reps || '')) return it;
    const m = String(it.reps).match(/^\s*(\d+)(?:\s*[-–]\s*(\d+))?/); return Object.assign({}, it, { reps_min: +m[1], reps_max: +(m[2] || m[1]) });
  };
  // Valores fijos de partida de un ejercicio (si viene de una descarga/intensidad, su base)
  function start(it) {
    const b = it.base || {};
    // como el trigger de la base de datos: «8-10» → 8 y 10
    if (it.reps_min == null && /^\s*\d/.test(it.reps || '')) { const m = String(it.reps).match(/^\s*(\d+)(?:\s*[-–]\s*(\d+))?/); it = Object.assign({}, it, { reps_min: +m[1], reps_max: +(m[2] || m[1]) }); }
    return { sets: num(b.sets) ?? num(it.sets) ?? 3, target_rir: b.target_rir !== undefined ? num(b.target_rir) : num(it.target_rir), load_kg: b.load_kg !== undefined ? num(b.load_kg) : num(it.load_kg), reps_min: it.reps_min ?? null, reps_max: it.reps_max ?? null, reps: it.reps };
  }

  // Semana k (0 = la primera) de un bloque de n semanas: acumulación 0…n-2, descarga n-1
  function project(it, k, n, opts) {
    const o = Object.assign({}, DEF, opts || {}), s = start(it), A = n - 1;
    const off = Math.max(0, Math.min(+o.offset || 0, 6));   // pasos por encima del bloque anterior (no toca el RIR)
    const acc = kk => {
      const ks = kk + off, r = ruleFor(it, o), v = { sets: s.sets, target_rir: s.target_rir, load_kg: s.load_kg, reps_min: s.reps_min, reps_max: s.reps_max, reps: s.reps };
      if (r.t === 'load') v.load_kg = roundLoad(s.load_kg + ks * r.kg);
      else if (r.t === 'reps') { v.reps_min = s.reps_min + ks * r.r; v.reps_max = (s.reps_max ?? s.reps_min) + ks * r.r; v.reps = repsText(v.reps_min, v.reps_max); }
      else if (r.t === 'sets') v.sets = s.sets + Math.min(2, Math.floor(ks / 2));
      if (o.rir_ramp && s.target_rir != null && A > 1) {
        const floor = s.target_rir >= 1 ? 1 : 0;
        v.target_rir = Math.max(floor, s.target_rir - Math.round(kk * (s.target_rir - floor) / (A - 1)));
      }
      return v;
    };
    if (k < A) return Object.assign(acc(k), { kind: 'normal', base: null });
    const p = acc(A - 1);   // la descarga parte de la última semana de carga
    return Object.assign({}, p, {
      kind: 'deload',
      sets: Math.max(1, Math.round(p.sets * (1 - o.deload_vol))),
      load_kg: p.load_kg == null ? null : roundLoad(p.load_kg * (1 - o.deload_int)),
      target_rir: Math.min((p.target_rir ?? 2) + 2, 5),
      base: { sets: p.sets, target_rir: p.target_rir, load_kg: p.load_kg }
    });
  }

  // Volumen relativo de cada semana (series × carga o series) para la mini gráfica del bloque
  function weekLoads(items, n, opts) {
    return Array.from({ length: n }, (_, k) => items.reduce((a, it) => { const v = project(it, k, n, opts); return a + v.sets * (v.load_kg || 1) * ((v.reps_max || v.reps_min || 8)); }, 0));
  }

  window.JMMeso = { DEF, project, ruleFor, weekLoads, roundLoad };
})();
