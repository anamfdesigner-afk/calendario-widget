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
// Nome habitual da aba das submissões. É só o PRIMEIRO palpite: a busca
// real é tolerante (ver escolherAbaSubmissoes_).
var ABA_SUBMISSOES = "Form responses";

// Nomes que uma aba de submissões costuma ter em qualquer idioma:
// "Form responses", "Form Responses 1", "Respostas do formulário".
var NOME_SUBMISSOES = /form|respost/i;

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

// Chave nas ScriptProperties onde vive a marca de água das submissões
// (ver submissoesFiaveis_).
var CHAVE_MARCA = "marcaSubmissoes";

var JANELA_ORFAS_MS = 20 * 60 * 1000;

// ATENÇÃO: acoplado ao ORCAMENTO_RESERVA_MS do widget.js (5 s por
// tentativa). Tem de ficar CONFORTAVELMENTE DENTRO desse orçamento. Com os
// 20 s que aqui estavam, sob contenção o widget desistia e falhava fechado
// — o hóspede era informado de que a reserva falhou — e o servidor tomava
// o lugar logo depois: o lugar ficava como ocupação fantasma durante 20
// minutos. Não mexer num dos dois sem mexer no outro.
var ESPERA_LOCK_MS = 3500;

var ESPERA_LOCK_GET_MS = 5000;

// O preparar(), o semear() e o limparTestes() correm à mão a partir do
// editor, onde não há hóspede nenhum à espera nem orçamento de cliente a
// respeitar. Podem esperar muito mais do que o caminho da reserva — e mais
// vale esperar do que devolver ao dono uma mensagem de "ocupado".
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

// Aceita "a|b" e "a | b" como o mesmo valor.
function normalizarReserva_(v) {
  return String(v == null ? "" : v).trim().replace(/\s*\|\s*/, " | ");
}

// O Apps Script tem DOIS fusos independentes: o do projeto (o que o guia
// manda pôr em Europe/Lisbon) e o da própria folha de cálculo, que o guia
// nunca mencionava. O getValues() constrói as células de data em Date com o
// fuso DA FOLHA; o getMonth()/getDate() do normalizarData_ lê-as no fuso DO
// PROJETO. Quando os dois discordam, uma linha guardada à meia-noite lê-se
// como o dia anterior, e o activos_, o linhaDoToken_ e a chave da
// reconciliação deslizam todos com ela: lugares revendidos no dia real e
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

