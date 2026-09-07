// ===============================
// RESERVAS — Web App do Apps Script
// ===============================
// Ligado à folha das submissões do JotForm. É esta a peça que torna
// impossível sobre-reservar: o POST reserva um lugar dentro de um mutex
// (LockService), coisa que o Sheety nunca conseguiu oferecer.
//
// Instalação: ver docs/instalacao-reservas.md.

var ABA_RESERVAS = "Reservas";
var ABA_CAPACIDADES = "Capacidades";
var ABA_SUBMISSOES = "Form responses";

// Colunas da aba Reservas.
var COL_TOKEN = 0;
var COL_DATA = 1;
var COL_HORARIO = 2;
var COL_CRIADO = 3;
var COL_ESTADO = 4;

var CABECALHO_RESERVAS = ["token", "data", "horario", "criado", "estado"];
var CABECALHO_CAPACIDADES = ["horario", "vagas"];

var ESTADO_ACTIVO = "activo";
var ESTADO_EXPIRADO = "expirado";

var FORMATO_HORARIO = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

var JANELA_ORFAS_MS = 20 * 60 * 1000;
var ESPERA_LOCK_MS = 20000;
var ESPERA_LOCK_GET_MS = 5000;

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
// completo. Só queremos AAAA-MM-DD, em hora local (o fuso do projeto tem
// de ser Europe/Lisbon).
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

// Aceita "a|b" e "a | b" como o mesmo valor.
function normalizarReserva_(v) {
  return String(v == null ? "" : v).trim().replace(/\s*\|\s*/, " | ");
}

// ===============================
// OCUPAÇÃO (funções puras)
// ===============================
// Esta é a ÚNICA definição de ocupação usada em vivo. A aba Form responses
// nunca entra na contagem — serve só à reconciliação.
function activos_(linhas, data, horario) {
  var n = 0;
  for (var i = 1; i < (linhas || []).length; i++) {
    var l = linhas[i] || [];
    if (String(l[COL_ESTADO]).trim() !== ESTADO_ACTIVO) continue;
    if (normalizarData_(l[COL_DATA]) !== data) continue;
    if (String(l[COL_HORARIO]).trim() !== horario) continue;
    n++;
  }
  return n;
}

