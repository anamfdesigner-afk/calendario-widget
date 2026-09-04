// ===============================
// CONFIGURAÇÃO
// ===============================
// ATENÇÃO: este URL ainda aponta para a folha ANTIGA (colunas
// data/horario). Depois de apontar o projeto Sheety à folha das
// submissões do JotForm ("Breakfast at Montecarmo12" / aba
// "Form responses"), substituir este URL pelo novo endpoint do
// Sheety. Enquanto isso não acontecer, o widget continua a contar
// vagas na folha antiga e as reservas novas não descontam vagas.
const SHEETY_GET_URL =
  "https://api.sheety.co/1ae6091d965454adf0c80bb4437fd2cc/boCalendarioMotecarmo12/folha1";

// Nome da folha tal como o Sheety a devolve no JSON do GET.
// Se não existir, usamos automaticamente a primeira coleção que vier
// na resposta — assim mudar de folha não parte a contagem.
const SHEETY_COLLECTION = "folha1";

// Nomes das colunas (camelCase) tal como o Sheety as devolve.
//
// Há duas formas possíveis de guardar a reserva:
//   a) duas colunas separadas: "data" + "horario"
//   b) uma coluna combinada: "2026-09-05 | 10:15-11:00"
//
// A folha das submissões do JotForm usa a forma (b), na coluna
// "reserva" (a label do campo é "Reserva"). Aceitamos as duas formas
// e vários nomes possíveis, porque foi precisamente um nome de coluna
// errado que fez as vagas nunca descerem.
const COLUNA_DATA = "data";
const COLUNA_HORARIO = "horario";
const COLUNAS_RESERVA = ["reserva", "resultado", "respostaFinal", "typeA137"];

// LABEL exata do campo Short Text criado no JotForm que vai receber
// uma cópia do valor. É este campo normal que a integração exporta.
// Pôr "" para desligar o espelho.
//
// TEM de coincidir letra a letra com a label no formulário. Estava
// "Resultado", mas o campo do formulário chama-se "Reserva" (id_135,
// nome único "respostaFinal"): o setFieldsValueByLabel não encontrava
// nada, não dava erro, e o valor nunca chegava à submissão.
const CAMPO_ESPELHO_LABEL = "Reserva";

// ID da pergunta do mesmo campo ("id_135" no HTML do formulário ->
// "135"). Escrevemos por ID **e** por LABEL: o ID não se estraga se
// alguém renomear a label, e a label continua a funcionar se o campo
// for recriado com outro ID. Pôr "" para desligar.
const CAMPO_ESPELHO_ID = "135";

// Bloquear submissão sem horário escolhido
const OBRIGATORIO = true;

// Quanto tempo esperamos pela revalidação das vagas na submissão.
// Se o Sheety não responder neste tempo, DEIXAMOS PASSAR: bloquear
// todas as reservas porque a API está lenta é pior do que o risco de
// uma reserva a mais.
const TIMEOUT_REVALIDACAO_MS = 4000;

// Painel de diagnóstico. Fica DESLIGADO para quem preenche o formulário
// (aparecia como uma caixa vermelha dentro do formulário publicado).
// Para ligar durante testes há duas maneiras:
//   - pôr DEBUG_FORCADO = true aqui, ou
//   - acrescentar ?debug=1 ao URL do widget no Widget Builder.
const DEBUG_FORCADO = false;
const DEBUG = DEBUG_FORCADO || /[?&]debug=1/.test(location.search);

const SLOTS = [
  { time: "08:00-08:45", vagas: 3 },
  { time: "08:45-09:30", vagas: 2 },
  { time: "09:30-10:15", vagas: 3 },
  { time: "10:15-11:00", vagas: 2 }
];

// Valor final, ex.: "2026-08-20 | 08:45-09:30"
let value = "";

// Número de geração do último pedido de horários. Ver carregarSlots().
let geracao = 0;

