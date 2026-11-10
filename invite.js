/* TEAM JMFIT · Registro por enlace de invitación
   - Cliente: si entra con ?invite=CODIGO, se le muestra el aviso y crea su cuenta sin alta manual.
   - Entrenador: botón "Enlace de invitación" en Clientes para copiar, enviar y crear enlaces. */
(function () {
  'use strict';
  var cfg = window.JMFIT_CONFIG || {};
  if (!cfg.SUPABASE_URL || !window.supabase) return;
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var KEY = 'jmfit-invite';
  var base = location.origin + location.pathname;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var urlCode = new URLSearchParams(location.search).get('invite');
  if (urlCode) { try { sessionStorage.setItem(KEY, urlCode); } catch (e) {} history.replaceState(null, '', base + location.hash); }
  function getCode() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }

  function patchSignUp() {
    if (!window.DB || window.DB.__invite) return;
    var orig = window.DB.signUp.bind(window.DB);
    window.DB.signUp = async function (email, password, name) {
      var c = getCode();
      if (!c) return orig(email, password, name);
      var r = await sb.auth.signUp({ email: email, password: password, options: { data: { name: name, invite: c }, emailRedirectTo: base } });
      if (r.error) throw new Error(r.error.message);
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      if (r.data.session) location.reload();
      return { needsConfirm: !r.data.session };
    };
    window.DB.__invite = true;
  }

  function toast(msg, kind) {
    var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2600);
  }

  async function openInvites() {
    var back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = '<div class="modal wide"><header><h2>Enlaces de invitación</h2><button type="button" class="icon-btn" data-x aria-label="Cerrar">✕</button></header><div class="modal-body" data-b><div class="loading"><span></span><span></span><span></span></div></div></div>';
    document.body.appendChild(back); document.body.classList.add('noscroll');
    var close = function () { back.remove(); document.body.classList.remove('noscroll'); };
    back.addEventListener('click', function (e) { if (e.target === back || e.target.closest('[data-x]')) close(); });
    var box = back.querySelector('[data-b]');
    async function load() {
      var r = await sb.from('invites').select('*').order('created_at', { ascending: false });
      if (r.error) { box.innerHTML = '<p class="empty">No se pudieron cargar: ' + esc(r.error.message) + '</p>'; return; }
      var now = new Date();
      box.innerHTML = '<p class="muted small">Quien se registre con un enlace válido tendrá su ficha de cliente creada sola. Tú solo le asignas rutinas y nutrición. Desactiva un enlace si se ha compartido de más.</p>' +
        (r.data.map(function (i) {
          var link = base + '?invite=' + i.code;
          var expired = i.expires_at && new Date(i.expires_at) < now, full = i.max_uses != null && i.uses >= i.max_uses;
          var ok = i.active && !expired && !full;
          var msg = '¡Hola! Te doy acceso a la app de TEAM JMFIT 💪\n\n1. Entra aquí: ' + link + '\n2. Crea tu cuenta con tu correo y confírmalo.\n3. En el móvil, añádela a la pantalla de inicio.\n\nAhí verás tus entrenos, tu nutrición y podrás enviarme tus check-ins.';
          return '<section class="card" style="margin:0"><header class="row gap" style="margin-bottom:8px"><b class="grow">' + esc(i.label || 'Enlace') + '</b><span class="pill ' + (ok ? 'green' : 'red') + '">' + (ok ? 'Activo' : !i.active ? 'Desactivado' : expired ? 'Caducado' : 'Sin usos') + '</span></header>' +
            '<p class="small muted">' + i.uses + (i.max_uses != null ? ' de ' + i.max_uses : '') + ' altas · ' + (i.expires_at ? 'caduca el ' + new Date(i.expires_at).toLocaleDateString('es-ES') : 'sin caducidad') + '</p>' +
            '<input readonly value="' + esc(link) + '" onclick="this.select()" style="margin:6px 0 10px">' +
            '<div class="row gap wrap"><button type="button" class="btn small" data-copy="' + esc(link) + '">Copiar enlace</button>' +
            '<a class="btn small primary" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(msg) + '">Enviar por WhatsApp</a>' +
            '<button type="button" class="btn small ghost" data-toggle="' + esc(i.code) + '" data-on="' + (i.active ? '1' : '0') + '">' + (i.active ? 'Desactivar' : 'Activar') + '</button></div></section>';
        }).join('') || '<p class="empty">Aún no hay enlaces.</p>') +
        '<form class="card" data-new style="margin:0"><h4 style="margin-top:0">Crear enlace nuevo</h4><div class="form-grid three">' +
        '<label>Nombre<input name="label" placeholder="Ej: Instagram noviembre"></label>' +
        '<label>Altas máximas<input name="max" type="number" min="1" value="10"></label>' +
        '<label>Caduca en (días)<input name="days" type="number" min="1" value="30"></label></div>' +
        '<button class="btn primary" style="margin-top:12px">Crear enlace</button></form>';
      box.querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = function () { navigator.clipboard.writeText(b.dataset.copy).then(function () { toast('Enlace copiado', 'ok'); }); }; });
      box.querySelectorAll('[data-toggle]').forEach(function (b) {
        b.onclick = async function () {
          var r2 = await sb.from('invites').update({ active: b.dataset.on !== '1' }).eq('code', b.dataset.toggle);
          if (r2.error) toast('Error: ' + r2.error.message, 'err'); else load();
        };
      });
      box.querySelector('[data-new]').onsubmit = async function (e) {
        e.preventDefault();
        var f = e.target, days = parseInt(f.days.value, 10), max = parseInt(f.max.value, 10);
        var row = { label: f.label.value.trim() || 'Enlace', max_uses: isNaN(max) ? null : max, expires_at: isNaN(days) ? null : new Date(Date.now() + days * 864e5).toISOString() };
        var r3 = await sb.from('invites').insert(row);
        if (r3.error) toast('Error: ' + r3.error.message, 'err'); else { toast('Enlace creado', 'ok'); load(); }
      };
    }
    load();
  }

  var switched = false;
  function enhance() {
    patchSignUp();
    var card = document.querySelector('.login-card');
    if (card && getCode() && !card.querySelector('[data-invite-banner]')) {
      var n = document.createElement('p'); n.setAttribute('data-invite-banner', '');
      n.className = 'note'; n.textContent = 'Te han invitado a TEAM JMFIT. Crea tu cuenta con tu correo para empezar.';
      var brand = card.querySelector('.brand'); brand ? brand.after(n) : card.prepend(n);
      if (!switched) { var up = card.querySelector('[data-mode="up"]'); if (up && !up.classList.contains('on')) { switched = true; up.click(); } }
    }
    if (document.body.dataset.role === 'coach' && /^#\/clientes\/?$/.test(location.hash)) {
      var top = document.querySelector('.top');
      if (top && !top.querySelector('[data-invbtn]')) {
        var b = document.createElement('button'); b.className = 'btn ghost'; b.setAttribute('data-invbtn', '');
        b.textContent = 'Enlace de invitación';
        b.onclick = openInvites;
        var grow = top.querySelector('.grow'); grow ? grow.after(b) : top.appendChild(b);
      }
    }
  }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        if (n.classList && n.classList.contains('toast')) {
          if (/NOT_INVITED/.test(n.textContent)) n.textContent = 'Este correo no está autorizado. Pide a tu entrenador un enlace de invitación.';
          else if (/PAUSED/.test(n.textContent)) n.textContent = 'Tu acceso está en pausa. Habla con tu entrenador para reactivarlo.';
        }
      });
    });
    enhance();
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', enhance);
  enhance();
})();
