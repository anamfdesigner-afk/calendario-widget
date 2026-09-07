import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { carregarWidget } from "./carregar.mjs";

const CAMINHO = fileURLToPath(new URL("../widget.js", import.meta.url));

// O padrão que o validarPedido_ do reservas.gs exige. Está aqui copiado de
// propósito: se um dos dois lados mudar, é este teste que dá o aviso.
const PADRAO_TOKEN = /^[A-Za-z0-9-]{8,64}$/;

function resposta(corpo, ok = true, status = 200) {
  return { ok: ok, status: status, json: async () => corpo };
}

// Regista tudo o que o widget diz ao JotForm.
function jotformFalso() {
  const chamadas = [];
  const subs = {};
  const api = {
    subscribe(evento, fn) { subs[evento] = fn; },
    sendData(d) { chamadas.push(["sendData", d.value]); },
    sendSubmit(d) { chamadas.push(["sendSubmit", d]); },
    showWidgetError(m) { chamadas.push(["showWidgetError", m]); },
    hideWidgetError() { chamadas.push(["hideWidgetError"]); },
    requestFrameResize() {},
    isWidgetOnBuilder() { return false; },
    setFieldsValueById(v) { chamadas.push(["setFieldsValueById", v]); },
    setFieldsValueByLabel(v) { chamadas.push(["setFieldsValueByLabel", v]); }
  };
  return { chamadas, subs, api };
}

function montar(stubs = {}) {
  const jf = jotformFalso();
  const carregado = carregarWidget(CAMINHO, Object.assign({ JFCustomWidget: jf.api }, stubs));
  return { widget: carregado.widget, documento: carregado.documento, jf: jf };
}

// Um fetch que separa o GET das vagas do POST da reserva e guarda tudo.
function fetchFalso({ get, post } = {}) {
  const pedidos = [];
  const f = async (url, opcoes) => {
    const op = opcoes || {};
    pedidos.push({ url: url, opcoes: op });
    const fn = op.method === "POST" ? post : get;
    if (!fn) throw new Error("pedido inesperado: " + url);
    return fn(url, op, pedidos.length);
  };
  f.pedidos = pedidos;
  return f;
}

const SLOTS_EXEMPLO = [
  { horario: "08:00-08:45", capacidade: 3, restantes: 1 },
  { horario: "08:45-09:30", capacidade: 2, restantes: 0 },
  { horario: "09:30-10:15", capacidade: 3, restantes: 3 }
];

function hojeAqui() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

// ===============================
// ARRANQUE
// ===============================
test("o widget arranca sem browser e limita o calendário a partir de hoje", () => {
  // hojeLocal() usa hora LOCAL de propósito: com toISOString() (UTC), de
  // madrugada o mínimo do calendário caía no dia anterior. Os dois valores
  // apanham a viragem do dia entre as duas leituras.
  const antes = hojeAqui();
  const { widget, documento } = montar();
  const depois = hojeAqui();

  const campo = documento.getElementById("datePicker");
  assert.ok(campo.min === antes || campo.min === depois, `min inesperado: ${campo.min}`);
  assert.equal(widget.valorEscolhido(), "");
  assert.equal(documento.getElementById("estado").textContent, "Nenhum horário escolhido.");
});

test("o widget subscreve o ready e o submit", () => {
  const { jf } = montar();
  assert.equal(typeof jf.subs.ready, "function");
  assert.equal(typeof jf.subs.submit, "function");
});

test("o widget arranca na mesma sem o JFCustomWidget", () => {
  const { widget, documento } = carregarWidget(CAMINHO);
  assert.equal(documento.getElementById("datePicker").min.length, 10);
  assert.equal(widget.valorEscolhido(), "");
});

// ===============================
// TOKEN
// ===============================
test("o TOKEN casa o padrão que o servidor exige", () => {
  const { widget } = montar();
  assert.match(widget.TOKEN, PADRAO_TOKEN);
});

test("o TOKEN continua válido sem crypto.randomUUID", () => {
  // Telemóveis antigos e contextos não seguros não têm randomUUID. Sem a
  // rede de segurança o widget rebentava no arranque e ninguém reservava.
  const a = montar({ crypto: undefined }).widget.TOKEN;
  const b = montar({ crypto: {} }).widget.TOKEN;
  assert.match(a, PADRAO_TOKEN);
  assert.match(b, PADRAO_TOKEN);
  assert.notEqual(a, b);
});

// ===============================
// LEITURA DAS VAGAS
// ===============================
test("buscarVagas pede a data escolhida e devolve os slots do servidor", async () => {
  const fetchStub = fetchFalso({
    get: async () => resposta({ ok: true, data: "2026-09-08", slots: SLOTS_EXEMPLO })
  });
  const { widget } = montar({ fetch: fetchStub });

  const slots = await widget.buscarVagas("2026-09-08");

  assert.equal(fetchStub.pedidos.length, 1);
  assert.equal(fetchStub.pedidos[0].url, widget.RESERVAS_URL + "?data=2026-09-08");
  assert.equal(fetchStub.pedidos[0].opcoes.method, undefined);
  assert.deepEqual(slots, SLOTS_EXEMPLO);
});

