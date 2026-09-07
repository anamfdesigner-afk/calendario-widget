// ===============================
// RESERVAS — Web App do Apps Script
// ===============================
// Ligado à folha das submissões do JotForm. É esta a peça que torna
// impossível sobre-reservar: o POST reserva um lugar dentro de um mutex
// (LockService), coisa que o Sheety nunca conseguiu oferecer.
//
// Um lugar tem três estados: `activo` (tomado na submissão, ainda por
// confirmar), `confirmado` (o webhook da JotForm disse que a submissão se
// concluiu) e `expirado` (libertado, por abandono ou à mão). A ocupação em
// vivo são as linhas `activo` MAIS as `confirmado`.
//
// Instalação: ver docs/instalacao-reservas.md.

var ABA_RESERVAS = "Reservas";
var ABA_CAPACIDADES = "Capacidades";

// Colunas da aba Reservas. A ordem é estável: o `quarto` e o `nome` foram
// ACRESCENTADOS ao fim, porque mudar a posição de uma coluna existente
// tornaria ilegíveis todas as linhas já guardadas — e uma linha ilegível é
// um lugar vendido que deixa de contar para a ocupação.
var COL_TOKEN = 0;
var COL_DATA = 1;
var COL_HORARIO = 2;
var COL_CRIADO = 3;
var COL_ESTADO = 4;
var COL_QUARTO = 5;
var COL_NOME = 6;

var CABECALHO_RESERVAS = ["token", "data", "horario", "criado", "estado", "quarto", "nome"];
var CABECALHO_CAPACIDADES = ["horario", "vagas"];

var ESTADO_ACTIVO = "activo";
var ESTADO_CONFIRMADO = "confirmado";
var ESTADO_EXPIRADO = "expirado";

var FORMATO_HORARIO = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

// Chave nas ScriptProperties onde fica a marca do último webhook recebido.
// É ela que arma a reconciliação (ver primeiroWebhookChegou_).
var CHAVE_ULTIMO_WEBHOOK = "ultimoWebhook";

// Uma órfã é uma linha `activo` com mais de 20 minutos: se a submissão se
// tivesse concluído, o webhook já teria chegado e a linha estaria
// `confirmado`.
var JANELA_ORFAS_MS = 20 * 60 * 1000;

// ATENÇÃO: acoplado ao ORCAMENTO_RESERVA_MS do widget.js (5 s por
// tentativa). Tem de ficar CONFORTAVELMENTE DENTRO desse orçamento. Com os
// 20 s que aqui estavam, sob contenção o widget desistia e falhava fechado
// — o hóspede era informado de que a reserva falhou — e o servidor tomava
// o lugar logo depois: o lugar ficava como ocupação fantasma durante 20
// minutos. Não mexer num dos dois sem mexer no outro.
var ESPERA_LOCK_MS = 3500;

var ESPERA_LOCK_GET_MS = 5000;

// O preparar() e o limparTestes() correm à mão a partir do editor, onde não
// há hóspede nenhum à espera nem orçamento de cliente a respeitar. Podem
// esperar muito mais do que o caminho da reserva — e mais vale esperar do
// que devolver ao dono uma mensagem de "ocupado".
var ESPERA_LOCK_MANUTENCAO_MS = 20000;

var AVISO_OCUPADO = "A folha está ocupada neste momento. Tente outra vez dentro de um minuto.";

// ===============================
// CAPACIDADES (funções puras)
// ===============================
// A aba Capacidades é a fonte de verdade dos horários E dos limites. A
// ordem das linhas é a ordem dos botões no widget, por isso devolvemos
// um array e não um mapa.
function capacidades_(linhas) {
  var out = [];
  var vistos = {};
  for (var i = 1; i < (linhas || []).length; i++) {
    var linha = linhas[i] || [];
    var horario = String(linha[0] == null ? "" : linha[0]).trim();
    if (!FORMATO_HORARIO.test(horario)) continue;
    if (vistos[horario]) continue;

    var bruto = linha[1];
    if (typeof bruto === "string" && bruto.trim() === "") continue;
    var vagas = Number(bruto);
    if (!isFinite(vagas) || Math.floor(vagas) !== vagas || vagas < 0) continue;

    vistos[horario] = true;
    out.push({ horario: horario, vagas: vagas });
  }
  return out;
}

