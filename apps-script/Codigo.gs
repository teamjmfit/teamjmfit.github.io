/**
 * TEAM JMFIT · Puente entre la app y tu hoja "Gestión de Cobros".
 *
 * Instalación (una sola vez):
 *  1. Abre tu hoja de cobros → Extensiones → Apps Script.
 *  2. Crea un archivo nuevo, pega TODO este código y guarda.
 *  3. Cambia TOKEN por una contraseña larga inventada (la misma que pondrás en la app).
 *  4. Implementar → Nueva implementación → Tipo: Aplicación web.
 *       Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario.
 *  5. Copia la URL que termina en /exec y pégala en la app (Cobros → Conectar hoja).
 */

const TOKEN = 'CAMBIA_ESTA_CLAVE';

const HOJA_CLIENTES = 'Base de Clientes';
const HOJA_PAGOS = 'Registro de Pagos';
const HOJA_TARIFAS = 'Tarifas Oficiales';
const FILA_INICIO_CLIENTES = 5;  // primera fila con datos
const FILA_INICIO_PAGOS = 5;
const FILA_INICIO_TARIFAS = 5;

function doGet(e) {
  return responder_({ ok: true, mensaje: 'TEAM JMFIT conectado. Usa la app para leer o registrar cobros.' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body.token || body.token !== TOKEN) return responder_({ ok: false, error: 'Clave incorrecta' });
    const accion = body.action;
    if (accion === 'resumen') return responder_({ ok: true, data: resumen_() });
    if (accion === 'registrarPago') return responder_({ ok: true, data: registrarPago_(body.pago || {}) });
    if (accion === 'altaCliente') return responder_({ ok: true, data: altaCliente_(body.cliente || {}) });
    return responder_({ ok: false, error: 'Acción desconocida: ' + accion });
  } catch (err) {
    return responder_({ ok: false, error: String(err && err.message || err) });
  }
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fecha_(v) {
  // instanceof Date falla a veces con las celdas de la hoja: se comprueba el tipo de otra forma
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === '' || v == null ? '' : String(v);
}

function resumen_() {
  const ss = SpreadsheetApp.getActive();

  // Clientes
  const hc = ss.getSheetByName(HOJA_CLIENTES);
  const nC = Math.max(0, hc.getLastRow() - FILA_INICIO_CLIENTES + 1);
  const filasC = nC ? hc.getRange(FILA_INICIO_CLIENTES, 1, nC, 17).getValues() : [];
  const clientes = filasC.filter(r => r[1] !== '').map(r => ({
    id: r[0], nombre: r[1], servicio: r[2], plan: r[3], cuota: r[6], meses: r[7],
    metodo: r[8], alta: fecha_(r[9]), ultimoPago: fecha_(r[10]), vence: fecha_(r[11]),
    dias: r[12], estado: r[13], pagadoMes: r[14], pendiente: r[15], notas: r[16]
  }));

  // Tarifas
  const ht = ss.getSheetByName(HOJA_TARIFAS);
  const nT = Math.max(0, ht.getLastRow() - FILA_INICIO_TARIFAS + 1);
  const filasT = nT ? ht.getRange(FILA_INICIO_TARIFAS, 1, nT, 4).getValues() : [];
  const tarifas = filasT.filter(r => r[0] !== '' && r[2] !== '').map(r => ({
    plan: r[0], servicio: r[1], precio: r[2], meses: r[3]
  }));

  // Últimos pagos
  const hp = ss.getSheetByName(HOJA_PAGOS);
  const nP = Math.max(0, hp.getLastRow() - FILA_INICIO_PAGOS + 1);
  const filasP = nP ? hp.getRange(FILA_INICIO_PAGOS, 1, nP, 9).getValues() : [];
  const pagos = filasP.filter(r => r[1] !== '' && r[2] !== '').map(r => ({
    id: r[0], fecha: fecha_(r[1]), cliente: r[2], servicio: r[3], plan: r[4],
    importe: r[5], metodo: r[6], vence: fecha_(r[7]), notas: r[8]
  })).slice(-40).reverse();

  return { clientes: clientes, tarifas: tarifas, pagos: pagos, actualizado: new Date().toISOString() };
}

function registrarPago_(p) {
  if (!p.cliente || !p.plan || !p.fecha) throw new Error('Faltan datos: cliente, plan y fecha son obligatorios');
  const hp = SpreadsheetApp.getActive().getSheetByName(HOJA_PAGOS);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Busca la primera fila libre (columna B "Fecha Pago" vacía) sin tocar las fórmulas
    const ultima = Math.max(hp.getLastRow(), FILA_INICIO_PAGOS);
    const fechas = hp.getRange(FILA_INICIO_PAGOS, 2, ultima - FILA_INICIO_PAGOS + 1, 1).getValues();
    let fila = -1;
    for (let i = 0; i < fechas.length; i++) {
      if (fechas[i][0] === '' && hp.getRange(FILA_INICIO_PAGOS + i, 3).getValue() === '') { fila = FILA_INICIO_PAGOS + i; break; }
    }
    if (fila === -1) fila = ultima + 1;

    const partes = String(p.fecha).split('-'); // yyyy-mm-dd
    const fecha = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));

    hp.getRange(fila, 2).setValue(fecha);            // B Fecha Pago
    hp.getRange(fila, 3).setValue(p.cliente);        // C Cliente
    hp.getRange(fila, 5).setValue(p.plan);           // E Plan Aplicado
    if (p.importe !== '' && p.importe != null) hp.getRange(fila, 6).setValue(Number(p.importe)); // F Importe
    if (p.metodo) hp.getRange(fila, 7).setValue(p.metodo);  // G Método
    if (p.notas) hp.getRange(fila, 9).setValue(p.notas);    // I Notas

    // Si la fila es nueva (sin fórmulas), copia las fórmulas de la fila anterior
    ['A', 'D', 'H', 'J'].forEach(function (col) {
      const celda = hp.getRange(col + fila);
      if (celda.getFormula() === '' && fila > FILA_INICIO_PAGOS) {
        hp.getRange(col + (fila - 1)).copyTo(celda, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      }
    });
    SpreadsheetApp.flush();
    return { fila: fila, id: hp.getRange(fila, 1).getDisplayValue() };
  } finally {
    lock.releaseLock();
  }
}

