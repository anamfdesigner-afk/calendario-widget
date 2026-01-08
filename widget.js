// ===============================
// CONFIGURAÇÃO
// ===============================
const SHEETY_GET_URL = "https://api.sheety.co/TEU_ID/agenda/vagas"; // GET para ler reservas
const SHEETY_POST_URL = "https://api.sheety.co/TEU_ID/agenda/vagas"; // POST para gravar reserva

const SLOTS = [
  "08:00-08:45",
  "08:45-09:30",
  "09:30-10:15",
  "10:15-11:00"
];

let selectedSlot = null;
let selectedDate = null;

// ===============================
// ELEMENTOS DOM
// ===============================
const dataInput = document.getElementById("data");
const container = document.getElementById("horarios");

// ===============================
// BLOQUEAR DIAS PASSADOS
// ===============================
const today = new Date().toISOString().split("T")[0];
dataInput.min = today;

// ===============================
// FUNÇÕES DE SHEETY
// ===============================
async function carregarVagas(data) {
  try {
    const res = await fetch(SHEETY_GET_URL);
    const json = await res.json();
    return json.vagas.filter(v => v.data === data).map(v => v.horario);
  } catch (err) {
    console.error("Erro ao buscar vagas:", err);
    return [];
  }
}

async function guardarReserva(data, horario) {
  try {
    await fetch(SHEETY_POST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaga: { data, horario } })
    });
    console.log("Reserva gravada:", data, horario);
  } catch (err) {
    console.error("Erro ao gravar reserva:", err);
  }
}

// ===============================
// FUNÇÕES JOTFORM CUSTOM WIDGET
// ===============================
function enviarJotForm(value) {
  if (window.JFCustomWidget) {
    const data = { value: value, valid: true };
    JFCustomWidget.sendSubmit(data);
    JFCustomWidget.sendData({ value });
  } else {
    console.warn("JFCustomWidget não detectado ainda.");
  }
}

// ===============================
// AO ESCOLHER DATA
// ===============================
dataInput.addEventListener("change", async () => {
  container.innerHTML = "";
  selectedSlot = null;
  selectedDate = dataInput.value;

  const ocupados = await carregarVagas(selectedDate);

  SLOTS.forEach(hora => {
    const div = document.createElement("div");
    div.className = "hora";
    div.textContent = ocupados.includes(hora) ? `${hora} — Ocupado` : `${hora} — Disponível`;

    if (ocupados.includes(hora)) div.classList.add("disabled");

    div.onclick = async () => {
      // Limpar seleção anterior
      document.querySelectorAll(".hora").forEach(h => h.classList.remove("selected"));
      div.classList.add("selected");
      selectedSlot = hora;

      // Grava no Sheety
      await guardarReserva(selectedDate, selectedSlot);

      // Envia para o Jotform
      const value = `${selectedDate} | ${selectedSlot}`;
      enviarJotForm(value);

      // Desativa outros horários
      document.querySelectorAll(".hora").forEach(h => {
        if (!h.classList.contains("selected")) h.classList.add("disabled");
      });
    };

    container.appendChild(div);
  });
});

// ===============================
// SUBSCRIBE GETDATA (Email Builder / Preview)
if (window.JFCustomWidget) {
  JFCustomWidget.subscribe("getData", function() {
    if (selectedDate && selectedSlot) {
      return { value: `${selectedDate} | ${selectedSlot}` };
    }
    return { value: "" };
  });
}
