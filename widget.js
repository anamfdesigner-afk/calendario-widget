// ===============================
// CONFIGURAÇÃO
// ===============================
const SHEETY_GET_URL =
  "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";

// Nome da folha tal como o Sheety a devolve no JSON do GET
const SHEETY_COLLECTION = "folha1";

// Nomes das colunas (camelCase) tal como o Sheety as devolve.
// A folha ATUAL usa duas colunas separadas: "data" e "horario".
// Versões antigas gravavam tudo numa coluna combinada
// ("2026-08-20 | 08:45-09:30") — COLUNA_RESERVA cobre esse caso antigo.
// Confirmar na linha "Colunas na folha:" do painel de diagnóstico.
const COLUNA_DATA = "data";
const COLUNA_HORARIO = "horario";
const COLUNA_RESERVA = "resultado";

// LABEL exata do campo Short Text criado no JotForm que vai receber
// uma cópia do valor. É este campo normal que a integração exporta.
// Pôr "" para desligar o espelho.
//
// TEM de coincidir letra a letra com a label no formulário. Estava
// "Resultado", mas o campo do formulário chama-se "Reserva" (id_135,
// nome único "respostaFinal"): o setFieldsValueByLabel não encontrava
// nada, não dava erro, e o valor nunca chegava à submissão.
const CAMPO_ESPELHO_LABEL = "Reserva";

// ID da pergunta do mesmo campo ("id_135" no HTML do formulário ->
// "135"). Escrevemos por ID **e** por LABEL: o ID não se estraga se
// alguém renomear a label, e a label continua a funcionar se o campo
// for recriado com outro ID. Pôr "" para desligar.
const CAMPO_ESPELHO_ID = "135";

// Bloquear submissão sem horário escolhido
const OBRIGATORIO = true;

// Painel de diagnóstico. Fica DESLIGADO para quem preenche o formulário
// (aparecia como uma caixa vermelha dentro do formulário publicado).
// Para ligar durante testes há duas maneiras:
//   - pôr DEBUG_FORCADO = true aqui, ou
//   - acrescentar ?debug=1 ao URL do widget no Widget Builder.
const DEBUG_FORCADO = false;
const DEBUG = DEBUG_FORCADO || /[?&]debug=1/.test(location.search);

const SLOTS = [
  { time: "08:00-08:45", vagas: 3 },
  { time: "08:45-09:30", vagas: 2 },
  { time: "09:30-10:15", vagas: 3 },
  { time: "10:15-11:00", vagas: 2 }
];

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

// O Google Sheets devolve às vezes a data como ISO completo
// ("2025-12-31T00:00:00.000Z"). Só queremos YYYY-MM-DD.
function normalizarData(v) {
  const t = String(v == null ? "" : v).trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : t;
}

// Uma linha da folha ocupa este slot se:
//  - as colunas separadas "data"+"horario" coincidirem, OU
//  - a coluna combinada "resultado" for igual a "data | horario".
// Aceitar as duas formas evita que a contagem volte a falhar em
// silêncio se o formato da folha mudar.
function linhaOcupaSlot(r, selectedDate, slotTime) {
  const d = normalizarData(r[COLUNA_DATA]);
  const h = String(r[COLUNA_HORARIO] == null ? "" : r[COLUNA_HORARIO]).trim();
  if (d && h) return d === selectedDate && h === slotTime;

  const combinado = String(r[COLUNA_RESERVA] == null ? "" : r[COLUNA_RESERVA]).trim();
  return combinado === formatarValor(selectedDate, slotTime);
}

