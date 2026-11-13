// TEAM JMFIT · pantalla post-entreno: felicitación, resumen y foto opcional para compartir en redes.
// La foto se compone en el móvil (canvas) y NUNCA se sube a la app: se comparte o se guarda en el dispositivo.
(function () {
  const IG = '@jorgeft_';
  const MSG = `¡Buen entreno! 🚀 Si te apetece, sácate una foto de cómo has acabado, súbela a tus redes y mencióname ${IG} (100% voluntario y sin presión). ¡A seguir sumando! 💪`;
  const LS = 'jmfit-post-nofoto';
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } } };

  // Mejoras: ejercicios cuyo mejor 1RM estimado de hoy supera al de la última vez
  const e1 = (w, r) => (w > 0 && r > 0 ? w * (1 + Math.min(r, 12) / 30) : 0);
  function summary(w) {
    let sets = 0, vol = 0; const ups = [];
    (w.ex || []).forEach(e => {
      let best = 0;
      (e.sets || []).forEach(s => { if (!s.done) return; sets++; const kg = parseFloat(String(s.w).replace(',', '.')), r = parseInt(s.r, 10); if (kg && r) { vol += kg * r; best = Math.max(best, e1(kg, r)); } });
      const before = Math.max(0, ...(e.prev || []).map(p => e1(Number(p.w), Number(p.r))));
      if (best && before && best > before * 1.005) ups.push(e.name);
    });
    return { sets, vol: Math.round(vol), ups };
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

  function show(w, { onClose } = {}) {
    const { esc, ic, toast } = window.JMUI;
    const st = summary(w), noFoto = ls.get(LS) === '1';
    const back = document.createElement('div'); back.className = 'post-back';
    back.innerHTML = `<section class="post" role="dialog" aria-label="Entreno terminado">
      <button type="button" class="icon-btn post-x" data-close aria-label="Cerrar">✕</button>
      <div class="post-burst">🚀</div>
      <p class="post-msg">${esc(MSG)}</p>
      <div class="post-stats"><div><b>${st.sets}</b><small>series</small></div><div><b>${st.vol.toLocaleString('es-ES')}</b><small>kg movidos</small></div><div><b>${st.ups.length}</b><small>${st.ups.length === 1 ? 'mejora' : 'mejoras'}</small></div></div>
      ${st.ups.length ? `<p class="post-ups">🔥 Has superado tu última vez en ${esc(st.ups.slice(0, 3).join(', '))}${st.ups.length > 3 ? '…' : ''}</p>` : ''}
      ${noFoto ? '' : `<div class="post-photo" data-ph>
        <label class="btn block"><input type="file" accept="image/*" capture="user" hidden data-cam>📸 Hacer foto</label>
      </div>`}
      <button type="button" class="btn primary block" data-close>Continuar</button>
      ${noFoto ? '<button type="button" class="link small" data-fotoon>Volver a mostrar la opción de foto</button>' : '<button type="button" class="link small" data-fotooff>No volver a mostrar la foto</button>'}
    </section>`;
    document.body.appendChild(back);
    let url = null;
    const close = () => { if (url) URL.revokeObjectURL(url); back.remove(); if (onClose) onClose(); };
    back.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
    const off = back.querySelector('[data-fotooff]'); if (off) off.onclick = () => { ls.set(LS, '1'); const p = back.querySelector('[data-ph]'); if (p) p.remove(); off.remove(); toast('Vale, ya no te lo propongo', 'ok'); };
    const on = back.querySelector('[data-fotoon]'); if (on) on.onclick = () => { ls.set(LS, '0'); toast('La próxima vez tendrás la opción de foto', 'ok'); on.remove(); };
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
  window.JMPost = { show, summary, MSG };
})();
