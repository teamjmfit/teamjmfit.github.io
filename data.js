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
