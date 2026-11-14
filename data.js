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
      Object.entries(opts.lte || {}).forEach(([k, v]) => { q = q.lte(k, v); });
      (opts.notNull || []).forEach(k => { q = q.not(k, 'is', null); });
      if (opts.order) q = q.order(opts.order[0], { ascending: opts.order[1] !== 'desc' });
      if (opts.limit) q = q.limit(opts.limit);
      return q;
    };
    // Caché de lecturas: lo mismo pedido dos veces en 30 s sale de memoria (y si ya está en camino, se comparte).
    // Cualquier escritura en una tabla borra su caché; cualquier rpc borra toda la caché.
    const cache = new Map(), TTL = 30000;
    const ck = (t, o) => t + '|' + JSON.stringify(o || {});
    const cached = (t, o, fn) => {
      const k = ck(t, o), hit = cache.get(k);
      if (hit && Date.now() - hit.at < TTL && !(o && o.fresh)) return hit.p.then(clone);
      const p = fn(); cache.set(k, { at: Date.now(), p });
      p.catch(() => cache.delete(k));
      return p.then(clone);
    };
    const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
    const drop = t => { for (const k of cache.keys()) if (!t || k.startsWith(t + '|')) cache.delete(k); };
    // las vistas dependen de varias tablas
    const VIEWS = { option_items: ['option_macros'], meal_options: ['option_macros'], foods: ['option_macros'], set_logs: ['last_performance'], daily_metrics: ['weekly_weight'], checkins: ['checkin_photos'], meal_plans: ['meal_blocks', 'meal_options', 'option_items', 'option_macros'], meal_blocks: ['meal_options', 'option_items', 'option_macros'] };
    const dropW = t => { drop(t); (VIEWS[t] || []).forEach(drop); };
    return {
      mode: 'live',
      sb,
      clearCache() { drop(); },
      async session() { const { data } = await sb.auth.getSession(); return data.session; },
      onAuth(fn) { sb.auth.onAuthStateChange((_e, s) => fn(s)); },
      async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
      async signUp(email, password, name) {
        const d = ok(await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin + location.pathname } }));
        return { needsConfirm: !d.session };
      },
      async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
      async updatePassword(password) { ok(await sb.auth.updateUser({ password })); },
      async signOut() { drop(); try { ['jmfit-boot', 'jmfit-sheet', 'jmfit-rolled'].forEach(k => localStorage.removeItem(k)); } catch (e) {} await sb.auth.signOut(); },
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
      // Supabase devuelve como mucho 1.000 filas por petición: si se piden más, se traen por páginas (hasta el límite pedido).
      // opts.cols: solo esas columnas (menos datos por la red).
      list(t, opts) {
        return cached(t, opts, async () => {
          const cols = (opts && opts.cols) || '*', lim = opts && opts.limit;
          if (!lim || lim <= 1000) return ok(await applyFilters(sb.from(t).select(cols), opts));
          const o = Object.assign({}, opts, { limit: null }), out = [];
          for (let from = 0; from < lim; from += 1000) {
            const to = Math.min(lim, from + 1000) - 1, rows = ok(await applyFilters(sb.from(t).select(cols), o).order('id').range(from, to));
            out.push(...rows); if (rows.length < to - from + 1) break;
          }
          return out;
        });
      },
      get(t, id, key = 'id') { return cached(t, { get: [key, id] }, async () => { const r = ok(await sb.from(t).select('*').eq(key, id)); return r[0] || null; }); },
      async insert(t, rows) { try { return ok(await sb.from(t).insert(rows).select()); } finally { dropW(t); } },
      async update(t, id, patch, key = 'id') { try { return ok(await sb.from(t).update(patch).eq(key, id).select()); } finally { dropW(t); } },
      async upsert(t, row, key = 'id') { try { return ok(await sb.from(t).upsert(row, { onConflict: key }).select()); } finally { dropW(t); } },
      async remove(t, id, key = 'id') { try { ok(await sb.from(t).delete().eq(key, id)); } finally { dropW(t); } },
      async rpc(fn, args) { try { return ok(await sb.rpc(fn, args)); } finally { if (!/^(get_my_nutrition|shopping_list|weekly_adherence|storage_usage|stagnation_alerts)$/.test(fn)) drop(); } },
      async uploadPhoto(clientId, blob) {
        const path = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        ok(await sb.storage.from('checkins').upload(path, blob, { contentType: 'image/jpeg' }));
        return path;
      },
      // Verificación en dos pasos (código de una app como Google Authenticator)
      mfa: {
        async level() { const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); if (error) throw error; return data; },
        async factors() { const { data, error } = await sb.auth.mfa.listFactors(); if (error) throw error; return data.all || []; },
        async enroll() {
          const all = await this.factors();
          for (const f of all.filter(f => f.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
          const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'TEAM JMFIT ' + new Date().toISOString().slice(0, 10) });
          if (error) throw error; return data;
        },
        async verify(factorId, code) { const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code }); if (error) throw error; drop(); },
        async unenroll(factorId) { const { error } = await sb.auth.mfa.unenroll({ factorId }); if (error) throw error; drop(); }
      },
      async removePhotos(paths) { if (paths.length) await sb.storage.from('checkins').remove(paths); },
      async photoUrl(path) {
        const d = ok(await sb.storage.from('checkins').createSignedUrl(path, 3600));
        return d.signedUrl;
      },
      async getSetting(key) { const r = await this.get('settings', key, 'key'); return r ? r.value : ''; },
      async setSetting(key, value) { await this.upsert('settings', { key, value }, 'key'); }
    };
  }

  // ---------------------------------------------------------------- DEMO
  const DEMO_FOODS = [
    ['Huevo M', 'Huevos', 'Genérico', 150, 12.7, 0.7, 9.7, 0, 'Unidad', 55], ['Claras de Huevo - Lidl', 'Huevos', 'Lidl', 43, 9.8, 0.9, 0, 0.6, null, null],
    ['Pan de Pueblo - Mercadona', 'Panes y cereales', 'Mercadona', 245, 7.5, 51, 0.8, 2.9, null, null], ['Pan integral', 'Panes y cereales', 'Genérico', 240, 10, 37, 4, 8.3, 'Rebanada', 30],
    ['Avena', 'Panes y cereales', 'Genérico', 389, 16.9, 66.3, 6.9, 10.6, null, null], ['Arroz Blanco Crudo', 'Arroces y pastas', 'Genérico', 359, 6.6, 79.2, 0.6, 1.4, null, null],
    ['Crema de Arroz', 'Arroces y pastas', 'Genérico', 366.7, 8.1, 76.6, 2.5, 2.7, null, null], ['Pasta Cruda', 'Arroces y pastas', 'Genérico', 357, 12.2, 72.3, 1.4, 3, null, null],
    ['Pechuga de Pollo Cruda', 'Carnes', 'Genérico', 109, 23, 0, 1.2, 0, null, null], ['Pechuga de Pavo 92% - Hacendado', 'Carnes', 'Mercadona', 89, 19.5, 1, 1.3, 0, null, null],
    ['Jamón serrano', 'Embutidos', 'Genérico', 248, 33.5, 1, 12, 0, 'Loncha', 12.5], ['Merluza', 'Pescados', 'Genérico', 82, 18, 0, 2, 0, null, null],
    ['Salmón', 'Pescados', 'Genérico', 146, 21.62, 0, 5.93, 0, null, null], ['Atún al natural (lata)', 'Pescados', 'Genérico', 115, 25, 0.2, 0.8, 0, 'Lata', 60],
    ['Queso fresco batido 0%', 'Lácteos', 'Genérico', 46, 8, 3.5, 0, 0, null, null], ['Yogur Natural 0% - Hacendado', 'Lácteos', 'Mercadona', 36, 4.3, 4.5, 0.1, 0, null, null],
    ['Leche Semidesnatada', 'Lácteos', 'Genérico', 44.6, 3, 4.6, 1.5, 0, null, null], ['Aceite de oliva virgen extra', 'Grasas y aceites', 'Genérico', 884, 0, 0, 100, 0, null, null],
    ['Aguacate', 'Grasas y aceites', 'Genérico', 160, 2, 8.5, 14.7, 6.7, null, null], ['Crema Cacahuete - Lidl', 'Grasas y aceites', 'Lidl', 684, 30.4, 12, 55.1, 9.2, null, null],
    ['Nueces', 'Frutos secos', 'Genérico', 714, 15, 14, 65, 0, null, null], ['Plátano', 'Frutas', 'Genérico', 92, 1.1, 22, 0.3, 2.6, 'Pieza', 90],
    ['Manzana', 'Frutas', 'Genérico', 52, 0.3, 14, 0.2, 2.4, 'Unidad', 150], ['Patata cruda', 'Tubérculos', 'Genérico', 77, 2, 17, 0.1, 2.2, null, null],
    ['Verdura', 'Verduras', 'Genérico', 24, 1, 5, 0, 0, null, null], ['Whey Protein', 'Suplementos', 'Genérico', 380, 86.6, 1.2, 3.9, 0.9, null, null]
  ];
  function demoBackend() {
    const KEY = 'jmfit-demo-v1';
    let store;
    const save = () => localStorage.setItem(KEY, JSON.stringify(store));
    const load = () => {
      try { store = JSON.parse(localStorage.getItem(KEY)); } catch (e) { store = null; }
      if (!store || !store.tables) { store = { tables: {}, who: null }; seed(); save(); }
      if (!(store.tables.foods || []).length) { store.tables.foods = DEMO_FOODS.map(([name, category, store_, kcal, protein, carbs, fat, fiber, unit_name, unit_g]) => ({ id: uuid(), name, category, store: store_, kind: store_ === 'Genérico' ? (category === 'Suplementos' ? 'Suplemento' : 'Genérico') : 'Marca', kcal, protein, carbs, fat, fiber, unit_name, unit_g, active: true })); save(); }
    };
    const T = n => (store.tables[n] = store.tables[n] || []);
    const keyOf = (t) => ({ settings: 'key', nutrition_plans: 'client_id' }[t] || 'id');
    const now = () => new Date().toISOString();
    const listeners = [];

    function seed() {
      const ex = window.JMFIT_EXERCISES.map(([name, muscle, equipment]) => ({ id: uuid(), name, muscle, equipment, media_url: '', notes: '' }));
      store.tables.exercises = ex;
      const find = n => ex.find(e => e.name === n);
      const c1 = { id: uuid(), user_id: 'demo-client', name: 'Laura Martín', email: 'laura@ejemplo.com', phone: '34600000000', goal: 'Ganar fuerza y masa muscular', service: 'Mixto', sheet_name: 'Laura Martín', notes: 'Rodilla derecha sensible en sentadilla profunda', active: true, remind_checkin: true, remind_payment: true, pay_due: null, pay_plan: null, pay_amount: null, consent_version: null, consent_at: null, consent_photos: true, data_request: null, data_request_at: null, ck_freq: 'semanal', ck_day: 5, ck_anchor: null, ui_prefs: {}, created_at: now() };
      const c2 = { id: uuid(), user_id: null, name: 'Carlos Ruiz', email: 'carlos@ejemplo.com', phone: '', goal: 'Perder grasa', service: 'Entreno', sheet_name: '', notes: '', active: true, remind_checkin: true, remind_payment: true, pay_due: null, pay_plan: null, pay_amount: null, consent_version: null, consent_at: null, consent_photos: true, data_request: null, data_request_at: null, ck_freq: 'semanal', ck_day: 5, ck_anchor: null, ui_prefs: {}, created_at: now() };
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
      for (const [k, v] of Object.entries(opts.lte || {})) if (!(row[k] <= v)) return false;
      for (const k of opts.notNull || []) if (row[k] == null) return false;
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
          if (!row.created_at && t !== 'settings') row.created_at = now();
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
        const ks = String(key).split(',').map(x => x.trim());
        const ex = T(t).find(r => ks.every(k => r[k] === row[k]));
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
        if (t === 'meal_plans') for (const b of T('meal_blocks').filter(x => x.plan_id === id)) await this.remove('meal_blocks', b.id);
        if (t === 'checkins') store.tables.checkin_photos = T('checkin_photos').filter(r => r.checkin_id !== id);
        if (t === 'meal_blocks') {
          const oids = new Set(T('meal_options').filter(o => o.block_id === id).map(o => o.id));
          store.tables.meal_options = T('meal_options').filter(o => o.block_id !== id);
          store.tables.option_items = T('option_items').filter(i => !oids.has(i.option_id));
        }
        if (t === 'meal_options') store.tables.option_items = T('option_items').filter(i => i.option_id !== id);
        if (t === 'sessions') store.tables.set_logs = T('set_logs').filter(r => r.session_id !== id);
        if (t === 'clients') ['routines', 'routine_items', 'sessions', 'set_logs', 'checkins', 'messages', 'nutrition_plans', 'meal_plans', 'meal_blocks', 'meal_options', 'option_items', 'checkin_photos', 'daily_metrics', 'form_responses']
          .forEach(n => { store.tables[n] = T(n).filter(r => r.client_id !== id); });
        save();
      },
      async uploadPhoto(_clientId, blob) {
        return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      },
      async photoUrl(path) { return path; },
      async removePhotos() {},
      mfa: { async level() { return { currentLevel: 'aal1', nextLevel: 'aal1' }; }, async factors() { return []; }, async enroll() { throw new Error('No disponible en modo demo'); }, async verify() {}, async unenroll() {} },
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
        if (fn === 'storage_usage') return { photo_bytes: 0, photos: 0, db_bytes: 0 };
        if (fn === 'set_goal_request') {
          const me = T('clients').find(c => c.user_id === 'demo-client'); if (!me) throw new Error('Tu cuenta no está vinculada a un cliente');
          const t = String(a.p_text || '').trim(); me.goal_request = t ? t.slice(0, 500) : null; me.goal_request_at = t ? now() : null; save(); return null;
        }
        if (fn === 'stagnation_alerts') {
          const items = new Map(T('routine_items').map(i => [i.id, i])), lim = Date.now() - 35 * 864e5;
          const wkOf = d => monday(String(d).slice(0, 10)), best = new Map();
          T('set_logs').forEach(l => {
            const it = items.get(l.routine_item_id); if (!it || it.position > 1 || !(l.weight > 0) || !(l.reps > 0) || new Date(l.created_at) < lim) return;
            const key = l.client_id + '|' + (l.lineage_id || String(l.exercise_name).toLowerCase()) + '|' + wkOf(l.created_at), b = best.get(key);
            if (!b || l.weight > b.weight || (l.weight === b.weight && l.reps > b.reps)) best.set(key, l);
          });
          const by = {}; best.forEach((l, key) => { const k = key.split('|').slice(0, 2).join('|'); (by[k] = by[k] || []).push(Object.assign({ wk: key.split('|')[2] }, l)); });
          return Object.values(by).map(a => a.sort((x, y) => y.wk.localeCompare(x.wk))).filter(a => a.length >= 3
            && Date.now() - new Date(a[0].created_at) < 10 * 864e5 && a[1].wk === plus(a[0].wk, -7) && a[2].wk === plus(a[0].wk, -14)
            && [a[1], a[2]].every(x => x.weight === a[0].weight && x.reps === a[0].reps))
            .map(a => ({ client_id: a[0].client_id, exercise_name: a[0].exercise_name, weight: a[0].weight, reps: a[0].reps, last_at: a[0].created_at }));
        }
        if (/^(accept_consent|withdraw_consent|request_data_deletion)$/.test(fn)) {
          const me = T('clients').find(c => c.user_id === 'demo-client'); if (!me) throw new Error('Tu cuenta no está vinculada a un cliente');
          const ts = now();
          if (fn === 'accept_consent') {
            T('consents').push({ id: uuid(), client_id: me.id, version: a.p_version, action: 'accept', health: true, photos: !!a.p_photos, guardian_name: a.p_guardian_name || null, guardian_relation: a.p_guardian_relation || null, created_at: ts });
            Object.assign(me, { consent_version: a.p_version, consent_at: ts, consent_photos: !!a.p_photos }, me.data_request === 'withdraw' ? { data_request: null, data_request_at: null } : {});
          } else if (fn === 'withdraw_consent') {
            T('consents').push({ id: uuid(), client_id: me.id, version: me.consent_version || '-', action: 'withdraw', health: false, photos: false, created_at: ts });
            Object.assign(me, { consent_version: null, consent_at: null, data_request: 'withdraw', data_request_at: ts });
          } else Object.assign(me, { data_request: 'delete', data_request_at: ts });
          save(); return fn === 'accept_consent' ? ts : null;
        }
        if (fn === 'clear_data_request') { const c = T('clients').find(x => x.id === a.p_client); if (c) Object.assign(c, { data_request: null, data_request_at: null }); save(); return null; }
        if (fn === 'delete_mesocycle') {
          const prog = T('programs').find(p => p.id === a.p_program); if (!prog) throw new Error('Mesociclo no encontrado');
          const d0 = new Date(); d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7)); const mon = d0.toISOString().slice(0, 10);
          const trained = new Set(T('sessions').map(x => x.routine_id));
          const drop = new Set(T('program_weeks').filter(w => w.program_id === prog.id && (a.p_scope === 'all' || w.start_date >= mon) && !T('routines').some(r => r.program_week_id === w.id && trained.has(r.id))).map(w => w.id));
          const dropR = new Set(T('routines').filter(r => drop.has(r.program_week_id)).map(r => r.id));
          store.tables.routine_items = T('routine_items').filter(i => !dropR.has(i.routine_id));
          store.tables.routines = T('routines').filter(r => !dropR.has(r.id));
          store.tables.program_weeks = T('program_weeks').filter(w => !drop.has(w.id));
          if (!T('program_weeks').some(w => w.program_id === prog.id)) store.tables.programs = T('programs').filter(p => p.id !== prog.id);
          else Object.assign(prog, { status: 'archived', auto_repeat: false });
          save(); return drop.size;
        }
        if (fn === 'create_mesocycle') {
          const n = +a.p_weeks; if (![4, 6].includes(n)) throw new Error('El mesociclo es de 4 o 6 semanas');
          const o = a.p_opts || {}, start = monday(a.p_start), P = window.JMMeso.project;
          const src = T('routines').filter(r => r.client_id === a.p_client && (a.p_from_week ? r.program_week_id === a.p_from_week : !r.program_week_id)).sort((x, y) => x.position - y.position || (x.day || 0) - (y.day || 0));
          if (!src.length) throw new Error('No hay rutinas de partida');
          T('programs').filter(p => p.client_id === a.p_client && p.status === 'active').forEach(p => { p.auto_repeat = false; });
          const trained = new Set(T('sessions').map(x => x.routine_id));
          const drop = new Set(T('program_weeks').filter(w => w.client_id === a.p_client && w.start_date >= start && !T('routines').some(r => r.program_week_id === w.id && trained.has(r.id))).map(w => w.id));
          const dropR = new Set(T('routines').filter(r => drop.has(r.program_week_id)).map(r => r.id));
          store.tables.routine_items = T('routine_items').filter(i => !dropR.has(i.routine_id));
          store.tables.routines = T('routines').filter(r => !dropR.has(r.id));
          store.tables.program_weeks = T('program_weeks').filter(w => !drop.has(w.id));
          const prog = { id: uuid(), client_id: a.p_client, name: a.p_name || 'Mesociclo', start_date: start, status: 'active', auto_repeat: false, deload_every: n, meso_weeks: n, meso_opts: o, created_at: now() };
          T('programs').push(prog);
          for (let k = 0; k < n; k++) {
            const w = { id: uuid(), program_id: prog.id, client_id: a.p_client, week_no: k + 1, start_date: plus(start, 7 * k), kind: k === n - 1 ? 'deload' : 'normal', source_week_id: null, published: o.publish !== false, notes: k === n - 1 ? 'Descarga del mesociclo' : `Acumulación ${k + 1}/${n - 1}`, created_at: now() };
            T('program_weeks').push(w);
            copyWeek(src, w.id, it => { const v = P(it, k, n, o); const r = { sets: v.sets, load_kg: v.load_kg, target_rir: v.target_rir, base: v.base || null, progression: window.JMMeso.progressionAt ? window.JMMeso.progressionAt(it, k, o, v) : it.progression };
              if (v.reps !== it.reps) Object.assign(r, { reps: v.reps, reps_min: v.reps_min, reps_max: v.reps_max }); return r; });
          }
          save(); return prog.id;
        }
        if (fn === 'clone_program_week' || fn === '_clone_week') {
          const mode = a.p_mode || 'progress', vol = a.p_deload_volume || 0.6;
          const src = T('program_weeks').find(w => w.id === a.p_week_id);
          if (!src) throw new Error('Semana no encontrada');
          const weeks = T('program_weeks').filter(w => w.program_id === src.program_id);
          let base = src;
          if ((src.kind === 'deload' || src.kind === 'intensity') && mode !== 'deload') base = weeks.filter(w => w.week_no < src.week_no && (w.kind === 'normal' || w.kind === 'maintenance')).sort((x, y) => y.week_no - x.week_no)[0] || src;
          const nw = { id: uuid(), program_id: src.program_id, client_id: src.client_id, week_no: Math.max(...weeks.map(w => w.week_no)) + 1, start_date: plus(weeks.map(w => w.start_date).sort().pop(), 7), kind: mode === 'deload' ? 'deload' : 'normal', source_week_id: src.id, published: false, created_at: now() };
          T('program_weeks').push(nw);
          const srcR = new Set(T('routines').filter(r => r.program_week_id === src.id).map(r => r.id));
          const done = new Set(T('sessions').filter(x => x.finished_at && srcR.has(x.routine_id)).map(x => x.id));
          copyWeek(T('routines').filter(r => r.program_week_id === base.id).sort((x, y) => (x.position - y.position) || ((x.day || 0) - (y.day || 0))), nw.id, it => {
            const fb = it.base || { sets: it.sets, target_rir: it.target_rir, load_kg: it.load_kg };   // lo fijo
            const o = { sets: fb.sets, target_rir: fb.target_rir ?? null, load_kg: fb.load_kg ?? null, base: null }; it = Object.assign({}, it, o); const pr = it.progression || {}; const rule = pr.type || 'none';
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
            if (mode === 'deload') { o.sets = Math.max(1, Math.round(it.sets * vol)); o.target_rir = Math.max(it.target_rir ?? 2, 2); o.base = { sets: it.sets, target_rir: it.target_rir, load_kg: o.load_kg ?? it.load_kg }; }
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
        // Migración 009: tipo de semana y cambios hacia las semanas siguientes
        const applyKind = (rid, kind, prevWeek) => {
          const done = prevWeek ? new Set(T('sessions').filter(x => x.finished_at && T('routines').some(r => r.id === x.routine_id && r.program_week_id === prevWeek)).map(x => x.id)) : new Set();
          T('routine_items').filter(i => i.routine_id === rid).forEach(i => {
            const b = i.base || { sets: i.sets, target_rir: i.target_rir, load_kg: i.load_kg };
            if (['normal', 'maintenance', 'test'].includes(kind)) { Object.assign(i, { sets: b.sets, target_rir: b.target_rir, load_kg: b.load_kg, base: null }); return; }
            if (kind === 'deload') { Object.assign(i, { sets: Math.max(1, Math.round(b.sets * 0.6)), target_rir: Math.max(b.target_rir ?? 2, 2), load_kg: b.load_kg, base: b }); return; }
            const logs = T('set_logs').filter(l => l.lineage_id && l.lineage_id === i.lineage_id && done.has(l.session_id));
            const rirs = logs.map(l => l.rir).filter(v => v != null);
            const okk = logs.length >= b.sets && i.reps_max != null && Math.min(...logs.map(l => +l.reps || 0)) >= i.reps_max && (b.target_rir == null || !rirs.length || Math.min(...rirs) >= b.target_rir);
            const inc = Number((i.progression || {}).inc_kg ?? 2.5);
            Object.assign(i, { sets: b.sets, target_rir: Math.max((b.target_rir ?? 2) - 1, 0), load_kg: okk ? roundLoad((b.load_kg ?? Math.max(...logs.map(l => +l.weight || 0))) + inc) : b.load_kg, base: b });
          });
        };
        const prevOf = w => (T('program_weeks').filter(x => x.program_id === w.program_id && x.week_no < w.week_no).sort((x, y) => y.week_no - x.week_no)[0] || {}).id || null;
        if (fn === 'delay_mesocycle') {
          const prog = T('programs').find(p => p.id === a.p_program); if (!prog) throw new Error('Mesociclo no encontrado');
          const ws = T('program_weeks').filter(w => w.program_id === prog.id).sort((x, y) => x.week_no - y.week_no), w1 = ws[0];
          if (!w1) throw new Error('El mesociclo no tiene semanas');
          if (w1.start_date < monday(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10))) throw new Error('El mesociclo ya ha empezado: solo se puede retrasar si empieza esta semana o más adelante');
          const wid = new Set(ws.map(w => w.id)), rids = new Set(T('routines').filter(r => wid.has(r.program_week_id)).map(r => r.id));
          if (T('sessions').some(s => rids.has(s.routine_id))) throw new Error('Ya hay entrenos registrados en este mesociclo');
          if (T('program_weeks').some(w => w.client_id === prog.client_id && w.program_id !== prog.id && w.start_date >= w1.start_date)) throw new Error('Hay otra planificación después de este mesociclo');
          const old = w1.start_date, dl = a.p_deload !== false;
          ws.forEach(w => { w.start_date = plus(w.start_date, 7); if (dl) w.week_no += 1; });
          prog.start_date = plus(prog.start_date, 7);
          if (!dl) { save(); return null; }
          let src = null;
          if ((a.p_source || 'prev') === 'prev') src = T('program_weeks').filter(w => w.client_id === prog.client_id && w.program_id !== prog.id && w.start_date < old && T('routines').some(r => r.program_week_id === w.id)).sort((x, y) => y.start_date.localeCompare(x.start_date) || y.week_no - x.week_no)[0];
          src = src || ws.find(w => w.kind !== 'deload') || w1;
          const nw = { id: uuid(), program_id: prog.id, client_id: prog.client_id, week_no: 1, start_date: old, kind: 'deload', source_week_id: src.id, published: w1.published, notes: 'Descarga antes del mesociclo', kind_set_at: now(), created_at: now() };
          T('program_weeks').push(nw);
          const srcR = T('routines').filter(r => r.program_week_id === src.id).sort((x, y) => x.position - y.position || (x.day || 0) - (y.day || 0));
          copyWeek(srcR, nw.id);
          T('routines').filter(r => r.program_week_id === nw.id).forEach(r => applyKind(r.id, 'deload', null));
          save(); return nw.id;
        }
        if (fn === 'set_event_done') {
          const e = T('calendar_events').find(x => x.id === a.p_id); if (!e) throw new Error('Evento no encontrado');
          e.done_at = a.p_done ? (e.done_at || now()) : null; save(); return null;
        }
        if (fn === 'set_week_kind') {
          const w = T('program_weeks').find(x => x.id === a.p_week); if (!w) throw new Error('Semana no encontrada');
          T('routines').filter(r => r.program_week_id === w.id).forEach(r => applyKind(r.id, a.p_kind, prevOf(w)));
          w.kind = a.p_kind; w.kind_set_at = now(); save(); return null;
        }
        if (fn === 'propagate_routine') {
          const src = T('routines').find(r => r.id === a.p_routine); if (!src || !src.program_week_id) return 0;
          const sw = T('program_weeks').find(w => w.id === src.program_week_id); let n = 0;
          for (const w of T('program_weeks').filter(x => x.program_id === sw.program_id && x.week_no > sw.week_no).sort((x, y) => x.week_no - y.week_no)) {
            const rs = T('routines').filter(r => r.program_week_id === w.id && (r.day ?? null) === (src.day ?? null));
            let t = rs.find(r => String(r.name).toLowerCase() === String(src.name).toLowerCase()) || rs.find(r => r.position === src.position);
            if (t && T('sessions').some(x => x.routine_id === t.id && x.finished_at)) continue;
            if (t) Object.assign(t, { name: src.name, day: src.day, notes: src.notes });
            else { t = Object.assign({}, src, { id: uuid(), program_week_id: w.id, created_at: now() }); T('routines').push(t); }
            const loads = {}; T('routine_items').filter(i => i.routine_id === t.id).forEach(i => { loads[i.lineage_id] = i.base ? i.base.load_kg : i.load_kg; });
            store.tables.routine_items = T('routine_items').filter(i => i.routine_id !== t.id);
            T('routine_items').filter(i => i.routine_id === src.id).sort((x, y) => x.position - y.position).forEach(i => {
              const b = i.base || {};
              T('routine_items').push(Object.assign({}, i, { id: uuid(), routine_id: t.id, sets: b.sets ?? i.sets, target_rir: b.target_rir !== undefined ? b.target_rir : i.target_rir, load_kg: loads[i.lineage_id] !== undefined ? loads[i.lineage_id] : (b.load_kg !== undefined ? b.load_kg : i.load_kg), base: null }));
            });
            if (['deload', 'intensity'].includes(w.kind)) applyKind(t.id, w.kind, prevOf(w));
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
        // Migración 005: base de alimentos y plan por comidas
        const fmap = () => new Map(T('foods').map(f => [f.id, f]));
        const gramsOf = (i, f) => (i.units != null && f && f.unit_g > 0 ? i.units * f.unit_g : Number(i.grams) || 0);
        if (fn === 'sync_foods') {
          let nuevos = 0, actualizados = 0, desactivados = 0; const names = new Set();
          for (const r of a.p_rows || []) {
            const nm = String(r.name || '').trim(); if (!nm || r.kcal == null) continue; names.add(nm.toLowerCase());
            const row = { name: nm, kind: r.kind || 'Genérico', store: r.store || 'Genérico', category: r.category || 'Otros', kcal: +r.kcal, protein: +r.protein || 0, carbs: +r.carbs || 0, fat: +r.fat || 0, fiber: +r.fiber || 0, unit_name: r.unit_name || null, unit_g: r.unit_g != null ? +r.unit_g : null, active: r.active !== false, source: r.source || null };
            const ex = T('foods').find(f => f.name.toLowerCase() === nm.toLowerCase());
            if (!ex) { T('foods').push(Object.assign({ id: uuid(), created_at: now(), updated_at: now() }, row)); nuevos++; }
            else if (Object.keys(row).some(k => (ex[k] ?? null) !== (row[k] ?? null))) { Object.assign(ex, row, { updated_at: now() }); actualizados++; }
          }
          T('foods').forEach(f => { if (f.active !== false && !names.has(f.name.toLowerCase())) { f.active = false; desactivados++; } });
          save(); return { nuevos, actualizados, desactivados, total: names.size };
        }
        if (fn === 'copy_meal_plan') {
          const to = a.p_to; let n = 0;
          for (const b of T('meal_blocks').filter(x => x.client_id === to)) await this.remove('meal_blocks', b.id);
          store.tables.meal_plans = T('meal_plans').filter(x => x.client_id !== to);
          const pmap = {};
          T('meal_plans').filter(x => x.client_id === a.p_from).forEach(pl => { const np = Object.assign({}, pl, { id: uuid(), client_id: to }); pmap[pl.id] = np.id; T('meal_plans').push(np); });
          T('meal_blocks').filter(b => b.client_id === a.p_from).sort((x, y) => x.position - y.position).forEach(b => {
            const nb = Object.assign({}, b, { id: uuid(), client_id: to, plan_id: pmap[b.plan_id] || null }); T('meal_blocks').push(nb); n++;
            T('meal_options').filter(o => o.block_id === b.id).forEach(o => {
              const no = Object.assign({}, o, { id: uuid(), block_id: nb.id, client_id: to }); T('meal_options').push(no);
              T('option_items').filter(i => i.option_id === o.id).forEach(i => T('option_items').push(Object.assign({}, i, { id: uuid(), option_id: no.id, client_id: to })));
            });
          });
          save(); return n;
        }
        if (fn === 'get_my_nutrition') {
          const c = T('clients').find(x => x.user_id === 'demo-client'); if (!c) return null;
          const p = T('nutrition_plans').find(x => x.client_id === c.id) || {}; const show = p.show_macros !== false; const F = fmap();
          const r1 = x => Math.round(x * 10) / 10;
          return {
            show_macros: show, targets: show ? { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat } : null, water: p.water, notes: p.notes, legacy_meals: p.meals, updated_at: p.updated_at,
            plans: T('meal_plans').filter(x => x.client_id === c.id).sort((x, y) => x.position - y.position).map(x => ({ id: x.id, name: x.name, notes: x.notes, targets: show && x.kcal != null ? { kcal: x.kcal, protein: x.protein, carbs: x.carbs, fat: x.fat } : null })),
            blocks: T('meal_blocks').filter(b => b.client_id === c.id).sort((x, y) => x.position - y.position).map(b => ({
              id: b.id, plan_id: b.plan_id, name: b.name, time_hint: b.time_hint, notes: b.notes,
              options: T('meal_options').filter(o => o.block_id === b.id).sort((x, y) => x.position - y.position).map(o => {
                const its = T('option_items').filter(i => i.option_id === o.id).sort((x, y) => x.position - y.position);
                const m = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
                its.forEach(i => { const f = F.get(i.food_id); if (!f) return; const g = gramsOf(i, f); m.kcal += g * f.kcal / 100; m.protein += g * f.protein / 100; m.carbs += g * f.carbs / 100; m.fat += g * f.fat / 100; m.fiber += g * (f.fiber || 0) / 100; });
                return { id: o.id, label: o.label, name: o.name, notes: o.notes,
                  macros: show ? { kcal: Math.round(m.kcal), protein: r1(m.protein), carbs: r1(m.carbs), fat: r1(m.fat), fiber: r1(m.fiber) } : null,
                  items: its.map(i => { const f = F.get(i.food_id); const g = gramsOf(i, f); return { food: f ? f.name : i.food_name, grams: Math.round(g), unit: f && f.unit_name, category: (f && f.category) || 'Otros', units: i.units != null ? i.units : (f && f.unit_g > 0 ? r1(i.grams / f.unit_g) : null), kcal: show && f ? Math.round(g * f.kcal / 100) : null }; }) };
              })
            }))
          };
        }
        throw new Error('Función no disponible en modo demo: ' + fn);
      },
      resetDemo() { localStorage.removeItem(KEY); load(); }
    };
  }

  const DB = LIVE ? liveBackend() : demoBackend();

  // ------------------------------------------------- Hoja de cobros (Apps Script)
  const sheetsInflight = {};
  DB.sheets = async function (action, payload) {
    if (action === 'resumen' && !payload) {
      if (!sheetsInflight.r) sheetsInflight.r = sheetsCall(action, payload).finally(() => { sheetsInflight.r = null; });
      return sheetsInflight.r;
    }
    return sheetsCall(action, payload);
  };
  async function sheetsCall(action, payload) {
    const [url, token] = await Promise.all([DB.getSetting('sheets_url'), DB.getSetting('sheets_token')]);
    if (!url) {
      if (DB.mode === 'demo') return demoSheets(action, payload);
      throw new Error('NO_SHEET');
    }
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, token }, payload || {})) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error en la hoja');
    return json.data;
  }

  // Datos de ejemplo de cobros para el modo demo (inventados)
  let demoPagos = null, demoAltas = null;
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
    if (action === 'altaCliente') {
      const c = payload.cliente || {}; if (!c.nombre || !c.plan) return Promise.reject(new Error('Faltan datos: nombre y plan'));
      demoAltas = demoAltas || []; if (['Laura Martín', 'Carlos Ruiz'].concat(demoAltas.map(x => x.nombre)).some(n => n.toLowerCase() === c.nombre.toLowerCase())) return Promise.reject(new Error('Ya hay un cliente con ese nombre en la hoja'));
      demoAltas.push(c); return Promise.resolve({ fila: 0, id: 'CLI-0' + (10 + demoAltas.length) });
    }
    const clientes = ['Laura Martín', 'Carlos Ruiz'].concat((demoAltas || []).map(x => x.nombre)).map((n, i) => {
      const last = demoPagos.find(p => p.cliente === n);
      const dias = last ? Math.round((new Date(last.vence) - Date.now()) / 864e5) : -1;
      return { id: 'CLI-00' + (i + 1), nombre: n, servicio: last ? last.servicio : '', plan: last ? last.plan : '', cuota: last ? last.importe : 0, vence: last ? last.vence : '', dias, estado: dias < 0 ? 'VENCIDO' : 'AL DÍA', pagadoMes: dias < 0 ? '✘ No' : '✔ Sí', pendiente: '', notas: '' };
    });
    return Promise.resolve({ clientes, tarifas, pagos: demoPagos, actualizado: new Date().toISOString(), demo: true });
  }

  window.DB = DB;
})();
