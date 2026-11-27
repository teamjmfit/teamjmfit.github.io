// TEAM JMFIT · pantalla post-entreno: felicitación, resumen y foto opcional para compartir en redes.
// La foto se compone en el móvil (canvas) y NUNCA se sube a la app: se comparte o se guarda en el dispositivo.
(function () {
  const IG = '@jorgeft_';
  const MSG = `¡Buen entreno! 🚀 Si te apetece, sácate una foto de cómo has acabado, súbela a tus redes y mencióname ${IG} (100% voluntario y sin presión). ¡A seguir sumando! 💪`;
  const LS = 'jmfit-post-nofoto';
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } } };

  // Mensajes para el final del entreno (se elige uno al azar). {g} = guerrero/guerrera, {n} = nombre
  const CHEERS = [
    '¡A seguir así, {g}! 💪', 'Eres un{a} {g}: hoy has vuelto a cumplir. 🔥', 'Gran entreno. El siguiente, más y mejor. 🚀',
    'Hoy has sumado, {n}. La constancia es tu superpoder. ⚡', '¡Entreno hecho! Cada serie te acerca a tu objetivo. 🎯',
    'Disciplina de {g}. Así se construye el cambio. 🏆', 'Lo difícil era empezar, y lo has terminado. ¡Enorme! 👏',
    'Un día más, un paso más. ¡Orgullo de equipo, {n}! 🖤💛', 'Hoy has ganado tú. Mañana, a por más. 💥',
    '¡Qué máquina! Descansa, come bien y a por el siguiente. 🍽️😴'];
  const cheer = (sex, name) => { const f = sex === 'female', first = String(name || '').split(' ')[0] || (f ? 'campeona' : 'campeón');
    return CHEERS[Math.floor(Math.random() * CHEERS.length)].replace(/\{g\}/g, f ? 'guerrera' : 'guerrero').replace(/\{a\}/g, f ? 'a' : '').replace(/\{n\}/g, first); };
  // Mejoras: ejercicios cuyo mejor 1RM estimado de hoy supera al de la última vez (sin series de aproximación ni isométricos)
  const e1 = (w, r) => (w > 0 && r > 0 ? w * (1 + Math.min(r, 12) / 30) : 0);
  function summary(w) {
    let sets = 0, vol = 0; const ups = [], det = [];
    (w.ex || []).forEach(e => {
      let best = 0, bs = null;
      (e.sets || []).forEach(s => { if (!s.done || s.tag === 'A') return; sets++; const kg = parseFloat(String(s.w).replace(',', '.')), r = parseInt(s.r, 10);
        if (kg && r && s.tag !== 'ISO') { vol += kg * r; const v = e1(kg, r); if (v > best) { best = v; bs = { w: kg, r }; } } });
      let before = 0, bp = null; (e.prev || []).forEach(p => { const v = e1(Number(p.w), Number(p.r)); if (v > before) { before = v; bp = { w: Number(p.w), r: Number(p.r) }; } });
      if (best && before && best > before * 1.005) { ups.push(e.name); det.push({ n: e.name, a: bp, b: bs, pct: (best - before) / before * 100 }); }
    });
    det.sort((a, b) => b.pct - a.pct);
    return { sets, vol: Math.round(vol), ups, det };
  }

  function compose(img, stats, withStats) {
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    // foto a pantalla completa (recorte centrado 4:5)
    const k = Math.max(W / img.width, H / img.height), dw = img.width * k, dh = img.height * k;
    g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const gr = g.createLinearGradient(0, H * 0.62, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.78)');
    g.fillStyle = gr; g.fillRect(0, H * 0.6, W, H * 0.4);
    g.fillStyle = '#d4af37'; g.font = '800 54px system-ui, -apple-system, Segoe UI, sans-serif'; g.textBaseline = 'alphabetic';
    g.fillText('TEAM JMFIT', 60, H - (withStats ? 150 : 90));
    g.fillStyle = '#fff'; g.font = '600 40px system-ui, -apple-system, Segoe UI, sans-serif';
    g.fillText(IG, 60, H - (withStats ? 95 : 40));
    if (withStats) {
      g.font = '500 34px system-ui, -apple-system, Segoe UI, sans-serif'; g.fillStyle = 'rgba(255,255,255,.88)';
      g.fillText(`${stats.sets} series · ${stats.vol.toLocaleString('es-ES')} kg${stats.ups.length ? ` · ${stats.ups.length} mejora${stats.ups.length > 1 ? 's' : ''} 🔥` : ''}`, 60, H - 40);
    }
    return new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.9));
  }

  function show(w, { onClose, sex, name } = {}) {
    const { esc, ic, toast, fmtKg } = window.JMUI;
    const st = summary(w), noFoto = false, msg = cheer(sex, name);   // la opción de foto sale siempre
    const back = document.createElement('div'); back.className = 'post-back';
    back.innerHTML = `<section class="post" role="dialog" aria-label="Entreno terminado">
      <button type="button" class="icon-btn post-x" data-close aria-label="Cerrar">✕</button>
      <div class="post-burst">🚀</div>
      <h2 class="post-cheer">${esc(msg)}</h2>
      <div class="post-tabs" role="tablist"><button type="button" class="chip on" data-ptab="res">Resumen</button><button type="button" class="chip" data-ptab="ups">🔥 Mejoras en esta sesión${st.det.length ? ` (${st.det.length})` : ''}</button></div>
      <div data-pane="ups" hidden>${st.det.length ? `<ul class="post-ul">${st.det.map(d => `<li><span class="grow"><b>${esc(d.n)}</b><small>${fmtKg(d.a.w)}×${d.a.r} → ${fmtKg(d.b.w)}×${d.b.r}</small></span><strong>+${Math.round(d.pct)}%</strong></li>`).join('')}</ul><p class="post-ups">Has superado tu última vez en ${st.det.length} ejercicio${st.det.length > 1 ? 's' : ''}. ¡Así se progresa!</p>`
        : '<p class="post-ups">Hoy has igualado tus marcas: mantener también es progresar. La próxima, a por un poquito más. 💪</p>'}</div>
      <div data-pane="res">
      <p class="post-msg">${esc(MSG)}</p>
      <div class="post-stats"><div><b>${st.sets}</b><small>series</small></div><div><b>${st.vol.toLocaleString('es-ES')}</b><small>kg movidos</small></div><div><b>${st.ups.length}</b><small>${st.ups.length === 1 ? 'mejora' : 'mejoras'}</small></div></div>
      ${st.ups.length ? `<p class="post-ups">🔥 Has superado tu última vez en ${esc(st.ups.slice(0, 3).join(', '))}${st.ups.length > 3 ? '…' : ''}</p>` : ''}
      ${noFoto ? '' : `<div class="post-photo" data-ph>
        <label class="btn block"><input type="file" accept="image/*" capture="user" hidden data-cam>📸 Hacer foto</label>
      </div>`}
      </div>
      <button type="button" class="btn primary block" data-close>Continuar</button>
    </section>`;
    document.body.appendChild(back);
    let url = null;
    const close = () => { if (url) URL.revokeObjectURL(url); back.remove(); if (onClose) onClose(); };
    back.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
    back.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => { back.querySelectorAll('[data-ptab]').forEach(x => x.classList.toggle('on', x === b)); back.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.ptab; }); });
    const cam = back.querySelector('[data-cam]');
    if (cam) cam.onchange = () => {
      const f = cam.files && cam.files[0]; if (!f) return;
      const img = new Image(), src = URL.createObjectURL(f);
      img.onload = async () => {
        URL.revokeObjectURL(src);
        const ph = back.querySelector('[data-ph]');
        const render = async withStats => {
          const blob = await compose(img, st, withStats); if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob);
          ph.querySelector('img').src = url; ph._blob = blob;
        };
        ph.innerHTML = `<img alt="Tu foto del entreno"><label class="row gap small"><input type="checkbox" data-stats> Añadir los datos del entreno</label>
          <div class="row gap"><button type="button" class="btn primary grow" data-share>${ic('send')} Compartir</button><a class="btn grow" data-save download="entreno-teamjmfit.jpg">Guardar</a></div>
          <p class="muted small">Menciona a ${IG} si te apetece. La foto no se sube a la app.</p>`;
        await render(false);
        ph.querySelector('[data-stats]').onchange = e => render(e.target.checked);
        const sv = ph.querySelector('[data-save]'); sv.onclick = () => { sv.href = url; };
        ph.querySelector('[data-share]').onclick = async () => {
          const file = new File([ph._blob], 'entreno-teamjmfit.jpg', { type: 'image/jpeg' }), text = `${IG} 💪`;
          try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text });
            else { sv.href = url; sv.click(); if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); toast(`Foto guardada. Súbela y menciona a ${IG}`, 'ok'); }
          } catch (e) { if (e && e.name !== 'AbortError') toast('No se pudo compartir; usa «Guardar»', 'err'); }
        };
      };
      img.onerror = () => toast('No se pudo leer la foto', 'err');
      img.src = src;
    };
  }
  window.JMPost = { show, summary, MSG, CHEERS };
})();
