document.addEventListener("DOMContentLoaded", () => {
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
  // AO ESCOLHER O DIA
  // ===============================
  datePicker.addEventListener("change", async () => {
    const selectedDate = datePicker.value;
    reservado = false;
    slotsDiv.hidden = false;
    slotsList.innerHTML = "";

    try {
      const response = await fetch(SHEETY_URL);
      const data = await response.json();
      const reservas = data.folha1 || [];

      SLOTS.forEach(slot => {
        const usadas = reservas.filter(
          r => r.data === selectedDate && r.horario && r.horario === slot.time
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
      console.error("Erro ao carregar vagas", err);
      slotsList.innerHTML = "<p>Erro ao carregar vagas.</p>";
    }
  });

  // ===============================
  // RESERVAR + ENVIAR AO JOTFORM
  // ===============================
  function reservar(date, slot, clickedButton) {
    reservado = true;

    // Desactivar todos os botões
    const buttons = slotsList.querySelectorAll("button");
    buttons.forEach(btn => (btn.disabled = true));

    // Feedback visual
    clickedButton.textContent = `${slot} — Selecionado`;
    const status = document.createElement("p");
    status.textContent = `Selecionado: ${date} às ${slot}`;
    status.style.marginTop = "12px";
    slotsDiv.appendChild(status);

    // Preparar valor para JotForm
    respostaFinal = `${date} | ${slot}`;

    // Enviar imediatamente ao JotForm
    if (window.JotFormCustomWidget && typeof JotFormCustomWidget.sendSubmit === "function") {
      JotFormCustomWidget.sendData({ value: respostaFinal });
      JotFormCustomWidget.sendSubmit(respostaFinal);
    } else {
      console.warn("JotFormCustomWidget não está disponível ainda.");
    }

    // Guardar no Sheety em paralelo (não bloqueia o submit)
    fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folha1: { data: date, horario: slot } })
    }).catch(err => console.error("Erro ao salvar no Sheety", err));
  }

  // ===============================
  // GET DATA (necessário para Email Builder / PDFs)
  // ===============================
  if (window.JotFormCustomWidget) {
    JotFormCustomWidget.subscribe("getData", function () {
      return { value: respostaFinal };
    });
  }
});
