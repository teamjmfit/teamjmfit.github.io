/**
 * TEAM JMFIT · Copia de seguridad automática (Google Apps Script)
 *
 * Cada noche descarga todos los datos de la app y:
 *   1) actualiza la hoja «TEAM JMFIT · Copia de seguridad» de tu Drive (una pestaña por tabla), y
 *   2) guarda una copia del día (JSON) en la carpeta «TEAM JMFIT · Copias» (se conservan 90 días).
 *
 * Instalación (una vez): pega la clave de copia en CLAVE_INICIAL, ejecuta «instalar»,
 * acepta los permisos y vuelve a dejar CLAVE_INICIAL vacía. La clave queda en las propiedades
 * del script (privadas de tu cuenta). Esta copia del código en el repositorio NO lleva la clave.
 */
const SUPABASE_URL = 'https://ctbliwwthavmamcoekmr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_AR6M97UM14PnBxpAh0wh6Q_v1uBPj35';   // clave pública de la app
const CLAVE_INICIAL = '';                                                  // solo para instalar
const DIAS_A_GUARDAR = 90;
const NOMBRES = {
  clients: 'Clientes', checkins: 'Check-ins', checkin_photos: 'Fotos check-in', daily_metrics: 'Peso diario',
  nutrition_plans: 'Nutrición', meal_plans: 'Planes', meal_blocks: 'Comidas', meal_options: 'Opciones',
  option_items: 'Alimentos del plan', meal_choices: 'Elecciones', foods: 'Base de alimentos', programs: 'Programas',
  program_weeks: 'Semanas', routines: 'Rutinas', routine_items: 'Ejercicios rutina', sessions: 'Entrenos',
  set_logs: 'Series', messages: 'Mensajes', exercises: 'Ejercicios', profiles: 'Perfiles', form_responses: 'Formularios', settings: 'Ajustes'
};

// Formularios de Google: sus respuestas llegan a la app (al enviarse y cada noche)
const FORMULARIOS = [
  { id: '1t7djBhZGSXae3dP-ePu9-DnJucLqFJW4jyOTBomRvQM', form: 'plan' },    // Plan 1:1 Jmfit (respuestas)
  { id: '1IaPE6zaeBTW69IOPZTZ8W4uQHOgCJuBMMDVCHrXlmjQ', form: 'salud' }    // Datos Base y Salud (respuestas)
];

function instalar() {
  const props = PropertiesService.getScriptProperties();
  if (CLAVE_INICIAL) props.setProperty('CLAVE', CLAVE_INICIAL);
  if (!props.getProperty('CLAVE')) throw new Error('Falta la clave de copia: pégala en CLAVE_INICIAL');
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'copiaJMFIT').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('copiaJMFIT').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncFormularios').forEach(t => ScriptApp.deleteTrigger(t));
  FORMULARIOS.forEach(f => ScriptApp.newTrigger('syncFormularios').forSpreadsheet(f.id).onFormSubmit().create());
  syncFormularios();
  copiaJMFIT();
}

function syncFormularios() {
  const clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
  const tz = Session.getScriptTimeZone();
  FORMULARIOS.forEach(f => {
    const vals = SpreadsheetApp.openById(f.id).getSheets()[0].getDataRange().getValues();
    if (vals.length < 2) return;
    const head = vals[0].map(h => String(h).trim());
    const iName = head.findIndex(h => /^nombre/i.test(h)), iMail = head.findIndex(h => /correo/i.test(h));
    const txt = v => v instanceof Date ? (v.getHours() || v.getMinutes() ? Utilities.formatDate(v, tz, 'dd/MM/yyyy HH:mm') : Utilities.formatDate(v, tz, 'dd/MM/yyyy')) : String(v);
    const rows = vals.slice(1).filter(r => r[0] instanceof Date).map(r => ({
      ts: r[0].toISOString(), name: iName >= 0 ? String(r[iName]).trim() : '', email: iMail >= 0 ? String(r[iMail]).trim() : '',
      answers: head.map((h, i) => [h, txt(r[i])]).filter((x, i) => i > 0)
    }));
    const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/ingest_forms', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      payload: JSON.stringify({ p_key: clave, p_form: f.form, p_rows: rows })
    });
    if (res.getResponseCode() !== 200) throw new Error('Formularios (' + f.form + '): ' + res.getContentText().slice(0, 300));
  });
}

function copiaJMFIT() {
  try { syncFormularios(); } catch (e) { console.error(e); }
  const props = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/backup_dump', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify({ p_key: props.getProperty('CLAVE') })
  });
  if (res.getResponseCode() !== 200) throw new Error('Supabase respondió ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  const txt = res.getContentText(), data = JSON.parse(txt);
  const hoy = Utilities.formatDate(new Date(), 'Atlantic/Canary', 'yyyy-MM-dd');

  // 1) Copia del día en la carpeta
  const carpeta = obtenerCarpeta_(props);
  carpeta.createFile('copia-' + hoy + '.json', txt, MimeType.PLAIN_TEXT);
  const limite = Date.now() - DIAS_A_GUARDAR * 864e5;
  const fs = carpeta.getFiles();
  while (fs.hasNext()) { const f = fs.next(); if (/^copia-\d{4}-\d{2}-\d{2}\.json$/.test(f.getName()) && f.getDateCreated().getTime() < limite) f.setTrashed(true); }

  // 2) Hoja con los datos actuales
  const ss = obtenerHoja_(props, carpeta);
  const resumen = [['Copia de seguridad TEAM JMFIT'], ['Actualizada', Utilities.formatDate(new Date(), 'Atlantic/Canary', 'dd/MM/yyyy HH:mm')], [], ['Pestaña', 'Tabla', 'Filas']];
  Object.keys(NOMBRES).forEach(t => {
    const rows = data[t]; if (!rows) return;
    const nombre = NOMBRES[t];
    const sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    sh.clearContents();
    const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const valores = rows.length ? [cols].concat(rows.map(r => cols.map(c => celda_(r[c])))) : [['(sin datos)']];
    sh.getRange(1, 1, valores.length, valores[0].length).setValues(valores);
    if (rows.length) sh.setFrozenRows(1);
    resumen.push([nombre, t, rows.length]);
  });
  resumen.push([], ['Cada día se guarda además una copia completa en la carpeta «TEAM JMFIT · Copias» (' + DIAS_A_GUARDAR + ' días).']);
  const r = ss.getSheetByName('Resumen') || ss.insertSheet('Resumen', 0);
  r.clearContents();
  const ancho = 3; r.getRange(1, 1, resumen.length, ancho).setValues(resumen.map(x => x.concat(Array(ancho - x.length).fill('')).slice(0, ancho)));
  const vacia = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1'); if (vacia && ss.getSheets().length > 1) ss.deleteSheet(vacia);
}

function celda_(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string' && v.length > 45000) v = v.slice(0, 45000) + '…';
  return v;
}
function obtenerCarpeta_(props) {
  const id = props.getProperty('CARPETA');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const c = DriveApp.createFolder('TEAM JMFIT · Copias');
  props.setProperty('CARPETA', c.getId()); return c;
}
function obtenerHoja_(props, carpeta) {
  const id = props.getProperty('HOJA');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  const ss = SpreadsheetApp.create('TEAM JMFIT · Copia de seguridad');
  DriveApp.getFileById(ss.getId()).moveTo(carpeta);
  props.setProperty('HOJA', ss.getId()); return ss;
}