function capacidadeDe_(caps, horario) {
  for (var i = 0; i < caps.length; i++) {
    if (caps[i].horario === horario) return caps[i].vagas;
  }
  return -1;
}

// ===============================
// NORMALIZAÇÃO (funções puras)
// ===============================
// O Sheets devolve células de data como Date, e às vezes como ISO
// completo. Só queremos AAAA-MM-DD.
//
// O preparar() força as colunas `data` e `criado` da aba Reservas a texto
// simples, precisamente para que o ramo da string seja o único que corre em
// vivo (ver formatarTexto_). O ramo do Date fica por robustez — uma folha
// preparada à mão, ou uma coluna reformatada por acidente, não pode fazer o
// script deixar de contar reservas. Esse ramo usa os getters locais, logo
// depende do fuso do projeto; é por isso que não queremos depender dele.
function normalizarData_(v) {
  if (v instanceof Date) {
    var mes = String(v.getMonth() + 1);
    var dia = String(v.getDate());
    if (mes.length < 2) mes = "0" + mes;
    if (dia.length < 2) dia = "0" + dia;
    return v.getFullYear() + "-" + mes + "-" + dia;
  }
  var t = String(v == null ? "" : v).trim();
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + "-" + m[2] + "-" + m[3] : t;
}

// O Apps Script tem DOIS fusos independentes: o do projeto (o que o guia
// manda pôr em Europe/Lisbon) e o da própria folha de cálculo, que o guia
// nunca mencionava. O getValues() constrói as células de data em Date com o
// fuso DA FOLHA; o getMonth()/getDate() do normalizarData_ lê-as no fuso DO
// PROJETO. Quando os dois discordam, uma linha guardada à meia-noite lê-se
// como o dia anterior, e o ocupados_, o linhaDoToken_ e a escolha da linha a
// confirmar deslizam todos com ela: lugares revendidos no dia real e
// bloqueados no dia anterior. O mesmo deslize pode fazer uma reserva
// recém-criada parecer mais velha, colapsar a janela dos 20 minutos e
// torná-la elegível a órfã antes de a submissão sequer existir.
//
// Em vez de confiar em qualquer das duas definições, guardamos o `criado`
// como ISO-8601 em UTC (uma string lê-se igual em qualquer fuso) e o
// preparar() põe as colunas `data` e `criado` em texto simples, para o
// Sheets não voltar a coagir a string numa célula de data — coisa que o
// appendRow faz de livre vontade.
function criadoIso_(ms) {
  return new Date(ms).toISOString();
}

// Em vivo o `criado` é sempre a string ISO-8601 UTC escrita pelo criadoIso_,
// e o Date.parse lê-a sem depender de fuso nenhum. O ramo do Date fica para
// uma folha antiga ou reformatada à mão.
function criadoMs_(v) {
  return v instanceof Date ? v.getTime() : Date.parse(String(v));
}

function formatarTexto_(aba, coluna) {
  aba.getRange(1, coluna + 1, aba.getMaxRows(), 1).setNumberFormat("@");
}

// ===============================
// OCUPAÇÃO (funções puras)
// ===============================
// Esta é a ÚNICA definição de ocupação usada em vivo, e conta os DOIS
// estados que tomam lugar: `activo` (submetido, à espera do webhook) e
// `confirmado` (webhook recebido). Contar só as activas devolveria ao mercado
// todos os lugares já confirmados — exatamente os que são certos.
function ocupaLugar_(estado) {
  var e = String(estado == null ? "" : estado).trim();
  return e === ESTADO_ACTIVO || e === ESTADO_CONFIRMADO;
}

function ocupados_(linhas, data, horario) {
  var n = 0;
  for (var i = 1; i < (linhas || []).length; i++) {
    var l = linhas[i] || [];
    if (!ocupaLugar_(l[COL_ESTADO])) continue;
    if (normalizarData_(l[COL_DATA]) !== data) continue;
    if (String(l[COL_HORARIO]).trim() !== horario) continue;
    n++;
  }
  return n;
}

// Algum slot desta data parece cheio? É o gatilho da reconciliação no GET
// (ver doGet). Slots de capacidade 0 (horário fechado pelo dono) ficam de
// fora: 0 ocupados já é "cheio" por >=, e sem esta guarda um único horário
// fechado punha a reconciliação a correr em TODOS os GET, que é
// exatamente o custo que se quer evitar. Um horário sem lugares também não
// tem lugares para libertar.
function algumSlotCheio_(linhas, data, caps) {
  for (var i = 0; i < (caps || []).length; i++) {
    if (caps[i].vagas <= 0) continue;
    if (ocupados_(linhas, data, caps[i].horario) >= caps[i].vagas) return true;
  }
  return false;
}

