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
    const hasPrio = Array.isArray(o.prio) && o.prio.length > 0, isPrio = hasPrio && o.prio.includes(it.id);
    const cap = typeof o.rep_cap === 'number' ? Math.max(0, Math.round(o.rep_cap)) : null;
    const acc = kk => {
      const ks = kk + off, r = ruleFor(it, o), v = { sets: s.sets, target_rir: s.target_rir, load_kg: s.load_kg, reps_min: s.reps_min, reps_max: s.reps_max, reps: s.reps };
      if (r.t === 'load') v.load_kg = roundLoad(s.load_kg + ks * r.kg);
      else if (r.t === 'reps') {
        let step = ks * r.r;
        // tope de repeticiones: pasado el tope se mantiene el rango y sube la carga (si la tiene)
        if (cap != null && step > cap) { const extra = step - cap; step = cap; if (s.load_kg != null) v.load_kg = roundLoad(s.load_kg + Math.ceil(extra / Math.max(r.r, 1)) * r.kg); }
        v.reps_min = s.reps_min + step; v.reps_max = (s.reps_max ?? s.reps_min) + step; v.reps = repsText(v.reps_min, v.reps_max);
      }
      else if (r.t === 'sets') v.sets = s.sets + Math.min(2, Math.floor(ks / 2));
      const ramp = (hi, lo) => (A > 1 ? hi - Math.round(kk * (hi - lo) / (A - 1)) : lo);
      if (isPrio) v.target_rir = ramp(num(o.prio_rir_hi) ?? 1, num(o.prio_rir_lo) ?? 0);
      else if (o.rir_mode === 'range') v.target_rir = ramp(num(o.rir_hi) ?? 2, num(o.rir_lo) ?? 1);
      else if (o.rir_mode === 'keep') v.target_rir = s.target_rir;
      else if (o.rir_ramp && s.target_rir != null && A > 1) {
        const floor = s.target_rir >= 1 ? 1 : 0;
        v.target_rir = Math.max(floor, s.target_rir - Math.round(kk * (s.target_rir - floor) / (A - 1)));
      }
      // volumen: más series en los prioritarios y, si se quiere, menos en el resto
      if (isPrio) v.sets = Math.max(1, v.sets + (num(o.prio_sets) ?? 1));
      else if (hasPrio) v.sets = Math.max(1, v.sets + (num(o.other_sets) ?? 0));
      return v;
    };
    // Ajuste manual de cada semana: RIR fijo y/o series de más o de menos (opts.weeks[k] = { rir, sets })
    const ov = (o.weeks || [])[k] || {}, fix = v => {
      if (ov.rir != null && ov.rir !== '') v.target_rir = Math.max(0, Math.min(10, +ov.rir));
      if (+ov.sets) v.sets = Math.max(1, v.sets + Math.round(+ov.sets));
      return v;
    };
    if (k < A) return fix(Object.assign(acc(k), { kind: 'normal', base: null }));
    const p = acc(A - 1);   // la descarga parte de la última semana de carga
    return fix(Object.assign({}, p, {
      kind: 'deload',
      sets: Math.max(1, Math.round(p.sets * (1 - o.deload_vol))),
      load_kg: p.load_kg == null ? null : roundLoad(p.load_kg * (1 - o.deload_int)),
      // descarga a RIR 2 (si ya era más alto, se mantiene); con prioridades, el RIR de descarga de cada grupo
      target_rir: isPrio && o.prio_dl_rir != null ? +o.prio_dl_rir : !isPrio && o.dl_rir != null ? +o.dl_rir : Math.max(p.target_rir ?? 2, 2),
      base: { sets: p.sets, target_rir: p.target_rir, load_kg: p.load_kg }
    }));
  }

  // Volumen relativo de cada semana (series × carga o series) para la mini gráfica del bloque
  function weekLoads(items, n, opts) {
    return Array.from({ length: n }, (_, k) => items.reduce((a, it) => { const v = project(it, k, n, opts); return a + v.sets * (v.load_kg || 1) * ((v.reps_max || v.reps_min || 8)); }, 0));
  }

  window.JMMeso = { DEF, project, ruleFor, weekLoads, roundLoad };
})();
