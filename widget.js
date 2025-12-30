document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ DOM carregado");

  const SHEETY_URL =
    "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";

  const SLOTS = [
    { time: "08:00-08:45", vagas: 3 },
    { time: "08:45-09:30", vagas: 2 },
    { time: "09:30-10:15", vagas: 3 },
    { time: "10:15-11:00", vagas: 2 }
  ];

  let reservado = false;
  let respostaFinal = "";

  const datePicker = document.getElementById("datePicker");
  const slotsDiv = document.getElementById("slots");
  const slotsList = document.getElementById("slotsList");

  const today = new Date().toISOString().split("T")[0];
  datePicker.min = today;

  datePicker.addEventListener("change", async () => {
    const selectedDate = datePicker.value;
    console.log("📅 Data selecionada:", selectedDate);

    reservado = false;
    slotsDiv.hidden = false;
    slotsList.innerHTML = "";

    try {
      console.log("⏳ Fetching reservas do Sheety...");
      const response = await fetch(SHEETY_URL);
      const data = await response.json();
      console.log("✅ Dados recebidos do Sheety:", data);

      const reservas = data.folha1 || [];

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
            }
          };
          slotsList.appendChild(btn);
        }
      });
    } catch (err) {
      console.error("❌ Erro ao carregar vagas", err);
      slotsList.innerHTML = "<p>Erro ao carregar vagas.</p>";
    }
  });

  function sendToJotForm(value) {
    if (window.JotFormCustomWidget) {
      try {
        JotFormCustomWidget.sendData({ value: value });
        console.log("✅ Dados enviados para JotForm:", value);
      } catch (e) {
        console.error("❌ Erro ao enviar para JotForm:", e);
      }
    } else {
      // Espera 100ms e tenta novamente
      setTimeout(() => sendToJotForm(value), 100);
    }
  }

  function reservar(date, slot, clickedButton) {
    console.log("🖱️ Slot clicado:", date, slot);
    reservado = true;

    const buttons = slotsList.querySelectorAll("button");
    buttons.forEach(btn => (btn.disabled = true));

    clickedButton.textContent = `${slot} — Selecionado`;
    respostaFinal = `${date} | ${slot}`;

    // Envia para JotForm de forma segura
    sendToJotForm(respostaFinal);

    // Enviar para Sheety
    fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folha1: { data: date, horario: slot } })
    })
      .then(resp => resp.json())
      .then(json => console.log("✅ Reserva gravada no Sheety:", json))
      .catch(err => console.error("❌ Erro ao salvar no Sheety", err));
  }

  // Permite que o JotForm leia os dados do widget
  if (window.JotFormCustomWidget) {
    JotFormCustomWidget.subscribe("getData", function () {
      console.log("📡 JotForm pediu dados, retornando:", respostaFinal);
      return { value: respostaFinal };
    });
  }
});
