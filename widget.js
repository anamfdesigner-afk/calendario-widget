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
const hiddenField = document.getElementById("input_135"); // campo hidden no JotForm

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

  console.log("📅 Data selecionada:", selectedDate);

  try {
    console.log("⏳ Fetching reservas do Sheety...");
    const response = await fetch(SHEETY_URL);
    const data = await response.json();
    const reservas = data.folha1 || [];
    console.log("✅ Dados recebidos do Sheety:", data);

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
  } catch (err) {
    console.error("Erro ao carregar vagas", err);
    slotsList.innerHTML = "<p>Erro ao carregar vagas.</p>";
  }
});

// ===============================
// RESERVAR + ENVIAR
// ===============================
async function reservar(date, slot, clickedButton) {
  reservado = true;

  // Desativar todos os botões
  const buttons = slotsList.querySelectorAll("button");
  buttons.forEach(btn => (btn.disabled = true));

  // Feedback visual
  clickedButton.textContent = `${slot} — Selecionado`;

  try {
    // 1️⃣ Guardar no Sheety
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

    // 2️⃣ Guardar valor no campo hidden
    respostaFinal = `${date} | ${slot}`;
    hiddenField.value = respostaFinal; // ✅ envia valor ao campo hidden

    console.log("💾 Resposta final:", respostaFinal);

    // 3️⃣ Enviar para JotForm Custom Widget
    if (window.JFCustomWidget) {
      const submitData = {
        value: respostaFinal,
        valid: true // necessário para campos obrigatórios
      };
      JFCustomWidget.sendData({ value: respostaFinal });
      JFCustomWidget.sendSubmit(submitData);
      console.log("✅ Valor enviado para JotForm");
    } else {
      console.warn("⚠️ JFCustomWidget não detectado");
    }
  } catch (err) {
    console.error("Erro ao reservar", err);
    alert("Erro ao reservar. Tenta novamente.");
  }
}

// ===============================
// GET DATA PARA EMAIL / PREVIEW
// ===============================
if (window.JFCustomWidget) {
  JFCustomWidget.subscribe("getData", () => {
    return { value: respostaFinal };
  });
}