// A linha viva deste token, em qualquer dos estados que tomam lugar.
//
// Incluir o `confirmado` não é zelo a mais. Um hóspede que submeta, receba a
// confirmação e volte atrás no formulário para submeter outra vez traz o
// MESMO token: se só olhássemos para as activas, o reservar_ não via a linha
// já confirmada, criava uma segunda e o hóspede ficava com dois lugares —
// e o primeiro, por estar `confirmado`, nunca seria libertado.
function linhaDoToken_(linhas, token) {
  for (var i = 1; i < (linhas || []).length; i++) {
    var l = linhas[i] || [];
    if (!ocupaLugar_(l[COL_ESTADO])) continue;
    if (String(l[COL_TOKEN]).trim() !== token) continue;
    return {
      indice: i,
      data: normalizarData_(l[COL_DATA]),
      horario: String(l[COL_HORARIO]).trim()
    };
  }
  return null;
}

// ===============================
// VALIDAÇÃO (função pura)
// ===============================
function validarPedido_(pedido, caps, hoje) {
  var token = String((pedido && pedido.token) || "");
  var data = String((pedido && pedido.data) || "");
  var horario = String((pedido && pedido.horario) || "");

  if (!/^[A-Za-z0-9-]{8,64}$/.test(token)) return { ok: false, erro: "token_invalido" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, erro: "data_invalida" };
  // Comparação de strings basta: em ISO a ordem lexicográfica é cronológica.
  if (data < hoje) return { ok: false, erro: "data_passada" };
  if (capacidadeDe_(caps, horario) < 0) return { ok: false, erro: "horario_desconhecido" };
  return { ok: true };
}

// ===============================
// RECONCILIAÇÃO (auto-reparação)
// ===============================
// Uma reserva que se concretizou é CONFIRMADA pelo webhook da JotForm. Uma
// abandonada fica `activo` para sempre. Logo, uma linha `activo` com mais de
// 20 minutos é uma órfã e pode ser libertada: se a submissão se tivesse
// concluído, o webhook já teria chegado.
//
// Isto substituiu uma versão que INFERIA o mesmo comparando contagens com
// uma coluna da folha das respostas. Essa coluna nunca existiu — o espelho
// do JotForm nunca escreveu nela (verificado no formulário publicado) — e a
// inferência trazia consigo toda a espécie de modo de falha silencioso.
// Agora não se infere: ou o webhook confirmou, ou não.
//
// Uma linha `confirmado` NUNCA é libertada. É uma reserva a valer.
function planoReconciliacao_(reservas, agoraMs, janelaMs) {
  var expirar = [];
  for (var i = 1; i < (reservas || []).length; i++) {
    var l = reservas[i] || [];
    if (String(l[COL_ESTADO]).trim() !== ESTADO_ACTIVO) continue;

    var criado = criadoMs_(l[COL_CRIADO]);
    // Sem timestamp legível não arriscamos: deixamos a linha em paz.
    if (!isFinite(criado)) continue;
    if (agoraMs - criado <= janelaMs) continue;

    expirar.push(i);
  }
  return expirar;
}

// Já chegou algum webhook, alguma vez?
//
// Esta é a guarda mais importante do ficheiro. Se o webhook estiver mal
// configurado — segredo errado, URL errado, integração nunca criada — NADA é
// confirmado, e sem esta guarda TODAS as reservas seriam libertadas 20
// minutos depois de serem feitas e os lugares revendidos, em silêncio, para
// o resto da vida da implantação.
//
// Enquanto não houver prova de que o webhook funciona, não se liberta nada.
// O preço é o oposto: as órfãs ficam presas e um slot pode aparecer cheio
// sem estar. Isso é visível ao dono e corrigível à mão; a sobre-reserva
// silenciosa não é nem uma coisa nem outra.
function primeiroWebhookChegou_(io) {
  if (!io.ultimoWebhook) return false;
  var v = io.ultimoWebhook();
  return !!(v && String(v).trim());
}

