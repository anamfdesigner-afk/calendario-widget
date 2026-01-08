// ===============================
// CONFIGURAÇÃO
// ===============================
const SHEETY_URL = "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";
const SHEETY_TOKEN = ""; // se não tiver token, deixa vazio
const SLOTS = [
  { time: "08:00-08:45", vagas: 3 },
  { time: "08:45-09:30", vagas: 2 },
  { time: "09:30-10:15", vagas: 3 },
  { time: "10:15-11:00", vagas: 2 }
];

let reservado = false;
let reservaFinal = "";

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
// AO ESCOLHER O DIA
// ===============================
datePicker.addEventListener("change", async () => {
  const selectedDate = datePicker.value;
  reservado = false;
  slotsDiv.hidden = false;
  slotsList.innerHTML = "";

  try {
    console.log("⏳ Fetching reservas do Sheety...");
    const response = await fetch(SHEETY_URL, {
      headers: SHEETY_TOKEN ? { "Authorization": `Bearer ${SHEETY_TOKEN}` } : {}
    });
    const data = await response.json();
    const reservas = data.folha1 || [];
    console.log("✅ Dados recebidos do Sheety:", reservas);

    SLOTS.forEach(slot => {
      const usadas = reservas.filter(
        r => r.data === selectedDate && r.horario === slot.time
      ).length;
      const restantes = slot.vagas - usadas;

      if (restantes <= 0) {
        const p = document.createElement("p");
        p.textContent = `${slot.time} — Sem vagas`;
        slotsList.appendChild(p);
      } else {
        const btn = document.createElement("button");
        btn.textContent = `${slot.time} (${restantes} vagas)`;
        btn.onclick = () => {
          if (!reservado) reservar(selectedDate, slot.time, btn);
        };
        slotsList.appendChild(btn);
      }
    });
  } catch (err) {
    console.error("Erro ao carregar vagas", err);
    slotsList.innerHTML = "<p>Erro ao carregar vagas.</p>";
  }
});

// ===============================
// RESERVAR + ENVIAR AO JOTFORM
// ===============================
async function reservar(date, slot, clickedButton) {
  reservado = true;

  // Desactivar todos os botões
  slotsList.querySelectorAll("button").forEach(btn => (btn.disabled = true));

  // Feedback visual
  clickedButton.textContent = `${slot} — Selecionado`;

  reservaFinal = `${date} | ${slot}`;

  // Atualizar o campo oculto do JotForm
  const hiddenField = document.querySelector('[name="RespostaFinal"]');
  if (hiddenField) hiddenField.value = reservaFinal;

  try {
    // Guardar no Sheety
    await fetch(SHEETY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SHEETY_TOKEN && { "Authorization": `Bearer ${SHEETY_TOKEN}` })
      },
      body: JSON.stringify({ folha1: { data: date, horario: slot } })
    });
    console.log("✅ Reserva gravada no Sheety:", { data: date, horario: slot });

    // Enviar valor para o JotForm Custom Widget
    if (window.JFCustomWidget) {
      JFCustomWidget.sendSubmit({ value: reservaFinal, valid: true });
      console.log("✅ JotFormCustomWidget atualizado com sucesso");
    }
  } catch (err) {
    console.error("Erro ao reservar", err);
    alert("Erro ao reservar. Tenta novamente.");
  }
}

// ===============================
// AJUSTAR IFRAME JOTFORM (opcional)
// ===============================
if (window.JFCustomWidget) {
  JFCustomWidget.requestFrameResize({ height: 400 });
}