function formatarTexto_(aba, coluna) {
  aba.getRange(1, coluna + 1, aba.getMaxRows(), 1).setNumberFormat("@");
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

// Algum slot desta data parece cheio? É o gatilho da reconciliação no GET
// (ver doGet). Slots de capacidade 0 (horário fechado pelo dono) ficam de
// fora: 0 activos já é "cheio" por >=, e sem esta guarda um único horário
// fechado punha a reconciliação a correr em TODOS os GET, que é
// exatamente o custo que se quer evitar. Um horário sem lugares também não
// tem lugares para libertar.
function algumSlotCheio_(linhas, data, caps) {
  for (var i = 0; i < (caps || []).length; i++) {
    if (caps[i].vagas <= 0) continue;
    if (activos_(linhas, data, caps[i].horario) >= caps[i].vagas) return true;
  }
  return false;
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

    // Em vivo o `criado` é sempre a string ISO-8601 UTC escrita pelo
    // criadoIso_, e o Date.parse lê-a sem depender de fuso nenhum. O ramo
    // do Date fica para uma folha antiga ou reformatada à mão.
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

// A guarda do colunaReserva_ é ao nível da COLUNA: basta UMA linha com
// valor no formato certo. A premissa de que a reconciliação precisa é por
// LINHA: toda a reserva genuína deixou uma submissão com o seu valor.
//
// O gatilho realista é a história deste repositório: alguém renomeia ou
// remapeia o campo `Reserva` no JotForm. O setFieldsValueByLabel é um
// postMessage sem resposta, onde um rótulo errado é indistinguível de
// sucesso — foi exatamente esse o erro que passou muito tempo sem se notar
// aqui. O espelho deixa de escrever, as linhas históricas válidas mantêm o
// colunaReserva_ satisfeito, cada reserva nova parece órfã, e 20 minutos
// depois de cada reserva o lugar é libertado e revendido, em silêncio.
//
// Por isso recusamos reconciliar quando as provas parecem INCOMPLETAS, e
// não apenas quando faltam de todo. `marca` é a contagem de linhas da
// Form responses registada na instalação: as linhas anteriores estão
// isentas (a folha tem ~49 linhas históricas cujo `Reserva` nunca foi
// escrito, e essas não podem travar a reconciliação para sempre), mas
// todas as posteriores têm de trazer uma reserva legível. O widget tem
// OBRIGATORIO = true, logo uma submissão nova sem reserva não é um
// hóspede que não escolheu: é o espelho partido.
//
// O resultado é trocar uma sobre-reserva silenciosa por uma libertação
// conservadora a menos, que é a direção escolhida em todo o resto deste
// desenho.
function submissoesFiaveis_(submissoes, idxColuna, marca) {
  if (idxColuna < 0) return false;
  var inicio = marca > 1 ? marca : 1;
  for (var i = inicio; i < (submissoes || []).length; i++) {
    var v = normalizarReserva_((submissoes[i] || [])[idxColuna]);
    if (!FORMATO_RESERVA_COMPLETO.test(v)) return false;
  }
  return true;
}

// Marca de água ainda não registada conta como 0, ou seja o regime mais
// estrito: sem saber quais as linhas históricas, todas as linhas têm de
// trazer reserva. Falhar para o lado de não libertar nada é preferível a
// libertar reservas reais.
function marcaDe_(io) {
  if (!io.marcaSubmissoes) return 0;
  var n = Number(io.marcaSubmissoes());
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Ponto de entrada único da reconciliação, partilhado pelo POST e pelo GET.
// Ter os dois caminhos a chamar isto é deliberado: as guardas não podem
// divergir, senão fechar um buraco num deles deixa-o aberto no outro.
// Devolve quantas linhas expirou.
//
// `excluirIndice` é a linha de quem está a pedir (-1 quando não há nenhuma).
// O plano é calculado sobre TODO o registo, e a reconciliação casa por
// contagens e não por identidade, pelo que a linha do próprio token pode
// sair no plano — mesmo quando é ela que tem submissão. Sem esta exclusão,
// um hóspede que tentasse trocar para um horário cheio recebia a recusa E
// perdia a reserva que já tinha confirmada, contra o invariante que o
// reservar_ documenta: a capacidade é verificada ANTES de libertar a
// escolha anterior.
function reconciliar_(io, excluirIndice) {
  var submissoes = io.lerSubmissoes();
  if (!submissoes || !submissoes.length) return 0;

  var idx = colunaReserva_(submissoes);
  // -1 = não sabemos ler a coluna. Reconciliar às cegas libertaria reservas
  // reais e reabriria lugares. Preferimos recusar.
  if (idx < 0) return 0;
  if (!submissoesFiaveis_(submissoes, idx, marcaDe_(io))) return 0;

  var bruto = planoReconciliacao_(
    io.lerReservas(), contarSubmissoes_(submissoes, idx), io.agora(), JANELA_ORFAS_MS
  );

  var plano = [];
  for (var i = 0; i < bruto.length; i++) {
    if (bruto[i] !== excluirIndice) plano.push(bruto[i]);
  }
  if (!plano.length) return 0;

  io.expirar(plano);
  return plano.length;
}

// ===============================
// SEMEADURA A PARTIR DAS SUBMISSÕES
// ===============================
// Na instalação a aba Reservas nasce vazia, mas a Form responses já tem
// reservas futuras vendidas a hóspedes reais. Sem as trazer para o registo,
// a ocupação em vivo é zero e esses lugares são vendidos OUTRA VEZ —
// reproduzido: três submissões para um slot de três lugares e o reservar_
// ainda devolvia "novo" três vezes, seis pequenos-almoços para três lugares.
//
// A mesma causa morde do outro lado mais tarde: essas linhas de submissão
// contam para sempre em contarSubmissoes_, logo o excedente da
// reconciliação ficaria negativo naquele slot e mascararia órfãs reais para
// sempre. Uma linha semeada tem a sua própria submissão, logo o excedente
// dá 0 e as duas metades do problema desaparecem.

// Token determinístico derivado do índice da linha de origem. Tem de
// satisfazer o ^[A-Za-z0-9-]{8,64}$ do validarPedido_, daí o enchimento a
// zeros: "sub-1" tinha 5 caracteres e era rejeitado.
function tokenSemeado_(indice) {
  var s = String(indice);
  while (s.length < 6) s = "0" + s;
  return "sub-" + s;
}

// Procura um token em QUALQUER estado, ao contrário do linhaDoToken_ que só
// olha para as activas. Serve para não reutilizar o token de uma linha de
// origem já semeada, e para não ressuscitar uma linha semeada que o dono
// tenha cancelado à mão (mudar `estado` para `expirado`, como o guia
// autoriza) — uma segunda semeadura não pode desfazer um cancelamento.
function tokenExiste_(linhas, token) {
  for (var i = 1; i < (linhas || []).length; i++) {
    if (String(((linhas[i] || [])[COL_TOKEN])).trim() === token) return true;
  }
  return false;
}

// Que linhas acrescentar à aba Reservas. Só datas >= hoje: uma reserva
// passada já foi consumida e semeá-la só bloquearia um lugar que ninguém
// pode usar. Comparação de strings basta — em ISO a ordem lexicográfica é
// cronológica.
//
// A decisão de semear é por CONTAGENS, como a da reconciliação, e não por
// identidade da linha: para cada slot semeamos só o que FALTA ao registo
// para cobrir as submissões daquele slot. Bastar "este token ainda não
// existe" não chegava — depois de o sistema entrar em serviço, as reservas
// normais têm tokens reais (UUID do widget) e nenhum token sub-<indice>, e
// correr semear() outra vez criava uma segunda linha para cada uma delas.
// Reproduzido: duas submissões, uma semeada e uma reservada pelo widget, e
// a segunda semeadura levava a ocupação a 3.
//
// Assim, semear() é seguro a qualquer momento: nunca põe no registo mais
// linhas do que há submissões. Isso importa porque o formulário pode
// continuar a receber reservas entre a instalação do script e a passagem
// do widget para o novo endereço.
function planoSemeadura_(submissoes, reservas, hoje, agoraMs) {
  var out = [];
  if (!submissoes || !submissoes.length) return out;

  var idx = colunaReserva_(submissoes);
  // -1 = não sabemos ler a coluna. Semear às cegas não é possível, e semear
  // a menos é o lado seguro: o pior caso é a instalação não bloquear nada.
  if (idx < 0) return out;

  // Agrupa as submissões futuras por slot, guardando o índice da linha de
  // origem — é dele que sai o token.
  var porSlot = {};
  var ordem = [];
  for (var i = 1; i < submissoes.length; i++) {
    var v = normalizarReserva_((submissoes[i] || [])[idx]);
    if (!FORMATO_RESERVA_COMPLETO.test(v)) continue;

    var partes = v.split(" | ");
    if (partes[0] < hoje) continue;

    if (!porSlot[v]) {
      porSlot[v] = { data: partes[0], horario: partes[1], linhas: [] };
      ordem.push(v);
    }
    porSlot[v].linhas.push(i);
  }

  for (var k = 0; k < ordem.length; k++) {
    var slot = porSlot[ordem[k]];
    var falta = slot.linhas.length - activos_(reservas, slot.data, slot.horario);
    for (var n = 0; n < slot.linhas.length && falta > 0; n++) {
      var token = tokenSemeado_(slot.linhas[n]);
      if (tokenExiste_(reservas, token)) continue;
      out.push([token, slot.data, slot.horario, criadoIso_(agoraMs), ESTADO_ACTIVO]);
      falta--;
    }
  }
  return out;
}

// Núcleo da semeadura, com a E/S injetada para ser testável em Node.
function semear_(io) {
  var submissoes = io.lerSubmissoes();
  // Sem aba de submissões não há nada a semear e nada a marcar: a marca
  // fica por registar, o que é o regime estrito (ver marcaDe_).
  if (!submissoes || !submissoes.length) return { semeadas: 0, marca: 0 };

  var hoje = normalizarData_(new Date(io.agora()));
  var plano = planoSemeadura_(submissoes, io.lerReservas(), hoje, io.agora());
  for (var i = 0; i < plano.length; i++) io.acrescentar(plano[i]);

  // A marca de água: daqui para a frente, toda a linha nova tem de trazer
  // uma reserva legível, senão a reconciliação para (ver
  // submissoesFiaveis_).
  //
  // Correr semear() outra vez volta a marcar, e é esse o remédio para um
  // caso concreto: o espelho do JotForm esteve partido durante um tempo, já
  // foi corrigido, mas as linhas em branco daquele período ficam na folha
  // para sempre e travariam a reconciliação para sempre. Remarcar aceita-as
  // como históricas. Por isso mesmo, NÃO é rotina: remarcar com o espelho
  // AINDA partido desliga a única guarda que impede reservas reais de serem
  // libertadas e revendidas. O guia diz ao dono para só correr semear() a
  // pedido.
  if (io.gravarMarca) io.gravarMarca(submissoes.length);

  return { semeadas: plano.length, marca: submissoes.length };
}

// Corre a partir do editor. O preparar() já a chama; fica separadamente
// executável para o caso de a aba das submissões só aparecer depois.
function semear() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(ESPERA_LOCK_MANUTENCAO_MS)) return relatar_(AVISO_OCUPADO);
  try {
    return relatar_("Reservas semeadas a partir das submissões: " + semear_(ioReal_()).semeadas);
  } finally {
    lock.releaseLock();
  }
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
    if (reconciliar_(io, existente ? existente.indice : -1)) {
      linhas = io.lerReservas();
      livre = activos_(linhas, data, horario) < limite;
    }
  }

  if (!livre) return { ok: true, reservado: false, motivo: "cheio", restantes: 0 };

  if (existente) io.expirar([existente.indice]);
  io.acrescentar([pedido.token, data, horario, criadoIso_(io.agora()), ESTADO_ACTIVO]);

  return { ok: true, reservado: true, estado: existente ? "trocado" : "novo" };
}