// Ponto de entrada único da reconciliação, partilhado pelo POST e pelo GET.
// Ter os dois caminhos a chamar isto é deliberado: as guardas não podem
// divergir, senão fechar um buraco num deles deixa-o aberto no outro.
// Devolve quantas linhas expirou.
//
// `excluirIndice` é a linha de quem está a pedir (-1 quando não há nenhuma).
// O plano é calculado sobre TODO o registo, pelo que a linha do próprio
// token pode sair nele — basta o hóspede demorar mais de 20 minutos entre a
// primeira submissão e uma troca de horário. Sem esta exclusão, um hóspede
// que tentasse trocar para um horário cheio recebia a recusa E perdia o
// lugar que já tinha, contra o invariante que o reservar_ documenta: a
// capacidade é verificada ANTES de libertar a escolha anterior.
//
// A recusa por falta de webhook vai para o registo de execução. A recusa em
// si é deliberada, mas o SILÊNCIO não: quem fosse investigar "por que é que
// as órfãs nunca são libertadas?" não tinha nada onde olhar.
function reconciliar_(io, excluirIndice) {
  if (!primeiroWebhookChegou_(io)) {
    console.log("Reconciliação não corre: ainda não chegou nenhum webhook da " +
      "JotForm. Enquanto não chegar nenhum, não se liberta nada — senão um " +
      "webhook mal configurado revendia todos os lugares já vendidos. " +
      "Confirme a integração e o segredo (ver preparar()).");
    return 0;
  }

  var bruto = planoReconciliacao_(io.lerReservas(), io.agora(), JANELA_ORFAS_MS);

  var plano = [];
  for (var i = 0; i < bruto.length; i++) {
    if (bruto[i] !== excluirIndice) plano.push(bruto[i]);
  }
  if (!plano.length) return 0;

  io.expirar(plano);
  return plano.length;
}

// ===============================
// NÚCLEO DA RESERVA
// ===============================
// A lógica toda está aqui, com a E/S injetada (io), para poder ser testada
// em Node sem Apps Script. O doPost só junta o mutex e a folha real.
//
// A ordem dos passos importa: a capacidade é verificada ANTES de libertar
// a escolha anterior do mesmo token. Ao contrário, um hóspede que trocasse
// para um horário cheio perdia o lugar que já tinha e não ganhava nenhum.
function reservar_(pedido, io) {
  var caps = capacidades_(io.lerCapacidades());
  if (!caps.length) return { ok: false, erro: "capacidades_ilegiveis" };

  var hoje = normalizarData_(new Date(io.agora()));
  var v = validarPedido_(pedido, caps, hoje);
  if (!v.ok) return v;

  var data = pedido.data;
  var horario = pedido.horario;
  var limite = capacidadeDe_(caps, horario);

  var linhas = io.lerReservas();
  var existente = linhaDoToken_(linhas, pedido.token);

  if (existente && existente.data === data && existente.horario === horario) {
    return { ok: true, reservado: true, estado: "repetido" };
  }

  var livre = ocupados_(linhas, data, horario) < limite;

  if (!livre) {
    // Só aqui vale a pena reconciliar: é a única situação em que libertar
    // órfãs pode mudar a resposta. Mantém o caminho normal rápido.
    if (reconciliar_(io, existente ? existente.indice : -1)) {
      linhas = io.lerReservas();
      livre = ocupados_(linhas, data, horario) < limite;
    }
  }

  if (!livre) return { ok: true, reservado: false, motivo: "cheio", restantes: 0 };

  if (existente) io.expirar([existente.indice]);
  io.acrescentar([
    pedido.token, data, horario, criadoIso_(io.agora()), ESTADO_ACTIVO, "", ""
  ]);

  return { ok: true, reservado: true, estado: existente ? "trocado" : "novo" };
}

// ===============================
// E/S REAL NA FOLHA
// ===============================
function folha_(nome, criarSeFaltar) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(nome);
  if (!aba && criarSeFaltar) aba = ss.insertSheet(nome);
  return aba;
}

function lerTudo_(nome) {
  var aba = folha_(nome, false);
  if (!aba) return null;
  var ultima = aba.getLastRow();
  var colunas = aba.getLastColumn();
  if (ultima < 1 || colunas < 1) return [];
  return aba.getRange(1, 1, ultima, colunas).getValues();
}

function propriedade_(chave) {
  return PropertiesService.getScriptProperties().getProperty(chave);
}

