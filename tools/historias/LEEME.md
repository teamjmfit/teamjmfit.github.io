# Historias de Instagram (1080×1920)

Plantilla para las historias semanales de la app.

1. Arranca la app en local (`python3 -m http.server 8765` en la raíz del repo).
2. `node tools/historias/capturas.js` → saca las capturas de la app (modo demo, tema oscuro) en esta carpeta.
3. Copia `logo.webp`, `coach.webp` y `coach-cara.webp` de la raíz a esta carpeta.
4. Edita `SEMANA` y `NOVEDADES` en `historias.html` con los cambios de la semana.
5. `node tools/historias/render.js tools/historias` → imágenes en `tools/historias/salida/`.

Las capturas y la carpeta `salida/` no se suben al repositorio.

## Historias «¿Te pasa esto?» (problema → solución)

- `node tools/historias/capturas-progreso.js` → capturas extra (rendimiento, marcas, peso), además de `capturas.js`.
- Copia también `icon-192.png` como `icon.png` (se usa en los avisos de la pantalla de bloqueo).
- `node tools/historias/render-problemas.js tools/historias` → `salida-problemas/`, una imagen por función con nombre (sin números).
- Para añadir una nueva: un objeto más en `S` dentro de `problemas.html` (file, hook, ans, sub, phone, chips).
