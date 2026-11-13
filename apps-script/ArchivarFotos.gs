/**
 * TEAM JMFIT · Archiva en tu Google Drive las fotos de los check-ins con más de 3 meses
 * y las borra de Supabase (así la app no se llena). En la app siguen enlazadas: ves «En Drive».
 *
 * Instalación (una sola vez, con tu cuenta de Google):
 *  1. Entra en https://script.google.com → Nuevo proyecto. Llámalo «JMFIT fotos».
 *  2. Pega TODO este código en Código.gs y guarda.
 *  3. Configuración del proyecto (rueda dentada) → Propiedades del script → añade:
 *       SUPABASE_URL          https://ctbliwwthavmamcoekmr.supabase.co
 *       SUPABASE_SERVICE_KEY  (Supabase → Project Settings → API Keys → secret / service_role)
 *       CARPETA_ID            1KQeSA3ane8aGr3EL2iFq1lTwVMOxEgjo   (la carpeta «fotos asesoria»)
 *     La clave secreta va SOLO aquí, nunca en la app ni en GitHub.
 *  4. Elige la función «probar» → Ejecutar → acepta los permisos. Te dice cuántas fotos se archivarían.
 *  5. Elige «instalar» → Ejecutar: se archivará solo cada noche (sobre las 3:00).
 *     Si quieres hacerlo ya, ejecuta «archivar».
 */

const MESES = 3;          // antigüedad a partir de la que se archiva
const POR_TANDA = 120;    // fotos por ejecución (el script tiene 6 minutos)
const POSE = { front: 'frente', side: 'lateral', back: 'espalda' };

function cfg_() {
  const p = PropertiesService.getScriptProperties();
  const c = { url: (p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, ''), key: (p.getProperty('SUPABASE_SERVICE_KEY') || '').replace(/[^\x21-\x7e]/g, ''),   // quita espacios o saltos pegados sin querer
    root: p.getProperty('CARPETA_ID') };
  if (!c.url || !c.key || !c.root) throw new Error('Faltan propiedades del script: SUPABASE_URL, SUPABASE_SERVICE_KEY y CARPETA_ID');
  return c;
}
function api_(c, method, path, body, raw) {
  // Las claves nuevas (sb_secret_…) van solo en «apikey»; las antiguas (JWT service_role) también como Bearer
  const headers = { apikey: c.key }; if (/^eyJ/.test(c.key)) headers.Authorization = 'Bearer ' + c.key;
  const opt = { method, muteHttpExceptions: true, headers };
  if (body !== undefined) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  if (method === 'patch') opt.headers.Prefer = 'return=minimal';
  const r = UrlFetchApp.fetch(c.url + path, opt), code = r.getResponseCode();
  if (code >= 300) throw new Error(method.toUpperCase() + ' ' + path.split('?')[0] + ' → ' + code + ' ' + r.getContentText().slice(0, 200));
  return raw ? r : (r.getContentText() ? JSON.parse(r.getContentText()) : null);
}
function pendientes_(c, n) {
  const cutoff = new Date(Date.now() - MESES * 30.5 * 864e5).toISOString();
  return api_(c, 'get', '/rest/v1/checkin_photos?select=id,path,pose,client_id,created_at,checkins(date),clients(name)'
    + '&archived_at=is.null&created_at=lt.' + encodeURIComponent(cutoff) + '&order=created_at.asc&limit=' + n);
}
const norm_ = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Carpeta del cliente dentro de «fotos asesoria»: la que ya tiene su nombre (o empieza por él) o una nueva. Se recuerda.
function carpeta_(c, clientId, nombre) {
  const p = PropertiesService.getScriptProperties(), k = 'carpeta_' + clientId, id = p.getProperty(k);
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* se busca de nuevo */ } }
  const root = DriveApp.getFolderById(c.root), want = norm_(nombre), it = root.getFolders();
  let hit = null;
  while (it.hasNext()) { const f = it.next(), n = norm_(f.getName()); if (n === want) { hit = f; break; } if (!hit && want && (n.indexOf(want) === 0 || want.indexOf(n) === 0)) hit = f; }
  hit = hit || root.createFolder(nombre || 'Sin nombre');
  p.setProperty(k, hit.getId());
  return hit;
}

function archivar() {
  const c = cfg_(), t0 = Date.now(), rows = pendientes_(c, POR_TANDA);
  let ok = 0; const fallos = [];
  for (const r of rows) {
    if (Date.now() - t0 > 5 * 60 * 1000) break;   // margen antes del límite de 6 min
    try {
      const nombre = (r.clients && r.clients.name) || 'Sin nombre';
      const fecha = String((r.checkins && r.checkins.date) || r.created_at).slice(0, 10);
      const blob = api_(c, 'get', '/storage/v1/object/checkins/' + r.path.split('/').map(encodeURIComponent).join('/'), undefined, true).getBlob()
        .setName(fecha + '_' + (POSE[r.pose] || r.pose) + '.jpg');
      const file = carpeta_(c, r.client_id, nombre).createFile(blob);
      api_(c, 'patch', '/rest/v1/checkin_photos?id=eq.' + r.id, { drive_file_id: file.getId(), archived_at: new Date().toISOString() });
      api_(c, 'delete', '/storage/v1/object/checkins', { prefixes: [r.path] });
      ok++;
    } catch (e) { fallos.push(r.id + ': ' + e.message); }
  }
  console.log('Archivadas ' + ok + ' de ' + rows.length + (fallos.length ? ' · fallos: ' + fallos.join(' | ') : ''));
  return ok;
}

function probar() {
  const c = cfg_(), rows = pendientes_(c, 1000);
  DriveApp.getFolderById(c.root);   // comprueba que la carpeta existe y tienes acceso
  const porCliente = {};
  rows.forEach(r => { const n = (r.clients && r.clients.name) || 'Sin nombre'; porCliente[n] = (porCliente[n] || 0) + 1; });
  console.log('Conexión correcta. Se archivarían ' + rows.length + ' fotos con más de ' + MESES + ' meses: ' + JSON.stringify(porCliente));
}

function instalar() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'archivar').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('archivar').timeBased().everyDays(1).atHour(3).create();
  console.log('Listo: se archivará cada noche sobre las 3:00.');
}