function ioReal_() {
  return {
    // lerTudo_ devolve null só quando a ABA não existe; uma aba que existe
    // mas está vazia devolve [], que é verdadeiro em JS e por isso NÃO
    // ativava o substituto abaixo. Sem este `.length`, a primeira reserva
    // acrescentada ficava na linha do cabeçalho — invisível para sempre,
    // porque todas as funções puras começam a contar em i = 1.
    lerReservas: function () {
      var linhas = lerTudo_(ABA_RESERVAS);
      return (linhas && linhas.length) ? linhas : [CABECALHO_RESERVAS];
    },
    lerCapacidades: function () { return lerTudo_(ABA_CAPACIDADES) || []; },
    acrescentar: function (linha) {
      var aba = folha_(ABA_RESERVAS, true);
      // Espelha a guarda de lerReservas: uma aba nova ou esvaziada não tem
      // cabeçalho nenhum, e sem ele a linha que estamos prestes a escrever
      // seria a linha 1 — a mesma que lerReservas trata como cabeçalho.
      if (aba.getLastRow() < 1) aba.appendRow(CABECALHO_RESERVAS);
      aba.appendRow(linha);
      // Sem isto, o doPost pode largar o lock antes do appendRow ficar
      // visível a uma leitura seguinte, e o pedido seguinte lê a folha sem
      // ver o lugar que acabou de ser ocupado: as duas reservas ganham o
      // último lugar, o que é exatamente o que este ficheiro existe para
      // impedir.
      SpreadsheetApp.flush();
    },
    expirar: function (indices) {
      var aba = folha_(ABA_RESERVAS, true);
      for (var i = 0; i < indices.length; i++) {
        // +1 porque as linhas da folha são 1-based e o índice inclui o cabeçalho.
        aba.getRange(indices[i] + 1, COL_ESTADO + 1).setValue(ESTADO_EXPIRADO);
      }
      SpreadsheetApp.flush();
    },
    ultimoWebhook: function () { return propriedade_(CHAVE_ULTIMO_WEBHOOK); },
    agora: function () { return Date.now(); }
  };
}

function resposta_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===============================
// GET: vagas de uma data
// ===============================
// É também aqui que a reconciliação corre em regime best-effort, e só
// quando algum slot da data pedida parece cheio. Sem este caminho, um slot
// cujos lugares fossem TODOS órfãos apareceria como "Sem vagas", ninguém
// chegaria a submeter contra ele, e a reconciliação do POST nunca correria:
// as órfãs ficavam presas para sempre.
function doGet(e) {
  var data = String(((e && e.parameter) || {}).data || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return resposta_({ ok: false, erro: "data_invalida" });
  }

  var io = ioReal_();
  var caps = capacidades_(io.lerCapacidades());
  if (!caps.length) return resposta_({ ok: false, erro: "capacidades_ilegiveis" });

  var linhas = io.lerReservas();

  // Reconciliar custa uma aquisição de lock e um getValues() inteiro da aba
  // Reservas. O <input type="date"> dispara `change` por segmento, logo uma
  // data escrita à mão faz uns três GET, cada um a serializar atrás dos
  // outros e atrás de todos os outros hóspedes.
  //
  // Por isso só reconciliamos quando algum slot desta data PARECE cheio,
  // que é exatamente o caso que este caminho existe para fechar. A
  // propriedade de fecho mantém-se intacta; o custo sai do caminho normal.
  if (algumSlotCheio_(linhas, data, caps)) {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(ESPERA_LOCK_GET_MS)) {
      try {
        // Ninguém a pedir um lugar: não há linha a proteger.
        if (reconciliar_(io, -1)) linhas = io.lerReservas();
      } catch (err) {
        // Reconciliar é oportunista: falhar aqui não deve impedir o GET —
        // o hóspede continua a receber as contagens. Mas engolir o erro sem
        // deixar rasto escondia uma reconciliação que nunca funciona atrás
        // de um GET que parece perfeito.
        console.log("Reconciliação no GET falhou (o GET segue): " + err);
      } finally {
        lock.releaseLock();
      }
    }
  }

  var slots = [];
  for (var i = 0; i < caps.length; i++) {
    var usadas = ocupados_(linhas, data, caps[i].horario);
    slots.push({
      horario: caps[i].horario,
      capacidade: caps[i].vagas,
      restantes: Math.max(0, caps[i].vagas - usadas)
    });
  }
  return resposta_({ ok: true, data: data, slots: slots });
}