// ===============================
// QUAL É A ABA DAS SUBMISSÕES
// ===============================
// Este ficheiro tem um princípio: procurar a COLUNA `Reserva` de forma
// tolerante, porque todos os bugs passados deste projeto foram um nome que
// não casava e falhou em silêncio. O nome da ABA era o único sítio onde
// esse princípio estava abandonado — uma constante exata.
//
// Se a aba não se chamar literalmente "Form responses" (nome traduzido,
// "Form Responses 1", renomeada pelo dono, recriada pela integração), o
// lerTudo_ devolvia null e ambos os chamadores leem isso como "não
// reconciliar". A reconciliação nunca mais correria durante toda a vida da
// implantação: as órfãs acumulavam-se como ocupação fantasma permanente e
// hóspedes que pagam veriam "Sem vagas" em slots vazios.
//
// `nomes` é a lista de nomes das abas e `ler` devolve as linhas de uma
// delas — injetados para isto ser testável sem Apps Script.
function escolherAbaSubmissoes_(nomes, ler) {
  var candidatos = [];
  for (var i = 0; i < (nomes || []).length; i++) {
    var n = String(nomes[i] == null ? "" : nomes[i]);
    // As nossas duas abas nunca são a das submissões, e a busca por
    // conteúdo não as pode escolher por acidente.
    if (n === ABA_RESERVAS || n === ABA_CAPACIDADES) continue;
    candidatos.push(n);
  }

  // 1. O nome exato, quando existe.
  for (var a = 0; a < candidatos.length; a++) {
    if (candidatos[a] === ABA_SUBMISSOES) return candidatos[a];
  }

  // 2. Um nome plausível.
  for (var b = 0; b < candidatos.length; b++) {
    if (NOME_SUBMISSOES.test(candidatos[b])) return candidatos[b];
  }

  // 3. Rede de segurança: a aba que tenha uma coluna com reservas legíveis.
  //    Cobre até uma aba com um nome que não diz nada.
  for (var c = 0; c < candidatos.length; c++) {
    if (colunaReserva_(ler(candidatos[c])) >= 0) return candidatos[c];
  }

  return null;
}

