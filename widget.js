// ===============================
// CONFIGURAÇÃO
// ===============================
// Web App do Apps Script ligado à folha das respostas (ver reservas.gs e
// docs/instalacao-reservas.md). É ele que conta as vagas e que toma o lugar
// dentro de um mutex — o widget deixou de interpretar uma folha de cálculo.
//
// Pode viver num repositório público: este endereço só devolve contagens de
// vagas e só aceita marcar reservas. Não deixa ler nada da folha.
//
// Se um dia for criada uma IMPLEMENTAÇÃO nova (em vez de uma versão nova da
// mesma), o URL muda e tem de ser trocado aqui, senão o formulário deixa de
// aceitar reservas.
const RESERVAS_URL =
  "https://script.google.com/macros/s/AKfycby8uX6UN3noJ7Y5Ep2uG_y2jvqMavPNEshMAKUkNxYgJL0o52PCbo2lrt8RAJ_Vv7lyAg/exec";

// Bloquear submissão sem horário escolhido
const OBRIGATORIO = true;

// Orçamento de CADA tentativa de reservar.
//
// ATENÇÃO: este número tem de cobrir a espera pelo mutex do reservas.gs
// (ESPERA_LOCK_MS, 3500 ms) MAIS as idas e vindas à folha que vêm depois de o
// obter — só ser maior do que os 3500 não chega, porque um pedido que espere
// perto disso pelo mutex fica com pouca margem para o resto. Descer este
// número abaixo do do servidor é claramente pior, mas nem essa comparação
// sozinha garante que sobra tempo suficiente.
//
// O que torna isto seguro de facto é a IDEMPOTÊNCIA pelo token: se a
// tentativa 1 esgotar o prazo enquanto o servidor ainda está a escrever a
// linha, a tentativa 2 encontra a linha do mesmo token, devolve "repetido" e
// não gasta um segundo lugar (ver reservarLugar). Não mexer num destes
// números sem verificar o outro.
const ORCAMENTO_RESERVA_MS = 5000;

// Painel de diagnóstico. Fica DESLIGADO para quem preenche o formulário
// (aparecia como uma caixa vermelha dentro do formulário publicado).
// Para ligar durante testes há duas maneiras:
//   - pôr DEBUG_FORCADO = true aqui, ou
//   - acrescentar ?debug=1 ao URL do widget no Widget Builder.
const DEBUG_FORCADO = false;
const DEBUG = DEBUG_FORCADO || /[?&]debug=1/.test(location.search);

// Identifica ESTE preenchimento do formulário no servidor. É o que torna a
// repetição do POST segura: com o mesmo token, o servidor devolve
// "repetido" em vez de gastar um segundo lugar (ver reservarLugar).
//
// Tem de casar o ^[A-Za-z0-9-]{8,64}$ que o validarPedido_ exige.
function gerarToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Telemóveis antigos (e qualquer contexto não seguro) não têm
  // crypto.randomUUID. Sem esta rede, o widget rebentava logo no arranque e
  // ninguém conseguia reservar. Não precisa de ser criptográfico: só precisa
  // de não colidir com o token de outro hóspede na mesma hora.
  let t = "";
  while (t.length < 32) {
    t += Math.random().toString(36).replace(/[^a-z0-9]/g, "");
  }
  return t.slice(0, 32);
}

const TOKEN = gerarToken();

// Valor final, ex.: "2026-08-20 | 08:45-09:30"
let value = "";

// Número de geração do último pedido de horários. Ver carregarSlots().
let geracao = 0;

// ===============================
// ELEMENTOS DOM
// ===============================
const datePicker = document.getElementById("datePicker");
const slotsDiv = document.getElementById("slots");
const slotsList = document.getElementById("slotsList");
const estadoDiv = document.getElementById("estado");
const debugDiv = document.getElementById("debug");

const temJF = typeof JFCustomWidget !== "undefined";

// ===============================
// UTILITÁRIOS
// ===============================
function log(msg) {
  console.log("[widget]", msg);
  if (!DEBUG || !debugDiv) return;
  debugDiv.hidden = false;
  const linha = document.createElement("div");
  linha.textContent = msg;
  debugDiv.appendChild(linha);
  ajustarAltura();
}

// Data de hoje em hora local. toISOString() usa UTC e, de madrugada,
// devolveria o dia anterior.
function hojeLocal() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Sem isto o JotForm corta o widget à altura inicial do iframe
function ajustarAltura() {
  if (temJF && JFCustomWidget.requestFrameResize) {
    JFCustomWidget.requestFrameResize({ height: document.body.scrollHeight + 20 });
  }
}

