// Robô da lista de compras do Contas da Casa — roda pelo GitHub Actions a cada 5 minutos (7h às 23h59).
// Lê a fila "avisos" que o app grava e manda a notificação para o OUTRO iPhone:
//  - "Fulano está no mercado"            (sempre)
//  - "Fulano colocou leite, pão… na lista" (dá para desligar em Ajustes, por iPhone)
import admin from "firebase-admin";

const sa = JSON.parse(process.env.FIREBASE_SA || "{}");
if (!sa.project_id) { console.error("Segredo FIREBASE_SA ausente ou inválido."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const TESTE = String(process.env.TESTE) === "true";
const URL_APP = process.env.URL_APP || "";
const agora = Date.now();

const fila = await db.collection("avisos").get();
if (fila.empty && !TESTE) { console.log("Nada novo na lista de compras."); process.exit(0); }

const avisos = fila.docs.map(d => ({ ref: d.ref, ...d.data() })).sort((a, b) => (a.em || 0) - (b.em || 0));
const tokensSnap = await db.collection("push").get();
const aparelhos = tokensSnap.docs.map(d => ({ ref: d.ref, token: d.data().token || d.id, email: String(d.data().email || "").toLowerCase(), compras: d.data().compras !== false })).filter(a => a.token);

// Itens que ainda estão na lista (se já compraram ou tiraram, não avisa)
const ids = [...new Set(avisos.filter(a => a.tipo === "item" && a.item).map(a => a.item))];
const naLista = new Set();
for (let i = 0; i < ids.length; i += 100) {
  const refs = ids.slice(i, i + 100).map(id => db.collection("compras").doc(id));
  (await db.getAll(...refs)).forEach(s => { if (s.exists && s.data().comprar) naLista.add(s.id); });
}

const juntar = n => n.length <= 1 ? (n[0] || "") : n.length <= 4 ? n.slice(0, -1).join(", ") + " e " + n[n.length - 1] : n.slice(0, 3).join(", ") + " e mais " + (n.length - 3);
const envios = [];
// "Estou no mercado": só o mais recente de cada pessoa/lista, e só se tiver menos de 1 hora
const mercados = new Map();
for (const a of avisos) if (a.tipo === "mercado" && agora - (a.em || 0) < 3600e3) mercados.set(a.email + "|" + a.lista, a);
for (const a of mercados.values()) envios.push({
  de: String(a.email || "").toLowerCase(), soCompras: false, tag: "mercado-" + a.lista,
  title: `🛒 ${a.quem || "Alguém"} está no mercado`,
  body: `Precisa de mais alguma coisa? Coloque na lista ${a.listaNome || "Mercado"} que aparece na hora.`
});
// Itens novos: agrupados por pessoa e lista (até 12 horas de atraso)
const grupos = new Map();
for (const a of avisos) {
  if (a.tipo !== "item" || !naLista.has(a.item) || agora - (a.em || 0) > 12 * 3600e3) continue;
  const k = a.email + "|" + a.lista;
  if (!grupos.has(k)) grupos.set(k, { a, nomes: [] });
  const g = grupos.get(k); if (!g.nomes.includes(a.nome)) g.nomes.push(a.nome);
}
for (const { a, nomes } of grupos.values()) envios.push({
  de: String(a.email || "").toLowerCase(), soCompras: true, tag: "lista-" + a.lista,
  title: `📝 ${a.quem || "Alguém"} colocou na lista ${a.listaNome || "Mercado"}`,
  body: juntar(nomes.map(n => String(n).toLowerCase())) + "."
});
if (TESTE && !envios.length) envios.push({ de: "", soCompras: false, tag: "teste-compras", title: "🛒 Lista de compras", body: "Teste: os avisos da lista de compras estão funcionando ✅" });

const ruins = new Set();
for (const e of envios) {
  const alvo = aparelhos.filter(x => (!e.de || x.email !== e.de) && (!e.soCompras || x.compras));
  if (!alvo.length) { console.log("Sem aparelho para avisar:", e.title); continue; }
  const link = URL_APP ? URL_APP + "?tab=compras" : "";
  const webpush = { notification: { title: e.title, body: e.body, icon: URL_APP + "icon-192.png" }, data: { title: e.title, body: e.body, url: link, tag: e.tag } };
  if (link.startsWith("https://")) webpush.fcmOptions = { link };
  const res = await admin.messaging().sendEachForMulticast({ tokens: alvo.map(x => x.token), webpush });
  console.log(`${e.title} — ${e.body} → enviado para ${res.successCount} de ${alvo.length}`);
  res.responses.forEach((r, i) => {
    if (!r.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"].includes(r.error && r.error.code)) ruins.add(alvo[i].ref);
  });
}
await Promise.all([...ruins].map(r => r.delete()));
// Limpa a fila (o que foi lido nesta rodada)
const lote = avisos.map(a => a.ref);
for (let i = 0; i < lote.length; i += 400) { const b = db.batch(); lote.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); }
console.log(`${avisos.length} aviso(s) lido(s) da fila.`);