// Alta de un cliente nuevo desde la app: una fila en «Base de Clientes» con nombre, plan, precio pactado,
// método y fecha de alta. Las columnas con fórmula (ID, servicio, precios, vencimiento, estado…) se copian de la fila anterior.
function altaCliente_(c) {
  const nombre = String(c.nombre || '').trim();
  if (!nombre || !c.plan) throw new Error('Faltan datos: nombre y plan son obligatorios');
  const hc = SpreadsheetApp.getActive().getSheetByName(HOJA_CLIENTES);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ultima = Math.max(hc.getLastRow(), FILA_INICIO_CLIENTES);
    const nombres = hc.getRange(FILA_INICIO_CLIENTES, 2, ultima - FILA_INICIO_CLIENTES + 1, 1).getValues();
    if (nombres.some(function (r) { return String(r[0]).trim().toLowerCase() === nombre.toLowerCase(); })) throw new Error('Ya hay un cliente con ese nombre en la hoja');
    let fila = -1;
    for (let i = 0; i < nombres.length; i++) { if (nombres[i][0] === '') { fila = FILA_INICIO_CLIENTES + i; break; } }
    if (fila === -1) fila = ultima + 1;
    if (fila > FILA_INICIO_CLIENTES) {
      // mismo formato y desplegables que la fila de arriba, y sus fórmulas donde falten
      const arriba = hc.getRange(fila - 1, 1, 1, 17), aqui = hc.getRange(fila, 1, 1, 17);
      arriba.copyTo(aqui, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      arriba.copyTo(aqui, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      ['A', 'C', 'E', 'G', 'H', 'K', 'L', 'M', 'N', 'O'].forEach(function (col) {
        const celda = hc.getRange(col + fila);
        if (celda.getFormula() === '') hc.getRange(col + (fila - 1)).copyTo(celda, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      });
    }
    hc.getRange(fila, 2).setValue(nombre);                                                      // B Nombre
    hc.getRange(fila, 4).setValue(c.plan);                                                      // D Plan
    if (c.precio !== '' && c.precio != null) hc.getRange(fila, 6).setValue(Number(c.precio));  // F Precio pactado
    if (c.metodo) hc.getRange(fila, 9).setValue(c.metodo);                                      // I Método
    const p = String(c.alta || '').split('-');
    if (p.length === 3) hc.getRange(fila, 10).setValue(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])));  // J Alta
    if (c.notas) hc.getRange(fila, 17).setValue(c.notas);                                       // Q Notas
    SpreadsheetApp.flush();
    return { fila: fila, id: hc.getRange(fila, 1).getDisplayValue() };
  } finally {
    lock.releaseLock();
  }
}
