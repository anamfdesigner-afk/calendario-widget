document.addEventListener("DOMContentLoaded", () => {
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

  const datePicker = document.getElementById("datePicker");
  const slotsDiv = document.getElementById("slots");
  const slotsList = document.getElementById("slotsList");

  // bloquear dias passados
  datePicker.min = new Date().toISOString().split("T")[0];

  datePicker.addEventListener("change", async () => {
    const selectedDate = datePicker.value;
    reservado = false;
    slotsDiv.hidden = false;
    slotsList.innerHTML = "";

    try {
      const res = await fetch(SHEETY_URL);
      const json = await res.json();
      const reservas = json.folha1 || [];

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
          btn.onclick = () => selecionarSlot(selectedDate, slot.time, btn);
          slotsList.appendChild(btn);
        }
      });
    } catch (e) {
      slotsList.innerHTML = "<p>Erro ao carregar vagas</p>";
    }
  });

  function selecionarSlot(date, slot, btn) {
    if (reservado) return;
    reservado = true;

    respostaFinal = `${date} | ${slot}`;

    // UI
    slotsList.querySelectorAll("button").forEach(b => b.disabled = true);
    btn.textContent = `${slot} — Selecionado`;

    const info = document.createElement("p");
    info.textContent = `Selecionado: ${date} às ${slot}`;
    slotsDiv.appendChild(info);

    // guardar no sheety (não bloqueia o form)
    fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folha1: { data: date, horario: slot }
      })
    }).catch(() => {});
  }

  // 🔑 ISTO É O MAIS IMPORTANTE
  if (window.JotFormCustomWidget) {
    JotFormCustomWidget.subscribe("getData", () => {
      return { value: respostaFinal };
    });
  }
});
