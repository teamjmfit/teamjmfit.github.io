/* TEAM JMFIT · Objetivos S.M.A.R.T.: métricas medibles, validación de realismo, enfoque que guía
   las rutinas, micro-objetivos por bloque (4 o 6 semanas, como los mesociclos) y progreso. */
(function () {
  'use strict';
  const DAY = 864e5;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 1) => (v == null || isNaN(v) ? '–' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ','));
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addD = (k, n) => { const x = new Date(k + 'T12:00:00'); x.setDate(x.getDate() + n); return ymd(x); };
  const days = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DAY);
  const fd = (k, o = { day: 'numeric', month: 'short' }) => new Date(k + 'T12:00:00').toLocaleDateString('es-ES', o);
  const keyOf = n => String(n || '').trim().toLowerCase();

  // Métricas de entrada: de dónde sale el dato y su unidad
  const METRICS = {
    weight: { l: 'Peso corporal', u: 'kg', src: 'báscula (check-in y pesajes)', d: 1 },
    body_fat: { l: '% de grasa', u: '%', src: 'check-in (medidas)', d: 1 },
    waist: { l: 'Perímetro de cintura', u: 'cm', src: 'check-in (medidas)', d: 1 },
    hip: { l: 'Perímetro de cadera', u: 'cm', src: 'check-in (medidas)', d: 1 },
    chest: { l: 'Perímetro de pecho', u: 'cm', src: 'check-in (medidas)', d: 1 },
    arm: { l: 'Perímetro de brazo', u: 'cm', src: 'check-in (medidas)', d: 1 },
    thigh: { l: 'Perímetro de muslo', u: 'cm', src: 'check-in (medidas)', d: 1 },
    e1rm: { l: '1RM estimado de un ejercicio', u: 'kg', src: 'series registradas en los entrenos', d: 1 }
  };
  // El objetivo principal fija el enfoque: etiqueta, pautas de rutina y progresión por defecto del mesociclo
  const FOCUS = {
    fat_loss: { l: 'Pérdida de grasa', tag: 'Definición', train: 'Mantener o subir cargas en los básicos para conservar músculo; 10–15 series por músculo y semana; RIR 1–3.', diet: 'Déficit moderado (300–500 kcal) y proteína alta (1,8–2,2 g/kg).', prog: 'auto' },
    muscle: { l: 'Ganar músculo', tag: 'Hipertrofia', train: 'Rangos de 6–12 reps, 10–20 series por músculo y semana, RIR 0–3, progresar reps y luego carga.', diet: 'Superávit ligero (200–300 kcal) y proteína 1,6–2,2 g/kg.', prog: 'reps' },
    strength: { l: 'Ganar fuerza', tag: 'Fuerza', train: 'Básicos a 3–6 reps con RIR 1–3, descansos de 2–5 min; progresar la carga semana a semana.', diet: 'Normocalórica o ligero superávit; carbohidratos alrededor del entreno.', prog: 'load' },
    recomp: { l: 'Recomposición', tag: 'Recomposición', train: 'Hipertrofia con cargas progresivas (6–12 reps, RIR 1–3).', diet: 'Mantenimiento calórico y proteína alta.', prog: 'auto' },
    health: { l: 'Salud y hábitos', tag: 'Salud', train: 'Volumen moderado, técnica y constancia; RIR 2–4.', diet: 'Hábitos sostenibles y adherencia.', prog: 'auto' }
  };
  const autoFocus = (metric, start, target) => {
    const up = +target > +start;
    if (metric === 'e1rm') return 'strength';
    if (metric === 'weight') return up ? 'muscle' : 'fat_loss';
    if (['body_fat', 'waist', 'hip'].includes(metric)) return up ? 'health' : 'fat_loss';
    return up ? 'muscle' : 'health';
  };
  const title = g => {
    const m = METRICS[g.metric] || { l: '', u: '' }, diff = +g.target_value - +g.start_value, up = diff > 0, u = m.u === '%' ? ' puntos' : ' ' + m.u;
    const what = g.metric === 'weight' ? (up ? 'Ganar' : 'Perder') + ` ${nf(Math.abs(diff))}${u}`
      : g.metric === 'e1rm' ? `${up ? 'Subir' : 'Bajar'} ${nf(Math.abs(diff))} kg el 1RM de ${g.exercise_name || 'un ejercicio'}`
      : `${up ? 'Subir' : 'Bajar'} ${nf(Math.abs(diff))}${u} de ${m.l.toLowerCase().replace('perímetro de ', '')}`;
    return `${what} (de ${nf(+g.start_value)} a ${nf(+g.target_value)} ${m.u}) antes del ${fd(g.deadline, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  };

  // Serie histórica de una métrica: [{date, v}]
  function series(metric, { checkins = [], daily = [], logs = [], sessions = [] }, exercise) {
    if (metric === 'e1rm') {
      const sd = {}; sessions.forEach(s => { sd[s.id] = s.started_at; });
      const by = {};
      logs.filter(l => keyOf(l.exercise_name) === keyOf(exercise) && +l.weight > 0 && +l.reps > 0).forEach(l => {
        const d = String(sd[l.session_id] || l.created_at || '').slice(0, 10); if (!d) return;
        const e = +l.weight * (1 + +l.reps / 30); if (!by[d] || e > by[d]) by[d] = e;
      });
      return Object.entries(by).map(([date, v]) => ({ date, v })).sort((a, b) => a.date.localeCompare(b.date));
    }
    const rows = checkins.filter(k => k[metric] != null && k[metric] !== '').map(k => ({ date: k.date, v: +k[metric] }));
    if (metric === 'weight') daily.filter(d => d.weight).forEach(d => rows.push({ date: d.date, v: +d.weight }));
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }
  // Valor actual: peso = media de los últimos 7 días con datos (quita el ruido diario); 1RM = mejor de las 3 últimas semanas
  function valueAt(metric, ser, date) {
    const s = ser.filter(x => x.date <= date); if (!s.length) return null;
    const last = s[s.length - 1].date;
    if (metric === 'weight') { const w = s.filter(x => x.date > addD(last, -7)); return w.reduce((a, x) => a + x.v, 0) / w.length; }
    if (metric === 'e1rm') return Math.max(...s.filter(x => x.date > addD(last, -21)).map(x => x.v));
    return s[s.length - 1].v;
  }

  // Micro-objetivos: un hito al final de cada bloque de 4 o 6 semanas hasta la fecha límite
  function blocks(g) {
    const total = Math.max(1, days(g.start_date, g.deadline)), bw = (+g.block_weeks || 4) * 7, out = [];
    for (let s = 0, i = 1; s < total; s += bw, i++) {
      const e = Math.min(total, s + bw), f = e / total;
      out.push({ i, from: addD(g.start_date, s), to: addD(g.start_date, e), target: +g.start_value + (+g.target_value - +g.start_value) * f });
    }
    return out;
  }

  function progress(g, data) {
    const ser = series(g.metric, data, g.exercise_name), t = ymd(new Date());
    const cur = valueAt(g.metric, ser, t), span = +g.target_value - +g.start_value;
    const pct = cur == null || !span ? 0 : Math.max(0, Math.min(1, (cur - +g.start_value) / span));
    const total = Math.max(1, days(g.start_date, g.deadline)), el = Math.max(0, Math.min(total, days(g.start_date, t)));
    const exp = el / total;
    const done = g.status === 'done' || pct >= 1;
    const st = done ? ['done', '¡Conseguido! 🏆'] : t > g.deadline ? ['late', 'Plazo cumplido sin llegar'] : pct >= exp + 0.05 ? ['ahead', 'Por delante del plan'] : pct >= exp - 0.1 ? ['ok', 'En camino'] : ['behind', 'Por detrás del plan'];
    const bl = blocks(g).map(b => {
      const v = b.to <= t ? valueAt(g.metric, ser, b.to) : null, need = span > 0 ? v >= b.target - 1e-9 : v <= b.target + 1e-9;
      return Object.assign(b, { now: b.from <= t && t < b.to, past: b.to <= t, value: v, hit: v == null ? null : need });
    });
    const expected = +g.start_value + span * exp;
    return { cur, pct, exp, st, blocks: bl, ser, expected, daysLeft: days(t, g.deadline), lastDate: ser.length ? ser[ser.length - 1].date : null };
  }

  // A de alcanzable: ritmo pedido frente a lo que es fisiológicamente razonable
  function validate(f, ctx = {}) {
    const out = [], m = f.metric, s = +f.start_value, tg = +f.target_value;
    if (!m || !METRICS[m]) return [{ lv: 'bad', t: 'Elige qué vas a medir.' }];
    if (!(s > 0) || !(tg > 0)) return [{ lv: 'bad', t: 'Pon el valor actual y el valor objetivo.' }];
    if (s === tg) return [{ lv: 'bad', t: 'El objetivo tiene que ser distinto del valor actual.' }];
    if (m === 'e1rm' && !f.exercise_name) out.push({ lv: 'bad', t: 'Elige el ejercicio del 1RM.' });
    if (!f.start_date || !f.deadline || f.deadline <= f.start_date) return out.concat({ lv: 'bad', t: 'La fecha límite tiene que ser posterior al inicio.' });
    const wk = days(f.start_date, f.deadline) / 7, mo = wk / 4.345, d = tg - s;
    if (wk < 2) out.push({ lv: 'bad', t: 'Menos de 2 semanas: no da tiempo a medir un cambio real (el ruido diario es mayor).' });
    else if (wk > 52) out.push({ lv: 'warn', t: 'Más de un año: mejor una meta intermedia y luego otra.' });
    const kgw = d / wk, pw = kgw / s * 100;
    if (m === 'weight') {
      if (d < 0) {
        if (pw < -1) out.push({ lv: 'bad', t: `Perder ${nf(-kgw, 2)} kg/semana (${nf(-pw)} % del peso) es extremo: riesgo de perder músculo, rendimiento y adherencia. Lo razonable es 0,5–1 %.` });
        else if (pw < -0.7) out.push({ lv: 'warn', t: `${nf(-kgw, 2)} kg/semana (${nf(-pw)} %): exigente. Solo en plazos cortos y con proteína alta.` });
        else out.push({ lv: 'ok', t: `${nf(-kgw, 2)} kg/semana (${nf(-pw)} % del peso): ritmo sostenible.` });
      } else {
        if (pw > 1) out.push({ lv: 'bad', t: `Ganar ${nf(kgw, 2)} kg/semana (${nf(pw)} %) es demasiado: la mayor parte sería grasa. Lo habitual es 0,25–0,5 %.` });
        else if (pw > 0.5) out.push({ lv: 'warn', t: `${nf(kgw, 2)} kg/semana (${nf(pw)} %): rápido; parte será grasa. Válido en principiantes o tras una dieta.` });
        else out.push({ lv: 'ok', t: `${nf(kgw, 2)} kg/semana (${nf(pw)} % del peso): ganancia magra realista.` });
      }
    } else if (m === 'body_fat') {
      const pm = d / mo;
      if (d > 0) out.push({ lv: 'warn', t: 'El objetivo sube el % de grasa: ¿es lo que buscas?' });
      else if (pm < -1.5) out.push({ lv: 'bad', t: `${nf(-pm)} puntos de grasa al mes es muy agresivo; lo realista es 0,5–1.` });
      else if (pm < -1) out.push({ lv: 'warn', t: `${nf(-pm)} puntos al mes: exigente.` });
      else out.push({ lv: 'ok', t: `${nf(-pm)} puntos de grasa al mes: realista.` });
      out.push({ lv: 'info', t: 'Mídelo siempre con el mismo método y en las mismas condiciones.' });
    } else if (m === 'e1rm') {
      const pm = d / s * 100 / mo;
      if (d < 0) out.push({ lv: 'warn', t: 'El objetivo baja el 1RM: normalmente se busca subirlo.' });
      else if (pm > 10) out.push({ lv: 'bad', t: `+${nf(pm)} % al mes es poco realista salvo en las primeras semanas de entreno. Lo habitual: 1–5 %.` });
      else if (pm > 5) out.push({ lv: 'warn', t: `+${nf(pm)} % al mes: posible en principiantes; en avanzados, difícil.` });
      else out.push({ lv: 'ok', t: `+${nf(pm)} % al mes (${nf(d / mo)} kg): realista.` });
      if (ctx.cur != null && Math.abs(ctx.cur - s) / ctx.cur > 0.1) out.push({ lv: 'warn', t: `El valor de partida se aleja de su 1RM estimado actual (${nf(ctx.cur)} kg).` });
    } else {
      const cw = d / wk;
      if (m === 'waist' || m === 'hip') {
        if (d > 0) out.push({ lv: 'warn', t: 'El objetivo sube el perímetro: ¿es lo que buscas?' });
        else if (cw < -1) out.push({ lv: 'bad', t: `${nf(-cw)} cm/semana es demasiado rápido; lo realista es 0,25–0,75 cm.` });
        else if (cw < -0.75) out.push({ lv: 'warn', t: `${nf(-cw)} cm/semana: exigente.` });
        else out.push({ lv: 'ok', t: `${nf(-cw)} cm/semana: realista.` });
      } else {
        const cm = d / mo;
        if (d > 0 && cm > (m === 'arm' ? 1 : 2)) out.push({ lv: 'warn', t: `+${nf(cm)} cm al mes es mucho para ${METRICS[m].l.toLowerCase()} salvo en principiantes.` });
        else out.push({ lv: 'ok', t: `${d > 0 ? '+' : ''}${nf(cm)} cm al mes: realista.` });
      }
    }
    if (!String(f.why || '').trim()) out.push({ lv: 'warn', t: 'R de relevante: escribe por qué es importante (motiva y ayuda a decidir).' });
    return out;
  }

  // Anillo de progreso (SVG) con el % en el centro y la marca de lo esperado a hoy
  function ring(pct, exp, cls = '', size = 96) {
    const r = 40, c = 2 * Math.PI * r, a = exp * 2 * Math.PI - Math.PI / 2;
    return `<svg class="gl-ring ${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${Math.round(pct * 100)} % conseguido">
      <circle cx="50" cy="50" r="${r}" class="bg"/><circle cx="50" cy="50" r="${r}" class="fg" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>
      ${exp > 0 && exp < 1 ? `<circle cx="${(50 + r * Math.cos(a)).toFixed(1)}" cy="${(50 + r * Math.sin(a)).toFixed(1)}" r="4" class="exp"><title>Lo esperado a hoy: ${Math.round(exp * 100)} %</title></circle>` : ''}
      <text x="50" y="55" text-anchor="middle" class="pc">${Math.round(pct * 100)}%</text></svg>`;
  }
  // Escalada: hitos de 25 en 25 % como medallas
  const badges = pct => [[0.25, 'Arranque'], [0.5, 'Mitad'], [0.75, 'Recta final'], [1, 'Meta']].map(([p, l]) => `<span class="gl-badge ${pct >= p ? 'on' : ''}" title="${Math.round(p * 100)} %">${pct >= p ? '★' : '☆'} ${l}</span>`).join('');

  window.JMGoals = { METRICS, FOCUS, autoFocus, title, series, valueAt, blocks, progress, validate, ring, badges, nf, fd, addD, days };
})();
