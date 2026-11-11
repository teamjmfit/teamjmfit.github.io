/* TEAM JMFIT · capa de datos.
   Dos modos con la misma interfaz:
   - live: Supabase (cuentas reales, datos en la nube, cada cliente ve solo lo suyo)
   - demo: localStorage (para probar la app sin configurar nada) */
(function () {
  const cfg = window.JMFIT_CONFIG || {};
  const LIVE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    }));

  // ---------------------------------------------------------------- LIVE
  function liveBackend() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    const applyFilters = (q, opts = {}) => {
      Object.entries(opts.eq || {}).forEach(([k, v]) => { q = v === null ? q.is(k, null) : q.eq(k, v); });
      Object.entries(opts.in || {}).forEach(([k, v]) => { q = q.in(k, v); });
      Object.entries(opts.gte || {}).forEach(([k, v]) => { q = q.gte(k, v); });
      if (opts.order) q = q.order(opts.order[0], { ascending: opts.order[1] !== 'desc' });
      if (opts.limit) q = q.limit(opts.limit);
      return q;
    };
    return {
      mode: 'live',
      async session() { const { data } = await sb.auth.getSession(); return data.session; },
      onAuth(fn) { sb.auth.onAuthStateChange((_e, s) => fn(s)); },
      async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
      async signUp(email, password, name) {
        const d = ok(await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin + location.pathname } }));
        return { needsConfirm: !d.session };
      },
      async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
      async updatePassword(password) { ok(await sb.auth.updateUser({ password })); },
      async signOut() { await sb.auth.signOut(); },
      async profile() {
        const s = await this.session(); if (!s) return null;
        const rows = ok(await sb.from('profiles').select('*').eq('id', s.user.id));
        return rows[0] || { id: s.user.id, email: s.user.email, role: 'client' };
      },
      async myClient() {
        const s = await this.session(); if (!s) return null;
        const rows = ok(await sb.from('clients').select('*').eq('user_id', s.user.id));
        return rows[0] || null;
      },
      async list(t, opts) { return ok(await applyFilters(sb.from(t).select('*'), opts)); },
      async get(t, id, key = 'id') { const r = ok(await sb.from(t).select('*').eq(key, id)); return r[0] || null; },
      async insert(t, rows) { return ok(await sb.from(t).insert(rows).select()); },
      async update(t, id, patch, key = 'id') { return ok(await sb.from(t).update(patch).eq(key, id).select()); },
      async upsert(t, row, key = 'id') { return ok(await sb.from(t).upsert(row, { onConflict: key }).select()); },
      async remove(t, id, key = 'id') { ok(await sb.from(t).delete().eq(key, id)); },
      async rpc(fn, args) { return ok(await sb.rpc(fn, args)); },
      async uploadPhoto(clientId, blob) {
        const path = `${clientId}/${Date.now()}.jpg`;
        ok(await sb.storage.from('checkins').upload(path, blob, { contentType: 'image/jpeg' }));
        return path;
      },
      async photoUrl(path) {
        const d = ok(await sb.storage.from('checkins').createSignedUrl(path, 3600));
        return d.signedUrl;
      },
      async getSetting(key) { const r = await this.get('settings', key, 'key'); return r ? r.value : ''; },
      async setSetting(key, value) { await this.upsert('settings', { key, value }, 'key'); }
    };
  }

  // ---------------------------------------------------------------- DEMO
  function demoBackend() {
    const KEY = 'jmfit-demo-v1';
    let store;
    const save = () => localStorage.setItem(KEY, JSON.stringify(store));
    const load = () => {
      try { store = JSON.parse(localStorage.getItem(KEY)); } catch (e) { store = null; }
      if (!store || !store.tables) { store = { tables: {}, who: null }; seed(); save(); }
    };
    const T = n => (store.tables[n] = store.tables[n] || []);
    const keyOf = (t) => ({ settings: 'key', nutrition_plans: 'client_id' }[t] || 'id');
    const now = () => new Date().toISOString();
    const listeners = [];

    function seed() {
      const ex = window.JMFIT_EXERCISES.map(([name, muscle, equipment]) => ({ id: uuid(), name, muscle, equipment, media_url: '', notes: '' }));
      store.tables.exercises = ex;
      const find = n => ex.find(e => e.name === n);
      const c1 = { id: uuid(), user_id: 'demo-client', name: 'Laura Martín', email: 'laura@ejemplo.com', phone: '34600000000', goal: 'Ganar fuerza y masa muscular', service: 'Mixto', sheet_name: 'Laura Martín', notes: 'Rodilla derecha sensible en sentadilla profunda', active: true, created_at: now() };
      const c2 = { id: uuid(), user_id: null, name: 'Carlos Ruiz', email: 'carlos@ejemplo.com', phone: '', goal: 'Perder grasa', service: 'Entreno', sheet_name: '', notes: '', active: true, created_at: now() };
      store.tables.clients = [c1, c2];
      const mkRoutine = (client, name, day, items) => {
        const r = { id: uuid(), client_id: client.id, name, day, position: day || 0, notes: '', created_at: now() };
        T('routines').push(r);
        items.forEach(([n, sets, reps, rest, load], i) => {
          const e = find(n);
          T('routine_items').push({ id: uuid(), routine_id: r.id, client_id: client.id, exercise_id: e && e.id, exercise_name: n, media_url: '', position: i, sets, reps, load: load || '', rest_sec: rest, notes: '' });
        });
        return r;
      };
      const r1 = mkRoutine(c1, 'Pierna y glúteo', 1, [['Sentadilla trasera', 4, '6-8', 150, 'RIR 2'], ['Hip thrust', 4, '8-10', 120], ['Peso muerto rumano', 3, '10', 120], ['Abducción de cadera', 3, '15', 60]]);
      mkRoutine(c1, 'Torso', 3, [['Press de banca', 4, '6-8', 150], ['Jalón al pecho', 4, '10', 90], ['Press de hombro con mancuernas', 3, '10', 90], ['Remo en polea baja', 3, '12', 90], ['Elevaciones laterales', 3, '15', 60]]);
      mkRoutine(c1, 'Full body', 4, [['Sentadilla goblet', 3, '12', 90], ['Remo con mancuerna', 3, '10', 90], ['Flexiones', 3, 'al fallo', 60], ['Plancha', 3, '40 s', 45]]);
      mkRoutine(c2, 'Full body A', 1, [['Prensa de piernas', 3, '12', 90], ['Press de banca', 3, '10', 90], ['Remo con barra', 3, '10', 90]]);
      store.tables.nutrition_plans = [{ client_id: c1.id, kcal: 2400, protein: 140, carbs: 290, fat: 75, water: '2,5–3 L', meals: 'Desayuno: avena 80 g + leche + plátano + 2 huevos\nComida: arroz 100 g (crudo) + pollo 180 g + verduras + AOVE\nMerienda: yogur proteico + fruta + 30 g frutos secos\nCena: patata 250 g + pescado blanco 200 g + ensalada', notes: 'Prioriza llegar a la proteína. Fin de semana: 1 comida libre.', updated_at: now() }];
      // historial de ejemplo
      for (let w = 3; w >= 1; w--) {
        const d = new Date(Date.now() - w * 7 * 864e5);
        const s = { id: uuid(), client_id: c1.id, routine_id: r1.id, routine_name: 'Pierna y glúteo', started_at: d.toISOString(), finished_at: new Date(d.getTime() + 70 * 6e4).toISOString(), rpe: 8, notes: '', volume: 0, coach_seen: w > 1 };
        T('sessions').push(s);
        const base = 60 + (3 - w) * 2.5;
        let vol = 0;
        [['Sentadilla trasera', base, 8], ['Hip thrust', base + 20, 10], ['Peso muerto rumano', base - 10, 10]].forEach(([n, kg, reps]) => {
          for (let i = 1; i <= 3; i++) { T('set_logs').push({ id: uuid(), session_id: s.id, client_id: c1.id, exercise_name: n, set_no: i, weight: kg, reps, created_at: s.started_at }); vol += kg * reps; }
        });
        s.volume = vol;
        T('checkins').push({ id: uuid(), client_id: c1.id, date: d.toISOString().slice(0, 10), weight: 58 + (3 - w) * 0.4, waist: 68, hip: 96, chest: 88, arm: 27, thigh: 55, energy: 4, sleep: 3 + (w % 2), adherence: 4, notes: w === 1 ? 'Muy bien la semana, algo cansada el jueves' : '', photo_path: '', coach_reply: w > 1 ? '¡Genial, sigue así!' : '', coach_seen: w > 1, created_at: d.toISOString() });
      }
      store.tables.messages = [
        { id: uuid(), client_id: c1.id, author: 'coach', body: '¡Bienvenida a TEAM JMFIT! Aquí tienes tu plan. Cualquier duda me escribes por aquí 💪', created_at: new Date(Date.now() - 20 * 864e5).toISOString() },
        { id: uuid(), client_id: c1.id, author: 'client', body: '¡Gracias! ¿El hip thrust lo hago con banda?', created_at: new Date(Date.now() - 2 * 864e5).toISOString() }
      ];
      store.tables.settings = [];
    }

    function matches(row, opts = {}) {
      for (const [k, v] of Object.entries(opts.eq || {})) if ((row[k] ?? null) !== v) return false;
      for (const [k, v] of Object.entries(opts.in || {})) if (!v.includes(row[k])) return false;
      for (const [k, v] of Object.entries(opts.gte || {})) if (!(row[k] >= v)) return false;
      return true;
    }
    const clone = o => JSON.parse(JSON.stringify(o));
    const defaults = {
      clients: () => ({ active: true, created_at: now() }),
      routines: () => ({ position: 0, created_at: now() }),
      sessions: () => ({ started_at: now(), coach_seen: false, volume: 0 }),
      set_logs: () => ({ created_at: now() }),
      checkins: () => ({ date: now().slice(0, 10), coach_seen: false, created_at: now() }),
      messages: () => ({ created_at: now() }),
      exercises: () => ({ created_at: now() })
    };

    load();
    return {
      mode: 'demo',
      async session() { return store.who ? { user: { id: store.who === 'coach' ? 'demo-coach' : 'demo-client' } } : null; },
      onAuth(fn) { listeners.push(fn); },
      async signIn(role) { store.who = role; save(); listeners.forEach(f => f({})); },
      async signUp() { throw new Error('En modo demo no se crean cuentas.'); },
      async resetPassword() { throw new Error('No disponible en modo demo.'); },
      async updatePassword() {},
      async signOut() { store.who = null; save(); listeners.forEach(f => f(null)); },
      async profile() {
        if (!store.who) return null;
        return store.who === 'coach'
          ? { id: 'demo-coach', email: 'entrenador@demo', name: 'Entrenador', role: 'coach' }
          : { id: 'demo-client', email: 'laura@ejemplo.com', name: 'Laura', role: 'client' };
      },
      async myClient() { return clone(T('clients').find(c => c.user_id === 'demo-client') || null); },
      async list(t, opts = {}) {
        let rows = T(t).filter(r => matches(r, opts));
        if (opts.order) {
          const [col, dir] = opts.order;
          rows = rows.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
        }
        if (opts.limit) rows = rows.slice(0, opts.limit);
        return clone(rows);
      },
      async get(t, id, key) { key = key || keyOf(t); return clone(T(t).find(r => r[key] === id) || null); },
      async insert(t, rows) {
        const arr = (Array.isArray(rows) ? rows : [rows]).map(r => {
          const row = Object.assign({}, (defaults[t] || (() => ({})))(), r);
          if (keyOf(t) === 'id' && !row.id) row.id = uuid();
          return row;
        });
        T(t).push(...arr); save(); return clone(arr);
      },
      async update(t, id, patch, key) {
        key = key || keyOf(t);
        const out = [];
        T(t).forEach(r => { if (r[key] === id) { Object.assign(r, patch); out.push(r); } });
        save(); return clone(out);
      },
      async upsert(t, row, key) {
        key = key || keyOf(t);
        const ex = T(t).find(r => r[key] === row[key]);
        if (ex) Object.assign(ex, row); else T(t).push(Object.assign({}, row));
        save(); return [clone(ex || row)];
      },
      async remove(t, id, key) {
        key = key || keyOf(t);
        store.tables[t] = T(t).filter(r => r[key] !== id);
        // borrado en cascada sencillo
        if (t === 'routines') store.tables.routine_items = T('routine_items').filter(r => r.routine_id !== id);
        if (t === 'program_weeks') {
          const rids = new Set(T('routines').filter(r => r.program_week_id === id).map(r => r.id));
          store.tables.routines = T('routines').filter(r => !rids.has(r.id));
          store.tables.routine_items = T('routine_items').filter(i => !rids.has(i.routine_id));
        }
        if (t === 'sessions') store.tables.set_logs = T('set_logs').filter(r => r.session_id !== id);
        if (t === 'clients') ['routines', 'routine_items', 'sessions', 'set_logs', 'checkins', 'messages', 'nutrition_plans']
          .forEach(n => { store.tables[n] = T(n).filter(r => r.client_id !== id); });
        save();
      },
      async uploadPhoto(_clientId, blob) {
        return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      },
      async photoUrl(path) { return path; },
      async getSetting(key) { const r = T('settings').find(s => s.key === key); return r ? r.value : ''; },
      async setSetting(key, value) { await this.upsert('settings', { key, value }, 'key'); },
      // Versiones locales de las funciones de la migración 002 (mismas reglas que en Supabase)
      async rpc(fn, a = {}) {
        const monday = v => { const d = new Date(v + 'T12:00:00'); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.toISOString().slice(0, 10); };
        const plus = (v, n) => { const d = new Date(v + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
        const roundLoad = x => (x == null ? null : Math.round(x / 0.25) * 0.25);
        const copyWeek = (routines, weekId, fx) => {
          for (const r of routines) {
            const nr = Object.assign({}, r, { id: uuid(), program_week_id: weekId, created_at: now() });
            T('routines').push(nr);
            T('routine_items').filter(i => i.routine_id === r.id).sort((x, y) => x.position - y.position).forEach(i => {
              if (!i.lineage_id) i.lineage_id = uuid();
              T('routine_items').push(Object.assign({}, i, { id: uuid(), routine_id: nr.id }, fx ? fx(i) : {}));
            });
          }
        };
        if (fn === 'create_program_from_routines') {
          const start = monday(a.p_start);
          const prog = { id: uuid(), client_id: a.p_client, name: a.p_name, start_date: start, status: 'active', auto_repeat: true, created_at: now() };
          const w1 = { id: uuid(), program_id: prog.id, client_id: a.p_client, week_no: 1, start_date: start, kind: 'normal', source_week_id: null, published: false, created_at: now() };
          T('programs').push(prog); T('program_weeks').push(w1);
          copyWeek(T('routines').filter(r => r.client_id === a.p_client && !r.program_week_id).sort((x, y) => x.position - y.position), w1.id);
          save(); return prog.id;
        }
        if (fn === 'clone_program_week' || fn === '_clone_week') {
          const mode = a.p_mode || 'progress', vol = a.p_deload_volume || 0.6;
          const src = T('program_weeks').find(w => w.id === a.p_week_id);
          if (!src) throw new Error('Semana no encontrada');
          const weeks = T('program_weeks').filter(w => w.program_id === src.program_id);
          let base = src;
          if (src.kind === 'deload' && mode !== 'deload') base = weeks.filter(w => w.week_no < src.week_no && w.kind === 'normal').sort((x, y) => y.week_no - x.week_no)[0] || src;
          const nw = { id: uuid(), program_id: src.program_id, client_id: src.client_id, week_no: Math.max(...weeks.map(w => w.week_no)) + 1, start_date: plus(weeks.map(w => w.start_date).sort().pop(), 7), kind: mode === 'deload' ? 'deload' : 'normal', source_week_id: src.id, published: false, created_at: now() };
          T('program_weeks').push(nw);
          const srcR = new Set(T('routines').filter(r => r.program_week_id === src.id).map(r => r.id));
          const done = new Set(T('sessions').filter(x => x.finished_at && srcR.has(x.routine_id)).map(x => x.id));
          copyWeek(T('routines').filter(r => r.program_week_id === base.id).sort((x, y) => (x.position - y.position) || ((x.day || 0) - (y.day || 0))), nw.id, it => {
            const o = {}; const pr = it.progression || {}; const rule = pr.type || 'none';
            const inc = Number(pr.inc_kg ?? pr.inc ?? 0);
            const logs = T('set_logs').filter(l => l.lineage_id && l.lineage_id === it.lineage_id && done.has(l.session_id));
            if ((mode === 'progress' || mode === 'repeat') && rule !== 'none' && it.reps_max != null && logs.length >= it.sets) {
              const minReps = Math.min(...logs.map(l => Number(l.reps) || 0)), top = Math.max(...logs.map(l => Number(l.weight) || 0));
              const rirs = logs.map(l => l.rir).filter(v => v != null), minRir = rirs.length ? Math.min(...rirs) : null;
              let up = false;
              if (minReps >= it.reps_max && (it.target_rir == null || minRir == null || minRir >= it.target_rir)) {
                if (rule === 'load' || rule === 'double') { o.load_kg = roundLoad((it.load_kg ?? top) + inc); up = true; }
                else if (rule === 'reps') { o.reps_min = it.reps_min + inc; o.reps_max = it.reps_max + inc; o.reps = o.reps_min === o.reps_max ? String(o.reps_min) : o.reps_min + '-' + o.reps_max; up = true; }
              }
              if (!up) o.load_kg = mode === 'repeat' ? (top || it.load_kg) : (it.load_kg ?? top);
            } else if (mode === 'repeat' && logs.length) {
              const top = Math.max(...logs.map(l => Number(l.weight) || 0)); if (top > 0) o.load_kg = top;
            }
            if (mode === 'deload') { o.sets = Math.max(1, Math.round(it.sets * vol)); o.target_rir = Math.min((it.target_rir ?? 2) + 2, 5); }
            return o;
          });
          save(); return nw.id;
        }
        if (fn === 'roll_program_weeks') {
          const prog = T('programs').find(p => p.id === a.p_program);
          if (!prog || prog.auto_repeat === false || prog.status !== 'active') return 0;
          let n = 0; const t = new Date(); const td = new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
          while (n < 12) {
            const lw = T('program_weeks').filter(w => w.program_id === prog.id).sort((x, y) => y.week_no - x.week_no)[0];
            if (!lw || !lw.published || plus(lw.start_date, 7) > td) break;
            const id = await this.rpc('_clone_week', { p_week_id: lw.id, p_mode: 'repeat' });
            const nw = T('program_weeks').find(w => w.id === id); nw.published = true; nw.notes = 'Repetida automáticamente';
            n++;
          }
          save(); return n;
        }
        if (fn === 'propagate_item_change') {
          const it = T('routine_items').find(i => i.id === a.p_item_id); if (!it) return 0;
          const r = T('routines').find(x => x.id === it.routine_id);
          const wk = r && T('program_weeks').find(w => w.id === r.program_week_id); if (!wk) return 0;
          const later = new Set(T('program_weeks').filter(w => w.program_id === wk.program_id && w.week_no > wk.week_no && !w.published).map(w => w.id));
          const rids = new Set(T('routines').filter(x => later.has(x.program_week_id)).map(x => x.id));
          let n = 0;
          T('routine_items').forEach(i => {
            if (!rids.has(i.routine_id) || i.lineage_id !== it.lineage_id) return;
            for (const [k, v] of Object.entries(a.p_changes || {})) if (v != null) i[k] = v;
            if ((a.p_changes || {}).reps != null) { const m = String(i.reps).match(/^\s*(\d+)(?:\s*[-–]\s*(\d+))?/); if (m) { i.reps_min = +m[1]; i.reps_max = +(m[2] || m[1]); } }
            n++;
          });
          save(); return n;
        }
        throw new Error('Función no disponible en modo demo: ' + fn);
      },
      resetDemo() { localStorage.removeItem(KEY); load(); }
    };
  }

  const DB = LIVE ? liveBackend() : demoBackend();

  // ------------------------------------------------- Hoja de cobros (Apps Script)
  DB.sheets = async function (action, payload) {
    const url = await DB.getSetting('sheets_url');
    const token = await DB.getSetting('sheets_token');
    if (!url) {
      if (DB.mode === 'demo') return demoSheets(action, payload);
      throw new Error('NO_SHEET');
    }
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, token }, payload || {})) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error en la hoja');
    return json.data;
  };

  // Datos de ejemplo de cobros para el modo demo (inventados)
  let demoPagos = null;
  function demoSheets(action, payload) {
    const iso = d => d.toISOString().slice(0, 10);
    const tarifas = [
      { plan: 'Mensual Entreno', servicio: 'Entreno', precio: 70, meses: 1 },
      { plan: 'Mensual Nutrición', servicio: 'Nutrición', precio: 50, meses: 1 },
      { plan: 'Mensual Mixto', servicio: 'Mixto', precio: 110, meses: 1 },
      { plan: 'Trimestral Mixto', servicio: 'Mixto', precio: 291, meses: 3 }
    ];
    demoPagos = demoPagos || [
      { id: 'PAG-0002', fecha: iso(new Date(Date.now() - 12 * 864e5)), cliente: 'Laura Martín', servicio: 'Mixto', plan: 'Mensual Mixto', importe: 110, metodo: 'Bizum', vence: iso(new Date(Date.now() + 18 * 864e5)), notas: '' },
      { id: 'PAG-0001', fecha: iso(new Date(Date.now() - 40 * 864e5)), cliente: 'Carlos Ruiz', servicio: 'Entreno', plan: 'Mensual Entreno', importe: 70, metodo: 'Efectivo', vence: iso(new Date(Date.now() - 10 * 864e5)), notas: '' }
    ];
    if (action === 'registrarPago') {
      const p = payload.pago; const t = tarifas.find(x => x.plan === p.plan) || { meses: 1, servicio: '' };
      const v = new Date(p.fecha); v.setMonth(v.getMonth() + t.meses);
      demoPagos.unshift({ id: 'PAG-' + String(demoPagos.length + 1).padStart(4, '0'), fecha: p.fecha, cliente: p.cliente, servicio: t.servicio, plan: p.plan, importe: Number(p.importe), metodo: p.metodo, vence: iso(v), notas: p.notas || '' });
      return Promise.resolve({ fila: 0, id: demoPagos[0].id });
    }
    const clientes = ['Laura Martín', 'Carlos Ruiz'].map((n, i) => {
      const last = demoPagos.find(p => p.cliente === n);
      const dias = last ? Math.round((new Date(last.vence) - Date.now()) / 864e5) : -1;
      return { id: 'CLI-00' + (i + 1), nombre: n, servicio: last ? last.servicio : '', plan: last ? last.plan : '', cuota: last ? last.importe : 0, vence: last ? last.vence : '', dias, estado: dias < 0 ? 'VENCIDO' : 'AL DÍA', pagadoMes: dias < 0 ? '✘ No' : '✔ Sí', pendiente: '', notas: '' };
    });
    return Promise.resolve({ clientes, tarifas, pagos: demoPagos, actualizado: new Date().toISOString(), demo: true });
  }

  window.DB = DB;
})();