// ===============================
// ELEMENTOS DOM
// ===============================
const datePicker = document.getElementById("datePicker");
const slotsDiv = document.getElementById("slots");
const slotsList = document.getElementById("slotsList");
const estadoDiv = document.getElementById("estado");
const debugDiv = document.getElementById("debug");

const temJF = typeof JFCustomWidget !== "undefined";

// ===============================
// UTILITÁRIOS
// ===============================
function log(msg) {
  console.log("[widget]", msg);
  if (!DEBUG || !debugDiv) return;
  debugDiv.hidden = false;
  const linha = document.createElement("div");
  linha.textContent = msg;
  debugDiv.appendChild(linha);
  ajustarAltura();
}

// Data de hoje em hora local. toISOString() usa UTC e, de madrugada,
// devolveria o dia anterior.
function hojeLocal() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Sem isto o JotForm corta o widget à altura inicial do iframe
function ajustarAltura() {
  if (temJF && JFCustomWidget.requestFrameResize) {
    JFCustomWidget.requestFrameResize({ height: document.body.scrollHeight + 20 });
  }
}

function formatarValor(date, slot) {
  return `${date} | ${slot}`;
}

// O Google Sheets devolve às vezes a data como ISO completo
// ("2025-12-31T00:00:00.000Z"). Só queremos YYYY-MM-DD.
function normalizarData(v) {
  const t = String(v == null ? "" : v).trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : t;
}

// Aceita espaçamento diferente à volta do "|" ("a|b" == "a | b").
const FORMATO_RESERVA = /^\d{4}-\d{2}-\d{2}\s*\|/;

function normalizarReserva(v) {
  return String(v == null ? "" : v).trim().replace(/\s*\|\s*/, " | ");
}

// Procura o valor combinado numa linha. Primeiro pelos nomes de coluna
// conhecidos; se nenhum servir, aceita QUALQUER coluna cujo conteúdo
// tenha o formato "AAAA-MM-DD | HH:MM-HH:MM". Essa última rede evita
// que um nome de coluna inesperado volte a esconder as reservas.
function valorCombinado(r) {
  for (const c of COLUNAS_RESERVA) {
    const v = normalizarReserva(r[c]);
    if (v) return v;
  }
  for (const k of Object.keys(r)) {
    const v = normalizarReserva(r[k]);
    if (FORMATO_RESERVA.test(v)) return v;
  }
  return "";
}

// Uma linha da folha ocupa este slot se:
//  - as colunas separadas "data"+"horario" coincidirem, OU
//  - a coluna combinada for igual a "data | horario".
function linhaOcupaSlot(r, selectedDate, slotTime) {
  const d = normalizarData(r[COLUNA_DATA]);
  const h = String(r[COLUNA_HORARIO] == null ? "" : r[COLUNA_HORARIO]).trim();
  if (d && h) return d === selectedDate && h === slotTime;

  return valorCombinado(r) === formatarValor(selectedDate, slotTime);
}

// ===============================
// ESPELHO NUM CAMPO NORMAL
// ===============================
// A integração do JotForm exporta campos normais de forma fiável, mas
// não a resposta deste widget. Copiamos o valor para um Short Text.
// O método correto é setFieldsValueByLabel (setFieldsValue NÃO existe).
// ATENÇÃO: por dentro, o setFieldsValueBy* é só um postMessage para o
// formulário ("fields:fill"). Não devolve nada e não dá erro se o
// campo não existir. Um alvo errado é indistinguível de sucesso visto
// de dentro do widget — foi por isso que isto falhou tanto tempo em
// silêncio. Escrevemos pelos DOIS caminhos para reduzir o risco.
function espelharEmCampo(v) {
  if (!temJF) return;

  let enviado = false;

  if (CAMPO_ESPELHO_ID &&
      typeof JFCustomWidget.setFieldsValueById === "function") {
    try {
      const porId = {};
      porId[CAMPO_ESPELHO_ID] = v;
      JFCustomWidget.setFieldsValueById(porId);
      enviado = true;
      log(`Espelho enviado por ID ${CAMPO_ESPELHO_ID}: ${v}`);
    } catch (e) {
      log("ERRO no espelho por ID: " + e.message);
    }
  }

  if (CAMPO_ESPELHO_LABEL &&
      typeof JFCustomWidget.setFieldsValueByLabel === "function") {
    try {
      const porLabel = {};
      porLabel[CAMPO_ESPELHO_LABEL] = v;
      JFCustomWidget.setFieldsValueByLabel(porLabel);
      enviado = true;
      log(`Espelho enviado por LABEL "${CAMPO_ESPELHO_LABEL}": ${v}`);
    } catch (e) {
      log("ERRO no espelho por LABEL: " + e.message);
    }
  }

  if (!enviado) {
    log("AVISO: a API não tem setFieldsValueById nem ...ByLabel.");
  }
}

