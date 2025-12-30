document.addEventListener("DOMContentLoaded", () => {
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
      // Obter reservas atuais do Sheety
      const response = await fetch(SHEETY_URL);
      const data = await response.json();
      const reservas = data.folha1 || [];

      SLOTS.forEach(slot => {
        // Contar quantas reservas já existem para esse dia e horário
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
      console.error("Erro ao carregar vagas", err);
      slotsList.innerHTML = "<p>Erro ao carregar vagas.</p>";
    }
  });

  // ===============================
  // FUNÇÃO RESERVAR
  // ===============================
  function reservar(date, slot, clickedButton) {
    reservado = true;

    // Bloquear todos os botões
    const buttons = slotsList.querySelectorAll("button");
    buttons.forEach(btn => btn.disabled = true);

    // Feedback visual
    clickedButton.textContent = `${slot} — Selecionado`;
    const status = document.createElement("p");
    status.textContent = `Selecionado: ${date} às ${slot}`;
    status.style.marginTop = "12px";
    slotsDiv.appendChild(status);

    // Valor para o JotForm
    respostaFinal = `${date} | ${slot}`;

    // ✅ Enviar imediatamente ao JotForm
    if (window.JotFormCustomWidget && typeof JotFormCustomWidget.sendSubmit === "function") {
      JotFormCustomWidget.sendData({ value: respostaFinal });
      JotFormCustomWidget.sendSubmit(respostaFinal);
    }

    // ✅ Guardar no Sheety em paralelo (não bloqueia o submit)
    fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folha1: { data: date, horario: slot } })
    })
    .then(resp => resp.json())
    .then(json => console.log("Reservado no Sheety", json))
    .catch(err => console.error("Erro ao salvar no Sheety", err));
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