function linhaDoToken_(linhas, token) {
  for (var i = 1; i < (linhas || []).length; i++) {
    var l = linhas[i] || [];
    if (String(l[COL_ESTADO]).trim() !== ESTADO_ACTIVO) continue;
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
// RECONCILIAÇÃO (funções puras)
// ===============================
// Uma reserva genuína deixa rasto em DOIS sítios: uma linha na aba
// Reservas (escrita por nós) e uma linha na Form responses (escrita pela
// integração do JotForm). Uma reserva abandonada deixa rasto só no
// primeiro. Logo, o excedente de linhas antigas sem contrapartida nas
// submissões são órfãs, e podem ser libertadas.
//
// Casamos por CONTAGENS, não por identidade: por isso não é preciso
// campo novo no JotForm nem espelhar o token. A troco disso, não sabemos
// QUAL das linhas é a órfã — e não precisamos, só de quantas.

var FORMATO_RESERVA_COMPLETO = /^\d{4}-\d{2}-\d{2}\s*\|\s*\d{2}:\d{2}-\d{2}:\d{2}$/;

// Procura a coluna "Reserva" na Form responses: primeiro pelo cabeçalho,
// depois por conteúdo. Devolver -1 é o sinal de "não sei ler isto", e quem
// chama TEM de tratar isso como "não reconciliar nada".
//
// O candidato do cabeçalho só é aceite se tiver pelo menos um valor no
// formato certo. Sem esta validação, uma coluna "Reserva" que existe mas
// está vazia — p.ex. a integração do JotForm ainda não está mapeada para
// lá escrever, ou a aba só tem cabeçalho — seria aceite às cegas: toda a
// contagem de submissões ficaria a zero, toda a reserva antiga pareceria
// órfã, e a reconciliação libertaria reservas REAIS. Por isso caímos para
// a rede de segurança por conteúdo, e devolvemos -1 se nem essa encontrar
// nada — nunca aceitamos uma coluna sem provas de conter reservas.
function colunaReserva_(linhas) {
  if (!linhas || !linhas.length) return -1;

  var cabecalho = linhas[0] || [];
  var largura = 0;
  for (var i = 0; i < linhas.length; i++) {
    largura = Math.max(largura, (linhas[i] || []).length);
  }

  // Contagem por coluna de valores no formato certo — usada tanto para
  // validar o candidato do cabeçalho como para a rede de segurança.
  var contagens = [];
  for (var col = 0; col < largura; col++) {
    var n = 0;
    for (var r = 1; r < linhas.length; r++) {
      var v = normalizarReserva_((linhas[r] || [])[col]);
      if (FORMATO_RESERVA_COMPLETO.test(v)) n++;
    }
    contagens[col] = n;
  }

  var candidatoCabecalho = -1;
  for (var c = 0; c < cabecalho.length; c++) {
    if (/reserva/i.test(String(cabecalho[c] == null ? "" : cabecalho[c]))) {
      candidatoCabecalho = c;
      break;
    }
  }
  if (candidatoCabecalho >= 0 && contagens[candidatoCabecalho] > 0) {
    return candidatoCabecalho;
  }

  // Rede de segurança: a coluna com mais valores no formato certo.
  var melhor = -1;
  var melhorContagem = 0;
  for (var col2 = 0; col2 < largura; col2++) {
    if (contagens[col2] > melhorContagem) {
      melhorContagem = contagens[col2];
      melhor = col2;
    }
  }
  return melhorContagem > 0 ? melhor : -1;
}

function contarSubmissoes_(linhas, idxColuna) {
  var mapa = {};
  if (idxColuna < 0) return mapa;
  for (var i = 1; i < (linhas || []).length; i++) {
    var v = normalizarReserva_((linhas[i] || [])[idxColuna]);
    if (!v) continue;
    mapa[v] = (mapa[v] || 0) + 1;
  }
  return mapa;
}

function planoReconciliacao_(reservas, submissoes, agoraMs, janelaMs) {
  var porSlot = {};

  for (var i = 1; i < (reservas || []).length; i++) {
    var l = reservas[i] || [];
    if (String(l[COL_ESTADO]).trim() !== ESTADO_ACTIVO) continue;

    var criado = l[COL_CRIADO] instanceof Date
      ? l[COL_CRIADO].getTime()
      : Date.parse(String(l[COL_CRIADO]));
    // Sem timestamp legível não arriscamos: deixamos a linha em paz.
    if (!isFinite(criado)) continue;
    if (agoraMs - criado <= janelaMs) continue;

    var chave = normalizarData_(l[COL_DATA]) + " | " + String(l[COL_HORARIO]).trim();
    if (!porSlot[chave]) porSlot[chave] = [];
    porSlot[chave].push({ indice: i, criado: criado });
  }

  var expirar = [];
  for (var chave2 in porSlot) {
    if (!Object.prototype.hasOwnProperty.call(porSlot, chave2)) continue;
    var antigas = porSlot[chave2];
    antigas.sort(function (a, b) { return a.criado - b.criado; });

    var confirmadas = submissoes[chave2] || 0;
    var excedente = antigas.length - confirmadas;
    for (var k = 0; k < excedente && k < antigas.length; k++) {
      expirar.push(antigas[k].indice);
    }
  }

  expirar.sort(function (a, b) { return a - b; });
  return expirar;
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

  var livre = activos_(linhas, data, horario) < limite;

  if (!livre) {
    // Só aqui vale a pena ler a Form responses: é a única situação em que
    // reconciliar pode mudar a resposta. Mantém o caminho normal rápido.
    var submissoes = io.lerSubmissoes();
    if (submissoes && submissoes.length) {
      var idx = colunaReserva_(submissoes);
      // -1 = não sabemos ler a coluna. Reconciliar às cegas libertaria
      // reservas reais e reabriria lugares. Preferimos recusar.
      if (idx >= 0) {
        var plano = planoReconciliacao_(
          linhas, contarSubmissoes_(submissoes, idx), io.agora(), JANELA_ORFAS_MS
        );
        if (plano.length) {
          io.expirar(plano);
          linhas = io.lerReservas();
          livre = activos_(linhas, data, horario) < limite;
        }
      }
    }
  }

  if (!livre) return { ok: true, reservado: false, motivo: "cheio", restantes: 0 };

  if (existente) io.expirar([existente.indice]);
  io.acrescentar([pedido.token, data, horario, new Date(io.agora()), ESTADO_ACTIVO]);

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

function ioReal_() {
  return {
    lerReservas: function () { return lerTudo_(ABA_RESERVAS) || [CABECALHO_RESERVAS]; },
    lerCapacidades: function () { return lerTudo_(ABA_CAPACIDADES) || []; },
    lerSubmissoes: function () { return lerTudo_(ABA_SUBMISSOES); },
    acrescentar: function (linha) {
      folha_(ABA_RESERVAS, true).appendRow(linha);
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
// É também aqui que a reconciliação corre em regime best-effort. Sem isto,
// um slot cujos lugares fossem TODOS órfãos apareceria como "Sem vagas",
// ninguém chegaria a submeter contra ele, e a reconciliação do POST nunca
// correria: as órfãs ficavam presas para sempre.
function doGet(e) {
  var data = String(((e && e.parameter) || {}).data || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return resposta_({ ok: false, erro: "data_invalida" });
  }

  var io = ioReal_();
  var caps = capacidades_(io.lerCapacidades());
  if (!caps.length) return resposta_({ ok: false, erro: "capacidades_ilegiveis" });

  var lock = LockService.getScriptLock();
  if (lock.tryLock(ESPERA_LOCK_GET_MS)) {
    try {
      var submissoes = io.lerSubmissoes();
      if (submissoes && submissoes.length) {
        var idx = colunaReserva_(submissoes);
        if (idx >= 0) {
          var plano = planoReconciliacao_(
            io.lerReservas(), contarSubmissoes_(submissoes, idx),
            io.agora(), JANELA_ORFAS_MS
          );
          if (plano.length) io.expirar(plano);
        }
      }
    } catch (err) {
      // Reconciliar é oportunista: falhar aqui não deve impedir o GET.
    } finally {
      lock.releaseLock();
    }
  }

  var linhas = io.lerReservas();
  var slots = [];
  for (var i = 0; i < caps.length; i++) {
    var usadas = activos_(linhas, data, caps[i].horario);
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
  if (pedido.acao !== "reservar") return resposta_({ ok: false, erro: "acao_desconhecida" });

  var lock = LockService.getScriptLock();
  // É este mutex que torna impossível duas submissões simultâneas
  // intercalarem-se e ficarem as duas com o último lugar.
  if (!lock.tryLock(ESPERA_LOCK_MS)) {
    return resposta_({ ok: false, erro: "lock_indisponivel" });
  }
  try {
    return resposta_(reservar_(pedido, ioReal_()));
  } catch (err) {
    return resposta_({ ok: false, erro: "erro_interno" });
  } finally {
    lock.releaseLock();
  }
}

// ===============================
// INSTALAÇÃO E LIMPEZA
// ===============================
// Corre UMA vez a partir do editor. Cria as abas e semeia as capacidades
// atuais. É preferível a pedir ao dono para criar abas à mão.
function preparar() {
  var reservas = folha_(ABA_RESERVAS, true);
  if (reservas.getLastRow() < 1) reservas.appendRow(CABECALHO_RESERVAS);

  var caps = folha_(ABA_CAPACIDADES, true);
  if (caps.getLastRow() < 1) {
    caps.appendRow(CABECALHO_CAPACIDADES);
    caps.appendRow(["08:00-08:45", 3]);
    caps.appendRow(["08:45-09:30", 2]);
    caps.appendRow(["09:30-10:15", 3]);
    caps.appendRow(["10:15-11:00", 2]);
  }
  return "Abas prontas.";
}

// Apaga as linhas do teste de concorrência. Existe para que ninguém tenha
// de escrever à mão na folha: um clique mal dado já apagou o email de um
// hóspede real.
function limparTestes() {
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
    normalizarReserva_: normalizarReserva_,
    activos_: activos_,
    linhaDoToken_: linhaDoToken_,
    validarPedido_: validarPedido_,
    colunaReserva_: colunaReserva_,
    contarSubmissoes_: contarSubmissoes_,
    planoReconciliacao_: planoReconciliacao_,
    reservar_: reservar_,
    // ioReal_ é a E/S real (SpreadsheetApp), normalmente fora do alcance dos
    // testes de unidade. É exportada mesmo assim para pinar, com uma folha
    // e um SpreadsheetApp esboçados, a aritmética de índices e as chamadas
    // a flush() que só se veem aqui — ver os testes de "ioReal_".
    ioReal_: ioReal_
  };
}
