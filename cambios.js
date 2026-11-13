// TEAM JMFIT · cambios de ejercicio en el entreno («Cambiar»).
// Cada familia agrupa ejercicios que trabajan IGUAL (mismo movimiento y músculo) con distinto material,
// para cuando la máquina está ocupada. El orden de `names` es el orden en que se proponen.
// El entrenador puede fijar los cambios de un ejercicio concreto en el catálogo (exercises.alternatives):
// si los fija, se usan esos y no los de la familia.
(function () {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  // [clave, título, músculo, prueba (sobre el nombre sin tildes), excluir, [[nombre, material], …]]
  const F = [
    ['pred', 'Curl predicador', 'Bíceps', /predicador|scott/, null, [
      ['Curl de bíceps predicador libre', 'Barra'], ['Curl predicador con mancuerna', 'Mancuerna'], ['Curl predicador con barra Z', 'Barra Z'],
      ['Curl predicador en polea', 'Polea'], ['Curl predicador en máquina', 'Máquina'], ['Curl de bíceps predicador unilateral', 'Mancuerna'], ['Curl de bíceps con barra', 'Barra']]],
    ['mart', 'Curl martillo', 'Bíceps', /martillo|hammer/, null, [
      ['Curl martillo con mancuernas', 'Mancuernas'], ['Curl martillo en polea con cuerda', 'Polea'], ['Curl martillo cruzado', 'Mancuerna'], ['Curl de bíceps con mancuernas', 'Mancuernas']]],
    ['curlfem', 'Curl femoral', 'Isquios', /femoral|nordic|nordico|isquio/, null, [
      ['Curl femoral tumbado', 'Máquina'], ['Curl femoral sentado', 'Máquina'], ['Curl de femoral en máquina', 'Máquina'], ['Curl femoral de pie unilateral', 'Máquina'], ['Curl nórdico', 'Peso corporal']]],
    ['curl', 'Curl de bíceps', 'Bíceps', /curl|biceps/, /femoral|predicador|martillo|muneca/, [
      ['Curl de bíceps con barra', 'Barra'], ['Curl de bíceps con mancuernas', 'Mancuernas'], ['Curl de bíceps en polea', 'Polea'], ['Curl de bíceps en máquina', 'Máquina'],
      ['Curl inclinado con mancuernas', 'Mancuernas'], ['Curl predicador en máquina', 'Máquina']]],
    ['incl', 'Press inclinado', 'Pecho / Tríceps', /inclinad/, /curl|remo|y en banco|elevacion|apertura|fly|cinta|caminar/, [
      ['Press inclinado con mancuernas', 'Mancuernas'], ['Press inclinado con barra', 'Barra'], ['Press inclinado en multipower', 'Multipower'], ['Press inclinado en máquina', 'Máquina']]],
    ['decl', 'Press declinado', 'Pecho / Tríceps', /declinad/, /apertura|fly|crunch/, [
      ['Press declinado con barra', 'Barra'], ['Press declinado con mancuernas', 'Mancuernas'], ['Press declinado en máquina', 'Máquina']]],
    ['fondos', 'Fondos', 'Tríceps / Pecho', /fondos|dips?\b/, null, [
      ['Fondos en paralelas', 'Peso corporal'], ['Fondos asistidos en máquina', 'Máquina'], ['Fondos en máquina', 'Máquina'], ['Fondos en banco', 'Peso corporal']]],
    ['apert', 'Aperturas de pecho', 'Pecho', /apertura|cruce de poleas|contractor|pec ?deck|\bfly/, /posterior|invertid/, [
      ['Aperturas con mancuernas', 'Mancuernas'], ['Aperturas en máquina', 'Máquina'], ['Cruce de poleas', 'Polea'], ['Aperturas en polea baja', 'Polea']]],
    ['plano', 'Press plano', 'Pecho / Tríceps', /press (de )?banca|press plano|press de pecho|chest press|flexiones|push.?up/, /cerrad|inclin|declin|militar|hombro/, [
      ['Press de banca con barra', 'Barra'], ['Press plano con mancuernas', 'Mancuernas'], ['Press plano en multipower', 'Multipower'], ['Flexiones', 'Peso corporal'],
      ['Press plano en máquina de discos', 'Máquina'], ['Press de pecho en máquina', 'Máquina']]],
    ['hombro', 'Press de hombro', 'Hombro / Tríceps', /press militar|press de hombro|arnold|press por encima|overhead press/, null, [
      ['Press de hombro con mancuernas', 'Mancuernas'], ['Press militar con barra', 'Barra'], ['Press de hombro en multipower', 'Multipower'], ['Press de hombro en máquina', 'Máquina'], ['Press Arnold', 'Mancuernas']]],
    ['lat', 'Elevación lateral', 'Hombro', /elevacion(es)? lateral|lateral raise/, null, [
      ['Elevaciones laterales con mancuernas', 'Mancuernas'], ['Elevación lateral en polea', 'Polea'], ['Elevación lateral en máquina', 'Máquina'], ['Elevación lateral inclinado con mancuerna', 'Mancuerna']]],
    ['post', 'Hombro posterior', 'Hombro posterior', /face pull|pajaro|posterior|rear delt|elevacion en y|apertura invertida|pec deck invertido/, null, [
      ['Pájaros con mancuernas', 'Mancuernas'], ['Face pull en polea', 'Polea'], ['Deltoides posterior en máquina', 'Máquina'], ['Pájaros en polea', 'Polea'], ['Elevación en Y en banco inclinado', 'Mancuernas']]],
    ['rotext', 'Rotación externa', 'Movilidad', /rotacion (externa|interna)/, null, [
      ['Rotación externa de hombro en polea', 'Polea'], ['Rotación externa con mancuerna', 'Mancuerna'], ['Rotación externa con banda', 'Banda']]],
    ['domin', 'Dominadas', 'Espalda / Bíceps', /dominada|pull.?up|chin.?up/, null, [
      ['Dominadas', 'Peso corporal'], ['Dominadas asistidas en máquina', 'Máquina'], ['Dominadas con banda', 'Banda'], ['Jalón al pecho con agarre prono', 'Polea']]],
    ['jalon', 'Jalón', 'Espalda / Bíceps', /jalon(?! de triceps)|pull.?down|polea alta al pecho/, /triceps|brazos rectos/, [
      ['Jalón al pecho con agarre prono', 'Polea'], ['Jalón al pecho con agarre neutro', 'Polea'], ['Jalón al pecho con agarre supino', 'Polea'], ['Jalón en máquina', 'Máquina'],
      ['Jalón unilateral en polea', 'Polea'], ['Dominadas asistidas en máquina', 'Máquina']]],
    ['remo', 'Remo', 'Espalda / Bíceps', /remo|row/, /al cuello|menton|ergometro|cardio/, [
      ['Remo sentado en polea', 'Polea'], ['Remo en máquina de palanca con agarre neutro', 'Máquina'], ['Remo con pecho apoyado', 'Máquina'], ['Remo con mancuerna a una mano', 'Mancuerna'],
      ['Remo con barra', 'Barra'], ['Remo en T', 'Barra']]],
    ['pull', 'Pullover', 'Espalda', /pullover|pull.?over|brazos rectos/, null, [
      ['Pullover en polea', 'Polea'], ['Pullover con mancuerna', 'Mancuerna'], ['Pullover en máquina', 'Máquina']]],
    ['tricover', 'Tríceps por encima de la cabeza', 'Tríceps', /agarre cerrado|frances|tras nuca|por encima de la cabeza|overhead|kaz|rompecraneos|skull/, null, [
      ['Press francés con barra Z', 'Barra Z'], ['Extensión de tríceps por encima de la cabeza en polea', 'Polea'], ['Extensión de tríceps por encima de la cabeza con mancuerna', 'Mancuerna'],
      ['Kaz press', 'Barra'], ['Press de banca agarre cerrado', 'Barra']]],
    ['tric', 'Extensión de tríceps', 'Tríceps', /triceps|push.?down|patada de tr|extension de codo/, /fondos/, [
      ['Extensión de tríceps en polea', 'Polea'], ['Extensión de tríceps con cuerda', 'Polea'], ['Tríceps en máquina', 'Máquina'], ['Extensión de tríceps unilateral en polea', 'Polea'], ['Patada de tríceps', 'Mancuerna']]],
    ['unil', 'Pierna unilateral', 'Cuádriceps / Glúteo', /bulgara|zancada|split|step.?up|subida al cajon|lunge/, null, [
      ['Sentadilla búlgara', 'Mancuernas'], ['Sentadilla búlgara en multipower', 'Multipower'], ['Zancada hacia atrás con mancuernas', 'Mancuernas'], ['Zancadas caminando', 'Mancuernas'], ['Step-up al cajón', 'Mancuernas']]],
    ['ext', 'Extensión de cuádriceps', 'Cuádriceps', /extension de (cuadriceps|rodilla)|sissy|leg extension/, null, [
      ['Extensión de cuádriceps', 'Máquina'], ['Extensión de cuádriceps en máquina de palanca', 'Máquina'], ['Extensión de rodilla', 'Máquina'], ['Extensión de cuádriceps unilateral', 'Máquina']]],
    ['sent', 'Sentadilla / prensa', 'Cuádriceps / Glúteo', /sentadilla|hack|prensa|pendulo|leg press|squat/, /bulgara|goblet sumo|gemelo/, [
      ['Sentadilla trasera', 'Barra'], ['Sentadilla en multipower', 'Multipower'], ['Sentadilla hack', 'Máquina'], ['Prensa de piernas', 'Máquina'], ['Sentadilla péndulo', 'Máquina'], ['Sentadilla goblet', 'Mancuerna']]],
    ['thrust', 'Hip thrust', 'Glúteo', /hip thrust|puente de gluteo|glute bridge/, null, [
      ['Hip thrust con barra', 'Barra'], ['Hip thrust en máquina', 'Máquina'], ['Hip thrust en multipower', 'Multipower'], ['Puente de glúteo con barra', 'Barra'], ['Puente de glúteo unilateral', 'Peso corporal']]],
    ['hiper', 'Hiperextensión', 'Glúteo / Isquios', /hiperextensi|pull.?through|back extension|banco romano/, null, [
      ['Hiperextensión 45°', 'Banco 45°'], ['Hiperextensión en banco romano', 'Banco'], ['Pull-through en polea', 'Polea']]],
    ['bisagra', 'Peso muerto / rumano', 'Isquios / Glúteo', /peso muerto|rumano|good morning|buenos dias|deadlift|rdl/, null, [
      ['Peso muerto rumano con barra', 'Barra'], ['Peso muerto rumano con mancuernas', 'Mancuernas'], ['Peso muerto rumano en multipower', 'Multipower'], ['Peso muerto convencional', 'Barra'], ['Good morning', 'Barra']]],
    ['aduc', 'Aductores', 'Aductores', /aduccion|aductor|copenhague/, null, [
      ['Aducción en máquina', 'Máquina'], ['Aducción en polea', 'Polea'], ['Plancha Copenhague', 'Peso corporal']]],
    ['abduc', 'Abducción / glúteo medio', 'Glúteo', /abduccion|patada de gluteo|glute kick|kickback/, null, [
      ['Abducción de cadera en máquina', 'Máquina'], ['Abducción en polea', 'Polea'], ['Patada de glúteo en polea', 'Polea'], ['Abducción con banda', 'Banda']]],
    ['gem', 'Gemelos', 'Gemelos', /gemelo|talon|calf/, null, [
      ['Elevación de gemelos de pie en máquina', 'Máquina'], ['Elevación de gemelos sentado', 'Máquina'], ['Gemelos en prensa', 'Máquina'], ['Elevación de gemelos en multipower', 'Multipower']]],
    ['rot', 'Core antirrotación', 'Core', /pallof|lenador|woodchop|rotacion rusa|russian twist/, null, [
      ['Pallof press', 'Polea'], ['Leñador en polea', 'Polea'], ['Rotación rusa', 'Disco']]],
    ['antiext', 'Core antiextensión', 'Core', /plancha|dead bug|rueda|ab ?wheel/, /copenhague/, [
      ['Plancha frontal', 'Peso corporal'], ['Plancha lateral', 'Peso corporal'], ['Dead bug', 'Peso corporal'], ['Rueda abdominal', 'Rueda']]],
    ['flex', 'Core flexión', 'Core', /crunch|encogimiento abdominal|elevacion de piernas|abdominal/, null, [
      ['Crunch en polea', 'Polea'], ['Crunch en máquina', 'Máquina'], ['Elevación de piernas colgado', 'Peso corporal'], ['Crunch en suelo', 'Peso corporal']]]
  ];
  const FAMILIES = F.map(([key, title, muscle, test, not, names]) => ({ key, title, muscle, test, not, names: names.map(([name, equipment]) => ({ name, equipment, muscle })) }));
  const familyOf = name => { const n = norm(name); return FAMILIES.find(f => f.test.test(n) && !(f.not && f.not.test(n))) || null; };

  // Cambios para un ejercicio: los que fijó el entrenador o, si no, su familia (los de la familia + los del catálogo que encajan).
  // lib: catálogo [{name, muscle, equipment, alternatives}]. Devuelve [{name, equipment, …}] sin el propio ejercicio.
  function altsFor(name, lib, max) {
    lib = lib || []; const k = norm(name), byName = new Map(lib.map(x => [norm(x.name), x]));
    const me = byName.get(k), pick = n => byName.get(norm(n)) || { name: n };
    let out;
    if (me && Array.isArray(me.alternatives) && me.alternatives.length) out = me.alternatives.map(pick);
    else {
      const f = familyOf(name); if (!f) return { list: [], family: null, custom: false };
      out = f.names.map(x => byName.get(norm(x.name)) || x).concat(lib.filter(x => familyOf(x.name) === f));
      const seen = new Set(); out = out.filter(x => { const n = norm(x.name); if (seen.has(n)) return false; seen.add(n); return true; });
      return { list: out.filter(x => norm(x.name) !== k).slice(0, max || 8), family: f, custom: false };
    }
    return { list: out.filter(x => norm(x.name) !== k).slice(0, max || 12), family: familyOf(name), custom: true };
  }
  window.JMSwap = { FAMILIES, familyOf, altsFor, norm };
})();
