// Robô de avisos do Contas da Casa — roda todo dia pelo GitHub Actions.
// Lê as contas fixas e faturas no Firebase e manda notificação para os iPhones cadastrados.
import admin from "firebase-admin";

const sa = JSON.parse(process.env.FIREBASE_SA || "{}");
if (!sa.project_id) { console.error("Segredo FIREBASE_SA ausente ou inválido."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const TESTE = String(process.env.TESTE) === "true";
const URL_APP = process.env.URL_APP || "";

const pad = n => String(n).padStart(2, "0");
const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ymAdd = (k, n) => { let [y, m] = k.split("-").map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return y + "-" + pad(m); };
const lastDay = k => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const diffDias = (a, b) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 864e5);
const brl = v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dBr = ds => ds.slice(8, 10) + "/" + ds.slice(5, 7);

const cur = hoje.slice(0, 7);
const meses = [ymAdd(cur, -1), cur, ymAdd(cur, 1)];
const docs = s => s.docs.map(d => ({ id: d.id, ...d.data() }));

const [fixas, cartoes, cfgSnap, tokensSnap, lancFat, ...mapas] = await Promise.all([
  db.collection("fixas").get().then(docs),
  db.collection("cartoes").get().then(docs),
  db.doc("config/geral").get(),
  db.collection("push").get(),
  db.collection("lanc").where("fatura", ">=", meses[0]).where("fatura", "<=", meses[2]).get().then(docs),
  ...meses.map(k => db.doc("pagos/" + k).get()),
  ...meses.map(k => db.doc("faturas/" + k).get()),
]);
const pagos = {}, faturas = {};
meses.forEach((k, i) => { pagos[k] = mapas[i].exists ? mapas[i].data() : {}; faturas[k] = mapas[i + 3].exists ? mapas[i + 3].data() : {}; });
const dias = (cfgSnap.exists && +cfgSnap.data().avisoDias) || 3;

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
// avisa X dias antes, na véspera, no dia e no dia seguinte (se não foi paga)
const alvo = itens.filter(i => [dias, 1, 0, -1].includes(i.dd)).sort((a, b) => a.dd - b.dd);
const rotulo = dd => dd === -1 ? "Venceu ontem" : dd === 0 ? "Hoje" : dd === 1 ? "Amanhã" : "Em " + dd + " dias";

let title, body;
if (alvo.length) {
  title = alvo.length === 1 ? "Conta vencendo" : alvo.length + " contas vencendo";
  body = alvo.map(i => `${rotulo(i.dd)} (${dBr(i.due)}): ${i.nome} · ${brl(i.valor)}`).join("\n");
} else if (TESTE) {
  title = "Contas da Casa";
  body = "Teste: as notificações estão funcionando ✅";
} else {
  console.log(`${hoje}: nada vencendo para avisar (${itens.length} conta(s) em aberto no período).`);
  process.exit(0);
}

const tokens = tokensSnap.docs.map(d => d.data().token || d.id).filter(Boolean);
if (!tokens.length) { console.log("Nenhum iPhone cadastrado para receber notificações."); process.exit(0); }

const webpush = { notification: { title, body, icon: URL_APP + "icon-192.png" }, data: { title, body, url: URL_APP, tag: "vencimentos-" + hoje } };
if (URL_APP.startsWith("https://")) webpush.fcmOptions = { link: URL_APP };
const res = await admin.messaging().sendEachForMulticast({ tokens, webpush });
console.log(`${hoje}: enviado para ${res.successCount} de ${tokens.length} aparelho(s).\n${title}\n${body}`);
const ruins = [];
res.responses.forEach((r, i) => {
  if (r.success) return;
  console.log("Falha:", r.error && r.error.code);
  if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"].includes(r.error && r.error.code)) ruins.push(tokensSnap.docs[i].ref.delete());
});
await Promise.all(ruins);
if (ruins.length) console.log(ruins.length + " aparelho(s) sem registro válido foram removidos.");
