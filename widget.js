const SHEETY_URL =
  "https://api.sheety.co/76a6d2f0ca2083ffa98601cdbdc2e82c/boCalendarioMontecarmo/folha1";

const SHEETY_TOKEN = "calendario-widget"; // igual ao que definiste no Sheety

const SLOTS = [
  { time: "08:00-08:45", max: 3 },
  { time: "08:45-09:30", max: 2 },
  { time: "09:30-10:15", max: 3 },
  { time: "10:15-11:00", max: 2 }
];

let selectedDate = null;
let selectedSlot = null;
let bookings = [];

/* -------------------- INIT JOTFORM -------------------- */
JotFormCustomWidget.subscribe("ready", function () {
  loadBookings().then(renderCalendar);
});

/* -------------------- LOAD DATA -------------------- */
async function loadBookings() {
  const res = await fetch(SHEETY_URL, {
    headers: {
      Authorization: `Bearer ${SHEETY_TOKEN}`
    }
  });
  const data = await res.json();
  bookings = data.folha1 || [];
}

/* -------------------- CALENDAR -------------------- */
function renderCalendar(date = new Date()) {
  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "";

  const year = date.getFullYear();
  const month = date.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const d = new Date(year, month, day);
    const btn = document.createElement("button");
    btn.textContent = day;

    if (d < new Date().setHours(0,0,0,0)) {
      btn.disabled = true;
    }

    btn.onclick = () => selectDate(d);
    calendar.appendChild(btn);
  }
}

/* -------------------- DATE SELECT -------------------- */
function selectDate(date) {
  selectedDate = date.toISOString().split("T")[0];
  renderSlots();
}

/* -------------------- SLOTS -------------------- */
function renderSlots() {
  const slotsDiv = document.getElementById("slots");
  slotsDiv.innerHTML = "";

  SLOTS.forEach(slot => {
    const used = bookings.filter(
      b => b.data === selectedDate && b.horario === slot.time
    ).length;

    const btn = document.createElement("button");

    if (used >= slot.max) {
      btn.textContent = `${slot.time} — sem vagas`;
      btn.disabled = true;
    } else {
      btn.textContent = `${slot.time} (${slot.max - used} vagas)`;
      btn.onclick = () => selectSlot(slot.time);
    }

    slotsDiv.appendChild(btn);
  });
}

/* -------------------- SLOT SELECT -------------------- */
async function selectSlot(slot) {
  selectedSlot = slot;

  await fetch(SHEETY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SHEETY_TOKEN}`
    },
    body: JSON.stringify({
      folha1: {
        data: selectedDate,
        horario: selectedSlot
      }
    })
  });

  // envia valor para o Jotform (campo da pergunta)
  JotFormCustomWidget.sendData({
    value: `${selectedDate} | ${selectedSlot}`
  });

  JotFormCustomWidget.submit();

  await loadBookings();
  renderSlots();
}
