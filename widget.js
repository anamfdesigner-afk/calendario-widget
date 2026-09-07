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

// Quanto tempo esperamos pela revalidação das vagas na submissão.
// Se o servidor não responder neste tempo, DEIXAMOS PASSAR: bloquear
// todas as reservas porque a API está lenta é pior do que o risco de
// uma reserva a mais.
const TIMEOUT_REVALIDACAO_MS = 4000;

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

    btn.textContent = ativo
      ? `✔ ${btn.dataset.slot} — SELECIONADO`
      : `${btn.dataset.slot} (${btn.dataset.restantes} vagas)`;

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
    carregarSlots(datePicker.value);
  });

  desenharBotoes();
  ajustarAltura();
}

iniciarUI();

// ===============================
// REVALIDAÇÃO NA SUBMISSÃO
// ===============================
// As vagas são lidas quando o dia é aberto. Entre esse momento e a
// submissão pode passar muito tempo, e outra pessoa pode ficar com o
// último lugar — dois hóspedes viam "1 vaga" e ambos reservavam.
// Aqui voltamos a contar imediatamente antes de submeter.
//
// LIMITE: isto encurta a janela, não a fecha. Duas submissões
// simultâneas podem passar as duas na verificação. Fechar a janela por
// completo exige uma reserva atómica do lado do servidor.
async function slotAindaTemVagas(date, slot) {
  try {
    const slots = await buscarVagas(date);
    const def = slots.find(s => s && s.horario === slot);
    const restantes = def ? Number(def.restantes) : 0;
    log(`Revalidação: ${slot} em ${date} -> ${restantes} vaga(s).`);
    return { cheio: !(restantes > 0) };
  } catch (e) {
    // Falha de rede: não bloqueamos (ver TIMEOUT_REVALIDACAO_MS).
    log("Revalidação falhou (" + e.message + "): a deixar passar.");
    return { cheio: false };
  }
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

  // É esta subscrição que faz o valor chegar à submissão.
  JFCustomWidget.subscribe("submit", function () {
    log(`Evento 'submit'. A enviar: "${value}"`);

    if (OBRIGATORIO && value === "") {
      // showWidgetError já envia sendSubmit({valid:false}) por dentro,
      // por isso não voltamos a chamar sendSubmit aqui.
      JFCustomWidget.showWidgetError("Escolha uma data e um horário.");
      return;
    }

    // Sem horário escolhido e não obrigatório: nada para revalidar.
    if (value === "") {
      JFCustomWidget.sendSubmit({ valid: true, value: value });
      return;
    }

    const partes = value.split("|");
    const dataEscolhida = (partes[0] || "").trim();
    const slotEscolhido = (partes[1] || "").trim();

    // Promise.race: ou a revalidação responde, ou desistimos e
    // deixamos passar. Nunca deixamos a submissão pendurada.
    const desistir = new Promise(resolve => {
      setTimeout(() => resolve({ indeterminado: true }), TIMEOUT_REVALIDACAO_MS);
    });

    Promise.race([slotAindaTemVagas(dataEscolhida, slotEscolhido), desistir])
      .then(r => {
        if (r && r.cheio) {
          log(`RECUSADO: ${slotEscolhido} ficou sem vagas entre a escolha e a submissão.`);
          value = "";
          carregarSlots(dataEscolhida);
          // showWidgetError já envia sendSubmit({valid:false}).
          JFCustomWidget.showWidgetError(
            "Esse horário acabou de ficar sem vagas. Escolha outro."
          );
          return;
        }

        if (r && r.indeterminado) {
          log("Revalidação sem resposta em tempo útil: a deixar passar.");
        }

        JFCustomWidget.sendSubmit({ valid: true, value: value });
      })
      .catch(e => {
        // Nunca deixar a submissão pendurada. O formulário espera uma
        // resposta nossa (a lib envia primeiro um {initial:true}); se
        // aqui estourasse uma exceção, o hóspede ficava preso no botão
        // de submeter para sempre.
        log("ERRO na revalidação: " + e.message + " — a deixar passar.");
        JFCustomWidget.sendSubmit({ valid: true, value: value });
      });
  });
}

// Só para os testes em Node. No browser não existe `module` e este bloco é
// ignorado.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RESERVAS_URL: RESERVAS_URL,
    TOKEN: TOKEN,
    gerarToken: gerarToken,
    hojeLocal: hojeLocal,
    formatarValor: formatarValor,
    buscarVagas: buscarVagas,
    carregarSlots: carregarSlots,
    selecionar: selecionar,
    desenharBotoes: desenharBotoes,
    slotAindaTemVagas: slotAindaTemVagas,
    valorEscolhido: function () { return value; }
  };
}
