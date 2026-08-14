// ===============================
// CONFIGURAÇÃO
// ===============================
const SHEETY_GET_URL =
  "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";

// Nome da folha tal como o Sheety a devolve no JSON do GET
const SHEETY_COLLECTION = "folha1";

// Nome da coluna (em camelCase) onde a integração do JotForm grava
// o valor deste widget. Ver instruções no fim do ficheiro.
const COLUNA_RESERVA = "reserva";

// Impedir submissão do formulário sem escolher horário
const OBRIGATORIO = true;

const SLOTS = [
  { time: "08:00-08:45", vagas: 3 },
  { time: "08:45-09:30", vagas: 2 },
  { time: "09:30-10:15", vagas: 3 },
  { time: "10:15-11:00", vagas: 2 }
];

// Valor final enviado ao JotForm, ex.: "2026-08-20 | 08:45-09:30"
let value = "";

// ===============================
// ELEMENTOS DOM
// ===============================
const datePicker = document.getElementById("datePicker");
const slotsDiv = document.getElementById("slots");
const slotsList = document.getElementById("slotsList");

// ===============================
// UTILITÁRIOS
// ===============================

// Data de hoje em hora local (toISOString usa UTC e, de madrugada,
// devolveria o dia anterior)
function hojeLocal() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Ajustar a altura do iframe ao conteúdo, senão o JotForm corta o widget
function ajustarAltura() {
  if (window.JFCustomWidget && JFCustomWidget.requestFrameResize) {
    JFCustomWidget.requestFrameResize({ height: document.body.scrollHeight + 20 });
  }
}

function formatarValor(date, slot) {
  return `${date} | ${slot}`;
}

// ===============================
// CARREGAR HORÁRIOS DE UM DIA
// ===============================
async function carregarSlots(selectedDate) {
  slotsDiv.hidden = false;
  slotsList.textContent = "A carregar...";
  ajustarAltura();

  let reservas = [];
  try {
    const response = await fetch(SHEETY_GET_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    reservas = data[SHEETY_COLLECTION] || [];
  } catch (err) {
    console.error("Erro ao carregar vagas", err);
    slotsList.textContent = "Erro ao carregar vagas. Tente novamente.";
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
    btn.textContent = `${slot.time} (${restantes} vagas)`;
    btn.dataset.slot = slot.time;
    btn.onclick = () => selecionar(selectedDate, slot.time);
    slotsList.appendChild(btn);
  });

  // Se o dia recarregado é o do horário já escolhido, voltar a marcá-lo
  marcarSelecionado();
  ajustarAltura();
}

// ===============================
// SELECIONAR HORÁRIO
// ===============================
// Nada é escrito no Sheety aqui. A linha é criada pela integração do
// JotForm no momento da submissão, para não gastar vagas com
// formulários abandonados e para manter menu + reserva na mesma linha.
function selecionar(date, slot) {
  value = formatarValor(date, slot);
  marcarSelecionado();

  if (window.JFCustomWidget) {
    // Mantém o valor vivo no formulário (condições, cálculos, etc.)
    JFCustomWidget.sendData({ value: value });
    if (JFCustomWidget.hideWidgetError) JFCustomWidget.hideWidgetError();
  }

  console.log("Reserva selecionada:", value);
}

function marcarSelecionado() {
  slotsList.querySelectorAll("button").forEach(btn => {
    const esteValor = formatarValor(datePicker.value, btn.dataset.slot);
    const ativo = esteValor === value;
    btn.classList.toggle("selecionado", ativo);
    btn.setAttribute("aria-pressed", ativo ? "true" : "false");
  });
}

// ===============================
// CICLO DE VIDA DO WIDGET JOTFORM
// ===============================
JFCustomWidget.subscribe("ready", function (data) {
  datePicker.min = hojeLocal();

  // Restaurar escolha anterior (voltar atrás numa form de várias páginas)
  if (data && data.value) {
    value = data.value;
    const [dataGuardada] = value.split("|").map(s => s.trim());
    if (dataGuardada) {
      datePicker.value = dataGuardada;
      carregarSlots(dataGuardada);
    }
  }

  datePicker.addEventListener("change", () => {
    value = ""; // mudar de dia limpa a escolha
    carregarSlots(datePicker.value);
  });

  ajustarAltura();
});

// É esta subscrição que faz o valor chegar à submissão — e, através da
// integração, ao Sheety. Sem ela a coluna fica vazia.
JFCustomWidget.subscribe("submit", function () {
  const valido = !OBRIGATORIO || value !== "";

  if (!valido && JFCustomWidget.showWidgetError) {
    JFCustomWidget.showWidgetError("Escolha uma data e um horário.");
  }

  JFCustomWidget.sendSubmit({
    valid: valido,
    value: value
  });
});
