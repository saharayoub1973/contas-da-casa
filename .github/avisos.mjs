// Robô de avisos do Contas da Casa — roda pelo GitHub Actions duas vezes por dia.
// Manhã: contas e faturas vencendo, último dia de desafio e, no dia 1, o resumo do mês que fechou.
// Noite: lembrete quando a sequência de dias registrados está em risco.
import admin from "firebase-admin";

const sa = JSON.parse(process.env.FIREBASE_SA || "{}");
if (!sa.project_id) { console.error("Segredo FIREBASE_SA ausente ou inválido."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const TESTE = String(process.env.TESTE) === "true";
const URL_APP = process.env.URL_APP || "";

const pad = n => String(n).padStart(2, "0");
const agoraSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
const P = Object.fromEntries(agoraSP.map(p => [p.type, p.value]));
const hoje = process.env.HOJE || `${P.year}-${P.month}-${P.day}`;
const hora = +P.hour;
const MODO = process.env.MODO || (hora >= 17 ? "noite" : "manha");

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const ymAdd = (k, n) => { let [y, m] = k.split("-").map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return y + "-" + pad(m); };
const lastDay = k => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const diffDias = (a, b) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 864e5);
const dAdd = (ds, n) => { const t = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10)) + n * 864e5); return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()); };
const brl = v => (v < 0 ? "-" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dBr = ds => ds.slice(8, 10) + "/" + ds.slice(5, 7);
const docs = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
const cur = hoje.slice(0, 7);

let title = "", linhas = [], tag = MODO + "-" + hoje;

if (MODO === "noite") {
  const diasSnap = await db.collection("dias").where("d", ">=", dAdd(hoje, -400)).get();
  const dias = new Set(diasSnap.docs.map(d => d.id));
  if (!dias.has(hoje)) {
    let n = 0, d = dAdd(hoje, -1);
    while (dias.has(d)) { n++; d = dAdd(d, -1); }
    if (n >= 2) {
      title = `🔥 Sequência de ${n} dias em risco`;
      linhas.push("Ainda não tem nada registrado hoje. Lance um gasto ou toque em “Hoje não gastei” antes da meia-noite.");
    }
  }
} else {
  const meses = [ymAdd(cur, -1), cur, ymAdd(cur, 1)];
  const [fixas, cartoes, cfgSnap, lancFat, desafios, ...mapas] = await Promise.all([
    db.collection("fixas").get().then(docs),
    db.collection("cartoes").get().then(docs),
    db.doc("config/geral").get(),
    db.collection("lanc").where("fatura", ">=", meses[0]).where("fatura", "<=", meses[2]).get().then(docs),
    db.collection("desafios").get().then(docs),
    ...meses.map(k => db.doc("pagos/" + k).get()),
    ...meses.map(k => db.doc("faturas/" + k).get()),
  ]);
  const pagos = {}, faturas = {};
  meses.forEach((k, i) => { pagos[k] = mapas[i].exists ? mapas[i].data() : {}; faturas[k] = mapas[i + 3].exists ? mapas[i + 3].data() : {}; });
  const dias = (cfgSnap.exists && +cfgSnap.data().avisoDias) || 3;

  // Resumo do mês que fechou (só no dia 1)
  if (hoje.endsWith("-01")) {
    const pk = ymAdd(cur, -1);
    const ls = await db.collection("lanc").where("data", ">=", pk + "-01").where("data", "<", cur + "-01").get().then(docs);
    let e = 0, s = 0, g = 0;
    for (const l of ls) { const v = +l.valor || 0; if (l.tipo === "entrada") e += v; else if (l.tipo === "meta") g += l.mov === "retirar" ? -v : v; else s += v; }
    if (ls.length) linhas.push(`Fechamos ${MESES[+pk.slice(5) - 1]}: ${e - s - g >= 0 ? "sobrou " + brl(e - s - g) : "faltou " + brl(s + g - e)}. Abra o app para ver a nota do mês.`);
  }

  // Contas e faturas
  const itens = [];
  for (const k of meses) {
    for (const f of fixas) {
      if (f.tipo === "entrada" || !f.dia || f.cartao || (f.desde || "0000-00") > k) continue;
      const v = pagos[k][f.id]; if (v && v !== "pulado") continue;
      const due = k + "-" + pad(Math.min(f.dia, lastDay(k)));
      itens.push({ nome: f.nome, valor: +f.valor || 0, due, dd: diffDias(due, hoje) });
    }
    for (const c of cartoes) {
      if (faturas[k][c.id]) continue;
      const tot = lancFat.filter(l => l.cartao === c.id && l.fatura === k).reduce((a, l) => a + (+l.valor || 0), 0);
      if (!(tot > 0)) continue;
      const due = k + "-" + pad(Math.min(+c.venc || 10, lastDay(k)));
      itens.push({ nome: "Fatura " + c.nome, valor: tot, due, dd: diffDias(due, hoje) });
    }
  }
  const alvo = itens.filter(i => [dias, 1, 0, -1].includes(i.dd)).sort((a, b) => a.dd - b.dd);
  const rotulo = dd => dd === -1 ? "Venceu ontem" : dd === 0 ? "Hoje" : dd === 1 ? "Amanhã" : "Em " + dd + " dias";
  alvo.forEach(i => linhas.push(`${rotulo(i.dd)} (${dBr(i.due)}): ${i.nome} · ${brl(i.valor)}`));

  // Último dia de desafio
  desafios.filter(d => !d.status && d.fim === hoje).forEach(d => linhas.push(`⚡ Último dia do desafio “${d.titulo}”.`));

  title = alvo.length ? (alvo.length === 1 ? "Conta vencendo" : alvo.length + " contas vencendo") : linhas.length ? "Contas da Casa" : "";
}

if (!linhas.length) {
  if (!TESTE) { console.log(`${hoje} (${MODO}): nada para avisar.`); process.exit(0); }
  title = "Contas da Casa";
  linhas = ["Teste: as notificações estão funcionando ✅"];
}
const body = linhas.join("\n");

const tokensSnap = await db.collection("push").get();
const tokens = tokensSnap.docs.map(d => d.data().token || d.id).filter(Boolean);
if (!tokens.length) { console.log("Nenhum iPhone cadastrado para receber notificações."); process.exit(0); }

const webpush = { notification: { title, body, icon: URL_APP + "icon-192.png" }, data: { title, body, url: URL_APP, tag } };
if (URL_APP.startsWith("https://")) webpush.fcmOptions = { link: URL_APP };
const res = await admin.messaging().sendEachForMulticast({ tokens, webpush });
console.log(`${hoje} (${MODO}): enviado para ${res.successCount} de ${tokens.length} aparelho(s).\n${title}\n${body}`);
const ruins = [];
res.responses.forEach((r, i) => {
  if (r.success) return;
  console.log("Falha:", r.error && r.error.code);
  if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"].includes(r.error && r.error.code)) ruins.push(tokensSnap.docs[i].ref.delete());
});
await Promise.all(ruins);
if (ruins.length) console.log(ruins.length + " aparelho(s) sem registro válido foram removidos.");