function nomeAbaSubmissoes_() {
  var abas = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var nomes = [];
  for (var i = 0; i < abas.length; i++) nomes.push(abas[i].getName());
  return escolherAbaSubmissoes_(nomes, function (nome) {
    return lerTudo_(nome) || [];
  });
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
    lerSubmissoes: function () {
      var nome = nomeAbaSubmissoes_();
      return nome ? lerTudo_(nome) : null;
    },
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
    marcaSubmissoes: function () {
      return PropertiesService.getScriptProperties().getProperty(CHAVE_MARCA);
    },
    gravarMarca: function (n) {
      PropertiesService.getScriptProperties().setProperty(CHAVE_MARCA, String(n));
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

  // Reconciliar custa uma aquisição de lock, um getValues() inteiro da
  // Form responses e uma regex por célula de todas as colunas. O
  // <input type="date"> dispara `change` por segmento, logo uma data
  // escrita à mão faz uns três GET, cada um a serializar atrás dos outros e
  // atrás de todos os outros hóspedes — e o custo cresce com a folha das
  // submissões para sempre.
  //
  // Por isso só reconciliamos quando algum slot desta data PARECE cheio,
  // que é exatamente o caso que este caminho existe para fechar: um slot
  // cujos lugares fossem TODOS órfãos apareceria como "Sem vagas", ninguém
  // chegaria a submeter contra ele, e a reconciliação do POST nunca
  // correria. A propriedade de fecho mantém-se intacta; o custo sai do
  // caminho normal.
  if (algumSlotCheio_(linhas, data, caps)) {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(ESPERA_LOCK_GET_MS)) {
      try {
        // Ninguém a pedir um lugar: não há linha a proteger.
        if (reconciliar_(io, -1)) linhas = io.lerReservas();
      } catch (err) {
        // Reconciliar é oportunista: falhar aqui não deve impedir o GET.
      } finally {
        lock.releaseLock();
      }
    }
  }

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
  } catch (err) {
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
// mensagem que o dono tem de CONFIRMAR na instalação (qual a aba das
// respostas foi encontrada, quantas reservas foram semeadas) não aparecia
// em sítio nenhum e a confirmação era impossível.
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

function preparar_() {
  var reservas = folha_(ABA_RESERVAS, true);
  if (reservas.getLastRow() < 1) reservas.appendRow(CABECALHO_RESERVAS);
  // Texto simples nas duas colunas que o Sheets teria coagido a datas —
  // é isto que tira o fuso da folha da equação (ver formatarTexto_).
  formatarTexto_(reservas, COL_DATA);
  formatarTexto_(reservas, COL_CRIADO);

  var caps = folha_(ABA_CAPACIDADES, true);
  if (caps.getLastRow() < 1) {
    caps.appendRow(CABECALHO_CAPACIDADES);
    caps.appendRow(["08:00-08:45", 3]);
    caps.appendRow(["08:45-09:30", 2]);
    caps.appendRow(["09:30-10:15", 3]);
    caps.appendRow(["10:15-11:00", 2]);
  }

  // Só depois de as abas existirem: as reservas futuras que já foram
  // vendidas têm de entrar no registo, senão os lugares delas aparecem
  // livres e são vendidos outra vez.
  var semeadas = semear_(ioReal_()).semeadas;

  // Devolvemos o nome da aba encontrada para o dono o CONFIRMAR na
  // instalação. Se sair "NENHUMA", a reconciliação nunca correria e mais
  // ninguém ficaria a saber.
  var aba = nomeAbaSubmissoes_();
  return "Abas prontas. Aba das respostas: " + (aba ? aba : "NENHUMA") +
    ". Reservas já existentes trazidas para o registo: " + semeadas;
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
    normalizarReserva_: normalizarReserva_,
    activos_: activos_,
    algumSlotCheio_: algumSlotCheio_,
    linhaDoToken_: linhaDoToken_,
    validarPedido_: validarPedido_,
    colunaReserva_: colunaReserva_,
    contarSubmissoes_: contarSubmissoes_,
    planoReconciliacao_: planoReconciliacao_,
    submissoesFiaveis_: submissoesFiaveis_,
    marcaDe_: marcaDe_,
    reconciliar_: reconciliar_,
    escolherAbaSubmissoes_: escolherAbaSubmissoes_,
    tokenSemeado_: tokenSemeado_,
    tokenExiste_: tokenExiste_,
    planoSemeadura_: planoSemeadura_,
    semear_: semear_,
    criadoIso_: criadoIso_,
    reservar_: reservar_,
    preparar: preparar,
    doGet: doGet,
    doPost: doPost,
    limparTestes: limparTestes,
    semear: semear,
    // ioReal_ é a E/S real (SpreadsheetApp), normalmente fora do alcance dos
    // testes de unidade. É exportada mesmo assim para pinar, com uma folha
    // e um SpreadsheetApp esboçados, a aritmética de índices e as chamadas
    // a flush() que só se veem aqui — ver os testes de "ioReal_".
    ioReal_: ioReal_
  };
}
