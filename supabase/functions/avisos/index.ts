// TEAM JMFIT · función «avisos» (Supabase Edge Function). Migración 032.
// Trabajos (POST JSON {job}):
//  · daily   — lo lanza pg_cron cada hora; desde las 07:00 (hora canaria) manda a cada cliente, una vez al día y
//              solo si hoy le toca entrenar o enviar la revisión, sus tareas de hoy y una frase de motivación.
//  · checkin — lo lanza la base de datos al guardar una revisión en fin de semana: aviso al entrenador.
//  · reviewed — lo lanza la base de datos cuando el entrenador marca un check-in como revisado o le responde: aviso al cliente.
//  · key     — devuelve la clave pública para dar de alta un móvil.
//  · test    — con la sesión del usuario (Authorization: Bearer …): le manda a él un aviso de prueba.
// Todos son seguros aunque alguien los llame a mano: solo se manda lo que toca y nunca dos veces (push_log).
// Las claves VAPID se generan aquí la primera vez y se guardan en push_vapid (solo el servidor las lee).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const TZ = "Atlantic/Canary", HOUR = 7, APP = "https://teamjmfit.github.io/";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };

// ---------- fechas (en hora canaria)
export function local(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const D = (s: string) => new Date(String(s).slice(0, 10) + "T12:00:00Z");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const add = (s: string, n: number) => { const x = D(s); x.setUTCDate(x.getUTCDate() + n); return ymd(x); };
export const dow = (s: string) => ((D(s).getUTCDay() + 6) % 7) + 1;   // 1 = lunes … 7 = domingo
const monday = (s: string) => add(s, 1 - dow(s));
const diff = (a: string, b: string) => Math.round((D(a).getTime() - D(b).getTime()) / 864e5);

// ---------- revisión (misma lógica que checkins.js)
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
export function ckStatus(c: Row, checkins: Row[], skips: Row[], t: string) {
  const freq = c.ck_freq || "semanal";
  if (freq === "ninguno") return null;
  const L = freq === "quincenal" ? 14 : 7, anchor = monday(c.ck_anchor || t), ko = Math.min(6, Math.max(0, (Number(c.ck_day) || 5) - 1));
  const period = (k: number) => { const start = add(anchor, k * L); return { k, start, end: add(start, L - 1), key: add(start, L - 7 + ko) }; };
  const periodAt = (d: string) => period(Math.floor(diff(monday(d), anchor) / L));
  const cur = periodAt(t);
  const cov = checkins.map(x => x.period_start ? [x.period_start, x.period_end || x.period_start] : (p => [p.start, p.end])(periodAt(x.date)))
    .concat(skips.map(x => [x.period_start, x.period_end]));
  const pending = [];
  for (let k = Math.max(0, cur.k - 12); k <= cur.k; k++) { const p = period(k); if (p.key <= t && !cov.some(r => r[0] <= p.end && r[1] >= p.start)) pending.push(p); }
  if (!pending.length) return null;
  return pending.length === 1 && pending[0].k === cur.k ? "toca" : "atrasado";
}

// ---------- tareas de hoy (misma lógica que la pantalla «Entreno» del cliente)
const nutriOnly = (c: Row) => { const v = String(c.service || "").toLowerCase(); return /nutri/.test(v) && !/mixt|entren|complet|ambos/.test(v); };
export function dayTasks(c: Row, d: { routines: Row[]; programs: Row[]; weeks: Row[]; events: Row[]; checkins: Row[]; skips: Row[] }, t: string) {
  const ok = new Set(d.programs.filter(p => p.status === "active").map(p => p.id));
  const cw = d.weeks.filter(w => w.published && ok.has(w.program_id) && w.start_date <= t).sort((a, b) => b.start_date.localeCompare(a.start_date) || b.week_no - a.week_no)[0];
  const rs = d.routines.filter(r => (cw ? r.program_week_id === cw.id : !r.program_week_id));
  const today = rs.filter(r => r.day === dow(t)).map(r => r.name);
  const ev = d.events.filter(e => e.date === t && e.visible !== false && !e.done_at);
  const train = [...today];
  const extra: string[] = [];
  let ck = ckStatus(c, d.checkins, d.skips, t);
  const rName = (id: string) => (d.routines.find(r => r.id === id) || {}).name;
  for (const e of ev) {
    const name = e.title || (e.routine_id && rName(e.routine_id)) || "";
    if (e.kind === "workout") { const n = name || "Entreno"; if (!train.some(x => x.toLowerCase() === n.toLowerCase())) train.push(n); }
    else if (e.kind === "cardio") extra.push(`cardio${e.minutes ? " " + e.minutes + " min" : ""}${e.title ? " (" + e.title + ")" : ""}`);
    else if (e.kind === "mobility") extra.push(name ? `movilidad (${name})` : "movilidad");
    else if (e.kind === "checkin") ck = ck || "toca";
    else if (e.kind === "photos") extra.push("fotos de progreso");
    else if (e.kind === "note" && e.title) extra.push(e.title);
  }
  const active = ev.some(e => ["cardio", "mobility", "photos"].includes(e.kind));
  return { train, extra, ck, active, trains: rs.some(r => r.day) || d.routines.some(r => r.by_client), nutri: nutriOnly(c) };
}

// ---------- frases (propias)
const FR = {
  train: [
    "La disciplina es hacer lo que toca aunque no te apetezca.", "No hace falta que sea perfecto, hace falta que lo hagas.",
    "Cada serie de hoy es una inversión en tu yo de dentro de seis meses.", "La motivación te hace empezar; la constancia te hace llegar.",
    "Hoy no se negocia: entras, entrenas y sales mejor.", "El progreso viene de repetir lo básico muchas veces.",
    "Un entreno hecho vale más que diez planeados.", "Tu cuerpo cambia con lo que haces todas las semanas, no con lo que haces un día.",
    "Ve a por una repetición más de calidad que la última vez.", "Ganas el día cuando cumples lo que te prometiste.",
    "Disciplina es acordarte de por qué empezaste cuando no te apetece seguir.", "Los días sin ganas son los que más cuentan.",
    "No esperes a estar motivado: actúa y la motivación llega.", "Comprometerse es seguir cuando la emoción del principio ya se fue.",
    "Tú eliges: la comodidad de hoy o el resultado de mañana.", "El que cumple los días normales es el que llega lejos.",
    "Nadie va a entrenar por ti. Hoy te toca a ti.", "Hazlo cansado, hazlo con sueño, pero hazlo.",
    "La diferencia entre querer y conseguir se llama constancia.", "Sé la persona que no se salta el entreno.",
    "Pequeñas victorias diarias, grandes cambios al año.", "Lo difícil de hoy es tu calentamiento de mañana.",
    "Te comprometiste contigo: hoy toca demostrarlo.", "Entrena con intención: cada serie cuenta.",
    "El compromiso no se nota el día que te apetece, se nota el día que no.", "Constancia aburrida, resultados increíbles.",
  ],
  rest: [
    "Descansar también es entrenar: hoy se construye lo que trabajaste.", "Hoy toca recuperar: duerme bien, come según tu plan y muévete un poco.",
    "La constancia también es saber parar cuando toca.", "El músculo crece cuando descansas. Respeta el día de hoy.",
    "Un buen descanso hoy es un mejor entreno mañana.", "Paseo, agua y buena comida: así se gana un día de descanso.",
    "Descansar no es parar: es cumplir el plan también hoy.", "Disciplina también es dormir bien y comer bien un día sin gimnasio.",
  ],
  ck: [
    "Lo que se mide, mejora. Tu revisión me ayuda a ajustarlo todo para ti.", "Sé sincero en la revisión: con datos reales afinamos mejor.",
    "Dos minutos de revisión = un plan mejor hecho para ti.", "Tu compromiso también es contarme cómo vas, aunque la semana no fuera perfecta.",
    "Sin datos no hay ajustes. Con tu revisión, el plan trabaja para ti.", "Una semana mala bien contada vale más que una buena sin contar.",
    "Revisar es parte del proceso: nos dice qué mantener y qué cambiar.", "Cumplir también es rendir cuentas. Te espero en la revisión.",
  ],
  nutri: [
    "La dieta no se hace un lunes, se hace cada comida.", "Constancia antes que perfección: una buena comida detrás de otra.",
    "No se trata de comer perfecto, se trata de cumplir casi siempre.", "Cada comida según el plan suma. Hoy también.",
    "Disciplina es elegir lo que quieres más sobre lo que quieres ahora.", "Tu compromiso se ve en el plato, comida a comida.",
  ],
};
const pick = (arr: string[], seed: string) => { let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0; return arr[Math.abs(h) % arr.length]; };
const list = (xs: string[]) => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " y " + xs[xs.length - 1];

export function dailyMessage(c: Row, k: ReturnType<typeof dayTasks>, t: string) {
  const first = String(c.name || "").trim().split(/\s+/)[0] || "";
  const ckTxt = k.ck === "atrasado" ? "la revisión que tienes pendiente" : k.ck ? "enviar tu revisión" : "";
  const tasks: string[] = [];
  let title: string, fr: string;
  if (k.train.length) {
    title = `💪 Hoy toca: ${k.train.join(" + ")}`;
    tasks.push(`entreno ${k.train.join(" + ")}`);
    fr = pick(FR.train, c.id + t);
  } else if (k.nutri || !k.trains) {
    title = k.ck ? "📋 Hoy toca tu revisión" : `🍽️ Buenos días${first ? ", " + first : ""}`;
    tasks.push("seguir tu plan de comidas");
    fr = pick(k.ck ? FR.ck : FR.nutri, c.id + t);
  } else {
    title = k.ck ? "📋 Hoy descansas… y toca revisión" : "😌 Hoy es día de descanso";
    tasks.push("descansar, comer según tu plan y moverte un poco");
    fr = pick(k.ck ? FR.ck : FR.rest, c.id + t);
  }
  tasks.push(...k.extra);
  if (ckTxt) tasks.push(ckTxt);
  // registro diario en la app (Inicio → Registro de hoy): peso en ayunas y horas de sueño
  const kk = k as Row, reg = [kk.needW !== false ? "tu peso en ayunas" : "", kk.needS !== false ? "tus horas de sueño" : ""].filter(Boolean);
  if (reg.length) tasks.push("apuntar " + reg.join(" y "));
  const body = `Hoy: ${list(tasks)}.\n${fr}`;
  return { title, body, url: APP + "#/", tag: "dia-" + t };
}

// ---------- envío
// Clave de servidor que Supabase pone sola en el entorno de la función (la antigua o la nueva «secret»)
const serverKey = () => { const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (k) return k; try { const m = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return m.default || Object.values(m)[0]; } catch (_) { return ""; } };
const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, serverKey() as string, { auth: { persistSession: false, autoRefreshToken: false } });
// deno-lint-ignore no-explicit-any
async function vapid(db: any) {
  let { data } = await db.from("push_vapid").select("public_key, private_key").eq("id", 1).maybeSingle();
  if (!data) {
    const k = webpush.generateVAPIDKeys();
    await db.from("push_vapid").upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: "id", ignoreDuplicates: true });
    data = (await db.from("push_vapid").select("public_key, private_key").eq("id", 1).single()).data;
  }
  webpush.setVapidDetails(APP, data.public_key, data.private_key);
  return data.public_key as string;
}
// Marca «ya enviado»; devuelve false si ya lo estaba
// deno-lint-ignore no-explicit-any
async function once(db: any, key: string) { const { error } = await db.from("push_log").insert({ key }); return !error; }
// deno-lint-ignore no-explicit-any
async function sendTo(db: any, userIds: string[], msg: Row) {
  if (!userIds.length) return 0;
  const { data: subs } = await db.from("push_subs").select("id, endpoint, p256dh, auth").in("user_id", userIds);
  let n = 0;
  for (const s of subs || []) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 12 * 3600 }); n++; }
    catch (e) { const code = (e as Row).statusCode; if (code === 404 || code === 410) await db.from("push_subs").delete().eq("id", s.id); }
  }
  return n;
}

