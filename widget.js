const SHEETY_URL =
  "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";

let selectedDate = null;
let selectedSlot = null;
let reservas = [];

const slotsContainer = document.getElementById("slots");
const calendarInput = document.getElementById("calendar");

/* ---------------- JOTFORM READY ---------------- */
JFCustomWidget.subscribe("ready", () => {
  console.log("✅ Jotform widget ready");

  JFCustomWidget.requestFrameResize({ height: 520 });
});

/* ---------------- LOAD RESERVAS ---------------- */
async function loadReservas() {
  const res = await fetch(SHEETY_URL);
  const data = await res.json();
  reservas = data.folha1 || [];
}

/* ---------------- GERAR HORÁRIOS ---------------- */
function getSlots() {
  return [
    "09:30-10:15",
    "10:15-11:00",
    "11:00-11:45",
    "14:00-14:45",
    "14:45-15:30",
    "15:30-16:15"
  ];
}

/* ---------------- RENDER SLOTS ---------------- */
function renderSlots() {
  slotsContainer.innerHTML = "";
  selectedSlot = null;

  const usados = reservas
    .filter(r => r.data === selectedDate)
    .map(r => r.horario);

  getSlots().forEach(slot => {
    const div = document.createElement("div");
    div.className = "slot";
    div.textContent = slot;

    if (usados.includes(slot)) {
      div.classList.add("disabled");
    }

    div.onclick = () => {
      document
        .querySelectorAll(".slot")
        .forEach(s => s.classList.remove("selected"));

      div.classList.add("selected");
      selectedSlot = slot;

      const value = `${selectedDate} | ${selectedSlot}`;

      /* 🔴 ESTE É O PASSO CRÍTICO */
      JFCustomWidget.setFieldsValue({
        ReservaFinal: value
      });

      console.log("✅ ReservaFinal set:", value);
    };

    slotsContainer.appendChild(div);
  });
}

/* ---------------- DATE CHANGE ---------------- */
calendarInput.addEventListener("change", async e => {
  selectedDate = e.target.value;

  await loadReservas();
  renderSlots();
});

/* ---------------- SUBMIT ---------------- */
JFCustomWidget.subscribe("submit", async () => {
  if (!selectedDate || !selectedSlot) {
    JFCustomWidget.sendSubmit({ valid: false });
    return;
  }

  const value = `${selectedDate} | ${selectedSlot}`;

  await fetch(SHEETY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folha1: {
        data: selectedDate,
        horario: selectedSlot
      }
    })
  });

  JFCustomWidget.sendSubmit({
    valid: true,
    value
  });
});
