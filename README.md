# TEAM JMFIT · App de entrenamiento y nutrición

App web instalable (PWA) para el entrenador y sus clientes. Se publica en GitHub Pages
(https://teamjmfit.github.io) y guarda los datos en Supabase. Sin frameworks ni paso de compilación:
lo que hay en el repositorio es exactamente lo que se sirve.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Carga los scripts en orden |
| `config.js` | URL y clave pública de Supabase (la clave pública es segura: los permisos los pone la base de datos) |
| `exercises.js` | Catálogo de ejercicios de ejemplo (modo demo) |
| `data.js` | Capa de datos: Supabase en producción, `localStorage` en modo demo |
| `app.js` | Interfaz completa (entrenador y cliente) |
| `fix.js`, `invite.js`, `features.js` | Módulos añadidos: traducción de errores, enlaces de invitación, métricas diarias y cumplimiento |
| `styles.css` | Estilos |
| `sw.js`, `manifest.json`, `icon-*.png` | Instalación en el móvil y uso sin conexión. **Sube la versión de `CACHE` en `sw.js` en cada cambio** |
| `supabase/migrations/` | SQL de la base de datos, en orden |
| `apps-script/Codigo.gs` | Puente con la hoja de cobros de Google (el token real NO va aquí) |

## Base de datos (orden de migraciones)

1. `000_baseline.sql` · esquema base, seguridad, invitaciones y métricas diarias (ya aplicado)
2. `001_avanzado_aditivo.sql` · programas por semanas, nutrición con opciones, fotos y medidas (aplicado el 10/11/2026)
3. `002_progresion_semanal.sql` · clonado de semanas con progresión automática (pendiente)

Todas son idempotentes y solo añaden; se ejecutan en Supabase → SQL Editor.

## Cómo trabajar

- Cada cambio en una rama y una *pull request*; al unirla a `main`, GitHub Pages publica en 1–2 minutos.
- Antes de unir: abrir la app, entrar como entrenador y como cliente, y revisar la consola del navegador.
