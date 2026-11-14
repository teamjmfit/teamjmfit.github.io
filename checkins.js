// TEAM JMFIT · Frecuencia del check-in (migración 029)
// Cada cliente tiene periodos de 7 o 14 días que empiezan en lunes (ck_anchor). El día clave es el viernes de la
// última semana del periodo (ck_day). Desde ese día, si el periodo no tiene check-in ni descarte del entrenador,
// queda pendiente. Un check-in enviado tarde cubre todos los pendientes de una vez.
(function () {
  'use strict';
  const D = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const add = (s, n) => { const x = D(s); x.setDate(x.getDate() + n); return ymd(x); };
  const monday = s => { const x = D(s); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return ymd(x); };
  const diff = (a, b) => Math.round((D(a) - D(b)) / 864e5);
  const todayStr = () => ymd(new Date());
  const MAX_BACK = 12;   // como mucho se cuentan 12 periodos hacia atrás

  const freqOf = c => (c && c.ck_freq) || 'semanal';
  const lenOf = c => (freqOf(c) === 'quincenal' ? 14 : 7);
  const off = c => freqOf(c) === 'ninguno';
  const anchorOf = (c, t) => monday((c && c.ck_anchor) || t);
  const keyOffset = c => { const d = Number(c && c.ck_day) || 5; return Math.min(6, Math.max(0, d - 1)); };

  // Periodo k (0 = el que empieza en el ancla)
  function period(c, k, anchor) {
    const L = lenOf(c), start = add(anchor, k * L), end = add(start, L - 1);
    return { k, start, end, key: add(start, L - 7 + keyOffset(c)) };
  }
  function periodAt(c, date, anchor) { const k = Math.floor(diff(monday(date), anchor) / lenOf(c)); return period(c, k, anchor); }

  // Qué rango cubre un check-in (los antiguos, sin period_start, cubren el periodo de su fecha) o un descarte
  const rangeOf = (c, x, anchor) => (x.period_start ? [x.period_start, x.period_end || x.period_start] : (() => { const p = periodAt(c, x.date, anchor); return [p.start, p.end]; })());
  const overlaps = (r, p) => r[0] <= p.end && r[1] >= p.start;

  function status(c, checkins, skips, t) {
    t = t || todayStr();
    if (off(c)) return { off: true, pending: [], state: null };
    const anchor = anchorOf(c, t), cur = periodAt(c, t, anchor);
    const cov = (checkins || []).map(x => rangeOf(c, x, anchor)).concat((skips || []).map(x => [x.period_start, x.period_end]));
    const pending = [];
    for (let k = Math.max(0, cur.k - MAX_BACK); k <= cur.k; k++) {
      const p = period(c, k, anchor);
      if (p.key <= t && !cov.some(r => overlaps(r, p))) pending.push(p);
    }
    const last = pending[pending.length - 1];
    const state = !pending.length ? null : (pending.length === 1 && last.k === cur.k) ? 'toca' : 'atrasado';
    return { off: false, freq: freqOf(c), cur, pending, state, late: pending.length ? Math.max(0, diff(t, pending[0].end)) : 0, isKeyDay: cur.key === t };
  }

  // Rango que se guarda con un check-in nuevo: todos los pendientes, o el periodo de su fecha si no hay ninguno
  function cover(c, checkins, skips, date) {
    const st = status(c, checkins, skips, todayStr());
    if (st.off) return {};
    if (st.pending.length) return { period_start: st.pending[0].start, period_end: st.pending[st.pending.length - 1].end };
    const p = periodAt(c, date, anchorOf(c, todayStr()));
    return { period_start: p.start, period_end: p.end };
  }

  const FREQ = [['semanal', 'Semanalmente'], ['quincenal', 'Cada 15 días'], ['ninguno', 'Sin check-in']];
  window.JMCk = { status, cover, period, periodAt, monday, off, freqOf, anchorOf, FREQ };
})();
