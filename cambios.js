// TEAM JMFIT · cambios de ejercicio y perfiles de resistencia.
// · Familias: ejercicios que trabajan IGUAL (mismo patrón y músculo) con distinto material, para cuando la máquina
//   está ocupada. El orden de cada lista es el orden en que se proponen (tras los del mismo perfil).
// · Perfil de resistencia (dónde está el pico de tensión):
//     0 = Estiramiento / multiarticular pesado → principio de la sesión
//     1 = Intermedio (acampanado)                → mitad
//     2 = Acortamiento / aislamiento guiado      → final
// El entrenador puede fijar en el catálogo los cambios de un ejercicio (exercises.alternatives) y su perfil (exercises.profile).
(function () {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const PROFILES = [
    { k: 0, key: 'estiramiento', short: 'Estiramiento', label: 'Estiramiento / multiarticular', tip: 'Pico de tensión con el músculo estirado o multiarticular pesado: al principio de la sesión, con el SNC fresco.' },
    { k: 1, key: 'intermedio', short: 'Intermedio', label: 'Intermedio', tip: 'Pico de tensión a mitad de recorrido (acampanado): mitad de la sesión.' },
    { k: 2, key: 'acortamiento', short: 'Acortamiento', label: 'Acortamiento / aislamiento', tip: 'Pico de tensión con el músculo contraído o máquina guiada: final de la sesión, con fatiga acumulada.' }
  ];
  // [clave, título, músculo, perfil por defecto, prueba (nombre sin tildes), excluir, [[nombre, material, perfil?], …]]
  const F = [
    // ---------------- Pecho
    ['incl', 'Press inclinado', 'Pecho / Tríceps', 0, /inclinad/, /curl|remo|y en banco|elevacion|apertura|fly|cinta|caminar/, [
      ['Press inclinado con mancuernas', 'Mancuernas'], ['Press inclinado con barra', 'Barra'], ['Press inclinado en multipower', 'Multipower'], ['Press inclinado en máquina', 'Máquina', 1]]],
    ['decl', 'Press declinado', 'Pecho / Tríceps', 0, /declinad/, /apertura|fly|crunch|agarre cerrado/, [
      ['Press declinado con barra', 'Barra'], ['Press declinado en multipower', 'Multipower'], ['Press declinado en máquina convergente', 'Máquina', 1], ['Press declinado con mancuernas', 'Mancuernas']]],
    ['fondos', 'Fondos', 'Tríceps / Pecho', 0, /fondos|dips?\b|dip machine/, null, [
      ['Fondos en paralelas', 'Peso corporal'], ['Fondos en paralelas lastrados', 'Lastre'], ['Fondos asistidos en máquina', 'Máquina'], ['Fondos en máquina', 'Máquina', 1],
      ['Press declinado en máquina convergente', 'Máquina', 1], ['Press declinado en multipower', 'Multipower'], ['Press declinado con barra agarre cerrado', 'Barra']]],
    ['apert', 'Aperturas de pecho', 'Pecho', 1, /apertura|cruce de poleas|contractor|contracter|pec ?deck|\bfly/, /posterior|invertid|inversa/, [
      ['Aperturas con mancuernas', 'Mancuernas', 0], ['Cruce de poleas', 'Polea', 1], ['Aperturas en máquina (pec deck)', 'Máquina', 2], ['Aperturas en polea baja', 'Polea', 2]]],
    ['plano', 'Press plano', 'Pecho / Tríceps', 0, /press (de )?banca|press plano|press de pecho|chest press|flexiones|push.?up|press plano en maquina/, /cerrad|inclin|declin|militar|hombro|vertical|jalon/, [
      ['Press de banca con barra', 'Barra'], ['Press plano con mancuernas', 'Mancuernas'], ['Press plano en multipower', 'Multipower'], ['Press plano en máquina convergente', 'Máquina', 1],
      ['Press plano en máquina de discos', 'Máquina', 1], ['Press de pecho en máquina', 'Máquina', 1], ['Flexiones', 'Peso corporal', 1]]],
    // ---------------- Hombro
    ['hombro', 'Press de hombro', 'Hombro / Tríceps', 0, /press militar|press de hombro|press para hombros|arnold|press por encima|overhead press|\bohp\b/, null, [
      ['Press militar con barra', 'Barra'], ['Press militar con mancuernas sentado', 'Mancuernas'], ['Press de hombro en multipower', 'Multipower'], ['Press de hombro en máquina', 'Máquina', 1], ['Press Arnold', 'Mancuernas', 1]]],
    ['frontal', 'Elevación frontal', 'Hombro', 1, /elevacion(es)? frontal/, null, [
      ['Elevaciones frontales con mancuerna', 'Mancuerna'], ['Elevaciones frontales con disco', 'Disco'], ['Elevaciones frontales en polea baja con cuerda', 'Polea'], ['Press Arnold', 'Mancuernas']]],
    ['lat', 'Elevación lateral', 'Hombro', 1, /elevacion(es)? lateral|lateral raise/, null, [
      ['Elevaciones laterales con mancuernas', 'Mancuernas', 1], ['Elevaciones laterales en polea baja', 'Polea', 0], ['Elevación lateral inclinado con mancuerna', 'Mancuerna', 0], ['Elevaciones laterales en máquina', 'Máquina', 2]]],
    ['menton', 'Remo al mentón', 'Hombro', 1, /remo al menton|remo al cuello|remo alto|upright row/, null, [
      ['Remo al mentón con barra Z', 'Barra Z'], ['Remo al mentón con mancuernas', 'Mancuernas'], ['Remo alto en polea baja con barra recta', 'Polea']]],
    ['post', 'Hombro posterior', 'Hombro posterior', 1, /face pull|pajaro|posterior|rear delt|elevacion en y|apertura(s)? invertida|apertura(s)? inversa|pec deck invertido|contracter invertido/, null, [
      ['Pájaros con mancuernas', 'Mancuernas', 1], ['Aperturas inversas en polea alta', 'Polea', 1], ['Contracter invertido (reverse pec deck)', 'Máquina', 2], ['Face pull en polea', 'Polea', 2], ['Elevación en Y en banco inclinado', 'Mancuernas', 1]]],
    ['rotext', 'Rotación externa', 'Movilidad', 1, /rotacion (externa|interna)/, null, [
      ['Rotación externa de hombro en polea', 'Polea'], ['Rotación externa con mancuerna', 'Mancuerna'], ['Rotación externa con banda', 'Banda']]],
    // ---------------- Espalda
    ['domin', 'Dominadas', 'Espalda / Bíceps', 0, /dominada|pull.?up|chin.?up/, null, [
      ['Dominadas pronas', 'Peso corporal'], ['Dominadas con agarre neutro', 'Peso corporal'], ['Dominadas asistidas en máquina', 'Máquina', 1], ['Jalón al pecho con agarre prono', 'Polea', 1], ['Jalón vertical en máquina convergente', 'Máquina', 1]]],
    ['jalon', 'Jalón', 'Espalda / Bíceps', 1, /jalon(?! de triceps)|pull.?down|polea alta al pecho/, /triceps|brazos rectos/, [
      ['Jalón al pecho con agarre prono', 'Polea'], ['Jalón al pecho con agarre neutro', 'Polea'], ['Jalón al pecho con agarre supino', 'Polea'], ['Jalón vertical en máquina convergente', 'Máquina'],
      ['Jalón unilateral en polea alta', 'Polea'], ['Dominadas asistidas en máquina', 'Máquina'], ['Dominadas pronas', 'Peso corporal', 0]]],
    ['remou', 'Remo unilateral', 'Espalda / Bíceps', 0, /remo (con mancuerna|unilateral|a una mano)|una mano.*remo|dumbbell row/, null, [
      ['Remo con mancuerna a una mano', 'Mancuerna'], ['Remo unilateral en polea baja', 'Polea', 1], ['Remo en máquina dorsal unilateral con apoyo', 'Máquina', 1]]],
    ['remo', 'Remo', 'Espalda / Bíceps', 1, /remo|row/, /al cuello|menton|remo alto|ergometro|cardio|upright/, [
      ['Remo con barra inclinado', 'Barra', 0], ['Remo en T con apoyo al pecho', 'Máquina', 0], ['Remo en polea baja con barra recta', 'Polea'], ['Remo sentado en polea', 'Polea'],
      ['Remo en máquina de palanca con agarre neutro', 'Máquina'], ['Remo con pecho apoyado', 'Máquina']]],
    ['pull', 'Pullover', 'Espalda', 1, /pullover|pull.?over|brazos rectos|brazos rigidos/, null, [
      ['Pullover en polea alta', 'Polea', 1], ['Pullover con mancuerna en banco plano', 'Mancuerna', 0], ['Pullover en máquina de brazos rígidos', 'Máquina', 2]]],
    // ---------------- Brazos
    ['pred', 'Curl predicador', 'Bíceps', 0, /predicador|scott/, null, [
      ['Curl de bíceps predicador libre', 'Barra'], ['Curl predicador con mancuerna', 'Mancuerna'], ['Curl predicador con barra Z', 'Barra Z'],
      ['Curl predicador en polea', 'Polea'], ['Curl predicador en máquina', 'Máquina'], ['Curl de bíceps predicador unilateral', 'Mancuerna'], ['Curl de bíceps con barra', 'Barra', 1]]],
    ['mart', 'Curl martillo', 'Bíceps', 1, /martillo|hammer/, null, [
      ['Curl martillo con mancuernas', 'Mancuernas'], ['Curl martillo en polea con cuerda', 'Polea'], ['Curl martillo cruzado', 'Mancuerna'], ['Curl de bíceps con mancuernas', 'Mancuernas']]],
    ['curlinc', 'Curl inclinado', 'Bíceps', 0, /curl inclinado|curl en banco inclinado/, null, [
      ['Curl inclinado con mancuernas', 'Mancuernas'], ['Curl predicador con barra Z', 'Barra Z'], ['Curl predicador en máquina', 'Máquina'], ['Curl bayesian en polea', 'Polea']]],
    ['curlfem', 'Curl femoral', 'Isquios', 1, /femoral|isquio|leg curl|nordic|nordico/, null, [
      ['Curl femoral tumbado', 'Máquina', 1], ['Curl femoral sentado', 'Máquina', 0], ['Curl de femoral en máquina', 'Máquina', 1], ['Curl femoral con mancuerna entre los pies', 'Mancuerna', 1],
      ['Curl femoral de pie unilateral', 'Máquina', 1], ['Curl nórdico', 'Peso corporal', 0]]],
    ['curl', 'Curl de bíceps', 'Bíceps', 1, /curl|biceps/, /femoral|isquio|predicador|martillo|muneca|inclinado/, [
      ['Curl de bíceps con barra', 'Barra'], ['Curl de bíceps con barra Z', 'Barra Z'], ['Curl de bíceps con mancuernas', 'Mancuernas'], ['Curl de bíceps en polea baja con barra Z', 'Polea', 2],
      ['Curl de bíceps en máquina', 'Máquina', 2], ['Curl inclinado con mancuernas', 'Mancuernas', 0], ['Curl predicador en máquina', 'Máquina', 0]]],
    ['tricover', 'Tríceps en estiramiento', 'Tríceps', 0, /agarre cerrado|frances|tras nuca|por encima de la cabeza|overhead|kaz|rompecraneos|skull|triceps tumbado/, null, [
      ['Press francés con barra Z', 'Barra Z'], ['Extensión de tríceps tumbado con mancuernas', 'Mancuernas'], ['Extensión de tríceps por encima de la cabeza en polea', 'Polea'],
      ['Extensión de tríceps por encima de la cabeza con mancuerna', 'Mancuerna'], ['Press de banca agarre cerrado', 'Barra'], ['Kaz press', 'Barra']]],
    ['tric', 'Extensión de tríceps', 'Tríceps', 2, /triceps|push.?down|patada de tr|extension de codo/, /fondos/, [
      ['Extensión de tríceps en polea con cuerda', 'Polea'], ['Extensión de tríceps en polea', 'Polea'], ['Extensión de tríceps en polea con barra recta', 'Polea'],
      ['Extensión de tríceps unilateral en polea', 'Polea'], ['Tríceps en máquina', 'Máquina'], ['Patada de tríceps', 'Mancuerna']]],
    // ---------------- Pierna
    ['unil', 'Pierna unilateral', 'Cuádriceps / Glúteo', 0, /bulgara|zancada|split|step.?up|subida al cajon|lunge/, null, [
      ['Sentadilla búlgara', 'Mancuernas'], ['Sentadilla búlgara en multipower', 'Multipower'], ['Zancada hacia atrás con mancuernas', 'Mancuernas'], ['Zancadas inversas con barra', 'Barra'],
      ['Zancadas caminando', 'Mancuernas'], ['Step-up al cajón', 'Mancuernas', 1]]],
    ['ext', 'Extensión de cuádriceps', 'Cuádriceps', 2, /extension(es)? de (cuadriceps|rodilla)|sissy|leg extension/, null, [
      ['Extensión de cuádriceps', 'Máquina'], ['Extensión de cuádriceps en máquina de palanca', 'Máquina'], ['Extensión de rodilla', 'Máquina'], ['Extensión de cuádriceps unilateral', 'Máquina'],
      ['Sentadilla sissy', 'Soporte', 0]]],
    ['front', 'Sentadilla frontal', 'Cuádriceps / Glúteo', 0, /sentadilla frontal|front squat|goblet/, null, [
      ['Sentadilla frontal con barra', 'Barra'], ['Sentadilla frontal en multipower', 'Multipower'], ['Sentadilla goblet', 'Mancuerna', 1]]],
    ['prensa', 'Prensa', 'Cuádriceps / Glúteo', 0, /prensa|pendulo|pendulum|leg press/, /gemelo/, [
      ['Prensa de piernas', 'Máquina'], ['Prensa horizontal', 'Máquina'], ['Sentadilla péndulo', 'Máquina'], ['Sentadilla hack', 'Máquina']]],
    ['sent', 'Sentadilla', 'Cuádriceps / Glúteo', 0, /sentadilla|hack|squat/, /bulgara|sissy|gemelo/, [
      ['Sentadilla trasera', 'Barra'], ['Sentadilla en multipower', 'Multipower'], ['Sentadilla hack', 'Máquina'], ['Prensa de piernas', 'Máquina'], ['Sentadilla péndulo', 'Máquina']]],
    ['thrust', 'Hip thrust', 'Glúteo', 2, /hip thrust|puente de gluteo|glute bridge/, null, [
      ['Hip thrust con barra', 'Barra'], ['Hip thrust en máquina', 'Máquina'], ['Hip thrust en multipower', 'Multipower'], ['Puente de glúteo con barra', 'Barra'], ['Puente de glúteo unilateral', 'Peso corporal']]],
    ['kick', 'Patada de glúteo', 'Glúteo', 2, /patada de gluteo|glute kick|kickback/, null, [
      ['Patada de glúteo en polea baja', 'Polea'], ['Patada de glúteo en máquina', 'Máquina'], ['Hiperextensión 45° enfoque glúteo', 'Banco 45°', 1]]],
    ['hiper', 'Hiperextensión', 'Glúteo / Isquios', 1, /hiperextensi|pull.?through|back extension|banco romano/, null, [
      ['Hiperextensión 45°', 'Banco 45°'], ['Hiperextensión en banco romano', 'Banco'], ['Pull-through en polea', 'Polea']]],
    ['sumo', 'Peso muerto sumo / hexagonal', 'Glúteo / Isquios', 0, /sumo|hexagonal|trap bar/, null, [
      ['Peso muerto sumo con barra', 'Barra'], ['Peso muerto con barra hexagonal', 'Barra hexagonal'], ['Peso muerto rumano sumo con mancuerna', 'Mancuerna']]],
    ['bisagra', 'Peso muerto / rumano', 'Isquios / Glúteo', 0, /peso muerto|rumano|good morning|buenos dias|deadlift|rdl/, /sumo|hexagonal/, [
      ['Peso muerto rumano con barra', 'Barra'], ['Peso muerto rumano con mancuernas', 'Mancuernas'], ['Peso muerto rumano en multipower', 'Multipower'], ['Peso muerto convencional', 'Barra'], ['Good morning', 'Barra']]],
    ['aduc', 'Aductores', 'Aductores', 1, /aduccion|aductor|copenhague/, null, [
      ['Aducción en máquina', 'Máquina'], ['Aducción en polea', 'Polea'], ['Plancha Copenhague', 'Peso corporal']]],
    ['abduc', 'Abducción / glúteo medio', 'Glúteo', 2, /abduccion/, null, [
      ['Abducción de cadera en máquina', 'Máquina'], ['Abducción en polea', 'Polea'], ['Abducción con banda', 'Banda']]],
    ['gem', 'Gemelos', 'Gemelos', 1, /gemelo|talon|calf/, null, [
      ['Elevación de gemelos de pie en máquina', 'Máquina', 0], ['Elevación de gemelos sentado', 'Máquina'], ['Gemelos en prensa', 'Máquina', 0], ['Elevación de gemelos en multipower', 'Multipower', 0]]],
    // ---------------- Core
    ['rot', 'Core antirrotación', 'Core', 1, /pallof|lenador|woodchop|rotacion rusa|russian twist/, null, [
      ['Pallof press', 'Polea'], ['Leñador en polea', 'Polea'], ['Rotación rusa', 'Disco']]],
    ['antiext', 'Core antiextensión', 'Core', 1, /plancha|dead bug|rueda|ab ?wheel/, /copenhague/, [
      ['Plancha frontal', 'Peso corporal'], ['Plancha lateral', 'Peso corporal'], ['Dead bug', 'Peso corporal'], ['Rueda abdominal', 'Rueda', 0]]],
    ['flex', 'Core flexión', 'Core', 1, /crunch|encogimiento abdominal|elevacion de piernas|abdominal/, null, [
      ['Crunch en polea', 'Polea', 2], ['Crunch en máquina', 'Máquina', 2], ['Elevación de piernas colgado', 'Peso corporal'], ['Crunch en suelo', 'Peso corporal', 2]]]
  ];
  const FAMILIES = F.map(([key, title, muscle, prof, test, not, names]) => ({ key, title, muscle, prof, test, not,
    names: names.map(([name, equipment, p]) => ({ name, equipment, muscle, profile: p != null ? p : prof })) }));
  const familyOf = name => { const n = norm(name); return FAMILIES.find(f => f.test.test(n) && !(f.not && f.not.test(n))) || null; };
  const KNOWN = new Map(); FAMILIES.forEach(f => f.names.forEach(x => { if (!KNOWN.has(norm(x.name))) KNOWN.set(norm(x.name), x); }));
  const PKEY = { estiramiento: 0, intermedio: 1, acortamiento: 2 };
  const NOSTR = /movilidad|calentamiento|cardio|estiramiento$/i;
  // Perfil de un ejercicio: el que fijó el entrenador → el de la lista de su familia → el de la familia
  function profileOf(name, lib) {
    const k = norm(name), me = (lib || []).find(x => norm(x.name) === k);
    if (me && me.profile != null && PKEY[me.profile] != null) return PKEY[me.profile];
    if (me && NOSTR.test(String(me.muscle || '').split('/')[0].trim())) return null;
    const kn = KNOWN.get(k); if (kn) return kn.profile;
    const f = familyOf(name); return f ? f.prof : null;
  }

  // Cambios para un ejercicio: los que fijó el entrenador o su familia (primero los del mismo perfil).
  function altsFor(name, lib, max) {
    lib = lib || []; const k = norm(name), byName = new Map(lib.map(x => [norm(x.name), x]));
    const me = byName.get(k), deco = x => Object.assign({}, x, { profile: profileOf(x.name, lib) });
    if (me && Array.isArray(me.alternatives) && me.alternatives.length) {
      return { list: me.alternatives.map(n => deco(byName.get(norm(n)) || KNOWN.get(norm(n)) || { name: n })).filter(x => norm(x.name) !== k).slice(0, max || 12), family: familyOf(name), custom: true };
    }
    const f = familyOf(name); if (!f) return { list: [], family: null, custom: false };
    const seen = new Set();
    let out = f.names.map(x => byName.get(norm(x.name)) || x).concat(lib.filter(x => familyOf(x.name) === f))
      .filter(x => { const n = norm(x.name); if (n === k || seen.has(n)) return false; seen.add(n); return true; }).map(deco);
    const p = profileOf(name, lib);
    if (p != null) out = out.map((x, i) => ({ x, i })).sort((a, b) => (a.x.profile === p ? 0 : 1) - (b.x.profile === p ? 0 : 1) || a.i - b.i).map(o => o.x);
    return { list: out.slice(0, max || 8), family: f, custom: false, profile: p };
  }

  // Orden de la sesión: calentamiento/movilidad inicial → (músculos prioritarios) → estiramiento/multiarticular → intermedio → acortamiento
  function sessionOrder(items, lib, nameOf, prio, muscleOf) {
    nameOf = nameOf || (x => x.exercise_name); prio = prio || [];
    const pre = x => { const m = muscleOf ? muscleOf(x) : null; return m && NOSTR.test(m); };
    let lead = 0; while (lead < items.length && pre(items[lead])) lead++;
    const head = items.slice(0, lead), rest = items.slice(lead).map((x, i) => {
      const m = String((muscleOf && muscleOf(x)) || '').toLowerCase(), pk = prio.findIndex(p => p.toLowerCase() === m), pr = profileOf(nameOf(x), lib);
      return { x, i, pk: pk < 0 ? 99 : pk, pr: pre(x) ? 3 : pr == null ? 1 : pr };
    });
    rest.sort((a, b) => a.pk - b.pk || a.pr - b.pr || a.i - b.i);
    return head.concat(rest.map(o => o.x));
  }
  window.JMSwap = { FAMILIES, PROFILES, familyOf, altsFor, profileOf, sessionOrder, norm };
})();
