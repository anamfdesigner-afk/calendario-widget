// ===============================
// CONFIGURAÇÃO
// ===============================

const SHEETY_URL =
  "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";

const SLOTS = [
  { time: "08:00-08:45", vagas: 3 },
  { time: "08:45-09:30", vagas: 2 },
  { time: "09:30-10:15", vagas: 3 },
  { time: "10:15-11:00", vagas: 2 }
];

// ===============================
// ESTADO
// ===============================

let respostaFinal = "";      // valor que vai para o Jotform
let reservado = false;      // impede múltiplas seleções
let jotformReady = false;   // garante lifecycle correto

// ===============================
// JOTFORM LIFECYCLE (OBRIGATÓRIO)
// ===============================

JFCustomWidget.subscribe("ready", function () {
  jotformReady = true;
  console.log("✅ Jotform ready");
});

JFCustomWidget.subscribe("submit", function () {
  console.log("📨 Submit recebido pelo widget");

  if (!respostaFinal) {
    JFCustomWidget.sendSubmit({
      valid: false,
      value: ""
    });
    return;
  }

  JFCustomWidget.sendSubmit({
    valid: true,
    value: respostaFinal
  });
});

// ===============================
// ELEMENTOS DOM
// ===============================

document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ DOM carregado");

  const datePicker = document.getElementById("datePicker");
  const slotsDiv = document.getElementById("slots");
  const slotsList = document.getElementById("slotsList");

  // bloquear dias passados
  const today = new Date().toISOString().split("T")[0];
  datePicker.min = today;

  // ===============================
  // AO ESCOLHER DATA
  // ===============================

  datePicker.addEventListener("change", async () => {
    const selectedDate = datePicker.value;
    console.log("📅 Data selecionada:", selectedDate);

    reservado = false;
    respostaFinal = "";
    slotsDiv.hidden = false;
    slotsList.innerHTML = "";

    try {
      console.log("⏳ Fetching reservas do Sheety...");
      const response = await fetch(SHEETY_URL);
      const data = await response.json();
      const reservas = data.folha1 || [];

      console.log("✅ Dados recebidos do Sheety:", data);

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
            if (!reservado) {
              reservar(selectedDate, slot.time, btn, slotsList);
            }
          };

          slotsList.appendChild(btn);
        }
      });
    } catch (err) {
      console.error("❌ Erro ao carregar vagas:", err);
      slotsList.innerHTML = "<p>Erro ao carregar vagas.</p>";
    }
  });
});

// ===============================
// RESERVAR SLOT
// ===============================

async function reservar(date, slot, clickedButton, slotsList) {
  reservado = true;
  respostaFinal = `${date} | ${slot}`;

  console.log("🖱️ Slot clicado:", respostaFinal);

  // desativar botões
  slotsList.querySelectorAll("button").forEach(btn => {
    btn.disabled = true;
  });

  clickedButton.textContent = `${slot} — Selecionado`;

  try {
    await fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folha1: {
          data: date,
          horario: slot
        }
      })
    });

    console.log("✅ Reserva gravada no Sheety");
  } catch (err) {
    console.error("❌ Erro ao gravar reserva:", err);
    alert("Erro ao reservar. Tenta novamente.");
  }
}