// ===============================
// ESPELHO NUM CAMPO NORMAL
// ===============================
// A integração do JotForm exporta campos normais de forma fiável, mas
// não a resposta deste widget. Copiamos o valor para um Short Text.
// O método correto é setFieldsValueByLabel (setFieldsValue NÃO existe).
// ATENÇÃO: por dentro, o setFieldsValueBy* é só um postMessage para o
// formulário ("fields:fill"). Não devolve nada e não dá erro se o
// campo não existir. Um alvo errado é indistinguível de sucesso visto
// de dentro do widget — foi por isso que isto falhou tanto tempo em
// silêncio. Escrevemos pelos DOIS caminhos para reduzir o risco.
function espelharEmCampo(v) {
  if (!temJF) return;

  let enviado = false;

  if (CAMPO_ESPELHO_ID &&
      typeof JFCustomWidget.setFieldsValueById === "function") {
    try {
      const porId = {};
      porId[CAMPO_ESPELHO_ID] = v;
      JFCustomWidget.setFieldsValueById(porId);
      enviado = true;
      log(`Espelho enviado por ID ${CAMPO_ESPELHO_ID}: ${v}`);
    } catch (e) {
      log("ERRO no espelho por ID: " + e.message);
    }
  }

  if (CAMPO_ESPELHO_LABEL &&
      typeof JFCustomWidget.setFieldsValueByLabel === "function") {
    try {
      const porLabel = {};
      porLabel[CAMPO_ESPELHO_LABEL] = v;
      JFCustomWidget.setFieldsValueByLabel(porLabel);
      enviado = true;
      log(`Espelho enviado por LABEL "${CAMPO_ESPELHO_LABEL}": ${v}`);
    } catch (e) {
      log("ERRO no espelho por LABEL: " + e.message);
    }
  }

  if (!enviado) {
    log("AVISO: a API não tem setFieldsValueById nem ...ByLabel.");
  }
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

  let reservas = [];
  try {
    const response = await fetch(SHEETY_GET_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Já há um pedido mais recente: esta resposta está velha.
    if (minhaGeracao !== geracao) return;

    reservas = data[SHEETY_COLLECTION] || [];

    if (reservas.length) {
      log("Colunas na folha: " + Object.keys(reservas[0]).join(", "));
      const separadas = reservas.filter(
        r => r[COLUNA_DATA] && r[COLUNA_HORARIO]
      ).length;
      const combinadas = reservas.filter(r => r[COLUNA_RESERVA]).length;
      log(`${reservas.length} linhas: ${separadas} com "${COLUNA_DATA}"+"${COLUNA_HORARIO}", ${combinadas} com "${COLUNA_RESERVA}"`);
      if (separadas === 0 && combinadas === 0) {
        log("AVISO: nenhuma coluna reconhecida. As vagas nunca vão descer.");
      }
    } else {
      log("A folha está vazia (0 linhas).");
    }
  } catch (err) {
    if (minhaGeracao !== geracao) return;
    console.error("Erro ao carregar vagas", err);
    slotsList.textContent = "Erro ao carregar vagas. Tente novamente.";
    log("ERRO no GET ao Sheety: " + err.message);
    ajustarAltura();
    return;
  }

  slotsList.textContent = "";

  SLOTS.forEach(slot => {
    const usadas = reservas.filter(
      r => linhaOcupaSlot(r, selectedDate, slot.time)
    ).length;
    const restantes = slot.vagas - usadas;

    if (restantes <= 0) {
      const p = document.createElement("p");
      p.textContent = `${slot.time} — Sem vagas`;
      slotsList.appendChild(p);
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.slot = slot.time;
    btn.dataset.restantes = restantes;
    btn.addEventListener("click", () => selecionar(selectedDate, slot.time));
    slotsList.appendChild(btn);
  });

  desenharBotoes();
  ajustarAltura();
}

// ===============================
// SELECIONAR HORÁRIO
// ===============================
// Nada é escrito no Sheety aqui. A linha é criada pela integração do
// JotForm na submissão, para não gastar vagas com formulários
// abandonados e para manter menu + reserva na mesma linha.
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
    JFCustomWidget.sendData({ value: value });
    if (JFCustomWidget.hideWidgetError) JFCustomWidget.hideWidgetError();
  }

  espelharEmCampo(value);
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

    espelharEmCampo(value);

    JFCustomWidget.sendSubmit({
      valid: true,
      value: value
    });
  });
}