function formatarValor(date, slot) {
  return `${date} | ${slot}`;
}

// ===============================
// LEITURA DAS VAGAS
// ===============================
// Os horários E os limites vêm do servidor (aba Capacidades). O widget já não
// tem lista de slots nenhuma: mudar uma capacidade é mudar uma célula da
// folha, sem republicar nada.
async function buscarVagas(data) {
  // `cache` é uma opção do fetch, não um cabeçalho nosso: continua a ser um
  // pedido simples e não provoca o preflight de CORS que o Apps Script não
  // sabe responder. Sem ele, o browser podia servir uma contagem velha.
  const resposta = await fetch(
    RESERVAS_URL + "?data=" + encodeURIComponent(data),
    { cache: "no-store" }
  );
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

  const corpo = await resposta.json();
  // Um {ok:false} tem sempre um motivo e NUNCA é uma lista de vagas vazia.
  // Tratá-lo como "sem vagas" mostrava "Sem vagas" em todos os horários e
  // deixava o hóspede a acreditar no número.
  if (!corpo || corpo.ok !== true) {
    throw new Error("resposta sem ok: " + ((corpo && corpo.erro) || "desconhecido"));
  }
  return corpo.slots || [];
}

// ===============================
// CARREGAR HORÁRIOS DE UM DIA
// ===============================
async function carregarSlots(selectedDate) {
  if (!selectedDate) return;

  // O <input type="date"> dispara "change" mais do que uma vez
  // enquanto a data é escrita (dia, mês e ano são segmentos
  // separados), por isso podem ficar vários fetch em curso ao mesmo
  // tempo. Sem esta guarda, o que respondesse por ÚLTIMO desenhava os
  // botões — e os botões guardam a data no closure, pelo que ficavam
  // presos a uma data intermédia. Sintoma real observado: escrever
  // 09/10/2026 e a reserva sair como "0202-09-10".
  const minhaGeracao = ++geracao;

  slotsDiv.hidden = false;
  slotsList.textContent = "A carregar...";
  ajustarAltura();

  let slots = [];
  try {
    slots = await buscarVagas(selectedDate);

    // Já há um pedido mais recente: esta resposta está velha.
    if (minhaGeracao !== geracao) return;
  } catch (err) {
    if (minhaGeracao !== geracao) return;
    console.error("Erro ao carregar vagas", err);
    slotsList.textContent = "Erro ao carregar vagas. Tente novamente.";
    log("ERRO no GET das vagas: " + err.message);
    ajustarAltura();
    return;
  }

  slotsList.textContent = "";

  slots.forEach(slot => {
    const horario = String((slot && slot.horario) || "");
    if (!horario) return;
    const restantes = Number(slot.restantes);

    if (!(restantes > 0)) {
      const p = document.createElement("p");
      p.textContent = `${horario} — Sem vagas`;
      slotsList.appendChild(p);
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.slot = horario;
    btn.dataset.restantes = restantes;
    // A data fica no closure de propósito (ver a guarda de geração acima).
    btn.addEventListener("click", () => selecionar(selectedDate, horario));
    slotsList.appendChild(btn);
  });

  desenharBotoes();
  ajustarAltura();
}

// ===============================
// SELECIONAR HORÁRIO
// ===============================
// Escolher não reserva nada: o lugar só é tomado na submissão, para não
// gastar vagas com formulários abandonados.
function selecionar(date, slot) {
  // Defesa em profundidade: um botão guarda a sua data no closure.
  // Se por alguma razão não for a data que está à vista no campo,
  // não gravamos nada — recarregamos os horários da data certa.
  // Evita gravar uma reserva com uma data que o utilizador não vê.
  if (datePicker.value && date !== datePicker.value) {
    log(`IGNORADO: botão de ${date}, campo mostra ${datePicker.value}.`);
    carregarSlots(datePicker.value);
    return;
  }

  value = formatarValor(date, slot);
  desenharBotoes();

  if (temJF) {
    // NÃO É CÓDIGO MORTO. Esta é agora a única forma de a reserva chegar à
    // submissão: o webhook da JotForm lê o valor da resposta do PRÓPRIO
    // widget (chave `q137_typeA137` do rawRequest) e é assim que sabe que
    // lugar confirmar. O espelho num campo normal, que era o caminho
    // "fiável", nunca funcionou — o campo Reserva ficou sempre vazio.
    JFCustomWidget.sendData({ value: value });
    if (JFCustomWidget.hideWidgetError) JFCustomWidget.hideWidgetError();
  }

  log("Selecionado: " + value);
}

// Feedback em TEXTO e em cor. O texto funciona mesmo que o CSS
// não tenha sido colado no painel certo do JotForm.
function desenharBotoes() {
  slotsList.querySelectorAll("button").forEach(btn => {
    const ativo = formatarValor(datePicker.value, btn.dataset.slot) === value;
    // Singular na última vaga: é o estado mais visto de todos, por ser o que
    // antecede "Sem vagas" em cada horário.
    const restantes = Number(btn.dataset.restantes);
    const textoVagas = restantes === 1 ? "1 vaga" : `${btn.dataset.restantes} vagas`;

    btn.textContent = ativo
      ? `✔ ${btn.dataset.slot} — SELECIONADO`
      : `${btn.dataset.slot} (${textoVagas})`;

    btn.classList.toggle("selecionado", ativo);
    btn.setAttribute("aria-pressed", ativo ? "true" : "false");
  });

  if (estadoDiv) {
    estadoDiv.textContent = value
      ? `Reserva escolhida: ${value}`
      : "Nenhum horário escolhido.";
  }
}

// ===============================
// ARRANQUE DA INTERFACE
// ===============================
// Deliberadamente FORA do evento "ready": se a biblioteca do JotForm
// falhar ou o "ready" não chegar, o calendário continua a funcionar.
function iniciarUI() {
  datePicker.min = hojeLocal();

  datePicker.addEventListener("change", () => {
    value = ""; // mudar de dia limpa a escolha
    // Limpa também a resposta do widget no JotForm, não só a variável local:
    // sem isto, a última escolha enviada por sendData ficava presa em
    // q137_typeA137, que é o campo que o webhook lê.
    if (temJF) JFCustomWidget.sendData({ value: "" });
    carregarSlots(datePicker.value);
  });

  desenharBotoes();
  ajustarAltura();
}

iniciarUI();

// ===============================
// RESERVAR O LUGAR NA SUBMISSÃO
// ===============================
// Promise.race com rejeição. Nunca esperamos por um pedido para sempre: o
// formulário está à espera da nossa resposta e um fetch pendurado prendia o
// hóspede no botão de submeter.
function comPrazo(promessa, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("prazo esgotado")), ms);
    promessa.then(
      v => { clearTimeout(id); resolve(v); },
      e => { clearTimeout(id); reject(e); }
    );
  });
}

