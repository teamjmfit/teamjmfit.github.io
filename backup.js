// TEAM JMFIT · copia de seguridad: descarga un Excel con todos los datos de la app (una hoja por tabla).
(function () {
  const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mini.min.js';
  const XLSX_SRI = 'sha384-6fBkVFQw1YKyYpZpKf7bguegzeJqso45fTePEWGNuVaGy70fxEhICA/yswrPjW4+';
  const TABLES = [
    ['clients', 'Clientes'], ['checkins', 'Check-ins'], ['checkin_photos', 'Fotos check-in'], ['daily_metrics', 'Peso diario'],
    ['nutrition_plans', 'Nutrición'], ['meal_plans', 'Planes'], ['meal_blocks', 'Comidas'], ['meal_options', 'Opciones'], ['option_items', 'Alimentos del plan'],
    ['foods', 'Base de alimentos'], ['programs', 'Programas'], ['program_weeks', 'Semanas'], ['routines', 'Rutinas'], ['routine_items', 'Ejercicios rutina'],
    ['sessions', 'Entrenos'], ['set_logs', 'Series'], ['messages', 'Mensajes'], ['exercises', 'Ejercicios']
  ];
  const SECRET = /token|secret|password|key/i;
  const KEY = 'last_backup';

  let lib = null;
  const loadLib = () => lib || (lib = new Promise((res, rej) => {
    if (window.XLSX) return res(window.XLSX);
    const s = document.createElement('script');
    s.src = XLSX_URL; s.integrity = XLSX_SRI; s.crossOrigin = 'anonymous';
    s.onload = () => res(window.XLSX); s.onerror = () => { lib = null; rej(new Error('No se pudo cargar el generador de Excel (¿sin conexión?)')); };
    document.head.appendChild(s);
  }));

  // Todas las filas de una tabla (en bloques de 1000, el máximo de Supabase por petición)
  async function allRows(t) {
    if (DB.mode !== 'live') return DB.list(t, {});
    const out = [];
    for (let from = 0; from < 200000; from += 1000) {
      const { data, error } = await DB.sb.from(t).select('*').range(from, from + 999);
      if (error) { if (/does not exist|schema cache/i.test(error.message)) return null; throw new Error(t + ': ' + error.message); }
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }
  const cell = v => {
    if (v == null) return '';
    if (typeof v === 'object') v = JSON.stringify(v);
    if (typeof v === 'string' && v.startsWith('data:')) return '(foto guardada en la app)';
    return typeof v === 'string' && v.length > 32000 ? v.slice(0, 32000) + '…' : v;
  };

  async function run(btn) {
    const { toast } = window.JMUI;
    if (btn) { btn.disabled = true; btn.dataset.txt = btn.innerHTML; btn.textContent = 'Preparando copia…'; }
    try {
      const X = await loadLib();
      const wb = X.utils.book_new(), resumen = [];
      const stamp = new Date();
      for (const [t, name] of TABLES) {
        const rows = await allRows(t);
        if (rows == null) continue;
        const clean = rows.map(r => { const o = {}; for (const k in r) o[k] = cell(r[k]); return o; });
        const ws = clean.length ? X.utils.json_to_sheet(clean) : X.utils.aoa_to_sheet([['(sin datos)']]);
        X.utils.book_append_sheet(wb, ws, name.slice(0, 31));
        resumen.push([name, t, rows.length]);
      }
      const settings = (await allRows('settings')) || [];
      const ss = X.utils.aoa_to_sheet([['Ajuste', 'Valor'], ...settings.filter(s => !SECRET.test(s.key)).map(s => [s.key, cell(s.value)])]);
      X.utils.book_append_sheet(wb, ss, 'Ajustes');
      const info = X.utils.aoa_to_sheet([['Copia de seguridad TEAM JMFIT'], ['Fecha', stamp.toLocaleString('es-ES')], [], ['Hoja', 'Tabla', 'Filas'], ...resumen,
        [], ['Las fotos no van dentro del Excel: siguen guardadas en la app (columna «path»).']]);
      wb.SheetNames.unshift('Resumen'); wb.Sheets.Resumen = info;
      const fname = `JMFIT-copia-${stamp.toISOString().slice(0, 10)}.xlsx`;
      X.writeFile(wb, fname, { compression: true });
      try { await DB.setSetting(KEY, stamp.toISOString()); } catch (e) { /* no es grave */ }
      toast(`Copia descargada: ${fname}`, 'ok');
      const r = document.querySelector('[data-backup-remind]'); if (r) r.remove();
    } catch (e) { console.error(e); toast('Error en la copia: ' + e.message, 'err'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.txt; } }
  }

  // Aviso en Inicio si hace más de 7 días de la última copia
  async function remind(host) {
    try {
      const last = await DB.getSetting(KEY);
      const days = last ? Math.floor((Date.now() - new Date(last)) / 864e5) : null;
      if (days != null && days < 7) return;
      const el = document.createElement('section'); el.className = 'card backup-remind'; el.dataset.backupRemind = '';
      el.innerHTML = `<h3>Copia de seguridad</h3><p class="small">${days == null ? 'Aún no has descargado ninguna copia.' : `Tu última copia es de hace ${days} días.`} Descarga un Excel con todos los datos (clientes, check-ins, planes, entrenos…) y guárdalo en tu Drive.</p><button class="btn small primary" type="button">Descargar copia</button>`;
      el.querySelector('button').onclick = e => run(e.currentTarget);
      host.prepend(el);
    } catch (e) { /* opcional */ }
  }

  window.JMBackup = { run, remind };
})();
