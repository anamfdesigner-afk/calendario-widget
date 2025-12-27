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

  let respostaFinal = "";
  let reservado = false;

  // ===============================
  // ELEMENTOS
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
  // AO ESCOLHER DIA
  // ===============================
  datePicker.addEventListener("change", async () => {
    const selectedDate = datePicker.value;
    reservado = false;
    slotsDiv.hidden = false;
    slotsList.innerHTML = "";

    try {
      const res = await fetch(SHEETY_URL);
      const data = await res.json();
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
              selecionarSlot(selectedDate, slot.time, btn);
            }
          };

          slotsList.appendChild(btn);
        }
      });
    } catch (e) {
      console.error(e);
      slotsList.innerHTML = "<p>Erro ao carregar vagas</p>";
    }
  });

  // ===============================
  // SELECIONAR SLOT
  // ===============================
  function selecionarSlot(date, slot, btn) {
    reservado = true;

    // UI
    document
      .querySelectorAll("#slotsList button")
      .forEach(b => (b.disabled = true));

    btn.textContent = `${slot} — Selecionado`;

    respostaFinal = `${date} | ${slot}`;

    // 👉 ENVIAR AO JOTFORM (SEM SUBMIT)
    if (window.JotFormCustomWidget) {
      JotFormCustomWidget.sendData({
        value: respostaFinal
      });
    }

    // Guardar no Sheety (em background)
    fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folha1: {
          data: date,
          horario: slot
        }
      })
    }).catch(err => console.error("Sheety erro:", err));
  }

  // ===============================
  // NECESSÁRIO PARA EMAIL / PDF
  // ===============================
  if (window.JotFormCustomWidget) {
    JotFormCustomWidget.subscribe("getData", () => {
      return { value: respostaFinal };
    });
  }
});
