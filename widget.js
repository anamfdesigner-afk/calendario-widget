let selectedDate = null;
let selectedTime = null;

/**
 * Render simples de horários (exemplo)
 * Isto podes adaptar depois à lógica de vagas / sheety
 */
function renderSlots() {
  const slots = ["10:00", "11:30", "14:00", "15:30"];
  const container = document.getElementById("slots");
  container.innerHTML = "";

  slots.forEach(time => {
    const div = document.createElement("div");
    div.className = "slot";
    div.innerText = time;

    div.onclick = () => {
      document
        .querySelectorAll(".slot")
        .forEach(s => s.classList.remove("selected"));

      div.classList.add("selected");
      selectedTime = time;

      enviarParaJotform();
    };

    container.appendChild(div);
  });
}

/**
 * 🔴 FUNÇÃO CRÍTICA
 * Envia o valor para o Hidden Field ReservaFinal
 * ANTES do submit
 */
function enviarParaJotform() {
  if (!selectedDate || !selectedTime) return;

  const valorFinal = `${selectedDate} ${selectedTime}`;
  console.log("A enviar ReservaFinal:", valorFinal);

  // 👉 Atualiza o hidden field
  JFCustomWidget.setFieldsValue({
    ReservaFinal: valorFinal
  });

  // 👉 Garante que o valor fica guardado
  JFCustomWidget.sendData({
    value: valorFinal
  });
}

/**
 * 🔗 Ligação ao Jotform
 */
JFCustomWidget.subscribe("ready", function (data) {
  console.log("Widget pronto");

  // Exemplo: data atual
  const hoje = new Date();
  selectedDate = hoje.toISOString().split("T")[0];

  renderSlots();
});

/**
 * 🔒 Submit final (garante que o campo não vai vazio)
 */
JFCustomWidget.subscribe("submit", function () {
  const valorFinal = selectedDate && selectedTime
    ? `${selectedDate} ${selectedTime}`
    : "";

  JFCustomWidget.sendSubmit({
    valid: !!valorFinal,
    value: valorFinal
  });
});