// deno-lint-ignore no-explicit-any
async function loadDay(db: any, c: Row, t: string) {
  const q = (tb: string) => db.from(tb).select("*").eq("client_id", c.id);
  const [routines, programs, weeks, events, checkins, skips, dm] = await Promise.all([
    q("routines"), q("programs"), q("program_weeks").eq("published", true), q("calendar_events").eq("date", t),
    q("checkins").order("date", { ascending: false }).limit(30), q("checkin_skips"), q("daily_metrics").eq("date", t),
  ]).then(rs => rs.map((r: Row) => r.data || []));
  const k = dayTasks(c, { routines, programs, weeks, events, checkins, skips }, t);
  const m = (dm as Row[])[0] || {};
  return Object.assign(k, { needW: m.weight == null, needS: m.sleep_h == null });
}

export const worth = (k: ReturnType<typeof dayTasks>) => !!(k.train.length || k.ck || k.active);
// deno-lint-ignore no-explicit-any
async function daily(db: any, force = false) {
  const { date: t, hour } = local();
  if (hour < HOUR && !force) return { skipped: "antes de las " + HOUR };
  const { data: subs } = await db.from("push_subs").select("user_id");
  const uids = [...new Set((subs || []).map((s: Row) => s.user_id))];
  if (!uids.length) return { sent: 0 };
  const { data: clients } = await db.from("clients").select("*").eq("active", true).in("user_id", uids);
  let sent = 0;
  for (const c of clients || []) {
    if (c.ui_prefs && c.ui_prefs.avisos === false) continue;
    try {
      const k = await loadDay(db, c, t);
      if (!worth(k)) continue;   // solo avisos de entrenos o revisiones: los días de descanso no se manda nada
      if (!(await once(db, `dia:${c.id}:${t}`))) continue;
      sent += await sendTo(db, [c.user_id], dailyMessage(c, k, t));
    } catch (_) { /* sigue con el resto */ }
  }
  return { sent };
}

