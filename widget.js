// ===============================
// CONFIGURAÇÃO
// ===============================
const SHEETY_URL = "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";

const SLOTS = [
  { time: "08:00-08:45", vagas: 3 },
  { time: "08:45-09:30", vagas: 2 },
  { time: "09:30-10:15", vagas: 3 },
  { time: "10:15-11:00", vagas: 2 }
];

let reservado = false;
let respostaFinal = "";

// ===============================
// ELEMENTOS DOM
// ===============================
const datePicker = document.getElementById("datePicker");
const slotsDiv = document.getElementById("slots");
const slotsList = document.getElementById("slotsList");

// ===============================
// BLOQUEAR DIAS PASSADOS
// ===============================
const today = new Date().toISOString().split("T")[0];
datePicker.min = today;

// ===============================
// FUNÇÃO DE FETCH DAS RESERVAS
// ===============================
async function fetchReservas() {
  try {
    const response = await fetch(SHEETY_URL);
    const data = await response.json();
    return data.folha1 || [];
  } catch (err) {
    console.error("Erro ao carregar vagas do Sheety", err);
    return [];
  }
}

// ===============================
// AO ESCOLHER O DIA
// ===============================
datePicker.addEventListener("change", async () => {
  const selectedDate = datePicker.value;
  reservado = false;
  slotsDiv.hidden = false;
  slotsList.innerHTML = "";

  const reservas = await fetchReservas();

  SLOTS.forEach(slot => {
    const usadas = reservas.filter(r => r.data === selectedDate && r.horario === slot.time).length;
    const restantes = slot.vagas - usadas;

    if (restantes <= 0) {
      const p = document.createElement("p");
      p.textContent = `${slot.time} — Sem vagas`;
      slotsList.appendChild(p);
    } else {
      const btn = document.createElement("button");
      btn.textContent = `${slot.time} (${restantes} vagas)`;
      btn.onclick = () => {
        if (!reservado) {
          reservar(selectedDate, slot.time, btn);
        }
      };
      slotsList.appendChild(btn);
    }
  });
});

// ===============================
// FUNÇÃO RESERVAR
// ===============================
async function reservar(date, slot, clickedButton) {
  reservado = true;

  // Desativa todos os botões
  const buttons = slotsList.querySelectorAll("button");
  buttons.forEach(btn => (btn.disabled = true));

  // Feedback visual
  clickedButton.textContent = `${slot} — Selecionado`;

  try {
    // Guardar no Sheety
    await fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folha1: { data: date, horario: slot } })
    });

    // Atualiza valor global
    respostaFinal = `${date} | ${slot}`;
    console.log("💾 Resposta final:", respostaFinal);

    // Envia para o JotForm se estivermos dentro do iframe
    waitForJFCustomWidget(() => {
      // Se queres obrigatório, podes usar sendSubmit({ valid: true, value })
      JFCustomWidget.sendData({ value: respostaFinal });
    });

  } catch (err) {
    console.error("Erro ao reservar", err);
    alert("Erro ao reservar. Tenta novamente.");
  }
}

// ===============================
// INTEGRAÇÃO SEGURA COM JOTFORM
// ===============================
function waitForJFCustomWidget(callback) {
  if (window.JFCustomWidget) {
    callback();
    // Permite que o form leia o valor atual
    JFCustomWidget.subscribe("getData", () => ({ value: respostaFinal }));
    console.log("✅ JotFormCustomWidget detectado e configurado");
  } else {
    setTimeout(() => waitForJFCustomWidget(callback), 50);
  }
}
