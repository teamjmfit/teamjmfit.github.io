/* TEAM JMFIT · Plan nutricional por comidas (como Harbiz) + base de alimentos en Google Sheets */
(function () {
  'use strict';
  const U = () => window.JMUI;
  const DB = () => window.DB;
  const SHEET_KEY = 'foods_sheet';
  const MEALS = ['Desayuno', 'Media mañana', 'Comida', 'Merienda', 'Pre entreno', 'Post entreno', 'Cena', 'Recena', 'Extra'];
  const N = { foods: null, sel: {}, lastSync: 0 };
  const r0 = x => Math.round(x), r1 = x => Math.round(x * 10) / 10;
  const f1 = x => String(r1(x)).replace('.', ',');
  const defSheet = () => (DB().mode === 'demo' ? '' : ((window.JMFIT_CONFIG || {}).FOODS_SHEET || ''));
  const pos = v => Number(String(v == null ? '' : v).replace(',', '.'));

  // ------------------------------------------------------------ alimentos
  async function loadFoods(force) {
    if (!N.foods || force) N.foods = await DB().list('foods', { order: ['name', 'asc'] });
    return N.foods;
  }
  const foodMap = () => new Map((N.foods || []).map(f => [f.id, f]));
  const gramsOf = (it, f) => (it.units != null && f && Number(f.unit_g) > 0 ? Number(it.units) * Number(f.unit_g) : Number(it.grams) || 0);
  function itemMacros(it, f) {
    const g = gramsOf(it, f), k = x => (f ? Number(f[x]) || 0 : 0) * g / 100;
    return { g, kcal: k('kcal'), p: k('protein'), c: k('carbs'), f: k('fat'), fi: k('fiber') };
  }
  function sumMacros(items, F) {
    const t = { kcal: 0, p: 0, c: 0, f: 0, fi: 0 };
    items.forEach(it => { const m = itemMacros(it, F.get(it.food_id)); for (const k in t) t[k] += m[k]; });
    return t;
  }
  function sheetIdOf(v) {
    const s = String(v || '').trim(); const m = s.match(/\/spreadsheets\/d\/([\w-]{20,})/);
    return m ? m[1] : (/^[\w-]{20,}$/.test(s) ? s : '');
  }
  // Lee la pestaña "Alimentos" de la hoja (compartida como "cualquiera con el enlace · lector")
  async function fetchSheet(id) {
    let txt;
    try {
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:json&headers=1&sheet=Alimentos`, { credentials: 'omit' });
      txt = await r.text();
    } catch (e) { throw new Error('No se pudo leer la hoja. Compártela como «Cualquier persona con el enlace · Lector».'); }
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('No se pudo leer la hoja. Compártela como «Cualquier persona con el enlace · Lector».');
    const j = JSON.parse(txt.slice(a, b + 1));
    if (j.status === 'error') throw new Error((j.errors && j.errors[0] && (j.errors[0].detailed_message || j.errors[0].message)) || 'Error en la hoja');
    const H = { nombre: 'name', tipo: 'kind', supermercado: 'store', 'categoría': 'category', categoria: 'category', kcal: 'kcal', 'proteínas': 'protein', proteinas: 'protein',
      hidratos: 'carbs', grasas: 'fat', fibra: 'fiber', medida: 'unit_name', 'g por medida': 'unit_g', activo: 'active', fuente: 'source' };
    const cols = j.table.cols.map(c => H[String(c.label || '').trim().toLowerCase()] || null);
    const nums = new Set(['kcal', 'protein', 'carbs', 'fat', 'fiber', 'unit_g']);
    const out = [];
    for (const row of j.table.rows || []) {
      const o = {};
      (row.c || []).forEach((cell, i) => {
        const k = cols[i]; if (!k || !cell || cell.v == null || cell.v === '') return;
        let v = cell.v;
        if (nums.has(k)) { v = pos(v); if (!isFinite(v) || v < 0) return; }
        else if (k === 'active') v = !/^(no|false|0|n)$/i.test(String(v).trim());
        else v = String(v).trim();
        o[k] = v;
      });
      if (o.name && o.kcal != null) out.push(o);
    }
    if (!out.length) throw new Error('La hoja no tiene alimentos (revisa que la pestaña se llame «Alimentos» y la fila 1 tenga las cabeceras).');
    return out;
  }
  async function syncFoods({ silent } = {}) {
    const id = sheetIdOf((await DB().getSetting(SHEET_KEY)) || defSheet());
    if (!id) { if (!silent) U().toast('Primero pega el enlace de tu hoja de alimentos', 'err'); return null; }
    try {
      const rows = await fetchSheet(id);
      // si la hoja no ha cambiado desde la última vez, no hace falta tocar la base de datos
      const sig = id + ':' + rows.length + ':' + [...JSON.stringify(rows)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0);
      let prev = ''; try { prev = localStorage.getItem('jmfit-foods-sig') || ''; } catch (e) {}
      if (silent && sig === prev) { N.lastSync = Date.now(); try { localStorage.setItem('jmfit-foods-sync', String(N.lastSync)); } catch (e) {} return { total: rows.length, nuevos: 0, actualizados: 0, desactivados: 0 }; }
      const res = await DB().rpc('sync_foods', { p_rows: rows });
      try { localStorage.setItem('jmfit-foods-sig', sig); } catch (e) {}
      N.lastSync = Date.now(); try { localStorage.setItem('jmfit-foods-sync', String(N.lastSync)); } catch (e) {}
      await loadFoods(true);
      const ch = res && (res.nuevos || res.actualizados || res.desactivados);
      if (!silent || ch) U().toast(`Alimentos al día: ${res.total} en la hoja${res.nuevos ? ` · ${res.nuevos} nuevos` : ''}${res.actualizados ? ` · ${res.actualizados} cambiados` : ''}${res.desactivados ? ` · ${res.desactivados} desactivados` : ''}`, 'ok');
      return res;
    } catch (e) { if (!silent) U().toast(e.message, 'err'); else console.warn('sync alimentos:', e.message); return null; }
  }
  // Sincronización automática: como mucho cada 10 minutos al abrir la nutrición
  async function autoSync() {
    try { N.lastSync = N.lastSync || Number(localStorage.getItem('jmfit-foods-sync')) || 0; } catch (e) {}
    if (Date.now() - N.lastSync < 10 * 6e4) return false;
    N.lastSync = Date.now();
    const r = await syncFoods({ silent: true });
    return !!(r && (r.nuevos || r.actualizados || r.desactivados));
  }

  // ------------------------------------------------------------ editor del entrenador
  async function coachEditor(c, host, form) {
    const { esc, ic, toast, confirmBox, modal, loading } = U();
    host.innerHTML = `<section class="card np">${loading()}</section>`;
    const st = { plans: [], blocks: [], options: [], items: [] };
    N.plan = N.plan || {};
    const load = async () => {
      const [pl, b, o, i] = await Promise.all([
        DB().list('meal_plans', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
        DB().list('meal_blocks', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
        DB().list('meal_options', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
        DB().list('option_items', { eq: { client_id: c.id }, order: ['position', 'asc'] }),
        loadFoods()
      ]);
      st.plans = pl; st.blocks = b; st.options = o; st.items = i;
      // comidas de antes de tener planes: van a un plan «Plan»
      const orphan = st.blocks.filter(x => !x.plan_id || !st.plans.some(p => p.id === x.plan_id));
      if (orphan.length) {
        const p0 = st.plans[0] || (await DB().insert('meal_plans', { client_id: c.id, name: 'Plan', position: 0 }))[0];
        if (!st.plans.includes(p0)) st.plans.push(p0);
        for (const x of orphan) { x.plan_id = p0.id; await DB().update('meal_blocks', x.id, { plan_id: p0.id }); }
      }
    };
    await load();
    autoSync().then(ch => { if (ch) draw(); });
    const optsOf = bid => st.options.filter(o => o.block_id === bid).sort((a, b) => a.position - b.position || String(a.label).localeCompare(b.label));
    const itemsOf = oid => st.items.filter(i => i.option_id === oid).sort((a, b) => a.position - b.position);
    const selOf = bid => { const os = optsOf(bid); const s = os.find(o => o.id === N.sel[bid]); return s || os[0] || null; };
    const cur = () => st.plans.find(p => p.id === N.plan[c.id]) || st.plans[0] || null;
    const blocksOf = () => { const p = cur(); return p ? st.blocks.filter(b => b.plan_id === p.id).sort((x, y) => x.position - y.position) : []; };
    const target = k => { const p = cur(); if (p && p[k] != null && p[k] !== '') return Number(p[k]) || 0; return form && form[k] ? Number(form[k].value) || 0 : 0; };
    const nextLabel = bid => { const used = new Set(optsOf(bid).map(o => o.label)); for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(L)) return L; return 'Z' + Date.now() % 1000; };

    function summary() {
      const F = foodMap(); const t = { kcal: 0, p: 0, c: 0, f: 0, fi: 0 };
      blocksOf().forEach(b => { const o = selOf(b.id); if (!o) return; const m = sumMacros(itemsOf(o.id), F); for (const k in t) t[k] += m[k]; });
      const bar = (lab, cls, v, goal, unit) => {
        const pct = goal ? Math.min(100, v / goal * 100) : 0, over = goal && v > goal * 1.05;
        return `<div class="np-goal ${cls}"><small>${lab}</small><b>${unit === 'kcal' ? r0(v) : f1(v)}${goal ? `<span> / ${r0(goal)}</span>` : ''} ${unit}</b>${goal ? `<i><em style="width:${pct}%" class="${over ? 'over' : ''}"></em></i>` : ''}</div>`;
      };
      const kc = t.p * 4 + t.c * 4 + t.f * 9, pc = x => (kc ? Math.round(x / kc * 100) : 0);
      return `${bar('Calorías', 'k', t.kcal, target('kcal'), 'kcal')}${bar('Proteína', 'p', t.p, target('protein'), 'g')}${bar('Hidratos', 'c', t.c, target('carbs'), 'g')}${bar('Grasas', 'f', t.f, target('fat'), 'g')}
        <p class="muted small np-split">${cur() && st.plans.length > 1 ? `<b>${esc(cur().name)}</b> · ` : ''}${kc ? `Reparto: P ${pc(t.p * 4)} % · C ${pc(t.c * 4)} % · G ${pc(t.f * 9)} % · fibra ${f1(t.fi)} g` : 'Añade comidas y alimentos para ver el total del día.'} <span class="np-hint">Cuenta la opción seleccionada de cada comida.</span></p>`;
    }
    function rowHtml(it) {
      const f = foodMap().get(it.food_id), m = itemMacros(it, f);
      const unit = it.units != null && f && f.unit_g > 0;
      const qty = unit ? it.units : r1(Number(it.grams) || 0);
      return `<tr data-i="${it.id}">
        <td class="np-q"><input type="number" inputmode="decimal" min="0" step="${unit ? '0.5' : '5'}" value="${esc(qty)}" data-qty>
          <select data-unit>${'<option value="g">g</option>'}${f && f.unit_g > 0 ? `<option value="u" ${unit ? 'selected' : ''}>${esc(f.unit_name || 'unidad')} (${f1(f.unit_g)} g)</option>` : ''}</select></td>
        <td class="np-n">${esc(f ? f.name : it.food_name)}${f ? (f.active === false ? ' <span class="pill red">inactivo</span>' : '') : ' <span class="pill red">no está en la base</span>'}${unit ? `<small class="muted"> · ${r0(m.g)} g</small>` : ''}</td>
        <td data-m="kcal">${r0(m.kcal)}</td><td data-m="p">${f1(m.p)}</td><td data-m="c">${f1(m.c)}</td><td data-m="f">${f1(m.f)}</td><td data-m="fi" class="lg">${f1(m.fi)}</td>
        <td><button type="button" class="icon-btn sm" data-delitem aria-label="Quitar">${ic('trash')}</button></td></tr>`;
    }
    const devTxt = dev => (dev == null ? '' : `<span class="${Math.abs(dev) > 10 ? 'bad' : 'muted'}">(${dev > 0 ? '+' : ''}${dev} % vs opción 1)</span>`);
    const devOf = bid => { const os = optsOf(bid), sel = selOf(bid), F = foodMap(); if (!os[0] || !sel || os[0].id === sel.id) return null; const ref = sumMacros(itemsOf(os[0].id), F).kcal; return ref ? Math.round((sumMacros(itemsOf(sel.id), F).kcal - ref) / ref * 100) : null; };
    function blockHtml(b, idx) {
      const os = optsOf(b.id), sel = selOf(b.id), F = foodMap();
      const items = sel ? itemsOf(sel.id) : [], t = sumMacros(items, F);
      const dev = devOf(b.id);
      return `<div class="np-block" data-b="${b.id}">
        <div class="np-bh">
          <input class="np-bname" value="${esc(b.name)}" list="np-meals" data-bname aria-label="Nombre de la comida">
          <input class="np-time" value="${esc(b.time_hint || '')}" placeholder="Hora (opcional)" data-btime aria-label="Hora">
          <span class="grow"></span>
          ${idx > 0 ? `<button type="button" class="icon-btn sm" data-up aria-label="Subir">${ic('up')}</button>` : ''}
          <button type="button" class="icon-btn sm" data-delblock aria-label="Borrar comida">${ic('trash')}</button>
        </div>
        <textarea rows="1" class="np-notes" placeholder="Descripción o cómo prepararlo (opcional)" data-bnotes>${esc(b.notes || '')}</textarea>
        <div class="np-opts">
          ${os.map((o, k) => `<button type="button" class="chip ${sel && o.id === sel.id ? 'on' : ''}" data-opt="${o.id}">Opción ${k + 1}</button>`).join('')}
          <button type="button" class="chip dashed" data-addopt>${ic('plus')} Opción</button>
          ${sel ? `<button type="button" class="chip dashed" data-dupopt title="Duplicar la opción seleccionada">${ic('copy')} Duplicar</button>` : ''}
          ${os.length > 1 ? `<button type="button" class="chip dashed danger" data-delopt>${ic('trash')} Quitar opción</button>` : ''}
        </div>
        ${items.length ? `<div class="tscroll"><table class="np-t"><thead><tr><th>Cantidad</th><th>Alimento</th><th>kcal</th><th>P</th><th>C</th><th>G</th><th class="lg">Fibra</th><th></th></tr></thead>
          <tbody>${items.map(rowHtml).join('')}</tbody>
          <tfoot><tr><td colspan="2">Total comida <small data-dev>${devTxt(dev)}</small></td><td data-t="kcal">${r0(t.kcal)}</td><td data-t="p">${f1(t.p)}</td><td data-t="c">${f1(t.c)}</td><td data-t="f">${f1(t.f)}</td><td data-t="fi" class="lg">${f1(t.fi)}</td><td></td></tr></tfoot>
        </table></div>` : `<p class="empty small">Sin alimentos en esta opción.</p>`}
        <div class="row gap wrap"><span class="grow"></span><button type="button" class="btn small primary" data-addfood>${ic('plus')} Añadir alimentos</button></div>
      </div>`;
    }
    function planBar() {
      const p = cur();
      const ph = k => (form && form[k] && form[k].value ? form[k].value : '');
      return `<div class="np-plans">
          ${st.plans.map(x => `<button type="button" class="chip ${p && x.id === p.id ? 'on' : ''}" data-plan="${x.id}">${esc(x.name)}</button>`).join('')}
          <button type="button" class="chip dashed" data-addplan>${ic('plus')} Plan</button>
          ${p ? `<button type="button" class="chip dashed" data-dupplan title="Duplicar este plan">${ic('copy')} Duplicar</button>` : ''}
        </div>
        ${p ? `<div class="np-planhead">
          <label class="np-pn">Nombre del plan<input value="${esc(p.name)}" data-pname list="np-plannames"></label>
          <datalist id="np-plannames"><option value="Día de entreno"><option value="Día de descanso"><option value="Día alto"><option value="Día bajo"><option value="Refeed"></datalist>
          <div class="np-pt"><small class="muted">Objetivo de este plan (vacío = el general)</small>
            <div class="np-ptr">${[['kcal', 'kcal'], ['protein', 'P'], ['carbs', 'C'], ['fat', 'G']].map(([k, l]) => `<label>${l}<input type="number" inputmode="numeric" min="0" value="${p[k] ?? ''}" placeholder="${esc(ph(k))}" data-pt="${k}"></label>`).join('')}</div></div>
          ${st.plans.length > 1 ? `<button type="button" class="icon-btn sm" data-delplan aria-label="Borrar plan">${ic('trash')}</button>` : ''}
        </div>` : ''}`;
    }
    async function ensurePlan() {
      if (cur()) return cur();
      const [p] = await DB().insert('meal_plans', { client_id: c.id, name: 'Plan', position: 0 });
      st.plans.push(p); N.plan[c.id] = p.id; return p;
    }
    async function addPlan() {
      const names = new Set(st.plans.map(p => p.name));
      const name = ['Día de entreno', 'Día de descanso', 'Plan 3', 'Plan 4'].find(n => !names.has(n)) || 'Plan';
      if (st.plans.length === 1 && st.plans[0].name === 'Plan') { st.plans[0].name = 'Día de entreno'; await DB().update('meal_plans', st.plans[0].id, { name: 'Día de entreno' }); }
      const nm = st.plans.length === 1 && name === 'Día de entreno' ? 'Día de descanso' : name;
      const [p] = await DB().insert('meal_plans', { client_id: c.id, name: nm, position: st.plans.reduce((m, x) => Math.max(m, x.position), -1) + 1 });
      st.plans.push(p); N.plan[c.id] = p.id; draw();
    }
    async function dupPlan() {
      const src = cur(); if (!src) return;
      const [p] = await DB().insert('meal_plans', { client_id: c.id, name: src.name + ' (copia)', position: st.plans.reduce((m, x) => Math.max(m, x.position), -1) + 1, kcal: src.kcal, protein: src.protein, carbs: src.carbs, fat: src.fat, notes: src.notes });
      st.plans.push(p);
      for (const b of blocksOf()) {
        const [nb] = await DB().insert('meal_blocks', { client_id: c.id, plan_id: p.id, name: b.name, position: b.position, time_hint: b.time_hint, notes: b.notes });
        st.blocks.push(nb);
        for (const o of optsOf(b.id)) {
          const [no] = await DB().insert('meal_options', { block_id: nb.id, client_id: c.id, label: o.label, name: o.name, position: o.position, notes: o.notes });
          st.options.push(no);
          const its = itemsOf(o.id);
          if (its.length) st.items.push(...await DB().insert('option_items', its.map(i => ({ option_id: no.id, client_id: c.id, food_id: i.food_id, food_name: i.food_name, grams: i.grams, units: i.units, position: i.position }))));
        }
      }
      N.plan[c.id] = p.id; draw();
    }
    function draw() {
      host.innerHTML = `<section class="card np">
        <div class="row gap wrap np-head"><h3>Plan por comidas</h3><span class="grow"></span>
          <button type="button" class="btn small ghost" data-copyplan>${ic('copy')} Copiar de otro cliente</button>
          <button type="button" class="btn small ghost" data-foods>${ic('apple')} Base de alimentos</button></div>
        <p class="muted small">Igual que en Harbiz: cada comida puede tener varias opciones; las cantidades se pueden cambiar cuando quieras y los macros se recalculan solos.</p>
        ${planBar()}
        <div class="np-sum" data-sum>${summary()}</div>
        <datalist id="np-meals">${MEALS.map(m => `<option value="${m}">`).join('')}</datalist>
        <div class="np-blocks">${blocksOf().map(blockHtml).join('') || '<p class="empty">Todavía no hay comidas. Empieza añadiendo el desayuno.</p>'}</div>
        <div class="row gap wrap"><button type="button" class="btn dashed" data-addblock>${ic('plus')} Añadir comida</button></div>
      </section>`;
      wire();
    }
    // Actualiza números sin redibujar (para no perder el foco al escribir)
    function refreshNumbers(bid) {
      const F = foodMap(), el = host.querySelector(`[data-b="${bid}"]`), sel = selOf(bid);
      if (el && sel) {
        const items = itemsOf(sel.id);
        items.forEach(it => {
          const tr = el.querySelector(`[data-i="${it.id}"]`); if (!tr) return;
          const m = itemMacros(it, F.get(it.food_id));
          tr.querySelectorAll('[data-m]').forEach(td => { const k = td.dataset.m; td.textContent = k === 'kcal' ? r0(m[k]) : f1(m[k]); });
          const sm = tr.querySelector('.np-n small'); if (sm) sm.textContent = ` · ${r0(m.g)} g`;
        });
        const t = sumMacros(items, F);
        el.querySelectorAll('[data-t]').forEach(td => { const k = td.dataset.t; td.textContent = k === 'kcal' ? r0(t[k]) : f1(t[k]); });
        const dv = el.querySelector('[data-dev]'); if (dv) dv.innerHTML = devTxt(devOf(bid));
      }
      const s = host.querySelector('[data-sum]'); if (s) s.innerHTML = summary();
    }
    const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg, 'ok'); } catch (e) { console.error(e); toast('Error: ' + e.message, 'err'); } };
    const timers = {};
    const later = (k, fn, ms = 500) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms); };

    async function addBlock() {
      const p = await ensurePlan();
      const used = new Set(blocksOf().map(b => b.name));
      const name = MEALS.find(m => !used.has(m)) || 'Comida';
      const posn = blocksOf().reduce((m, b) => Math.max(m, b.position), -1) + 1;
      const [b] = await DB().insert('meal_blocks', { client_id: c.id, plan_id: p.id, name, position: posn });
      const [o] = await DB().insert('meal_options', { block_id: b.id, client_id: c.id, label: 'A', position: 0 });
      st.blocks.push(b); st.options.push(o); N.sel[b.id] = o.id; draw();
      const el = host.querySelector(`[data-b="${b.id}"] [data-bname]`); if (el) el.select();
    }
    async function addOption(bid, copyFrom) {
      const os = optsOf(bid), posn = os.reduce((m, o) => Math.max(m, o.position), -1) + 1;
      const [o] = await DB().insert('meal_options', { block_id: bid, client_id: c.id, label: nextLabel(bid), position: posn });
      st.options.push(o);
      if (copyFrom) {
        const src = itemsOf(copyFrom.id);
        if (src.length) st.items.push(...await DB().insert('option_items', src.map(i => ({ option_id: o.id, client_id: c.id, food_id: i.food_id, food_name: i.food_name, grams: i.grams, units: i.units, position: i.position }))));
      }
      N.sel[bid] = o.id; draw();
    }

    function wire() {
      host.querySelector('[data-addblock]').onclick = () => run(addBlock);
      host.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => { N.plan[c.id] = b.dataset.plan; draw(); });
      host.querySelector('[data-addplan]').onclick = () => run(addPlan);
      const dp = host.querySelector('[data-dupplan]'); if (dp) dp.onclick = () => run(dupPlan, 'Plan duplicado');
      const p = cur();
      if (p) {
        const pn = host.querySelector('[data-pname]');
        pn.oninput = () => { p.name = pn.value.trim() || 'Plan'; const chip = host.querySelector(`[data-plan="${p.id}"]`); if (chip) chip.textContent = p.name; later('pn' + p.id, () => run(() => DB().update('meal_plans', p.id, { name: p.name }))); };
        host.querySelectorAll('[data-pt]').forEach(inp => inp.oninput = () => {
          const k = inp.dataset.pt, v = inp.value === '' ? null : Math.round(Number(inp.value)); p[k] = v;
          const s = host.querySelector('[data-sum]'); if (s) s.innerHTML = summary();
          later('pt' + p.id + k, () => run(() => DB().update('meal_plans', p.id, { [k]: v })));
        });
        const dl = host.querySelector('[data-delplan]');
        if (dl) dl.onclick = async () => {
          if (!(await confirmBox(`¿Borrar el plan «${p.name}» con todas sus comidas?`))) return;
          run(async () => {
            await DB().remove('meal_plans', p.id);
            const bids = new Set(st.blocks.filter(b => b.plan_id === p.id).map(b => b.id));
            const oids = new Set(st.options.filter(o => bids.has(o.block_id)).map(o => o.id));
            st.plans = st.plans.filter(x => x.id !== p.id); st.blocks = st.blocks.filter(b => !bids.has(b.id));
            st.options = st.options.filter(o => !oids.has(o.id)); st.items = st.items.filter(i => !oids.has(i.option_id));
            delete N.plan[c.id]; draw();
          }, 'Plan borrado');
        };
      }
      host.querySelector('[data-foods]').onclick = () => foodsModal(() => draw());
      host.querySelector('[data-copyplan]').onclick = () => copyPlanModal(c, async () => { await load(); draw(); });
      host.querySelectorAll('[data-b]').forEach(el => {
        const bid = el.dataset.b, b = st.blocks.find(x => x.id === bid);
        const save = patch => { Object.assign(b, patch); later('b' + bid + Object.keys(patch)[0], () => run(() => DB().update('meal_blocks', bid, patch))); };
        el.querySelector('[data-bname]').oninput = e => save({ name: e.target.value.trim() || 'Comida' });
        el.querySelector('[data-btime]').oninput = e => save({ time_hint: e.target.value.trim() || null });
        const nt = el.querySelector('[data-bnotes]'); nt.oninput = e => { save({ notes: e.target.value }); nt.style.height = 'auto'; nt.style.height = nt.scrollHeight + 'px'; };
        const up = el.querySelector('[data-up]');
        if (up) up.onclick = () => run(async () => {
          const bl = blocksOf(), i = bl.indexOf(b), prev = bl[i - 1]; const p1 = prev.position, p2 = b.position === p1 ? p1 + 1 : b.position;
          prev.position = p2; b.position = p1;
          await DB().update('meal_blocks', b.id, { position: p1 }); await DB().update('meal_blocks', prev.id, { position: p2 }); draw();
        });
        el.querySelector('[data-delblock]').onclick = async () => {
          if (!(await confirmBox(`¿Borrar la comida «${b.name}» con todas sus opciones?`))) return;
          run(async () => {
            await DB().remove('meal_blocks', bid);
            const oids = new Set(optsOf(bid).map(o => o.id));
            st.blocks = st.blocks.filter(x => x.id !== bid); st.options = st.options.filter(o => o.block_id !== bid); st.items = st.items.filter(i => !oids.has(i.option_id));
            draw();
          }, 'Comida borrada');
        };
        el.querySelectorAll('[data-opt]').forEach(btn => btn.onclick = () => { N.sel[bid] = btn.dataset.opt; draw(); });
        el.querySelector('[data-addopt]').onclick = () => run(() => addOption(bid));
        const dup = el.querySelector('[data-dupopt]'); if (dup) dup.onclick = () => run(() => addOption(bid, selOf(bid)));
        const del = el.querySelector('[data-delopt]');
        if (del) del.onclick = async () => {
          const o = selOf(bid), k = optsOf(bid).indexOf(o) + 1;
          if (!(await confirmBox(`¿Quitar la opción ${k} de «${b.name}»?`, 'Quitar'))) return;
          run(async () => { await DB().remove('meal_options', o.id); st.options = st.options.filter(x => x.id !== o.id); st.items = st.items.filter(i => i.option_id !== o.id); delete N.sel[bid]; draw(); });
        };
        el.querySelector('[data-addfood]').onclick = () => { const o = selOf(bid); if (o) foodPicker(c, o, st, () => draw()); };
        el.querySelectorAll('[data-i]').forEach(tr => {
          const it = st.items.find(i => i.id === tr.dataset.i), f = foodMap().get(it.food_id);
          const qty = tr.querySelector('[data-qty]'), unit = tr.querySelector('[data-unit]');
          const persist = () => later('i' + it.id, () => run(() => DB().update('option_items', it.id, { grams: it.grams, units: it.units })), 400);
          qty.oninput = () => {
            const v = pos(qty.value); if (!(v > 0)) return;
            if (unit.value === 'u' && f && f.unit_g > 0) { it.units = v; it.grams = r1(v * f.unit_g); } else { it.units = null; it.grams = v; }
            refreshNumbers(bid); persist();
          };
          unit.onchange = () => {
            if (unit.value === 'u' && f && f.unit_g > 0) { it.units = Math.max(0.5, Math.round(gramsOf(it, f) / f.unit_g * 2) / 2); it.grams = r1(it.units * f.unit_g); }
            else { it.grams = r1(gramsOf(it, f)); it.units = null; }
            persist(); draw();
          };
          tr.querySelector('[data-delitem]').onclick = () => run(async () => { await DB().remove('option_items', it.id); st.items = st.items.filter(i => i.id !== it.id); draw(); });
        });
      });
    }
    if (form) form.addEventListener('input', () => { const s = host.querySelector('[data-sum]'); if (s) s.innerHTML = summary(); });
    draw();
  }

  // Buscador de alimentos (se queda abierto para añadir varios seguidos)
  function foodPicker(c, option, st, after) {
    const { esc, ic, modal, toast } = U();
    const foods = (N.foods || []).filter(f => f.active !== false);
    const uniq = k => [...new Set(foods.map(f => f[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    let added = 0;
    const m = modal('Añadir alimentos', `
      <p class="muted small" data-added>Valores por 100 g. Pulsa + en cada alimento que quieras añadir.</p>
      <div class="np-filter">
        <input type="search" placeholder="Buscar alimento…" data-q autocomplete="off">
        <select data-kind><option value="">Todos los tipos</option>${['Genérico', 'Marca', 'Suplemento'].map(x => `<option>${x}</option>`).join('')}</select>
        <select data-store><option value="">Todos los súper</option>${uniq('store').map(x => `<option>${esc(x)}</option>`).join('')}</select>
        <select data-cat><option value="">Todas las categorías</option>${uniq('category').map(x => `<option>${esc(x)}</option>`).join('')}</select>
      </div>
      <div class="np-list" data-list></div>`, { wide: true });
    const box = m.querySelector('[data-list]');
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const list = () => {
      const q = norm(m.querySelector('[data-q]').value), k = m.querySelector('[data-kind]').value, s = m.querySelector('[data-store]').value, ca = m.querySelector('[data-cat]').value;
      const words = q.split(/\s+/).filter(Boolean);
      const res = foods.filter(f => (!k || f.kind === k) && (!s || f.store === s) && (!ca || f.category === ca) && words.every(w => norm(f.name + ' ' + f.store).includes(w))).slice(0, 80);
      box.innerHTML = res.length ? res.map(f => `<div class="np-food">
          <div><b>${esc(f.name)}</b><small class="muted">${esc(f.category || '')}${f.store && f.store !== 'Genérico' ? ' · ' + esc(f.store) : ''}${f.unit_g > 0 ? ` · ${esc(f.unit_name || 'unidad')} ${f1(f.unit_g)} g` : ''}</small></div>
          <span class="np-fm"><b>${r0(f.kcal)}</b> kcal · P ${f1(f.protein)} · C ${f1(f.carbs)} · G ${f1(f.fat)}</span>
          <button type="button" class="icon-btn primary sm" data-add="${f.id}" aria-label="Añadir ${esc(f.name)}">${ic('plus')}</button></div>`).join('')
        : `<p class="empty">${foods.length ? 'Nada con ese nombre. Si falta, añádelo en tu hoja de alimentos.' : 'La base de alimentos está vacía: conecta tu hoja en «Base de alimentos».'}</p>`;
      box.querySelectorAll('[data-add]').forEach(btn => btn.onclick = async () => {
        const f = foods.find(x => x.id === btn.dataset.add); btn.disabled = true;
        try {
          const posn = st.items.filter(i => i.option_id === option.id).reduce((mx, i) => Math.max(mx, i.position), -1) + 1;
          const unit = f.unit_g > 0;
          const [it] = await DB().insert('option_items', { option_id: option.id, client_id: c.id, food_id: f.id, food_name: f.name, grams: unit ? Number(f.unit_g) : 100, units: unit ? 1 : null, position: posn });
          st.items.push(it); added++;
          m.querySelector('[data-added]').textContent = `${added} ${added === 1 ? 'alimento añadido' : 'alimentos añadidos'} a esta opción. Ajusta las cantidades al cerrar.`;
          btn.innerHTML = ic('check'); after();
        } catch (e) { toast('Error: ' + e.message, 'err'); }
        finally { setTimeout(() => { btn.disabled = false; btn.innerHTML = ic('plus'); }, 900); }
      });
    };
    // el buscador solo en «input»: si también redibuja en «change» (al perder el foco) se pierde el clic en +
    m.querySelector('[data-q]').oninput = list;
    m.querySelectorAll('[data-kind],[data-store],[data-cat]').forEach(el => { el.onchange = list; });
    list();
    if (window.innerWidth > 700) m.querySelector('[data-q]').focus();
  }

  // Ajustes y vista de la base de alimentos
  async function foodsModal(after) {
    const { esc, ic, modal, toast } = U();
    const raw = (await DB().getSetting(SHEET_KEY)) || defSheet(); const id = sheetIdOf(raw);
    await loadFoods();
    const act = (N.foods || []).filter(f => f.active !== false).length;
    let last = 0; try { last = Number(localStorage.getItem('jmfit-foods-sync')) || 0; } catch (e) {}
    const m = modal('Base de alimentos', `
      <p>Tus alimentos viven en una hoja de Google que editas tú. La app la lee sola al abrir la nutrición (como mucho cada 10 min) y al pulsar <b>Sincronizar</b>. Si cambias un valor, los planes que usan ese alimento se recalculan solos.</p>
      <label>Enlace de la hoja<input name="sheet" value="${esc(id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '')}" placeholder="https://docs.google.com/spreadsheets/d/…/edit"></label>
      <p class="muted small">La hoja tiene que estar compartida como «Cualquier persona con el enlace · Lector» (solo lectura: nadie puede cambiarla salvo tú).</p>
      <div class="row gap wrap">
        <button type="button" class="btn primary small" data-sync>${ic('refresh')} Guardar y sincronizar</button>
        ${id ? `<a class="btn small" href="https://docs.google.com/spreadsheets/d/${esc(id)}/edit" target="_blank" rel="noopener">Abrir la hoja</a>` : ''}
      </div>
      <p class="muted small" data-st>${act} alimentos activos en la app${last ? ' · última sincronización ' + new Date(last).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>`);
    m.querySelector('[data-sync]').onclick = async e => {
      const v = sheetIdOf(m.querySelector('[name=sheet]').value);
      if (!v) { toast('Ese enlace no parece de una hoja de Google', 'err'); return; }
      e.target.disabled = true;
      try {
        if (v !== id) await DB().setSetting(SHEET_KEY, v);
        const r = await syncFoods();
        if (r) { m.querySelector('[data-st]').textContent = `${(N.foods || []).filter(f => f.active !== false).length} alimentos activos en la app · sincronizado ahora`; if (after) after(); }
      } finally { e.target.disabled = false; }
    };
  }

  async function copyPlanModal(c, after) {
    const { esc, modal, toast } = U();
    const clients = (await DB().list('clients', { order: ['name', 'asc'] })).filter(x => x.id !== c.id);
    const blocks = await DB().list('meal_blocks', {});
    const has = new Set(blocks.map(b => b.client_id));
    const withPlan = clients.filter(x => has.has(x.id));
    modal('Copiar plan de otro cliente', withPlan.length ? `
      <label>Copiar el plan por comidas de<select name="from">${withPlan.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
      <p class="muted small">Se copian todos sus planes (entreno, descanso…) y se sustituyen los que tenga ahora ${esc(c.name)}. Después puedes ajustar las cantidades a sus macros.</p>`
      : '<p class="empty">Ningún otro cliente tiene todavía plan por comidas.</p>', {
      submitLabel: 'Copiar plan',
      onSubmit: withPlan.length ? async (f, fd) => {
        try { const n = await DB().rpc('copy_meal_plan', { p_from: fd.get('from'), p_to: c.id }); toast(`Plan copiado (${n} comidas)`, 'ok'); await after(); }
        catch (e) { toast('Error: ' + e.message, 'err'); return false; }
      } : undefined
    });
  }

  // ------------------------------------------------------------ vista del cliente
  function clientView(d) {
    const { esc, nl2br } = U();
    const blocks = (d && d.blocks) || [];
    if (!blocks.length) return '';
    const show = d.show_macros !== false;
    const plans = (d.plans || []).filter(p => blocks.some(b => b.plan_id === p.id));
    const groups = plans.length ? plans.map(p => ({ p, bs: blocks.filter(b => b.plan_id === p.id) })) : [{ p: null, bs: blocks }];
    const loose = plans.length ? blocks.filter(b => !plans.some(p => p.id === b.plan_id)) : [];
    if (loose.length) groups[0].bs = groups[0].bs.concat(loose);
    const tot = bs => { const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 }; bs.forEach(b => { const o = (b.options || [])[0]; if (o && o.macros) for (const k in t) t[k] += Number(o.macros[k]) || 0; }); return t; };
    return `<section class="card np-client"><h3>Mis comidas</h3>
      ${groups.length > 1 ? `<div class="np-opts np-cplans">${groups.map((g, k) => `<button type="button" class="chip ${k === 0 ? 'on' : ''}" data-cplan="${k}">${esc(g.p.name)}</button>`).join('')}</div>
        <p class="muted small">Elige el plan del día: cada uno tiene sus propias calorías.</p>` : ''}
      ${groups.map((g, gk) => { const t = tot(g.bs); return `<div class="np-cg" data-cg="${gk}" ${gk ? 'hidden' : ''}>
      ${show && t.kcal ? `<p class="np-ctot"><b>${r0(t.kcal)} kcal</b> · P ${r0(t.protein)} g · C ${r0(t.carbs)} g · G ${r0(t.fat)} g <small class="muted">${groups.length > 1 ? 'este día' : 'al día'}</small></p>` : ''}
      ${g.bs.map(b => `<div class="np-cb" data-cb="${b.id}">
        <div class="row"><b>${esc(b.name)}</b>${b.time_hint ? `<small class="muted"> · ${esc(b.time_hint)}</small>` : ''}</div>
        ${b.notes ? `<p class="muted small">${nl2br(b.notes)}</p>` : ''}
        ${b.options.length > 1 ? `<div class="np-opts">${b.options.map((o, k) => `<button type="button" class="chip ${k === 0 ? 'on' : ''}" data-copt="${k}">Opción ${k + 1}</button>`).join('')}</div>` : ''}
        ${b.options.map((o, k) => `<div class="np-co" data-co="${k}" ${k ? 'hidden' : ''}>
          <ul class="np-items">${(o.items || []).map(i => `<li><span class="q">${i.units != null && i.unit ? `${f1(i.units)} ${esc(i.unit.toLowerCase())}` : `${r0(i.grams)} g`}</span> ${esc(i.food)}${i.units != null && i.unit ? ` <small class="muted">(${r0(i.grams)} g)</small>` : ''}${show && i.kcal != null ? `<small class="muted np-k">${r0(i.kcal)} kcal</small>` : ''}</li>`).join('') || '<li class="muted">Sin alimentos</li>'}</ul>
          ${show && o.macros && (o.items || []).length ? `<p class="small np-cm"><b>${r0(o.macros.kcal)} kcal</b> · P ${f1(o.macros.protein)} g · C ${f1(o.macros.carbs)} g · G ${f1(o.macros.fat)} g</p>` : ''}
        </div>`).join('')}
      </div>`).join('')}
      </div>`; }).join('')}
      <p class="muted small">Puedes elegir cualquier opción de cada comida: están pensadas para que sumen parecido.</p>
    </section>`;
  }
  function wireClient(root) {
    root.querySelectorAll('[data-cplan]').forEach(btn => btn.onclick = () => {
      root.querySelectorAll('[data-cplan]').forEach(b => b.classList.toggle('on', b === btn));
      root.querySelectorAll('[data-cg]').forEach(g => { g.hidden = g.dataset.cg !== btn.dataset.cplan; });
    });
    root.querySelectorAll('[data-cb]').forEach(cb => cb.querySelectorAll('[data-copt]').forEach(btn => btn.onclick = () => {
      cb.querySelectorAll('[data-copt]').forEach(b => b.classList.toggle('on', b === btn));
      cb.querySelectorAll('[data-co]').forEach(o => { o.hidden = o.dataset.co !== btn.dataset.copt; });
    }));
  }

  window.JMNutri = { coachEditor, clientView, wireClient, syncFoods, loadFoods, fetchSheet, sheetIdOf };
})();
