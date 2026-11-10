// TEAM JMFIT · traduce el aviso de registro no autorizado
new MutationObserver(function (ms) {
  ms.forEach(function (m) {
    m.addedNodes.forEach(function (n) {
      if (n.classList && n.classList.contains('toast') && /NOT_INVITED|saving new user/i.test(n.textContent)) {
        n.textContent = 'Este correo no está autorizado. Pide a tu entrenador que te dé de alta con este correo.';
      }
    });
  });
}).observe(document.body, { childList: true });
