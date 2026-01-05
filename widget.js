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

let reservado = false;  // impede múltiplas seleções
let respostaFinal = "";  // valor final para enviar ao JotForm

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
// FUNÇÃO PARA ENVIAR AO JOTFORM
// ===============================
function enviarParaJotForm(valor) {
  // Envia para campo oculto
  alert (valor);
  window.parent.postMessage(
    { type: 'setValue', value: valor, targetId: 'input_119' },
    '*'
  );

  // Informa o JotForm que o widget é válido
  if (window.JFCustomWidget) {
    JFCustomWidget.sendSubmit({
      value: valor,
      valid: true
    });
    console.log("✅ JotFormCustomWidget detectado e campo marcado como válido");
  } else {
    // Espera até a API carregar
    const waitForJotForm = setInterval(() => {
      if (window.JFCustomWidget) {
        JFCustomWidget.sendSubmit({
          value: valor,
          valid: true
        });
        console.log("✅ JotFormCustomWidget agora detectado e válido");
        clearInterval(waitForJotForm);
      }
    }, 50);
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

  try {
    console.log("⏳ Fetching reservas do Sheety...");
    const response = await fetch(SHEETY_URL);
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
          if (!reservado) {
            reservar(selectedDate, slot.time, btn);
            const valor = `${selectedDate} | ${slot.time}`;
            enviarParaJotForm(valor); // envia valor e marca como válido
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
// RESERVAR + GRAVAR NO SHEETY
// ===============================
async function reservar(date, slot, clickedButton) {
  reservado = true;

  // Desativa todos os botões
  const buttons = slotsList.querySelectorAll("button");
  buttons.forEach(btn => (btn.disabled = true));

  // Feedback visual
  clickedButton.textContent = `${slot} — Selecionado`;
  const status = document.createElement("p");
  status.textContent = `Selecionado: ${date} às ${slot}`;
  status.style.marginTop = "12px";
  slotsDiv.appendChild(status);

  try {
    // Guardar no Sheety
    const body = { folha1: { data: date, horario: slot } };
    await fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    console.log("✅ Reserva gravada no Sheety:", body);

    // Guarda localmente
    respostaFinal = `${date} | ${slot}`;
  } catch (err) {
    console.error("Erro ao reservar", err);
    alert("Erro ao reservar. Tenta novamente.");
  }
}