// ===============================
// LEITURA DA FOLHA
// ===============================
// Usado tanto ao mostrar os horários como ao revalidar na submissão,
// para que as duas contagens não possam divergir.
async function buscarReservas() {
  const response = await fetch(SHEETY_GET_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  // O nome da coleção é o nome da aba da folha. Se apontarmos o
  // Sheety a outra folha (ex.: "Form responses" -> "formResponses"),
  // o nome muda. Em vez de partir, usamos a primeira coleção que
  // vier na resposta.
  let linhas = data[SHEETY_COLLECTION];
  if (!Array.isArray(linhas)) {
    const chave = Object.keys(data).find(k => Array.isArray(data[k]));
    if (chave) {
      linhas = data[chave];
      log(`Coleção "${SHEETY_COLLECTION}" não existe; a usar "${chave}".`);
    } else {
      linhas = [];
      log("AVISO: a resposta do Sheety não tem nenhuma lista de linhas.");
    }
  }
  return linhas;
}

function limiteDoSlot(slotTime) {
  const def = SLOTS.find(s => s.time === slotTime);
  return def ? def.vagas : 0;
}

function vagasRestantes(reservas, date, slotTime) {
  const usadas = reservas.filter(
    r => linhaOcupaSlot(r, date, slotTime)
  ).length;
  return limiteDoSlot(slotTime) - usadas;
}

// ===============================
// CARREGAR HORÁRIOS DE UM DIA
// ===============================
async function carregarSlots(selectedDate) {
  if (!selectedDate) return;

  // O <input type="date"> dispara "change" mais do que uma vez
  // enquanto a data é escrita (dia, mês e ano são segmentos
  // separados), por isso podem ficar vários fetch em curso ao mesmo
  // tempo. Sem esta guarda, o que respondesse por ÚLTIMO desenhava os
  // botões — e os botões guardam a data no closure, pelo que ficavam
  // presos a uma data intermédia. Sintoma real observado: escrever
  // 09/10/2026 e a reserva sair como "0202-09-10".
  const minhaGeracao = ++geracao;

  slotsDiv.hidden = false;
  slotsList.textContent = "A carregar...";
  ajustarAltura();

  let reservas = [];
  try {
    reservas = await buscarReservas();

    // Já há um pedido mais recente: esta resposta está velha.
    if (minhaGeracao !== geracao) return;

    if (reservas.length) {
      log("Colunas na folha: " + Object.keys(reservas[0]).join(", "));
      const separadas = reservas.filter(
        r => r[COLUNA_DATA] && r[COLUNA_HORARIO]
      ).length;
      const combinadas = reservas.filter(r => valorCombinado(r)).length;
      log(`${reservas.length} linhas: ${separadas} com "${COLUNA_DATA}"+"${COLUNA_HORARIO}", ${combinadas} com reserva combinada`);
      if (separadas === 0 && combinadas === 0) {
        log("AVISO: nenhuma coluna reconhecida. As vagas nunca vão descer.");
      }
    } else {
      log("A folha está vazia (0 linhas).");
    }
  } catch (err) {
    if (minhaGeracao !== geracao) return;
    console.error("Erro ao carregar vagas", err);
    slotsList.textContent = "Erro ao carregar vagas. Tente novamente.";
    log("ERRO no GET ao Sheety: " + err.message);
    ajustarAltura();
    return;
  }

  slotsList.textContent = "";

  SLOTS.forEach(slot => {
    const restantes = vagasRestantes(reservas, selectedDate, slot.time);

    if (restantes <= 0) {
      const p = document.createElement("p");
      p.textContent = `${slot.time} — Sem vagas`;
      slotsList.appendChild(p);
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.slot = slot.time;
    btn.dataset.restantes = restantes;
    btn.addEventListener("click", () => selecionar(selectedDate, slot.time));
    slotsList.appendChild(btn);
  });

  desenharBotoes();
  ajustarAltura();
}

// ===============================
// SELECIONAR HORÁRIO
// ===============================
// Nada é escrito no Sheety aqui. A linha é criada pela integração do
// JotForm na submissão, para não gastar vagas com formulários
// abandonados e para manter menu + reserva na mesma linha.
function selecionar(date, slot) {
  // Defesa em profundidade: um botão guarda a sua data no closure.
  // Se por alguma razão não for a data que está à vista no campo,
  // não gravamos nada — recarregamos os horários da data certa.
  // Evita gravar uma reserva com uma data que o utilizador não vê.
  if (datePicker.value && date !== datePicker.value) {
    log(`IGNORADO: botão de ${date}, campo mostra ${datePicker.value}.`);
    carregarSlots(datePicker.value);
    return;
  }

  value = formatarValor(date, slot);
  desenharBotoes();

  if (temJF) {
    JFCustomWidget.sendData({ value: value });
    if (JFCustomWidget.hideWidgetError) JFCustomWidget.hideWidgetError();
  }

  espelharEmCampo(value);
  log("Selecionado: " + value);
}

// Feedback em TEXTO e em cor. O texto funciona mesmo que o CSS
// não tenha sido colado no painel certo do JotForm.
function desenharBotoes() {
  slotsList.querySelectorAll("button").forEach(btn => {
    const ativo = formatarValor(datePicker.value, btn.dataset.slot) === value;

    btn.textContent = ativo
      ? `✔ ${btn.dataset.slot} — SELECIONADO`
      : `${btn.dataset.slot} (${btn.dataset.restantes} vagas)`;

    btn.classList.toggle("selecionado", ativo);
    btn.setAttribute("aria-pressed", ativo ? "true" : "false");
  });

  if (estadoDiv) {
    estadoDiv.textContent = value
      ? `Reserva escolhida: ${value}`
      : "Nenhum horário escolhido.";
  }
}

// ===============================
// ARRANQUE DA INTERFACE
// ===============================
// Deliberadamente FORA do evento "ready": se a biblioteca do JotForm
// falhar ou o "ready" não chegar, o calendário continua a funcionar.
function iniciarUI() {
  datePicker.min = hojeLocal();

  datePicker.addEventListener("change", () => {
    value = ""; // mudar de dia limpa a escolha
    carregarSlots(datePicker.value);
  });

  desenharBotoes();
  ajustarAltura();
}

iniciarUI();

// ===============================
// REVALIDAÇÃO NA SUBMISSÃO
// ===============================
// As vagas são lidas quando o dia é aberto. Entre esse momento e a
// submissão pode passar muito tempo, e outra pessoa pode ficar com o
// último lugar — dois hóspedes viam "1 vaga" e ambos reservavam.
// Aqui voltamos a contar imediatamente antes de submeter.
//
// LIMITE: isto encurta a janela, não a fecha. Duas submissões
// simultâneas podem passar as duas na verificação. Fechar a janela por
// completo exige uma reserva atómica do lado do servidor, que o Sheety
// não oferece.
async function slotAindaTemVagas(date, slot) {
  try {
    const reservas = await buscarReservas();
    const restantes = vagasRestantes(reservas, date, slot);
    log(`Revalidação: ${slot} em ${date} -> ${restantes} vaga(s).`);
    return { cheio: restantes <= 0 };
  } catch (e) {
    // Falha de rede: não bloqueamos (ver TIMEOUT_REVALIDACAO_MS).
    log("Revalidação falhou (" + e.message + "): a deixar passar.");
    return { cheio: false };
  }
}

// ===============================
// LIGAÇÃO AO JOTFORM
// ===============================
if (!temJF) {
  log("AVISO: JFCustomWidget não existe. O widget não está ligado ao JotForm.");
} else {
  JFCustomWidget.subscribe("ready", function (data) {
    log("Evento 'ready' recebido.");

    // sendData e sendSubmit são ignorados dentro do construtor do
    // JotForm. Testar sempre no link público do formulário.
    if (typeof JFCustomWidget.isWidgetOnBuilder === "function" &&
        JFCustomWidget.isWidgetOnBuilder()) {
      log("AVISO: a correr no construtor. Nada é enviado. Testar no formulário publicado.");
    }

    // Restaurar escolha anterior (voltar atrás numa form de várias páginas)
    if (data && data.value) {
      value = data.value;
      const dataGuardada = value.split("|")[0].trim();
      if (dataGuardada) {
        datePicker.value = dataGuardada;
        carregarSlots(dataGuardada);
      }
    }

    ajustarAltura();
  });

  // É esta subscrição que faz o valor chegar à submissão.
  JFCustomWidget.subscribe("submit", function () {
    log(`Evento 'submit'. A enviar: "${value}"`);

    if (OBRIGATORIO && value === "") {
      // showWidgetError já envia sendSubmit({valid:false}) por dentro,
      // por isso não voltamos a chamar sendSubmit aqui.
      JFCustomWidget.showWidgetError("Escolha uma data e um horário.");
      return;
    }

    // Sem horário escolhido e não obrigatório: nada para revalidar.
    if (value === "") {
      JFCustomWidget.sendSubmit({ valid: true, value: value });
      return;
    }

    const partes = value.split("|");
    const dataEscolhida = (partes[0] || "").trim();
    const slotEscolhido = (partes[1] || "").trim();

    // Promise.race: ou a revalidação responde, ou desistimos e
    // deixamos passar. Nunca deixamos a submissão pendurada.
    const desistir = new Promise(resolve => {
      setTimeout(() => resolve({ indeterminado: true }), TIMEOUT_REVALIDACAO_MS);
    });

    Promise.race([slotAindaTemVagas(dataEscolhida, slotEscolhido), desistir])
      .then(r => {
        if (r && r.cheio) {
          log(`RECUSADO: ${slotEscolhido} ficou sem vagas entre a escolha e a submissão.`);
          value = "";
          espelharEmCampo("");
          carregarSlots(dataEscolhida);
          // showWidgetError já envia sendSubmit({valid:false}).
          JFCustomWidget.showWidgetError(
            "Esse horário acabou de ficar sem vagas. Escolha outro."
          );
          return;
        }

        if (r && r.indeterminado) {
          log("Revalidação sem resposta em tempo útil: a deixar passar.");
        }

        espelharEmCampo(value);
        JFCustomWidget.sendSubmit({ valid: true, value: value });
      })
      .catch(e => {
        // Nunca deixar a submissão pendurada. O formulário espera uma
        // resposta nossa (a lib envia primeiro um {initial:true}); se
        // aqui estourasse uma exceção, o hóspede ficava preso no botão
        // de submeter para sempre.
        log("ERRO na revalidação: " + e.message + " — a deixar passar.");
        espelharEmCampo(value);
        JFCustomWidget.sendSubmit({ valid: true, value: value });
      });
  });
}
