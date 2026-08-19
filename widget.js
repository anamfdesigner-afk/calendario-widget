// ===============================
// CONFIGURAÇÃO
// ===============================
const SHEETY_GET_URL =
  "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";

// Nome da folha tal como o Sheety a devolve no JSON do GET
const SHEETY_COLLECTION = "folha1";

// Nome da coluna (camelCase) onde a reserva fica gravada na folha.
// O Sheety converte o cabeçalho "Resultado" na chave "resultado".
// Confirmar na linha "Colunas na folha:" do painel de diagnóstico.
const COLUNA_RESERVA = "resultado";

// LABEL exata do campo Short Text criado no JotForm que vai receber
// uma cópia do valor. É este campo normal que a integração exporta.
// Pôr "" para desligar o espelho.
const CAMPO_ESPELHO_LABEL = "Resultado";

// Bloquear submissão sem horário escolhido
const OBRIGATORIO = true;

// Painel de diagnóstico visível dentro do widget. Pôr false no fim.
const DEBUG = true;

const SLOTS = [
  { time: "08:00-08:45", vagas: 3 },
  { time: "08:45-09:30", vagas: 2 },
  { time: "09:30-10:15", vagas: 3 },
  { time: "10:15-11:00", vagas: 2 }
];

// Valor final, ex.: "2026-08-20 | 08:45-09:30"
let value = "";

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
// ESPELHO NUM CAMPO NORMAL
// ===============================
// A integração do JotForm exporta campos normais de forma fiável, mas
// não a resposta deste widget. Copiamos o valor para um Short Text.
// O método correto é setFieldsValueByLabel (setFieldsValue NÃO existe).
function espelharEmCampo(v) {
  if (!CAMPO_ESPELHO_LABEL || !temJF) return;

  if (typeof JFCustomWidget.setFieldsValueByLabel !== "function") {
    log("AVISO: setFieldsValueByLabel não existe nesta versão da API.");
    return;
  }

  try {
    const campos = {};
    campos[CAMPO_ESPELHO_LABEL] = v;
    JFCustomWidget.setFieldsValueByLabel(campos);
    log(`Espelhado em "${CAMPO_ESPELHO_LABEL}": ${v}`);
  } catch (e) {
    log("ERRO ao espelhar: " + e.message);
  }
}

// ===============================
// CARREGAR HORÁRIOS DE UM DIA
// ===============================
async function carregarSlots(selectedDate) {
  if (!selectedDate) return;

  slotsDiv.hidden = false;
  slotsList.textContent = "A carregar...";
  ajustarAltura();

  let reservas = [];
  try {
    const response = await fetch(SHEETY_GET_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    reservas = data[SHEETY_COLLECTION] || [];

    if (reservas.length) {
      log("Colunas na folha: " + Object.keys(reservas[0]).join(", "));
      const comValor = reservas.filter(r => r[COLUNA_RESERVA]).length;
      log(`${comValor} de ${reservas.length} linhas têm "${COLUNA_RESERVA}" preenchido`);
      if (comValor === 0) {
        log(`AVISO: nenhuma linha tem "${COLUNA_RESERVA}". As vagas nunca vão descer.`);
      }
    } else {
      log("A folha está vazia (0 linhas).");
    }
  } catch (err) {
    console.error("Erro ao carregar vagas", err);
    slotsList.textContent = "Erro ao carregar vagas. Tente novamente.";
    log("ERRO no GET ao Sheety: " + err.message);
    ajustarAltura();
    return;
  }

  slotsList.textContent = "";

  SLOTS.forEach(slot => {
    const alvo = formatarValor(selectedDate, slot.time);
    const usadas = reservas.filter(
      r => String(r[COLUNA_RESERVA] || "").trim() === alvo
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