async function pedirReserva(data, horario) {
  const resposta = await fetch(RESERVAS_URL, {
    method: "POST",
    // text/plain de propósito. É o único Content-Type que mantém isto um
    // "simple request" e evita o preflight de CORS: o Apps Script não tem
    // doOptions e NÃO SABE responder a um OPTIONS. Com application/json o
    // pedido nem chega a sair do browser.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    // O Web App responde 302 para script.googleusercontent.com; é no destino
    // que está o corpo e o cabeçalho de CORS.
    redirect: "follow",
    body: JSON.stringify({
      acao: "reservar",
      token: TOKEN,
      data: data,
      horario: horario
    })
  });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return resposta.json();
}

// Uma repetição, e só uma.
//
// É segura porque o servidor é idempotente pelo token: se o primeiro pedido
// chegou e só a resposta se perdeu, o segundo encontra a linha do mesmo
// token, devolve estado "repetido" e NÃO consome um segundo lugar.
async function reservarLugar(data, horario) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      return await comPrazo(pedirReserva(data, horario), ORCAMENTO_RESERVA_MS);
    } catch (e) {
      ultimoErro = e;
      log(`Tentativa ${tentativa} de reservar falhou: ${e.message}`);
    }
  }
  throw ultimoErro;
}

// O corpo do handler de submissão, separado para poder ser testado.
//
// INVARIANTE: sai daqui por exatamente UM de dois caminhos — sendSubmit ou
// showWidgetError. O formulário fica à espera da nossa resposta (a biblioteca
// envia primeiro um {initial:true}); um ramo que devolva sem responder prende
// o hóspede no botão de submeter para sempre. E o showWidgetError já envia
// sendSubmit({valid:false}) por dentro, por isso nunca se chama sendSubmit
// depois dele.
async function tratarSubmit() {
  log(`Evento 'submit'. Escolha: "${value}"`);

  if (value === "") {
    if (OBRIGATORIO) {
      JFCustomWidget.showWidgetError("Escolha uma data e um horário.");
      return;
    }
    JFCustomWidget.sendSubmit({ valid: true, value: "" });
    return;
  }

  const partes = value.split("|");
  const dataEscolhida = (partes[0] || "").trim();
  const slotEscolhido = (partes[1] || "").trim();

  let r;
  try {
    r = await reservarLugar(dataEscolhida, slotEscolhido);
  } catch (e) {
    // FALHA FECHADA. Ao contrário da revalidação que isto substituiu, aqui
    // não se deixa passar: sem resposta do servidor não há lugar tomado, e
    // deixar passar era vender um lugar que ninguém guardou.
    log("Reserva falhou (" + e.message + "): a recusar.");
    JFCustomWidget.showWidgetError(
      "Não foi possível confirmar a reserva. Tente novamente.");
    return;
  }

  if (r && r.ok === true && r.reservado === true) {
    log(`Lugar reservado (${r.estado}).`);
    JFCustomWidget.sendSubmit({ valid: true, value: value });
    return;
  }

  if (r && r.ok === true && r.motivo === "cheio") {
    log(`RECUSADO: ${slotEscolhido} ficou sem vagas entre a escolha e a submissão.`);
    value = "";
    // Limpa também a resposta do widget no JotForm (ver o mesmo cuidado no
    // "change" do datePicker): sem isto o q137_typeA137 ficava com a reserva
    // recusada, inofensivo só enquanto OBRIGATORIO obrigar a escolher outra.
    if (temJF) JFCustomWidget.sendData({ value: "" });
    desenharBotoes();
    carregarSlots(dataEscolhida);
    JFCustomWidget.showWidgetError(
      "Esse horário acabou de ficar sem vagas. Escolha outro.");
    return;
  }

  // Mensagem própria: o widget ofereceu esta data, e quem escolhesse hoje às
  // 23:50 e submetesse às 00:01 recebia um "tente novamente" que nunca ia
  // funcionar, sem perceber que só tinha de mudar o dia.
  if (r && r.erro === "data_passada") {
    log("RECUSADO: a data escolhida já passou.");
    JFCustomWidget.showWidgetError("Essa data já passou. Escolha outra.");
    return;
  }

  log("Reserva recusada pelo servidor: " + ((r && r.erro) || "sem motivo"));
  JFCustomWidget.showWidgetError(
    "Não foi possível confirmar a reserva. Tente novamente.");
}

