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

// Regista tudo o que o widget diz ao JotForm. Os setFieldsValueBy* estão cá
// para PROVAR que ninguém lhes toca: o espelho foi apagado por nunca ter
// funcionado, e voltar a escrever por ali seria voltar a acreditar num
// caminho que não avisa quando falha.
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

// As respostas ao formulário. O invariante é que há sempre exatamente uma.
function respostasAoFormulario(chamadas) {
  return chamadas.filter(c => c[0] === "sendSubmit" || c[0] === "showWidgetError");
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

test("mudar de data limpa também a resposta do widget no JotForm", async () => {
  // Mesmo cuidado do ramo "cheio": limpar só a variável `value` local e
  // deixar a escolha anterior presa em q137_typeA137 (via sendData) seria uma
  // reserva fantasma no campo que o webhook lê.
  const { widget, documento, jf } = montar({
    fetch: fetchFalso({ get: async () => resposta({ ok: true, slots: SLOTS_EXEMPLO }) })
  });

  widget.selecionar("2026-09-08", "08:00-08:45");
  jf.chamadas.length = 0;

  const campo = documento.getElementById("datePicker");
  campo.value = "2026-09-09";
  campo.disparar("change");

  assert.deepEqual(
    jf.chamadas.filter(c => c[0] === "sendData"),
    [["sendData", ""]]
  );
  assert.equal(widget.valorEscolhido(), "");
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
    ["08:00-08:45 (1 vaga)", "09:30-10:15 (3 vagas)"]
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

test("um erro de uma geração antiga não apaga os botões de uma geração mais recente", async () => {
  // Espelho do teste acima, mas para o ramo de ERRO do catch: se a guarda de
  // geração ali dentro fosse apagada, um pedido mais lento (e mais velho) que
  // falhasse DEPOIS de a geração nova já ter desenhado os botões substituía-os
  // por "Erro ao carregar vagas", apesar de o hóspede já estar a ver horários
  // válidos e atuais.
  const porResolver = [];
  const { widget, documento } = montar({
    fetch: (url) => new Promise((res, rej) => {
      const data = String(url).split("data=")[1];
      porResolver.push({ res, rej, data });
    })
  });

  const velha = widget.carregarSlots("2026-09-09");
  const nova = widget.carregarSlots("2026-09-10");

  // a nova responde bem primeiro
  porResolver[1].res(resposta({ ok: true, slots: SLOTS_EXEMPLO }));
  await nova;

  const lista = documento.getElementById("slotsList");
  const botoesAntes = lista.querySelectorAll("button").map(b => b.textContent);
  assert.ok(botoesAntes.length > 0);

  // só depois a velha falha
  porResolver[0].rej(new Error("rede em baixo"));
  await velha;

  assert.deepEqual(
    lista.querySelectorAll("button").map(b => b.textContent),
    botoesAntes
  );
  assert.notEqual(lista.textContent, "Erro ao carregar vagas. Tente novamente.");
});

test("desenharBotoes usa singular só na última vaga", async () => {
  // "1 vagas" é português errado, e é o estado mais visto de todos: aparece
  // sempre no último lugar de cada horário, logo antes de passar a "Sem
  // vagas".
  const { widget, documento } = montar({
    fetch: fetchFalso({
      get: async () => resposta({
        ok: true,
        slots: [
          { horario: "08:00-08:45", capacidade: 3, restantes: 1 },
          { horario: "09:30-10:15", capacidade: 3, restantes: 2 }
        ]
      })
    })
  });

  await widget.carregarSlots("2026-09-08");

  assert.deepEqual(
    documento.getElementById("slotsList").querySelectorAll("button").map(b => b.textContent),
    ["08:00-08:45 (1 vaga)", "09:30-10:15 (2 vagas)"]
  );
});

// ===============================
// SELECIONAR
// ===============================
test("selecionar manda o valor pelo sendData — é por aí que o webhook o lê", async () => {
  // NÃO é código morto: a resposta do próprio widget (q137_typeA137) é o
  // único sítio de onde o webhook consegue tirar que lugar confirmar.
  const { widget, jf } = montar({
    fetch: fetchFalso({ get: async () => resposta({ ok: true, slots: SLOTS_EXEMPLO }) })
  });

  widget.selecionar("2026-09-08", "08:00-08:45");

  assert.deepEqual(
    jf.chamadas.filter(c => c[0] === "sendData"),
    [["sendData", "2026-09-08 | 08:00-08:45"]]
  );
  assert.equal(widget.valorEscolhido(), "2026-09-08 | 08:00-08:45");
});

test("o espelho num campo normal desapareceu de vez", async () => {
  // Verificado no formulário publicado: o campo Reserva ficava sempre vazio e
  // o setFieldsValueBy* nunca dava erro. Código que finge funcionar é pior do
  // que código nenhum — foi o que escondeu este bug durante meses.
  const { widget, jf } = montar({
    fetch: fetchFalso({
      get: async () => resposta({ ok: true, slots: SLOTS_EXEMPLO }),
      post: async () => resposta({ ok: true, reservado: true, estado: "novo" })
    })
  });

  widget.selecionar("2026-09-08", "08:00-08:45");
  await widget.tratarSubmit();

  assert.deepEqual(jf.chamadas.filter(c => /setFieldsValue/.test(c[0])), []);
});

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

// ===============================
// PEDIDO DE RESERVA
// ===============================
test("pedirReserva vai em text/plain, e nunca em application/json", async () => {
  // O Apps Script não tem doOptions: com application/json o browser faz um
  // preflight que ninguém responde e o pedido nem sai da máquina do hóspede.
  const fetchStub = fetchFalso({
    post: async () => resposta({ ok: true, reservado: true, estado: "novo" })
  });
  const { widget } = montar({ fetch: fetchStub });

  await widget.pedirReserva("2026-09-08", "08:45-09:30");

  const p = fetchStub.pedidos[0];
  assert.equal(p.url, widget.RESERVAS_URL);
  assert.equal(p.opcoes.method, "POST");
  assert.equal(p.opcoes.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.equal(p.opcoes.redirect, "follow");

  const corpo = JSON.parse(p.opcoes.body);
  assert.equal(corpo.acao, "reservar");
  assert.equal(corpo.data, "2026-09-08");
  assert.equal(corpo.horario, "08:45-09:30");
  assert.match(corpo.token, PADRAO_TOKEN);
});

test("pedirReserva rebenta num HTTP que não seja 2xx", async () => {
  const { widget } = montar({
    fetch: fetchFalso({ post: async () => resposta({}, false, 503) })
  });
  await assert.rejects(() => widget.pedirReserva("2026-09-08", "08:00-08:45"), /HTTP 503/);
});

test("comPrazo desiste com 'prazo esgotado'", async () => {
  const { widget } = montar();
  await assert.rejects(
    () => widget.comPrazo(new Promise(() => {}), 5),
    /prazo esgotado/
  );
});

test("comPrazo apaga o temporizador quando a promessa responde", async () => {
  // Um temporizador esquecido rejeitava DEPOIS de já termos respondido ao
  // formulário, e em Node deixava o processo de testes pendurado.
  const limpos = [];
  const { widget } = montar({
    setTimeout: () => 7,
    clearTimeout: (id) => limpos.push(id)
  });

  await widget.comPrazo(Promise.resolve("ok"), 100);
  assert.deepEqual(limpos, [7]);
});

test("reservarLugar repete uma vez — o servidor é idempotente pelo token", async () => {
  let n = 0;
  const { widget } = montar({
    fetch: fetchFalso({
      post: async () => {
        n += 1;
        if (n === 1) throw new Error("rede");
        return resposta({ ok: true, reservado: true, estado: "repetido" });
      }
    })
  });

  const r = await widget.reservarLugar("2026-09-08", "08:00-08:45");

  assert.equal(n, 2);
  assert.equal(r.estado, "repetido");
});

test("reservarLugar desiste ao fim de duas tentativas, e não de três", async () => {
  let n = 0;
  const { widget } = montar({
    fetch: fetchFalso({ post: async () => { n += 1; throw new Error("rede"); } })
  });

  await assert.rejects(() => widget.reservarLugar("2026-09-08", "08:00-08:45"), /rede/);
  assert.equal(n, 2);
});

// ===============================
// SUBMISSÃO
// ===============================
// O formulário fica à espera da resposta do widget. Todos os testes daqui
// para baixo verificam a MESMA coisa além do seu assunto: que sai daqui
// exatamente uma resposta.
function comEscolha(stubs) {
  const montado = montar(stubs);
  montado.widget.selecionar("2026-09-08", "08:00-08:45");
  montado.jf.chamadas.length = 0;
  return montado;
}

test("submeter sem escolha, sendo obrigatório, mostra o erro e não deixa passar", async () => {
  const { widget, jf } = montar();

  await widget.tratarSubmit();

  assert.deepEqual(respostasAoFormulario(jf.chamadas), [
    ["showWidgetError", "Escolha uma data e um horário."]
  ]);
});

test("submeter sem escolha, não sendo obrigatório, deixa passar em branco", async () => {
  const trocar = (fonte) => {
    const novo = fonte.replace("const OBRIGATORIO = true;", "const OBRIGATORIO = false;");
    assert.notEqual(novo, fonte, "a linha do OBRIGATORIO mudou de forma");
    return novo;
  };
  const { widget, jf } = montar({ transformarFonte: trocar });

  await widget.tratarSubmit();

  assert.deepEqual(respostasAoFormulario(jf.chamadas), [
    ["sendSubmit", { valid: true, value: "" }]
  ]);
});

test("com o lugar reservado, a submissão passa com o valor escolhido", async () => {
  const { widget, jf } = comEscolha({
    fetch: fetchFalso({
      post: async () => resposta({ ok: true, reservado: true, estado: "novo" })
    })
  });

  await widget.tratarSubmit();

  assert.deepEqual(respostasAoFormulario(jf.chamadas), [
    ["sendSubmit", { valid: true, value: "2026-09-08 | 08:00-08:45" }]
  ]);
});

test("um horário que ficou cheio recusa, limpa a escolha e recarrega os horários", async () => {
  const fetchStub = fetchFalso({
    get: async () => resposta({ ok: true, slots: SLOTS_EXEMPLO }),
    post: async () => resposta({ ok: true, reservado: false, motivo: "cheio", restantes: 0 })
  });
  const { widget, jf } = comEscolha({ fetch: fetchStub });

  await widget.tratarSubmit();

  assert.deepEqual(respostasAoFormulario(jf.chamadas), [
    ["showWidgetError", "Esse horário acabou de ficar sem vagas. Escolha outro."]
  ]);
  // O showWidgetError já envia sendSubmit({valid:false}) por dentro.
  assert.deepEqual(jf.chamadas.filter(c => c[0] === "sendSubmit"), []);
  assert.equal(widget.valorEscolhido(), "");
  assert.ok(
    fetchStub.pedidos.some(p => String(p.url).indexOf("?data=2026-09-08") >= 0),
    "devia ter recarregado os horários do dia"
  );
});

test("um horário que ficou cheio limpa também a resposta do widget no JotForm", async () => {
  // Não basta apagar a variável local `value`: sem limpar sendData, a
  // reserva recusada continuava presa em q137_typeA137, que é o campo que o
  // webhook lê. Inofensivo só enquanto OBRIGATORIO impedir submeter em
  // branco — o dia em que isso mudar, isto seria uma confirmação fantasma.
  const fetchStub = fetchFalso({
    get: async () => resposta({ ok: true, slots: SLOTS_EXEMPLO }),
    post: async () => resposta({ ok: true, reservado: false, motivo: "cheio", restantes: 0 })
  });
  const { widget, jf } = comEscolha({ fetch: fetchStub });

  await widget.tratarSubmit();

  assert.deepEqual(
    jf.chamadas.filter(c => c[0] === "sendData"),
    [["sendData", ""]]
  );
});

test("uma data que já passou tem mensagem própria", async () => {
  // Escolher hoje às 23:50 e submeter às 00:01 dava um "tente novamente" que
  // nunca ia funcionar, numa data que o próprio widget tinha oferecido.
  const { widget, jf } = comEscolha({
    fetch: fetchFalso({ post: async () => resposta({ ok: false, erro: "data_passada" }) })
  });

  await widget.tratarSubmit();

  assert.deepEqual(respostasAoFormulario(jf.chamadas), [
    ["showWidgetError", "Essa data já passou. Escolha outra."]
  ]);
});

test("um ok:false qualquer falha FECHADA", async () => {
  const { widget, jf } = comEscolha({
    fetch: fetchFalso({ post: async () => resposta({ ok: false, erro: "lock_indisponivel" }) })
  });

  await widget.tratarSubmit();

  assert.deepEqual(respostasAoFormulario(jf.chamadas), [
    ["showWidgetError", "Não foi possível confirmar a reserva. Tente novamente."]
  ]);
  assert.deepEqual(jf.chamadas.filter(c => c[0] === "sendSubmit"), []);
});

test("sem resposta do servidor depois da repetição, falha FECHADA", async () => {
  // Ao contrário da revalidação que isto substituiu, aqui não se deixa
  // passar: sem resposta não há lugar tomado, e deixar passar era vender um
  // lugar que ninguém guardou.
  let n = 0;
  const { widget, jf } = comEscolha({
    fetch: fetchFalso({ post: async () => { n += 1; throw new Error("rede"); } })
  });

  await widget.tratarSubmit();

  assert.equal(n, 2);
  assert.deepEqual(respostasAoFormulario(jf.chamadas), [
    ["showWidgetError", "Não foi possível confirmar a reserva. Tente novamente."]
  ]);
});

test("o subscritor do submit responde mesmo quando alguma coisa estoura", async () => {
  // Sem o .catch a responder, uma exceção inesperada deixava o hóspede preso
  // no botão de submeter, à espera de uma resposta que nunca chegava.
  const jf = jotformFalso();
  let primeira = true;
  jf.api.sendSubmit = (d) => {
    jf.chamadas.push(["sendSubmit", d]);
    if (primeira) { primeira = false; throw new Error("postMessage falhou"); }
  };
  const { widget } = carregarWidget(CAMINHO, {
    JFCustomWidget: jf.api,
    fetch: fetchFalso({
      post: async () => resposta({ ok: true, reservado: true, estado: "novo" })
    })
  });
  widget.selecionar("2026-09-08", "08:00-08:45");
  jf.chamadas.length = 0;

  jf.subs.submit();
  await new Promise(r => setTimeout(r, 20));

  assert.deepEqual(jf.chamadas.map(c => c[0]), ["sendSubmit", "showWidgetError"]);
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