test("buscarVagas rebenta com um ok:false em vez de o ler como zero vagas", async () => {
  // Um {ok:false} tem sempre um motivo e nunca é uma lista de vagas vazia.
  // Confundi-los mostrava "Sem vagas" em todos os horários, com ar de verdade.
  const { widget } = montar({
    fetch: fetchFalso({ get: async () => resposta({ ok: false, erro: "capacidades_ilegiveis" }) })
  });
  await assert.rejects(() => widget.buscarVagas("2026-09-08"), /capacidades_ilegiveis/);
});

test("buscarVagas rebenta num HTTP que não seja 2xx", async () => {
  const { widget } = montar({
    fetch: fetchFalso({ get: async () => resposta({}, false, 500) })
  });
  await assert.rejects(() => widget.buscarVagas("2026-09-08"), /HTTP 500/);
});

// ===============================
// DESENHAR OS HORÁRIOS
// ===============================
test("carregarSlots dá um botão a cada horário com vagas e texto simples aos cheios", async () => {
  const { widget, documento } = montar({
    fetch: fetchFalso({ get: async () => resposta({ ok: true, slots: SLOTS_EXEMPLO }) })
  });

  await widget.carregarSlots("2026-09-08");

  const lista = documento.getElementById("slotsList");
  assert.equal(documento.getElementById("slots").hidden, false);
  assert.deepEqual(
    lista.querySelectorAll("button").map(b => b.textContent),
    ["08:00-08:45 (1 vagas)", "09:30-10:15 (3 vagas)"]
  );
  assert.deepEqual(
    lista.querySelectorAll("p").map(p => p.textContent),
    ["08:45-09:30 — Sem vagas"]
  );
});

test("carregarSlots avisa quando o servidor falha, em vez de mostrar zero vagas", async () => {
  const { widget, documento } = montar({
    fetch: fetchFalso({ get: async () => { throw new Error("rede em baixo"); } })
  });

  await widget.carregarSlots("2026-09-08");

  const lista = documento.getElementById("slotsList");
  assert.equal(lista.textContent, "Erro ao carregar vagas. Tente novamente.");
  assert.deepEqual(lista.querySelectorAll("button"), []);
});

test("uma resposta velha não desenha por cima da mais recente", async () => {
  // O <input type="date"> dispara "change" por segmento: escrever 09/10/2026
  // chega a produzir a data intermédia "0202-09-10". Sem a guarda de geração,
  // a resposta que chegasse por ÚLTIMO desenhava os botões, e os botões levam
  // a data no closure — o hóspede reservava um dia que nunca viu.
  const porResolver = [];
  const { widget, documento } = montar({
    fetch: (url) => new Promise(res => {
      const data = String(url).split("data=")[1];
      porResolver.push(() => res(resposta({
        ok: true,
        slots: [{ horario: "08:00-08:45", capacidade: 3, restantes: 3 }],
        data: data
      })));
    })
  });

  const velha = widget.carregarSlots("0202-09-10");
  const nova = widget.carregarSlots("2026-09-10");

  porResolver[1]();          // a nova responde primeiro
  await nova;
  porResolver[0]();          // e a velha só depois
  await velha;

  const botoes = documento.getElementById("slotsList").querySelectorAll("button");
  assert.equal(botoes.length, 1);

  botoes[0].disparar("click");
  assert.equal(widget.valorEscolhido(), "2026-09-10 | 08:00-08:45");
});

// ===============================
// SELECIONAR
// ===============================
test("selecionar ignora um botão cuja data já não é a que está no ecrã", async () => {
  const fetchStub = fetchFalso({
    get: async () => resposta({ ok: true, slots: SLOTS_EXEMPLO })
  });
  const { widget, documento } = montar({ fetch: fetchStub });

  documento.getElementById("datePicker").value = "2026-09-11";
  widget.selecionar("2026-09-10", "08:00-08:45");

  assert.equal(widget.valorEscolhido(), "");
  // E recarrega os horários da data que o hóspede está mesmo a ver.
  assert.equal(fetchStub.pedidos.length, 1);
  assert.equal(fetchStub.pedidos[0].url, widget.RESERVAS_URL + "?data=2026-09-11");
});

test("o painel de diagnóstico só aparece com ?debug=1", () => {
  // Já foi enviado LIGADO e os hóspedes viram uma caixa vermelha com texto
  // técnico dentro do formulário publicado.
  const semDebug = montar();
  semDebug.widget.selecionar("2026-09-08", "08:00-08:45");
  assert.equal(semDebug.documento.getElementById("debug").hidden, true);

  const comDebug = montar({ location: { search: "?debug=1" } });
  comDebug.widget.selecionar("2026-09-08", "08:00-08:45");
  assert.equal(comDebug.documento.getElementById("debug").hidden, false);
});