// deno-lint-ignore no-explicit-any
async function coachIds(db: any) { const { data } = await db.from("profiles").select("id").eq("role", "coach"); return (data || []).map((p: Row) => p.id); }

// deno-lint-ignore no-explicit-any
async function checkin(db: any, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return { ok: false };
  const { data: k } = await db.from("checkins").select("id, client_id, created_at").eq("id", id).maybeSingle();
  if (!k || Date.now() - new Date(k.created_at).getTime() > 3600e3) return { ok: false };
  if (!(await once(db, `ck:${k.id}`))) return { ok: false };
  const { data: c } = await db.from("clients").select("name").eq("id", k.client_id).maybeSingle();
  const sent = await sendTo(db, await coachIds(db), { title: `📥 Revisión de ${c ? c.name : "un cliente"}`, body: "La acaba de enviar. Tócala para verla.", url: APP + "#/revision/" + k.id, tag: "ck-" + k.id });
  return { ok: true, sent };
}

// Revisión hecha por el entrenador → aviso al cliente (una vez al marcarla y otra por cada respuesta nueva)
const hash = (t: string) => { let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
// deno-lint-ignore no-explicit-any
async function reviewed(db: any, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return { ok: false };
  const { data: k } = await db.from("checkins").select("id, client_id, coach_seen, coach_reply").eq("id", id).maybeSingle();
  if (!k || (!k.coach_seen && !k.coach_reply)) return { ok: false };
  const { data: c } = await db.from("clients").select("id, user_id, name, ui_prefs, active").eq("id", k.client_id).maybeSingle();
  if (!c || !c.user_id || c.active === false || (c.ui_prefs && c.ui_prefs.avisos === false)) return { ok: false };
  const reply = String(k.coach_reply || "").trim();
  if (!(await once(db, `rv:${k.id}:${reply ? hash(reply) : "visto"}`))) return { ok: false };
  if (reply) await once(db, `rv:${k.id}:visto`);   // si después solo se marca «Revisado», no se repite
  const first = String(c.name || "").trim().split(/\s+/)[0];
  const msg = reply
    ? { title: "💬 Tu entrenador ha revisado tu check-in", body: reply.length > 160 ? reply.slice(0, 157) + "…" : reply, url: APP + "#/", tag: "rv-" + k.id }
    : { title: "✅ Revisión hecha", body: `${first ? first + ", y" : "Y"}a he revisado tu check-in. Entra en la app para ver tus ajustes.`, url: APP + "#/", tag: "rv-" + k.id };
  return { ok: true, sent: await sendTo(db, [c.user_id], msg) };
}

// Píldora o novedad publicada → aviso a todos los clientes activos con avisos (una vez por publicación)
const plain = (t: string) => String(t || "").replace(/\*\*/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
// deno-lint-ignore no-explicit-any
async function post(db: any, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return { ok: false };
  const { data: p } = await db.from("posts").select("id, kind, title, body, published").eq("id", id).maybeSingle();
  if (!p || !p.published) return { ok: false };
  if (!(await once(db, `post:${p.id}`))) return { ok: false };
  const { data: subs } = await db.from("push_subs").select("user_id");
  const uids = [...new Set((subs || []).map((s: Row) => s.user_id))];
  if (!uids.length) return { ok: true, sent: 0 };
  const { data: cs } = await db.from("clients").select("user_id, ui_prefs").eq("active", true).in("user_id", uids);
  const to = (cs || []).filter((c: Row) => !(c.ui_prefs && c.ui_prefs.avisos === false)).map((c: Row) => c.user_id);
  const b = plain(p.body);
  const msg = { title: `${p.kind === "novedad" ? "📣 Novedad" : "💊 Nueva píldora"}: ${String(p.title).slice(0, 80)}`,
    body: b ? (b.length > 140 ? b.slice(0, 137) + "…" : b) : "Tócala para leerla en la app.", url: APP + "#/pildoras", tag: "post-" + p.id };
  return { ok: true, sent: await sendTo(db, to, msg) };
}

// deno-lint-ignore no-explicit-any
async function test(db: any, req: Request) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data } = await db.auth.getUser(tok);
  const u = data && data.user;
  if (!u) return { ok: false, error: "sin sesión" };
  const { data: c } = await db.from("clients").select("*").eq("user_id", u.id).eq("active", true).maybeSingle();
  if (c) { const k0 = await loadDay(db, c, local().date); if (!worth(k0)) return { ok: true, sent: 0, none: true }; }
  const msg = c ? dailyMessage(c, await loadDay(db, c, local().date), local().date)
    : { title: "📥 Así te llegará cada revisión", body: "Cuando un cliente envíe su revisión te aviso al momento.", url: APP + "#/", tag: "prueba" };
  return { ok: true, sent: await sendTo(db, [u.id], msg) };
}

if (import.meta.main !== false) Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const out = (o: Row, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const db = sb();
    const key = await vapid(db);
    if (body.job === "key") return out({ key });
    if (body.job === "daily") return out(await daily(db));
    if (body.job === "checkin") return out(await checkin(db, body.id));
    if (body.job === "reviewed") return out(await reviewed(db, body.id));
    if (body.job === "post") return out(await post(db, body.id));
    if (body.job === "test") return out(await test(db, req));
    return out({ error: "trabajo desconocido" }, 400);
  } catch (e) { return out({ error: String((e as Error).message || e) }, 500); }
});