// ===============================
// LIGAÇÃO AO JOTFORM
// ===============================
if (!temJF) {
  log("AVISO: JFCustomWidget não existe. O widget não está ligado ao JotForm.");
} else {
  JFCustomWidget.subscribe("ready", function (data) {
    log("Evento 'ready' recebido.");

    // sendData e sendSubmit são ignorados dentro do construtor do
    // JotForm. Testar sempre no link público do formulário.
    if (typeof JFCustomWidget.isWidgetOnBuilder === "function" &&
        JFCustomWidget.isWidgetOnBuilder()) {
      log("AVISO: a correr no construtor. Nada é enviado. Testar no formulário publicado.");
    }

    // Restaurar escolha anterior (voltar atrás numa form de várias páginas)
    if (data && data.value) {
      value = data.value;
      const dataGuardada = value.split("|")[0].trim();
      if (dataGuardada) {
        datePicker.value = dataGuardada;
        carregarSlots(dataGuardada);
      }
    }

    ajustarAltura();
  });

  // É esta subscrição que toma o lugar e deixa a submissão passar.
  JFCustomWidget.subscribe("submit", function () {
    tratarSubmit().catch(function (e) {
      // O catch também RESPONDE. Sem ele, uma exceção inesperada deixava o
      // formulário à espera de uma resposta que nunca chegava.
      log("ERRO inesperado na submissão: " + e.message);
      JFCustomWidget.showWidgetError(
        "Não foi possível confirmar a reserva. Tente novamente.");
    });
  });
}

// Só para os testes em Node. No browser não existe `module` e este bloco é
// ignorado.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RESERVAS_URL: RESERVAS_URL,
    ORCAMENTO_RESERVA_MS: ORCAMENTO_RESERVA_MS,
    TOKEN: TOKEN,
    gerarToken: gerarToken,
    hojeLocal: hojeLocal,
    formatarValor: formatarValor,
    buscarVagas: buscarVagas,
    carregarSlots: carregarSlots,
    selecionar: selecionar,
    desenharBotoes: desenharBotoes,
    comPrazo: comPrazo,
    pedirReserva: pedirReserva,
    reservarLugar: reservarLugar,
    tratarSubmit: tratarSubmit,
    valorEscolhido: function () { return value; }
  };
}
