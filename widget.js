let selectedValue = "";

// slots fixos por agora (teste)
const SLOTS = [
  { time: "10:00", capacity: 2 },
  { time: "11:00", capacity: 3 },
  { time: "14:00", capacity: 1 }
];

// ⚠️ OBRIGATÓRIO: esperar pelo ready
JFCustomWidget.subscribe("ready", function () {
  console.log("Widget ready");

  const dateInput = document.getElementById("dateInput");

  dateInput.addEventListener("change", function (e) {
    const selectedDate = e.target.value;
    console.log("DATA SELECIONADA:", selectedDate);
    renderSlots(selectedDate);
  });
});

// renderiza os botões
function renderSlots(date) {
  const container = document.getElementById("slots");
  container.innerHTML = "";

  if (!date) return;

  SLOTS.forEach(slot => {
    const btn = document.createElement("button");
    btn.className = "slot";
    btn.type = "button";
    btn.textContent = `${slot.time} (${slot.capacity} vagas)`;

    btn.onclick = function () {
      document.querySelectorAll(".slot").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");

      selectedValue = JSON.stringify({
        date: date,
        time: slot.time,
        capacity: slot.capacity
      });

      console.log("VALOR SELECIONADO:", selectedValue);

      // envia o valor imediatamente para o Jotform
      JFCustomWidget.sendData({
        value: selectedValue
      });
    };

    container.appendChild(btn);
  });

  // ajusta altura do iframe
  JFCustomWidget.requestFrameResize({
    height: 300
  });
}

// quando o formulário é submetido
JFCustomWidget.subscribe("submit", function () {
  console.log("FORM SUBMIT");

  JFCustomWidget.sendSubmit({
    valid: selectedValue !== "",
    value: selectedValue
  });
});
