// TEAM JMFIT · pantalla de carga: logo + frase motivacional. Se quita sola cuando la app ya está pintada
// (mínimo ~1,1 s para que dé tiempo a leer la frase y máximo 4 s pase lo que pase).
(function () {
  const FRASES = [
    'La disciplina gana a la motivación.',
    'Un entreno más cerca de tu objetivo.',
    'Constancia > perfección.',
    'Hoy cuenta. Cada serie suma.',
    'No hace falta que sea fácil, hace falta que lo hagas.',
    'Tu único rival es quien eras ayer.',
    'Pequeños pasos, grandes cambios.',
    'Lo que haces cada día pesa más que lo que haces de vez en cuando.',
    'Entrena, come bien, descansa. Repite.',
    'El progreso no se ve en un día, se construye cada día.',
    'Hazlo por tu yo de dentro de 6 meses.',
    'Fuerte no es quien no cae, es quien vuelve.',
    'La constancia es tu mejor suplemento.',
    'Una repetición más que ayer.',
    'Sin excusas, con ganas.',
    'Confía en el proceso.',
    'Tu cuerpo escucha todo lo que haces.',
    'El mejor momento para empezar es ahora.'
  ];
  const el = document.getElementById('splash'); if (!el) return;
  const f = el.querySelector('[data-frase]'); if (f) f.textContent = FRASES[Math.floor(Math.random() * FRASES.length)];
  const t0 = Date.now(), MIN = 1100, MAX = 4000;
  let done = false;
  const hide = () => {
    if (done) return; done = true;
    el.classList.add('out'); setTimeout(() => el.remove(), 450);
  };
  const ready = () => { const app = document.getElementById('app'); return app && !app.querySelector('.splash'); };
  const check = () => { if (done) return; if (ready()) setTimeout(hide, Math.max(0, MIN - (Date.now() - t0))); else requestAnimationFrame(check); };
  requestAnimationFrame(check);
  setTimeout(hide, MAX);
  el.addEventListener('click', () => { if (ready()) hide(); });
})();