// ===============================
// POST: reservar um lugar
// ===============================
function doPost(e) {
  var pedido;
  try {
    pedido = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return resposta_({ ok: false, erro: "corpo_invalido" });
  }
  // O !pedido não é zelo a mais: JSON.parse("null") tem SUCESSO, e o
  // pedido.acao aqui — já fora do try — levantava um TypeError. O Apps
  // Script respondia com uma página HTML de erro em vez de JSON, e o widget
  // não sabe ler isso. Vale o mesmo para "123" ou "\"texto\"".
  if (!pedido || pedido.acao !== "reservar") {
    return resposta_({ ok: false, erro: "acao_desconhecida" });
  }

  var lock = LockService.getScriptLock();
  // É este mutex que torna impossível duas submissões simultâneas
  // intercalarem-se e ficarem as duas com o último lugar.
  if (!lock.tryLock(ESPERA_LOCK_MS)) {
    return resposta_({ ok: false, erro: "lock_indisponivel" });
  }
  try {
    return resposta_(reservar_(pedido, ioReal_()));
  } catch (err2) {
    return resposta_({ ok: false, erro: "erro_interno" });
  } finally {
    lock.releaseLock();
  }
}

// ===============================
// INSTALAÇÃO E LIMPEZA
// ===============================
// O editor do Apps Script NÃO mostra o valor devolvido por uma função —
// só mostra o painel "Registo de execução". Sem este console.log, a
// mensagem que o dono tem de CONFIRMAR na instalação (se o webhook está
// configurado, se já chegou algum) não aparecia em sítio nenhum e a
// confirmação era impossível.
function relatar_(mensagem) {
  console.log(mensagem);
  return mensagem;
}

// Corre UMA vez a partir do editor. Cria as abas e semeia as capacidades
// atuais. É preferível a pedir ao dono para criar abas à mão.
function preparar() {
  var lock = LockService.getScriptLock();
  // O mesmo lock do doPost. O preparar() acrescenta linhas e o limparTestes()
  // apaga-as; sem o lock, um deles corre a meio de um doPost que já leu a
  // folha e já calculou o seu plano de reconciliação, e o setValue do
  // expirar vai marcar `expirado` na linha errada — uma reserva real de um
  // hóspede que nada tem a ver com isto.
  if (!lock.tryLock(ESPERA_LOCK_MANUTENCAO_MS)) return relatar_(AVISO_OCUPADO);
  try {
    return relatar_(preparar_());
  } finally {
    lock.releaseLock();
  }
}

// Uma aba Reservas de uma versão anterior tem o cabeçalho antigo, de cinco
// colunas. As colunas são lidas por POSIÇÃO e não pelo nome, logo o script
// funciona de qualquer maneira — mas o dono ficava sem saber o que são as
// duas colunas novas que aparecem cheias de nomes de hóspedes.
function garantirCabecalho_(aba) {
  if (aba.getLastColumn() >= CABECALHO_RESERVAS.length) return;
  aba.getRange(1, 1, 1, CABECALHO_RESERVAS.length).setValues([CABECALHO_RESERVAS]);
}

