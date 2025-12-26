// ===============================
// CONFIGURAÇÃO
// ===============================

const SHEETY_URL =
  "https://api.sheety.co/76a6d2f0ca2083ffa98601cdbdc2e82c/boCalendarioMontecarmo/folha1";

const SLOTS = [
  { time: "08:00-08:45", vagas: 3 },
  { time: "08:45-09:30", vagas: 2 },
  { time: "09:30-10:15", vagas: 3 },
  { time: "10:15-11:00", vagas: 2 }
];

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

  slotsDiv.hidden = false;
  slotsList.innerHTML = "";

  try {
    const response = await fetch(SHEETY_URL);
    const data = await response.json();
    const reservas = data.folha1 || [];

    SLOTS.forEach(slot => {
      const usadas = reservas.filter(
        r => r.data === selectedDate && r.horário === slot.time
      ).length;

      if (usadas >= slot.vagas) {
        const p = document.createElement("p");
        p.textContent = `${slot.time} — Sem vagas`;
        slotsList.appendChild(p);
      } else {
        const btn = document.createElement("button");
        btn.textContent = `${slot.time}`;
        btn.onclick = () => reservar(selectedDate, slot.time);
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

async function reservar(date, slot) {
  try {
    // 1️⃣ Guardar no Sheety
    await fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folha1: {
          data: date,
          horário: slot
        }
      })
    });

    // 2️⃣ Enviar resposta ao Jotform
    const value = `${date} | ${slot}`;

    if (window.JotFormCustomWidget) {
      JotFormCustomWidget.sendSubmit(value);
    } else {
      console.error("JotFormCustomWidget não disponível");
    }
  } catch (err) {
    console.error("Erro ao reservar", err);
    alert("Erro ao reservar. Tenta novamente.");
  }
}
