# Historias de Instagram (1080×1920)

Plantilla para las historias semanales de la app.

1. Arranca la app en local (`python3 -m http.server 8765` en la raíz del repo).
2. `node tools/historias/capturas.js` → saca las capturas de la app (modo demo, tema oscuro) en esta carpeta.
3. Copia `logo.webp`, `coach.webp` y `coach-cara.webp` de la raíz a esta carpeta.
4. Edita `SEMANA` y `NOVEDADES` en `historias.html` con los cambios de la semana.
5. `node tools/historias/render.js tools/historias` → imágenes en `tools/historias/salida/`.

Las capturas y la carpeta `salida/` no se suben al repositorio.