function preparar_() {
  var reservas = folha_(ABA_RESERVAS, true);
  if (reservas.getLastRow() < 1) reservas.appendRow(CABECALHO_RESERVAS);
  garantirCabecalho_(reservas);

  // Texto simples nas colunas que o Sheets teria coagido — as duas datas
  // (ver formatarTexto_) e o quarto, porque um quarto "007" virava 7. Mas SÓ
  // enquanto a aba não tiver linhas de dados.
  //
  // A razão é uma versão anterior deste script, que deixava o appendRow
  // coagir as strings ISO em células de DATA. Reformatar essa coluna para
  // texto simples não converte a célula de volta à string original: uma
  // célula de data formatada como texto pode devolver o NÚMERO DE SÉRIE do
  // Sheets no getValues(), e então o normalizarData_ dá "46000". Todas as
  // reservas guardadas ficariam invisíveis para o ocupados_ e os lugares
  // delas seriam vendidos outra vez — exatamente o desastre que este
  // ficheiro existe para impedir, e desencadeado por um simples segundo
  // preparar().
  //
  // Não foi possível confirmar em Apps Script a partir daqui, por isso
  // tratamos como risco e não como facto: com uma aba já com dados não há
  // ganho nenhum em formatar (as linhas antigas já lá estão como estão, e as
  // novas trazem a string ISO do criadoIso_), e há este risco todo.
  //
  // Nota de horizonte: o formatarTexto_ cobre as linhas até ao
  // getMaxRows() do momento — 1000 numa aba nova. Uma folha que passe disso
  // volta a ter as colunas em formato automático nas linhas de baixo. Não é
  // fatal (a coluna `criado` guarda ISO em UTC e o normalizarData_ ainda
  // aceita Date), mas quem lá chegar deve saber que a garantia tem limite.
  if (reservas.getLastRow() <= 1) {
    formatarTexto_(reservas, COL_DATA);
    formatarTexto_(reservas, COL_CRIADO);
    formatarTexto_(reservas, COL_QUARTO);
  }

  var caps = folha_(ABA_CAPACIDADES, true);
  if (caps.getLastRow() < 1) {
    caps.appendRow(CABECALHO_CAPACIDADES);
    caps.appendRow(["08:00-08:45", 3]);
    caps.appendRow(["08:45-09:30", 2]);
    caps.appendRow(["09:30-10:15", 3]);
    caps.appendRow(["10:15-11:00", 2]);
  }

  // O dono tem de CONFIRMAR isto na instalação: enquanto não tiver chegado
  // nenhum webhook, nenhum lugar é libertado.
  var ultimo = ioReal_().ultimoWebhook();
  return "Abas prontas. Último webhook recebido: " + (ultimo ? ultimo : "NUNCA") +
    (ultimo ? "" : " (enquanto for NUNCA, nenhum lugar é libertado)") + ".";
}

// Apaga as linhas do teste de concorrência. Existe para que ninguém tenha
// de escrever à mão na folha: um clique mal dado já apagou o email de um
// hóspede real.
function limparTestes() {
  var lock = LockService.getScriptLock();
  // O deleteRow é a operação mais perigosa do ficheiro: desloca todos os
  // índices abaixo dele. Ver o comentário do preparar().
  if (!lock.tryLock(ESPERA_LOCK_MANUTENCAO_MS)) return relatar_(AVISO_OCUPADO);
  try {
    return relatar_(limparTestes_());
  } finally {
    lock.releaseLock();
  }
}

function limparTestes_() {
  var aba = folha_(ABA_RESERVAS, false);
  if (!aba) return "Aba Reservas não existe.";
  var linhas = lerTudo_(ABA_RESERVAS) || [];
  var apagadas = 0;
  for (var i = linhas.length - 1; i >= 1; i--) {
    if (String((linhas[i] || [])[COL_TOKEN]).indexOf("conc-teste-") === 0) {
      aba.deleteRow(i + 1);
      apagadas++;
    }
  }
  return "Linhas de teste apagadas: " + apagadas;
}

// ===============================
// EXPORTAÇÃO PARA OS TESTES
// ===============================
// No Apps Script "module" não existe, logo este bloco é ignorado. Em Node
// é o que dá acesso às funções puras (ver tests/carregar.mjs).
if (typeof module !== "undefined") {
  module.exports = {
    capacidades_: capacidades_,
    capacidadeDe_: capacidadeDe_,
    normalizarData_: normalizarData_,
    criadoIso_: criadoIso_,
    criadoMs_: criadoMs_,
    ocupaLugar_: ocupaLugar_,
    ocupados_: ocupados_,
    algumSlotCheio_: algumSlotCheio_,
    linhaDoToken_: linhaDoToken_,
    validarPedido_: validarPedido_,
    planoReconciliacao_: planoReconciliacao_,
    primeiroWebhookChegou_: primeiroWebhookChegou_,
    reconciliar_: reconciliar_,
    reservar_: reservar_,
    preparar: preparar,
    doGet: doGet,
    doPost: doPost,
    limparTestes: limparTestes,
    // ioReal_ é a E/S real (SpreadsheetApp), normalmente fora do alcance dos
    // testes de unidade. É exportada mesmo assim para pinar, com uma folha
    // e um SpreadsheetApp esboçados, a aritmética de índices e as chamadas
    // a flush() que só se veem aqui — ver os testes de "ioReal_".
    ioReal_: ioReal_
  };
}
