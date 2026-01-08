const SHEETY_URL =
  "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";

const SLOTS = [
  { time: "09:30-10:15", vagas: 3 },
  { time: "10:15-11:00", vagas: 2 },
  { time: "11:00-11:45", vagas: 3 }
];

let reservaFinal = "";

const datePicker = document.getElementById("datePicker");
const slotsList = document.getElementById("slotsList");

/* 🔹 bloquear dias passados */
datePicker.min = new Date().toISOString().split("T")[0];

JFCustomWidget.subscribe("ready", () => {
  console.log("✅ Widget ready");
});

/* 🔹 escolher dia */
datePicker.addEventListener("change", async () => {
  const date = datePicker.value;
  slotsList.innerHTML = "";

  const res = await fetch(SHEETY_URL);
  const data = await res.json();
  const reservas = data.folha1 || [];

  SLOTS.forEach(slot => {
    const usadas = reservas.filter(
      r => r.data === date && r.horario === slot.time
    ).length;

    const restantes = slot.vagas - usadas;

    const btn = document.createElement("button");

    if (restantes <= 0) {
      btn.textContent = `${slot.time} — sem vagas`;
      btn.disabled = true;
    } else {
      btn.textContent = `${slot.time} (${restantes} vagas)`;

      btn.onclick = () => {
        document
          .querySelectorAll("button")
          .forEach(b => b.classList.remove("selected"));

        btn.classList.add("selected");

        reservaFinal = `${date} | ${slot.time}`;

        /* 🔴 CRÍTICO */
        JFCustomWidget.setFieldsValue({
          ReservaFinal: reservaFinal
        });

        console.log("✅ ReservaFinal:", reservaFinal);
      };
    }

    slotsList.appendChild(btn);
  });
});

/* 🔹 submit */
JFCustomWidget.subscribe("submit", async () => {
  if (!reservaFinal) {
    JFCustomWidget.sendSubmit({ valid: false });
    return;
  }

  const [data, horario] = reservaFinal.split(" | ");

  await fetch(SHEETY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folha1: { data, horario }
    })
  });

  JFCustomWidget.sendSubmit({
    valid: true,
    value: reservaFinal
  });
});
