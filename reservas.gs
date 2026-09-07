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
    validarPedido_: validarPedido_
  };
}
