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

// A aba das respostas do JotForm. Ao contrário das outras duas, esta NÃO é
// nossa: é a integração do Google Sheets que a cria, ordena e enche. A única
// coisa que aqui se faz é preencher células VAZIAS de UMA coluna. Nunca
// inserir nem apagar linhas ou colunas, nunca escrever noutra coluna — o dono
// lê esta aba todos os dias e as respostas dos hóspedes não são nossas para
// mexer.
var ABA_RESPOSTAS = "Form responses";

// Colunas da aba Reservas. A ordem é estável: o `quarto`, o `nome` e a
// `submissao` foram ACRESCENTADOS ao fim, porque mudar a posição de uma coluna
// existente tornaria ilegíveis todas as linhas já guardadas — e uma linha
// ilegível é um lugar vendido que deixa de contar para a ocupação.
//
// A `submissao` é o `submissionID` que o webhook já trazia e que até aqui só
// vivia no anel anti-repetição das propriedades do script. Guardá-la na linha
// dá às duas tabelas a ÚNICA chave comum que alguma vez tiveram: sem ela não
// há como dizer que linha da aba das respostas corresponde a que reserva.
var COL_TOKEN = 0;
var COL_DATA = 1;
var COL_HORARIO = 2;
var COL_CRIADO = 3;
var COL_ESTADO = 4;
var COL_QUARTO = 5;
var COL_NOME = 6;
var COL_SUBMISSAO = 7;

var CABECALHO_RESERVAS = [
  "token", "data", "horario", "criado", "estado", "quarto", "nome", "submissao"
];
var CABECALHO_CAPACIDADES = ["horario", "vagas"];

var ESTADO_ACTIVO = "activo";
var ESTADO_CONFIRMADO = "confirmado";
var ESTADO_EXPIRADO = "expirado";

var FORMATO_HORARIO = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

// O valor que o widget grava, tal como aparece na submissão. Este padrão é
// SOLTO (casa no meio de um texto qualquer) e serve só para RECUSAR: um valor
// com cara de reserva nunca serve de nome nem de quarto (ver campoPorNome_).
// Para DECIDIR que lugar se confirma usa-se o ancorado abaixo.
var FORMATO_RESERVA = /(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{2}:\d{2}-\d{2}:\d{2})/;

// Este é o que decide, e é ANCORADO de propósito: o valor da chave tem de ser
// uma reserva e mais NADA. Um `\d{4}-\d{2}-\d{2} | HH:MM-HH:MM` escondido no
// meio de uma frase não nomeia lugar nenhum.
var FORMATO_RESERVA_ANCORADO = /^\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{2}:\d{2}-\d{2}:\d{2})\s*$/;

// Só para o último recurso: um corpo que não chega como objeto JSON. Com
// fronteiras em vez de âncoras, que é o mais perto de ancorado que um texto
// solto permite — a data não pode vir presa a outro dígito, nem o horário
// continuar noutro.
var FORMATO_RESERVA_TEXTO =
  /(?:^|[^\d])(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{2}:\d{2}-\d{2}:\d{2})(?![\d:])/g;

// As chaves do rawRequest que podem nomear um lugar. A primeira é a resposta
// do PRÓPRIO widget; a segunda é a tolerância de sempre neste projeto, para o
// dia em que a JotForm renomear o campo — e é a segunda escolha, nunca a
// primeira.
var CHAVE_RESERVA_WIDGET = /typeA137/i;
var CHAVE_RESERVA_TOLERANTE = /reserva/i;

// Chaves nas ScriptProperties. O segredo do webhook e o ID do formulário
// vivem AQUI e nunca no ficheiro: este código está num repositório público,
// e quem descobrisse o segredo podia forjar confirmações e tornar uma
// reserva falsa impossível de libertar.
var CHAVE_SEGREDO = "segredoWebhook";
var CHAVE_FORM_ID = "formIdEsperado";
var CHAVE_ULTIMO_WEBHOOK = "ultimoWebhook";
var CHAVE_SUBMISSOES = "submissoesConfirmadas";

// Quantos `submissionID` se guardam para reconhecer uma entrega repetida (ver
// confirmarWebhook_). Um anel curto nas propriedades do script chega e evita
// uma coluna nova na folha: o que interessa é apanhar a repetição de minutos
// ou horas depois, não a de um mês depois — a essa altura a linha já foi
// servida ao pequeno-almoço.
var MAX_SUBMISSOES_LEMBRADAS = 50;

// Uma órfã é uma linha `activo` com mais de 20 minutos: se a submissão se
// tivesse concluído, o webhook já teria chegado e a linha estaria
// `confirmado`.
var JANELA_ORFAS_MS = 20 * 60 * 1000;

// Quanto tempo o canal do webhook pode estar CALADO antes de deixarmos de
// confiar nele (ver webhookEmudeceu_). Seis janelas de órfãs: folgado o
// suficiente para uma manhã sem submissões nenhumas não desarmar a
// reconciliação, e curto o suficiente para uma integração apagada não passar
// um dia inteiro a revender lugares vendidos.
var LIMITE_WEBHOOK_MUDO_MS = 6 * JANELA_ORFAS_MS;

// ATENÇÃO: acoplado ao ORCAMENTO_RESERVA_MS do widget.js (5 s por
// tentativa). Tem de ficar CONFORTAVELMENTE DENTRO desse orçamento. Com os
// 20 s que aqui estavam, sob contenção o widget desistia e falhava fechado
// — o hóspede era informado de que a reserva falhou — e o servidor tomava
// o lugar logo depois: o lugar ficava como ocupação fantasma durante 20
// minutos. Não mexer num dos dois sem mexer no outro.
var ESPERA_LOCK_MS = 3500;

var ESPERA_LOCK_GET_MS = 5000;

// O webhook não tem hóspede à espera, e uma confirmação perdida é caríssima:
// a linha fica `activo`, parece órfã 20 minutos depois e o lugar é revendido.
// Por isso espera mais do que o caminho do hóspede — mas não tanto que a
// JotForm desista do pedido e a confirmação se perca de outra maneira.
var ESPERA_LOCK_WEBHOOK_MS = 10000;

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

// O token de uma linha, com UMA regra só. É por este valor que o io
// reconfirma a linha antes de lhe escrever (ver ioReal_.expirar e
// ioReal_.confirmar), e é por ele que o linhaDoToken_ a escolhe: se as duas
// normalizações divergissem, a reconfirmação falhava sempre e nada voltava a
// ser escrito — uma avaria silenciosa exactamente onde não se pode ter uma.
function normalizarToken_(v) {
  return String(v == null ? "" : v).trim();
}

function tokenDaLinha_(linha) {
  return normalizarToken_((linha || [])[COL_TOKEN]);
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
    if (tokenDaLinha_(l) !== token) continue;
    return {
      indice: i,
      data: normalizarData_(l[COL_DATA]),
      horario: String(l[COL_HORARIO]).trim()
    };
  }
  return null;
}

// A linha `activo` que o webhook confirma: a mais antiga DENTRO DA JANELA das
// órfãs e, se não houver nenhuma lá dentro, a mais antiga de todas.
//
// A janela não é zelo: uma linha `activo` abandonada só é libertada quando
// alguém bate num slot cheio, logo um horário com lugares de sobra acumula
// fantasmas indefinidamente. Sem a preferência, uma fantasma de três horas
// absorvia a confirmação da submissão que acabou de chegar — verificado — e a
// linha verdadeira, deixada `activo`, era expirada 21 minutos depois: o
// hóspede perdia o lugar que tinha pago e o nome dele ficava colado à
// fantasma. Pior, ao re-submeter já não havia linha viva do seu token, criava-
// -se uma segunda e um segundo webhook confirmava-a: dois lugares permanentes
// para um hóspede, que é o buraco que o linhaDoToken_ fechou.
//
// Quando o webhook de uma submissão verdadeira chega, a linha dela tem
// segundos — está sempre dentro da janela. Isto estreita também o C1.
//
// Sem timestamp legível, a linha continua candidata (como último recurso, pela
// ordem da folha) em vez de ser ignorada — ignorá-la faria o webhook não
// encontrar nada e não confirmar reserva nenhuma.
function maisAntigaActiva_(linhas, data, horario, agoraMs, janelaMs) {
  var naJanela = -1;
  var naJanelaCriado = Infinity;
  var qualquer = -1;
  var qualquerCriado = Infinity;

  for (var i = 1; i < (linhas || []).length; i++) {
    var l = linhas[i] || [];
    if (String(l[COL_ESTADO]).trim() !== ESTADO_ACTIVO) continue;
    if (normalizarData_(l[COL_DATA]) !== data) continue;
    if (String(l[COL_HORARIO]).trim() !== horario) continue;

    var criado = criadoMs_(l[COL_CRIADO]);
    var legivel = isFinite(criado);
    if (!legivel) criado = Infinity;

    if (qualquer < 0 || criado < qualquerCriado) {
      qualquer = i;
      qualquerCriado = criado;
    }
    // Uma linha sem timestamp legível não se sabe se está dentro da janela,
    // por isso não entra nesta preferência — fica no último recurso.
    if (legivel && agoraMs - criado <= janelaMs) {
      if (naJanela < 0 || criado < naJanelaCriado) {
        naJanela = i;
        naJanelaCriado = criado;
      }
    }
  }

  return naJanela >= 0 ? naJanela : qualquer;
}

// ===============================
// VALIDAÇÃO (função pura)
// ===============================
// Devolve os valores JÁ NORMALIZADOS (token, data, horario), e é com ESSES que
// o reservar_ conta e escreve.
//
// Devolvê-los não é comodidade: era a validação a testar `String(pedido.data)`
// e o reservar_ a usar `pedido.data` em bruto. Um `data` que chegasse como
// ARRAY (o Apps Script desdobra `data=x&data=y` num array, e um POST JSON pode
// trazer o que quiser) passava a validação — `String(["2026-09-08"])` dá
// "2026-09-08" — e depois comparava `!==` diferente de todas as strings
// guardadas: o ocupados_ contava ZERO, o slot parecia livre e a capacidade
// ficava sem efeito nenhum. Verificado num slot de um lugar já cheio: com a
// string recusava, com o array reservava. O `token` tinha o mesmo buraco, e
// com ele a idempotência: a linha do próprio hóspede não era encontrada e
// ficava com dois lugares.
function validarPedido_(pedido, caps, hoje) {
  var token = String((pedido && pedido.token) || "");
  var data = String((pedido && pedido.data) || "");
  var horario = String((pedido && pedido.horario) || "");

  if (!/^[A-Za-z0-9-]{8,64}$/.test(token)) return { ok: false, erro: "token_invalido" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, erro: "data_invalida" };
  // Comparação de strings basta: em ISO a ordem lexicográfica é cronológica.
  if (data < hoje) return { ok: false, erro: "data_passada" };
  if (capacidadeDe_(caps, horario) < 0) return { ok: false, erro: "horario_desconhecido" };
  return { ok: true, token: token, data: data, horario: horario };
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
// A RECONCILIAÇÃO nunca liberta uma linha `confirmado`: é uma reserva a
// valer, por muito antiga que seja. Não é o mesmo que dizer que uma linha
// `confirmado` nunca é libertada — o reservar_ expira-a quando o MESMO token
// troca de horário (só depois de garantir o novo lugar), e o dono pode
// escrever `expirado` à mão para cancelar. O que nunca acontece é uma linha
// confirmada ser libertada por decorrer o tempo.
//
// Cada entrada leva o `indice` E o `token` da linha, para o io poder
// RECONFIRMAR a linha antes de lhe escrever `expirado` — é o mesmo padrão do
// planoRespostas_, e está aqui pela mesma razão, com o dobro da consequência.
// O plano é calculado sobre uma leitura da folha e escrito DOIS pedidos ao
// Sheets depois; o lock do script não exclui o dono a mexer na aba à mão, e o
// guia mandava-o ordenar pela coluna `data` como gesto normal do dia a dia.
// Verificado: com o plano em índices nus, uma ordenação nessa janela marcava
// `expirado` numa reserva VIVA e o lugar dela era vendido outra vez — o dano
// exacto que este ficheiro inteiro existe para impedir.
function planoReconciliacao_(reservas, agoraMs, janelaMs) {
  var expirar = [];
  for (var i = 1; i < (reservas || []).length; i++) {
    var l = reservas[i] || [];
    if (String(l[COL_ESTADO]).trim() !== ESTADO_ACTIVO) continue;

    var criado = criadoMs_(l[COL_CRIADO]);
    // Sem timestamp legível não arriscamos: deixamos a linha em paz.
    if (!isFinite(criado)) continue;
    if (agoraMs - criado <= janelaMs) continue;

    expirar.push({ indice: i, token: tokenDaLinha_(l) });
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

// E continua a chegar? A guarda de cima olhava só para a marca ser não-vazia,
// uma vez, e nunca a comparava com nada. Bastava a instalação ter funcionado
// um dia: se depois disso a integração fosse apagada, desativada, ou o URL ou
// o segredo editados na JotForm, nada voltava a ser confirmado, mas a marca
// ficava lá e a reconciliação ficava ARMADA — e todas as reservas feitas a
// partir daí eram libertadas aos 20 minutos e os lugares revendidos, em
// silêncio, para o resto da vida da implantação. Era exactamente a falha que
// a guarda existia para impedir, coberta só na variante "nunca funcionou".
//
// Estar calado, por si, não é sintoma nenhum — de noite não há submissões. O
// sintoma é "as reservas chegam mas as confirmações não": marca velha E linhas
// `activo` criadas DEPOIS dela. Nesse caso não se liberta nada, e diz-se
// porquê no registo, como no caso do webhook que nunca chegou.
function webhookEmudeceu_(io, reservas, agoraMs) {
  if (!io.ultimoWebhook) return false;
  var marca = criadoMs_(io.ultimoWebhook());
  // Marca ilegível (uma propriedade editada à mão): não é a este guarda que
  // compete decidir. O primeiroWebhookChegou_ já a aceitou como prova.
  if (!isFinite(marca)) return false;
  if (agoraMs - marca <= LIMITE_WEBHOOK_MUDO_MS) return false;

  for (var i = 1; i < (reservas || []).length; i++) {
    var l = reservas[i] || [];
    if (String(l[COL_ESTADO]).trim() !== ESTADO_ACTIVO) continue;
    var criado = criadoMs_(l[COL_CRIADO]);
    if (!isFinite(criado)) continue;
    if (criado > marca) return true;
  }
  return false;
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

  var reservas = io.lerReservas();
  var agora = io.agora();

  if (webhookEmudeceu_(io, reservas, agora)) {
    console.log("Reconciliação não corre: o último webhook da JotForm tem " +
      "mais de " + Math.round(LIMITE_WEBHOOK_MUDO_MS / 60000) + " minutos e " +
      "há reservas feitas depois dele ainda por confirmar. As reservas estão a " +
      "chegar e as confirmações não — libertar lugares agora era revender " +
      "lugares vendidos. Confirme a integração e o segredo (ver preparar()).");
    return 0;
  }

  var bruto = planoReconciliacao_(reservas, agora, JANELA_ORFAS_MS);

  var plano = [];
  for (var i = 0; i < bruto.length; i++) {
    if (bruto[i].indice !== excluirIndice) plano.push(bruto[i]);
  }
  if (!plano.length) return 0;

  io.expirar(plano);
  // Quantas linhas se PLANEOU expirar, como no espelharRespostas_: o io ainda
  // pode saltar alguma na reconfirmação (e diz no registo que saltou), e a
  // passagem seguinte trata dela com índices frescos. O número serve aos
  // chamadores só para decidirem se vale a pena reler a folha, e reler a mais
  // não faz mal a ninguém.
  return plano.length;
}

// ===============================
// WEBHOOK DA JOTFORM (confirmação)
// ===============================
// A JotForm publica cada submissão concluída em POST <URL>?k=<segredo>, com
// Content-Type form-encoded, e traz `formID` e `rawRequest`.

// Achata um valor do rawRequest num texto. Um campo de nome do JotForm chega
// como objeto ({first, last}), e é daí que sai "Ana Silva".
function achatarValor_(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "object") return "";

  var partes = [];
  for (var k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    var s = achatarValor_(v[k]);
    if (s) partes.push(s);
  }
  return partes.join(" ").trim();
}

// As chaves do rawRequest que NÃO são respostas do hóspede: metadados que a
// JotForm mete no mesmo objeto. Sem esta lista, um `formName` casava
// /nome|name/i e o registo da cozinha ficava com o título do formulário no
// lugar do nome do hóspede.
var CHAVES_NAO_RESPOSTA =
  /^(slug|path|website|simple_spc|temp|event_?id|formID|formName|formTitle|timeToSubmit|validatedNewRequiredFieldIDs|submission_?id|type|q\d+_typeA\d+)$/i;

// O nome da pergunta dentro de uma chave `q<número>_<nome>`. As respostas do
// hóspede têm todas esta forma; os metadados não.
function nomeDaChave_(chave) {
  var m = String(chave).match(/^q\d+_(.+)$/);
  return m ? m[1] : "";
}

// Procura um campo do rawRequest pelo NOME, de forma tolerante — a mesma
// razão de sempre neste projeto: os nomes dos campos do JotForm mudam e um
// nome que não casa falha em silêncio. Um valor que seja a própria reserva
// nunca serve de quarto nem de nome.
//
// Em duas passagens: primeiro só as chaves com a forma de resposta
// (`q<número>_<nome>`), comparando o padrão contra o NOME e não contra a
// chave inteira; e só se nenhuma servir é que se aceita qualquer chave. Sem a
// preferência, um campo escondido como `q2_formName` podia ganhar ao nome do
// hóspede — a decisão ficava com a ordem das chaves, que é a JotForm que
// escolhe.
function campoPorNome_(campos, padrao) {
  return campoEm_(campos, padrao, true) || campoEm_(campos, padrao, false);
}

function campoEm_(campos, padrao, soRespostas) {
  for (var k in campos) {
    if (!Object.prototype.hasOwnProperty.call(campos, k)) continue;
    if (CHAVES_NAO_RESPOSTA.test(String(k))) continue;

    var nome = nomeDaChave_(k);
    if (soRespostas) {
      if (!nome) continue;
      if (CHAVES_NAO_RESPOSTA.test(nome)) continue;
      if (!padrao.test(nome)) continue;
    } else if (!padrao.test(String(k))) {
      continue;
    }

    var s = achatarValor_(campos[k]);
    if (!s) continue;
    if (FORMATO_RESERVA.test(s)) continue;
    return s;
  }
  return "";
}

// O campo do quarto NÃO tem "quarto" nem "room" no nome: no rawRequest deste
// formulário chega como `q6_typeA` (verificado no DOM do formulário
// publicado). Só com `/quarto|room/` a coluna `quarto` ficava vazia em todas
// as reservas, e o registo que a cozinha lê de manhã perdia metade da
// identidade.
//
// Um `/typea/i` à solta não serve: `typeA` é o nome genérico da JotForm para
// uma caixa de texto curta, e num formulário com várias apanhava a errada. O
// que identifica este campo é o ID DA PERGUNTA — e isso ATA esta constante a
// ESTE formulário. Se o formulário for reconstruído, o id muda, o `quarto`
// volta a ficar vazio (em silêncio) e é aqui que se corrige.
//
// O `^q6_` só casa na segunda passagem do campoEm_, contra a chave inteira:
// na primeira, que compara contra o nome da pergunta ("typeA"), não casa
// nada. Um campo mesmo chamado "quarto" continua a ganhar-lhe.
var NOME_CAMPO_QUARTO = /quarto|room|^q6_/i;
var NOME_CAMPO_NOME = /nome|name/i;

// As reservas DISTINTAS escritas nas chaves cujo nome casa `padraoChave`.
//
// Distintas, e todas: a decisão de que lugar se confirma não pode depender da
// ORDEM das chaves. A JotForm ordena o rawRequest pelo id da pergunta, logo
// qualquer campo escrito pelo hóspede aparece ANTES do campo do widget — e um
// `match` sobre o texto todo devolvia o primeiro, que era o do hóspede.
function reservasNasChaves_(campos, padraoChave) {
  var achadas = [];
  for (var k in campos) {
    if (!Object.prototype.hasOwnProperty.call(campos, k)) continue;
    if (!padraoChave.test(String(k))) continue;
    var m = achatarValor_(campos[k]).match(FORMATO_RESERVA_ANCORADO);
    if (!m) continue;
    var valor = m[1] + " | " + m[2];
    if (achadas.indexOf(valor) < 0) achadas.push(valor);
  }
  return achadas;
}

// As reservas distintas de um corpo que não é um objeto JSON. Último recurso.
// O `replace` em vez do `exec` é de propósito: um regex global guardado numa
// constante do módulo leva lastIndex consigo entre chamadas, e um erro a meio
// de um ciclo deixava-o apontado para o meio do texto seguinte.
function reservasNoTexto_(texto) {
  var achadas = [];
  String(texto).replace(FORMATO_RESERVA_TEXTO, function (todo, data, horario) {
    var valor = data + " | " + horario;
    if (achadas.indexOf(valor) < 0) achadas.push(valor);
    return todo;
  });
  return achadas;
}

// Uma reserva, ou nada. Duas reservas diferentes no mesmo sítio são uma
// AMBIGUIDADE e recusam-se: escolher uma delas seria deixar a ordem decidir
// que lugar se confirma, que é exatamente o buraco que isto fecha. Recusar
// custa uma confirmação perdida (a linha fica `activo` e o lugar volta ao
// mercado); escolher mal custa o lugar de outro hóspede, preso para sempre.
function escolherReserva_(candidatas, onde) {
  if (candidatas.length === 1) return candidatas[0];
  if (candidatas.length > 1) {
    console.log("Webhook ambíguo: encontrei " + candidatas.length +
      " reservas diferentes " + onde + " (" + candidatas.join(" / ") +
      "). Não confirmo nenhuma — a ordem dos campos não pode decidir que " +
      "lugar se confirma.");
  }
  return "";
}

// Lê do rawRequest a reserva e a identidade. Devolve null quando não há
// reserva legível — e nesse caso não se confirma nada: um POST sem reserva
// não diz que lugar confirmar.
//
// A reserva vem do VALOR de uma chave, nunca do texto todo. A versão anterior
// procurava o formato no rawRequest inteiro e ficava com a primeira ocorrência:
// bastava um hóspede escrever `2026-12-25 | 08:00-08:45` na caixa do quarto
// para o webhook — assinado pela JotForm, sem segredo nenhum pelo meio —
// confirmar a linha de OUTRO hóspede naquele horário. E como uma linha
// `confirmado` nunca é libertada pela reconciliação, repetir a manobra prendia
// o horário todo, para sempre; a linha do próprio atacante ficava `activo` e o
// lugar dele era revendido 20 minutos depois. Só a resposta do widget pode
// nomear um lugar.
function dadosDoWebhook_(bruto) {
  var texto = String(bruto == null ? "" : bruto);

  var campos = null;
  try {
    campos = JSON.parse(texto);
  } catch (err) {
    campos = null;
  }
  var temChaves = !!(campos && typeof campos === "object");

  var valor;
  if (temChaves) {
    valor = escolherReserva_(
      reservasNasChaves_(campos, CHAVE_RESERVA_WIDGET), "na resposta do widget");
    // A chave tolerante só entra quando a do widget não existe: um campo do
    // hóspede chamado "reserva" não pode passar à frente da resposta do widget.
    if (!valor) {
      valor = escolherReserva_(
        reservasNasChaves_(campos, CHAVE_RESERVA_TOLERANTE),
        "em chaves com 'reserva' no nome");
    }
  } else {
    valor = escolherReserva_(reservasNoTexto_(texto),
      "num corpo que não é um objeto JSON");
  }
  if (!valor) return null;

  var m = valor.match(FORMATO_RESERVA_ANCORADO);
  var out = { data: m[1], horario: m[2], quarto: "", nome: "" };
  if (temChaves) {
    out.quarto = campoPorNome_(campos, NOME_CAMPO_QUARTO);
    out.nome = campoPorNome_(campos, NOME_CAMPO_NOME);
  }
  return out;
}

// O anel dos `submissionID` já confirmados, guardado como texto simples nas
// propriedades do script (um id por linha).
function listaDeSubmissoes_(texto) {
  var bruto = String(texto == null ? "" : texto).split(/\s+/);
  var out = [];
  for (var i = 0; i < bruto.length; i++) {
    if (bruto[i]) out.push(bruto[i]);
  }
  return out;
}

// O id à cabeça, os mais recentes primeiro, cortado no limite.
function comSubmissao_(lista, id) {
  var out = [id];
  for (var i = 0; i < lista.length; i++) {
    if (out.length >= MAX_SUBMISSOES_LEMBRADAS) break;
    if (lista[i] !== id) out.push(lista[i]);
  }
  return out;
}

// O portão: as duas verificações que autenticam o pedido — o segredo e o
// formulário. Não tocam na folha, e é por isso que o doPost as corre ANTES de
// pegar no lock.
//
// A ordem é a da emenda: primeiro o segredo, depois o formulário, e só depois
// (já no confirmarWebhook_) a reserva. O que a ordem protege é o que tem de
// ser verdade antes de uma ESCRITA, e nada aqui escreve.
//
// Correr isto antes do lock não é micro-optimização: o endereço do web app é
// público por desenho, e enquanto o lock vinha primeiro bastava um POST com
// `rawRequest` e sem `k` para ficar dez segundos na fila do mutex. Alguns por
// segundo saturavam-no, as reservas verdadeiras (que esperam 3,5 s) recebiam
// lock_indisponivel, o widget falha fechado de propósito — e o formulário
// deixava de aceitar reservas.
function portaoWebhook_(params, io) {
  var p = params || {};

  var segredo = io.segredo ? io.segredo() : null;
  if (!segredo) {
    console.log("Webhook recusado: não há segredo definido nas propriedades " +
      "do script (" + CHAVE_SEGREDO + "). Sem segredo, qualquer pessoa que " +
      "descobrisse o endereço podia forjar confirmações.");
    return { ok: false, erro: "webhook_nao_configurado" };
  }
  if (String(p.k == null ? "" : p.k) !== String(segredo)) {
    console.log("Webhook recusado: segredo (k) errado ou ausente.");
    return { ok: false, erro: "segredo_invalido" };
  }

  var formEsperado = io.formIdEsperado ? io.formIdEsperado() : null;
  if (!formEsperado) {
    console.log("Webhook recusado: não há ID de formulário definido nas " +
      "propriedades do script (" + CHAVE_FORM_ID + ").");
    return { ok: false, erro: "webhook_nao_configurado" };
  }
  var formRecebido = String(p.formID == null ? "" : p.formID).trim();
  if (formRecebido !== String(formEsperado).trim()) {
    console.log("Webhook recusado: veio do formulário " + formRecebido +
      " e o esperado é outro.");
    return { ok: false, erro: "formulario_inesperado" };
  }

  return { ok: true };
}

// As três verificações, por esta ordem. Qualquer uma que falhe devolve
// ok:false e NÃO confirma nada — nem marca que chegou webhook nenhum, senão
// um POST anónimo qualquer armava a reconciliação.
//
// O portão volta a ser corrido aqui, mesmo quando o doPost já o correu: é a
// única forma de esta função ser segura por si, e é ela que os testes chamam
// directamente. Duas leituras de propriedades não custam nada.
//
// Se não houver linha `activo` para aquele par (o webhook chegou depois de a
// reconciliação já ter libertado a linha, ou a submissão não passou pelo
// widget), regista-se e não se cria nada: inventar uma reserva a partir de
// um webhook seria dar a um POST o poder de ocupar lugares.
function confirmarWebhook_(params, io) {
  var p = params || {};

  var portao = portaoWebhook_(p, io);
  if (!portao.ok) return portao;

  var dados = dadosDoWebhook_(p.rawRequest);
  if (!dados) {
    console.log("Webhook recusado: não encontrei no rawRequest nenhuma " +
      "reserva no formato AAAA-MM-DD | HH:MM-HH:MM.");
    return { ok: false, erro: "reserva_ilegivel" };
  }

  // Só aqui, com as três verificações passadas: é este o registo de que o
  // webhook FUNCIONA, e é ele que permite à reconciliação libertar órfãs
  // (ver primeiroWebhookChegou_). Guarda-se mesmo quando não há linha para
  // confirmar — o que se está a provar é que o canal está de pé, e uma
  // linha em falta não desmente isso.
  io.gravarUltimoWebhook(io.agora());

  // A MESMA submissão só confirma UMA linha. Uma confirmação é permanente e
  // não tem como se desfazer, e nada registava de que submissão tinha vindo:
  // uma entrega repetida — a JotForm a repetir um pedido que expirou no
  // transporte, coisa que uma espera de lock mais um arranque a frio tornam
  // plausível, ou o dono a reenviar à mão — encontrava a linha do hóspede já
  // `confirmado` e confirmava a SEGUINTE mais antiga: a linha de outro
  // hóspede, com o quarto e o nome do primeiro. Se essa outra tivesse sido
  // abandonada, o lugar ficava consumido por ninguém, para sempre.
  var submissao = String(p.submissionID == null ? "" : p.submissionID).trim();
  var vistas = io.submissoesVistas ? listaDeSubmissoes_(io.submissoesVistas()) : [];
  if (submissao && vistas.indexOf(submissao) >= 0) {
    console.log("Webhook repetido: a submissão " + submissao + " já confirmou " +
      "uma linha. Não confirmo outra — seria prender o lugar de outro hóspede.");
    return { ok: true, confirmado: false, motivo: "submissao_repetida" };
  }

  var reservas = io.lerReservas();
  var indice = maisAntigaActiva_(
    reservas, dados.data, dados.horario, io.agora(), JANELA_ORFAS_MS);
  if (indice < 0) {
    console.log("Webhook sem linha activa para " + dados.data + " | " +
      dados.horario + ": nada confirmado e nada criado. Ou a reconciliação " +
      "já libertou a linha, ou esta submissão não passou pelo widget.");
    return { ok: true, confirmado: false, motivo: "sem_reserva_activa" };
  }

  // A `submissao` vai para a linha, e não só para o anel das propriedades: é
  // ela que liga esta reserva à linha da aba das respostas (ver
  // planoRespostas_). Sem submissionID guarda-se vazio, e essa reserva
  // simplesmente nunca aparece ao lado do menu do hóspede — não se inventa
  // uma correspondência por data e horário, que casaria a reserva de um
  // hóspede com a submissão de outro no mesmo slot.
  //
  // Vai com o `token` da linha escolhida, para o io a RECONFIRMAR antes de
  // lhe escrever: entre esta leitura e a escrita há dois pedidos ao Sheets, e
  // o dono a ordenar a aba nessa janela punha o quarto e o nome deste hóspede
  // na linha de OUTRO — e a linha verdadeira, deixada `activo`, era expirada
  // 20 minutos depois. Verificado antes desta guarda existir.
  var alvo = { indice: indice, token: tokenDaLinha_(reservas[indice]) };
  if (!io.confirmar(alvo, dados.quarto, dados.nome, submissao)) {
    // Ao contrário do expirar — cujo salto se cura sozinho na passagem
    // seguinte —, uma confirmação saltada não se repete: o webhook desta
    // submissão já veio. Por isso NÃO se grava no anel das já vistas. Se a
    // JotForm reentregar, a próxima tentativa encontra a linha com números
    // frescos; gravá-la aqui era recusar essa reentrega como repetida e
    // perder a confirmação de vez — a linha ficava `activo` e o lugar era
    // revendido aos 20 minutos.
    console.log("Confirmação não escrita: a linha escolhida para " +
      dados.data + " | " + dados.horario + " já não é a que estava lá quando " +
      "a escolhemos (a aba \"" + ABA_RESERVAS + "\" foi ordenada ou teve " +
      "linhas apagadas entretanto). Não se escreve às cegas: confirmar a " +
      "linha errada dava o lugar deste hóspede a outro. Se a JotForm " +
      "reentregar o webhook, a reserva é confirmada nessa altura; se a linha " +
      "ficar `activo` durante horas, ponha-a a `confirmado` à mão.");
    return { ok: true, confirmado: false, motivo: "linha_mudou" };
  }
  // Só depois de haver mesmo uma linha confirmada: uma entrega que não
  // confirmou nada não gastou nada, e repeti-la não faz mal a ninguém.
  if (submissao && io.gravarSubmissoesVistas) {
    io.gravarSubmissoesVistas(comSubmissao_(vistas, submissao).join("\n"));
  }
  return { ok: true, confirmado: true };
}

// ===============================
// ESPELHO NA ABA DAS RESPOSTAS
// ===============================
// O dono quer ver a reserva ao lado das escolhas de menu do hóspede, e não só
// no registo da cozinha. A coluna `typeA137` da aba das respostas — a resposta
// do próprio widget — está vazia em TODAS as submissões, porque o JotForm
// nunca exporta a resposta de um widget. É esse o destino: uma coluna que
// existe, que ninguém preenche e que já tem o nome certo.
//
// As duas colunas são descobertas pelo CABEÇALHO, nunca pela posição. Uma
// coluna acertada por posição é a mesma armadilha do espelho morto: continua a
// escrever depois de a folha mudar, só que na célula errada — e aqui a célula
// errada é a resposta de um hóspede.
var CABECALHO_ID_RESPOSTAS = /submission\s*id/i;

// O destino procura-se em TRÊS passagens, e a ordem é que faz a segurança.
//
// A primeira é o cabeçalho legível: quando o campo do widget tem título no
// JotForm, a integração escreve `Reserva` em vez do nome interno. Vem à
// frente porque a integração NÃO renomeia a coluna antiga — deixa a
// `typeA137` para trás, com as reservas das submissões velhas, e sem esta
// ordem o dono mudava o nome do campo e a coluna que ele lê ficava na mesma.
//
// A segunda exige o nome do widget INTEIRO — `typeA137`, com ou sem o prefixo
// que a JotForm às vezes lhe põe (`q137_typeA137`). É a folha de hoje, antes
// de alguém mexer no JotForm.
//
// Só quando não existe nenhuma das duas é que se cai para o nome tolerante, e
// é por isso que as outras estão ANCORADAS. Com uma passagem só
// (/typeA137|reserva/i) ganhava o primeiro cabeçalho que CONTIVESSE
// "reserva": uma pergunta chamada "Reserva especial" à esquerda da coluna D
// passava a ser o destino — e a guarda "só células vazias" preenchia
// precisamente os hóspedes que tinham deixado essa pergunta em branco.
var CABECALHO_DESTINO_NOVO = /^reserva$/i;
var CABECALHO_DESTINO_EXACTO = /^(?:[a-z0-9]+_)?typeA137$/i;
var CABECALHO_DESTINO_TOLERANTE = /reserva/i;

// Quando não há coluna, devolve -1 e a funcionalidade fica DESLIGADA: não se
// escreve nada em sítio nenhum. Adivinhar a coluna seria escrever por cima de
// respostas de hóspedes.
function colunaPorCabecalho_(linhas, padrao) {
  var cabecalho = (linhas || [])[0] || [];
  for (var i = 0; i < cabecalho.length; i++) {
    var titulo = String(cabecalho[i] == null ? "" : cabecalho[i]).trim();
    if (titulo && padrao.test(titulo)) return i;
  }
  return -1;
}

function colunaSubmissao_(linhas) {
  return colunaPorCabecalho_(linhas, CABECALHO_ID_RESPOSTAS);
}

function colunaDestino_(linhas) {
  var padroes = [
    CABECALHO_DESTINO_NOVO,
    CABECALHO_DESTINO_EXACTO,
    CABECALHO_DESTINO_TOLERANTE
  ];
  for (var i = 0; i < padroes.length; i++) {
    var idx = colunaPorCabecalho_(linhas, padroes[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

// O título da coluna encontrada, para o preparar() o DIZER ao dono. Uma
// funcionalidade desligada em silêncio é o que aconteceu ao espelho: ninguém
// reparou durante meses porque nada o reportava. Aqui, ou o preparar() nomeia
// as duas colunas, ou diz EM FALTA.
function tituloDaColuna_(linhas, indice) {
  if (indice < 0) return "";
  return String(((linhas || [])[0] || [])[indice] || "").trim();
}

// Um `submissionID` como TEXTO, para as duas tabelas se compararem pela mesma
// régua.
//
// Um id tem 19 dígitos, o que passa a precisão de um double. Se uma célula
// vier como NÚMERO, o valor já foi arredondado DENTRO do Sheets antes de nós o
// vermos e não há como recuperar os dígitos perdidos. O que se pode é não
// perder mais nenhum: o String() de um double grande devolve a forma mais
// curta que volta ao mesmo número (6437228876324828909 sai
// "6437228876324829000", com o fim truncado a zeros), enquanto o toFixed(0)
// devolve o inteiro exacto do double, em decimal. (O toFixed(0) só passa a
// notação científica a partir de 1e21; com 19 dígitos isso está fora de
// alcance, mas não é a garantia universal que aqui já esteve escrita.)
//
// E o que isto NÃO garante, para ninguém contar com mais do que há: dois ids
// diferentes só ficam garantidamente distintos enquanto pelo menos um dos
// lados for TEXTO. Número contra número casa de propósito — é a mesma régua
// dos dois lados — mas são dois valores já arredondados: nesta ordem de
// grandeza o passo do double é 1024, e dois ids a menos de 1024 um do outro
// caem no mesmo número e casam um com o outro sem serem o mesmo id. Quem
// impede isso não é esta função, é a coluna `submissao` estar em texto simples
// (ver o preparar()) e a `Submission ID` da aba das respostas também.
//
// Um id numérico que por isso não case com um id em texto não escreve NADA, e
// essa é a direcção segura: escrever à mesma seria pôr a reserva de um hóspede
// na linha de outro.
function normalizarId_(v) {
  if (typeof v === "number") {
    if (!isFinite(v)) return "";
    return v.toFixed(0);
  }
  var t = String(v == null ? "" : v).trim();
  // Uma célula que o Sheets tenha formatado pode chegar em notação científica
  // ("6.4372288763248E+18"). Comparada assim não casaria com nada.
  if (/^\d+(?:\.\d+)?[eE]\+?\d+$/.test(t)) return Number(t).toFixed(0);
  return t;
}

// Há alguma reserva com submissão guardada? Serve para o espelho não ir ler a
// aba das respostas — nem escrever no registo — numa instalação onde ainda não
// há nada para espelhar.
function temSubmissaoGuardada_(reservas) {
  for (var i = 1; i < (reservas || []).length; i++) {
    if (normalizarId_((reservas[i] || [])[COL_SUBMISSAO])) return true;
  }
  return false;
}

// O que escrever, e onde. Função pura: recebe as duas folhas já lidas e os
// índices (0-based) das duas colunas, e devolve as células a preencher.
//
// Preenche-se SÓ o que está por preencher, e só onde o id casa EXACTAMENTE com
// o de uma linha do registo. São as duas condições juntas que tornam isto
// idempotente e seguro: correr mil vezes escreve uma só, e uma linha sem
// correspondência fica exactamente como estava. Nunca se inventa um valor a
// partir da data ou do horário — isso casaria a reserva de um hóspede com a
// submissão de outro no mesmo slot.
//
// A `linha` e a `coluna` saem daqui já em coordenadas 1-based da folha, que é
// o que o getRange quer. A aritmética 0-based→1-based fica TODA dentro desta
// função pura, coberta por testes, em vez de espalhada pelo io: um deslize de
// um escreve a reserva por cima da resposta de um hóspede.
//
// Cada entrada leva também a `colunaId` e o `id` que a escolheu, para o
// escreverRespostas poder RECONFIRMAR a linha antes de lhe tocar. Sem isso, a
// escrita confiava em números de linha lidos momentos antes: bastava o dono
// ordenar ou apagar uma linha nessa janela — e o guia ensinava ordenar como
// gesto normal do dia a dia, até isto o obrigar a trocar o conselho por
// filtrar — para a reserva de um hóspede ir parar à linha de outro.
function planoRespostas_(submissoes, reservas, idxId, idxDestino) {
  var plano = [];
  if (idxId < 0 || idxDestino < 0) return plano;

  var porId = {};
  for (var r = 1; r < (reservas || []).length; r++) {
    var linhaR = reservas[r] || [];
    var id = normalizarId_(linhaR[COL_SUBMISSAO]);
    if (!id) continue;

    // Uma reserva que já não ocupa lugar não se espelha. Pôr o `estado` a
    // `expirado` é o único gesto que o guia autoriza ao dono; sem esta guarda,
    // quem cancelava via a reserva aparecer na aba das respostas na mesma — e,
    // pior, ficava lá para sempre, porque a célula deixava de estar vazia.
    //
    // A régua é o ocupaLugar_, a MESMA que decide a ocupação, e não uma lista
    // de palavras proibidas. Enquanto isto comparava com `expirado` exacto,
    // medido: `Expirado` com maiúscula, um `cancelado` inventado pelo dono e
    // uma célula apagada libertavam todos o lugar e continuavam a ser
    // espelhados. Uma lista negra esquece sempre um caso; a régua da ocupação,
    // por construção, não pode divergir dela própria.
    if (!ocupaLugar_(linhaR[COL_ESTADO])) continue;

    // Um submissionID confirma no máximo UMA linha (ver o anel do
    // confirmarWebhook_), logo a primeira que se encontra é a única.
    if (Object.prototype.hasOwnProperty.call(porId, id)) continue;

    var valor = normalizarData_(linhaR[COL_DATA]) + " | " +
      String(linhaR[COL_HORARIO] == null ? "" : linhaR[COL_HORARIO]).trim();

    // E só se o valor tiver mesmo a forma de uma reserva. Se a coluna `data`
    // tiver sido coagida a célula de data, o normalizarData_ devolve o número
    // de série do Sheets e isto seria "46000 | 08:45-09:30" — escrito na aba
    // do dono, ao lado do menu do hóspede, onde nada o corrige depois: a
    // célula deixa de estar vazia e nunca mais é preenchida. Mais vale não
    // aparecer nada do que aparecer isso.
    if (!FORMATO_RESERVA_ANCORADO.test(valor)) continue;

    porId[id] = valor;
  }

  for (var i = 1; i < (submissoes || []).length; i++) {
    var l = submissoes[i] || [];
    // Só células VAZIAS. É esta guarda que impede o espelho de escrever por
    // cima de seja o que for — inclusive de uma correcção feita à mão.
    if (String(l[idxDestino] == null ? "" : l[idxDestino]).trim()) continue;

    var chave = normalizarId_(l[idxId]);
    if (!chave) continue;
    if (!Object.prototype.hasOwnProperty.call(porId, chave)) continue;

    plano.push({
      linha: i + 1,
      coluna: idxDestino + 1,
      colunaId: idxId + 1,
      id: chave,
      valor: porId[chave]
    });
  }
  return plano;
}

// Ponto de entrada único do espelho. Hoje só o doGet lhe chama — o caminho do
// webhook foi retirado de propósito (ver o doPost) — mas as guardas ficam
// todas aqui, pela mesma razão do reconciliar_: duas cópias acabam por
// divergir, e fechar um buraco numa delas deixa-o aberto na outra.
//
// Devolve quantas células PLANEOU escrever — o escreverRespostas ainda pode
// saltar alguma na reconfirmação, e a passagem seguinte do GET volta a tratar
// dela. As `reservas` são um parâmetro para o doGet não ler a aba duas vezes;
// sem elas, lê-as.
function espelharRespostas_(io, reservas) {
  if (!io.lerRespostas || !io.escreverRespostas) return 0;

  var linhas = reservas || io.lerReservas();
  if (!temSubmissaoGuardada_(linhas)) return 0;

  var submissoes = io.lerRespostas();
  if (!submissoes) {
    // A ABA não existe — coisa diferente de faltarem colunas nela. Antes, uma
    // aba renomeada dava exactamente a mesma queixa das colunas em falta, e
    // mandava o dono procurar cabeçalhos que estão lá, intactos.
    console.log("Espelho desligado: não há nenhuma aba chamada \"" +
      ABA_RESPOSTAS + "\" (a integração do JotForm ainda não a criou, ou a aba " +
      "mudou de nome). A reserva não aparece ao lado do menu; as reservas e os " +
      "lugares não são afectados.");
    return 0;
  }

  var idxId = colunaSubmissao_(submissoes);
  var idxDestino = colunaDestino_(submissoes);
  if (idxId < 0 || idxDestino < 0) {
    // Há reservas para espelhar e não há onde as pôr. Dizer porquê é o
    // essencial: o espelho anterior deste projeto esteve partido durante meses
    // exactamente porque falhava sem deixar rasto nenhum.
    console.log("Espelho desligado: na aba \"" + ABA_RESPOSTAS + "\" falta a " +
      "coluna do " + (idxId < 0 ? "id da submissão (cabeçalho tipo " +
      "\"Submission ID\")" : "destino (cabeçalho \"Reserva\", ou o nome " +
        "interno do campo do widget)") +
      ". A reserva não aparece ao lado do menu; as reservas e os lugares não " +
      "são afectados. Corra o preparar() para ver as duas colunas.");
    return 0;
  }

  var plano = planoRespostas_(submissoes, linhas, idxId, idxDestino);
  if (!plano.length) return 0;

  io.escreverRespostas(plano);
  return plano.length;
}

// ===============================
// ESPELHO AUTOMÁTICO (GATILHO DE TEMPO)
// ===============================
// O espelho acima corre no doGet, e só lá. Enquanto foi o único caminho, a
// reserva mais recente ficava sem aparecer ao lado do menu até alguém abrir o
// formulário e escolher uma data — para o dono, indistinguível de estar
// partido, porque funciona, mas mais tarde.
//
// Um gatilho de tempo é a ÚNICA maneira de o tornar automático, e não é uma
// escolha de gosto: uma reserva só se pode espelhar depois de a integração do
// Sheets ter escrito a linha da submissão na aba das respostas, e essa escrita
// é independente do webhook. Quando o webhook confirma, a linha ainda não está
// lá — mesmo fora do lock, espelhar no caminho do webhook seria quase sempre
// planear zero células. O que falta é uma passagem MAIS TARDE, e é isto.
//
// O preço, para ficar dito: este gatilho pede um âmbito novo
// (`script.scriptapp`), o que obriga o dono a autorizar o script outra vez.
var FUNCAO_GATILHO_ESPELHO = "espelhoAgendado";
var MINUTOS_GATILHO_ESPELHO = 15;

// Os gatilhos DESTE projeto que são nossos, reconhecidos pelo nome da função.
// Separado do ScriptApp para ser testável, e a separação não é cosmética: é o
// filtro que impede o instalar de apagar um gatilho de outra função que o dono
// tenha posto no mesmo projeto.
function gatilhosDoEspelho_(gatilhos) {
  var meus = [];
  for (var i = 0; i < (gatilhos || []).length; i++) {
    if (gatilhos[i].getHandlerFunction() === FUNCAO_GATILHO_ESPELHO) meus.push(gatilhos[i]);
  }
  return meus;
}

// O que o gatilho corre. NÃO pega no lock, pela mesma razão do doGet: a
// escrita é sempre o mesmo valor na mesma célula, numa coluna que mais ninguém
// escreve, e o escreverRespostas reconfirma a linha antes de lhe tocar. Pegar
// no lock de 15 em 15 minutos era roubá-lo ao caminho da reserva, que só o
// espera 3,5 s e falha FECHADO quando não o consegue.
function espelhoAgendado() {
  try {
    var celulas = espelharRespostas_(ioReal_());
    // Só quando escreveu. São 96 execuções por dia: uma linha por cada era
    // afogar o registo de execução, que é onde o dono procura os problemas a
    // sério.
    if (celulas) {
      console.log("Espelho automático: " + celulas + " célula(s) planeada(s) na aba \"" +
        ABA_RESPOSTAS + "\".");
    }
  } catch (err) {
    // Uma excepção não apanhada num gatilho faz o Apps Script mandar um email
    // ao dono a cada falha. De 15 em 15 minutos isso é uma caixa de correio
    // inutilizável — e isto não é urgente: as reservas e os lugares não
    // dependem do espelho, e a passagem seguinte volta a tentar.
    console.log("Espelho automático falhou (volta a tentar dentro de " +
      MINUTOS_GATILHO_ESPELHO + " min; as reservas e os lugares não são " +
      "afectados): " + err);
  }
}

function apagarGatilhosEspelho_() {
  var meus = gatilhosDoEspelho_(ScriptApp.getProjectTriggers());
  for (var i = 0; i < meus.length; i++) ScriptApp.deleteTrigger(meus[i]);
  return meus.length;
}

// Corre UMA vez a partir do editor, como o preparar(). Apaga os anteriores
// ANTES de criar o novo: correr isto outra vez é o gesto natural de quem não
// se lembra se já o correu, e sem o apagar cada corrida duplicava as
// execuções para sempre.
function instalarGatilhoEspelho() {
  var apagados = apagarGatilhosEspelho_();
  ScriptApp.newTrigger(FUNCAO_GATILHO_ESPELHO)
    .timeBased()
    .everyMinutes(MINUTOS_GATILHO_ESPELHO)
    .create();
  return relatar_("Espelho automático ligado: corre a cada " +
    MINUTOS_GATILHO_ESPELHO + " minutos." +
    (apagados ? " Apagado(s) " + apagados + " gatilho(s) anterior(es) desta função." : ""));
}

function removerGatilhoEspelho() {
  var apagados = apagarGatilhosEspelho_();
  return relatar_(apagados
    ? "Espelho automático desligado: apagado(s) " + apagados + " gatilho(s). A reserva " +
      "volta a aparecer na aba \"" + ABA_RESPOSTAS + "\" só quando alguém abrir o formulário."
    : "Não havia nenhum gatilho do espelho para apagar.");
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

  // Daqui para baixo NADA vem do `pedido` em bruto: só os valores
  // normalizados pelo validarPedido_. Ver o comentário dele.
  var token = v.token;
  var data = v.data;
  var horario = v.horario;
  var limite = capacidadeDe_(caps, horario);

  var linhas = io.lerReservas();
  var existente = linhaDoToken_(linhas, token);

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

  // Com o token, para o io reconfirmar a linha antes de a marcar `expirado`:
  // é o MESMO token por que o linhaDoToken_ a escolheu, e aqui já está
  // normalizado pelo validarPedido_.
  if (existente) io.expirar([{ indice: existente.indice, token: token }]);
  // Oito valores, tantos quantas as colunas do CABECALHO_RESERVAS: o quarto, o
  // nome e a submissão só se sabem na confirmação. Escrever menos valores do
  // que colunas deixaria a coluna nova sem célula nenhuma, e um getValues()
  // de uma linha mais curta devolve `undefined` onde o código espera "".
  io.acrescentar([
    token, data, horario, criadoIso_(io.agora()), ESTADO_ACTIVO, "", "", ""
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

// A linha `linha` (1-based, da folha) ainda é a que tem este token?
//
// É a reconfirmação que o espelho já fazia na aba das respostas, trazida para
// a aba `Reservas`, onde custa mais caro. Tanto o plano da reconciliação como
// a linha que o webhook confirma são números de linha lidos DOIS pedidos ao
// Sheets antes da escrita, e o lock do script não exclui uma pessoa a editar
// a folha à mão. Se o dono ordenar ou apagar linhas nessa janela, a
// coordenada passa a apontar para a reserva de OUTRO hóspede: o `expirado`
// caía numa reserva viva (e o lugar era vendido outra vez) e a confirmação
// caía na linha errada. Reler o token e comparar é o que impede as duas
// coisas; se não casar, salta-se.
//
// A comparação usa o normalizarToken_, a mesma regra por que a linha foi
// escolhida (ver tokenDaLinha_) — se divergissem, isto recusava sempre e nada
// era escrito.
function linhaAindaEDoToken_(aba, linha, token) {
  return normalizarToken_(aba.getRange(linha, COL_TOKEN + 1).getValue()) === token;
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
    // A aba das respostas pode não existir (uma folha nova, a integração do
    // JotForm ainda por ligar, ou a aba renomeada). Aí devolve NULL, e não
    // []: são coisas diferentes e o dono precisa de as distinguir. Um []
    // quer dizer "a aba está lá e não tem cabeçalho"; um null quer dizer "não
    // há aba nenhuma com este nome" — e mandá-lo procurar colunas quando o
    // que falta é a aba é fazê-lo perder a tarde no sítio errado.
    lerRespostas: function () { return lerTudo_(ABA_RESPOSTAS); },
    escreverRespostas: function (plano) {
      // `false`: se a aba não existir, NÃO se cria. Uma aba nossa com este
      // nome faria a integração do JotForm criar outra ao lado, e o dono
      // ficava com duas abas de respostas e nenhuma completa.
      var aba = folha_(ABA_RESPOSTAS, false);
      if (!aba) return;
      var escritas = 0;
      var saltadasId = 0;
      var saltadasDestino = 0;
      for (var i = 0; i < plano.length; i++) {
        var p = plano[i];
        // RECONFIRMAR a linha antes de lhe tocar. O plano traz números de
        // linha lidos momentos antes, e isto corre sem lock de propósito (ver
        // o doGet). A integração do JotForm só acrescenta linhas ao fim, mas o
        // dono não: se ele ordenar ou apagar uma linha nesta janela, a
        // coordenada passa a apontar para a resposta de OUTRO hóspede. Reler o
        // id e comparar é o que impede a reserva de um ir para a linha do
        // outro; se não casar, salta-se e a passagem seguinte do GET trata
        // dela com números de linha frescos.
        if (normalizarId_(aba.getRange(p.linha, p.colunaId).getValue()) !== p.id) {
          saltadasId++;
          continue;
        }

        // E reler o destino, pela mesma razão: entre o plano e a escrita
        // alguém pode ter escrito ali à mão, e uma correcção do dono nunca
        // pode ser apagada por nós.
        var destino = aba.getRange(p.linha, p.coluna);
        var jaLa = destino.getValue();
        if (String(jaLa == null ? "" : jaLa).trim()) {
          saltadasDestino++;
          continue;
        }

        // Célula a célula, com as coordenadas que o planoRespostas_ já
        // calculou. Nunca insertRow, deleteRow, insertColumn nem um setValues
        // sobre um intervalo: esta aba é da integração do JotForm e a única
        // coisa que aqui fazemos é preencher células vazias de uma coluna.
        destino.setValue(p.valor);
        escritas++;
      }
      // As duas reconfirmações acima faziam `continue` sem dizer nada. Neste
      // projeto um caminho que não escreve e não se queixa é a assinatura da
      // avaria que custou um dia — o espelho do JotForm esteve meses partido
      // exactamente assim, e quem fosse investigar "por que é que esta linha
      // nunca recebe a reserva?" não tinha onde olhar. Só quando houver
      // saltos: o GET corre a cada data que um hóspede escolhe, e um registo
      // cheio de linhas normais esconde a única que interessa.
      if (saltadasId || saltadasDestino) {
        console.log("Espelho: " + (saltadasId + saltadasDestino) + " de " +
          plano.length + " célula(s) não foram escritas nesta passagem — " +
          saltadasId + " porque a linha já não é a que o plano escolheu (a " +
          "aba \"" + ABA_RESPOSTAS + "\" foi ordenada ou teve linhas apagadas " +
          "entre a leitura e a escrita; a passagem seguinte do GET trata delas " +
          "com números de linha frescos) e " + saltadasDestino + " porque a " +
          "célula de destino deixou de estar vazia (uma correcção à mão nunca " +
          "é apagada por nós). Escritas: " + escritas + ".");
      }
      if (escritas) SpreadsheetApp.flush();
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
    // O `plano` são entradas {indice, token}, e não índices nus. O token é o
    // que torna esta escrita segura: ver expirar_/confirmar_ abaixo.
    expirar: function (plano) {
      var aba = folha_(ABA_RESERVAS, true);
      var escritas = 0;
      var saltadas = 0;
      for (var i = 0; i < plano.length; i++) {
        // +1 porque as linhas da folha são 1-based e o índice inclui o cabeçalho.
        if (!linhaAindaEDoToken_(aba, plano[i].indice + 1, plano[i].token)) {
          saltadas++;
          continue;
        }
        aba.getRange(plano[i].indice + 1, COL_ESTADO + 1).setValue(ESTADO_EXPIRADO);
        escritas++;
      }
      if (saltadas) {
        // NUNCA em silêncio: neste projeto um caminho que não escreve e não se
        // queixa é a assinatura da avaria que custou um dia. E nunca com o
        // token no registo — quem o soubesse podia mover a reserva daquele
        // hóspede pelo endereço público do doPost.
        console.log("Reconciliação: " + saltadas + " linha(s) não foram " +
          "libertadas porque já não são as que o plano escolheu — a aba \"" +
          ABA_RESERVAS + "\" foi ordenada ou teve linhas apagadas entre a " +
          "leitura e a escrita. Escrever às cegas marcava `expirado` numa " +
          "reserva viva e o lugar dela era vendido outra vez. A passagem " +
          "seguinte trata delas com números de linha frescos.");
      }
      if (escritas) SpreadsheetApp.flush();
    },
    // Devolve `true` se escreveu mesmo. Ao contrário do expirar, aqui a
    // resposta importa ao chamador: uma confirmação saltada não se cura na
    // passagem seguinte, e o confirmarWebhook_ precisa de saber para não
    // gravar esta submissão no anel das já vistas (ver lá).
    confirmar: function (alvo, quarto, nome, submissao) {
      var aba = folha_(ABA_RESERVAS, true);
      var linha = alvo.indice + 1;
      // A MESMA reconfirmação do expirar, e pela mesma razão: entre a escolha
      // da linha (no confirmarWebhook_) e esta escrita há dois pedidos ao
      // Sheets, e o lock do script não exclui o dono a mexer na aba à mão.
      if (!linhaAindaEDoToken_(aba, linha, alvo.token)) return false;

      // O ESTADO primeiro, o quarto, o nome e a submissão depois. É o estado
      // que protege o lugar de ser libertado pela reconciliação: se a escrita
      // falhar a meio, mais vale um lugar protegido sem nome do que um nome
      // guardado numa linha que a reconciliação ainda vai revender.
      aba.getRange(linha, COL_ESTADO + 1).setValue(ESTADO_CONFIRMADO);
      aba.getRange(linha, COL_QUARTO + 1).setValue(quarto);
      aba.getRange(linha, COL_NOME + 1).setValue(nome);
      aba.getRange(linha, COL_SUBMISSAO + 1).setValue(submissao == null ? "" : submissao);
      SpreadsheetApp.flush();
      return true;
    },
    segredo: function () { return propriedade_(CHAVE_SEGREDO); },
    formIdEsperado: function () { return propriedade_(CHAVE_FORM_ID); },
    ultimoWebhook: function () { return propriedade_(CHAVE_ULTIMO_WEBHOOK); },
    gravarUltimoWebhook: function (ms) {
      PropertiesService.getScriptProperties()
        .setProperty(CHAVE_ULTIMO_WEBHOOK, criadoIso_(ms));
    },
    submissoesVistas: function () { return propriedade_(CHAVE_SUBMISSOES); },
    gravarSubmissoesVistas: function (texto) {
      PropertiesService.getScriptProperties().setProperty(CHAVE_SUBMISSOES, texto);
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

  // O espelho na aba das respostas, em regime best-effort. Corre em TODOS os
  // GET e NÃO só quando algum slot parece cheio: uma reserva só se pode
  // espelhar depois de a linha da submissão existir na aba das respostas, e
  // essa linha é escrita pela integração do Sheets, que é independente do
  // webhook. Preso ao caminho do slot cheio, a esmagadora maioria das reservas
  // nunca chegava a aparecer ao lado do menu — que é a razão de existir disto.
  //
  // E não é de graça, para ninguém se enganar a contar: a partir da primeira
  // reserva com submissão guardada — ou seja, para sempre — cada GET faz mais
  // um getValues() INTEIRO da aba das respostas (23 colunas × todas as linhas,
  // que só crescem), e o <input type="date"> dispara uns três GET por data
  // escrita à mão. É latência no caminho do hóspede. O que a torna suportável
  // é o temSubmissaoGuardada_ (numa instalação sem reservas não custa nada) e
  // é ela o primeiro sítio a olhar se um dia o GET ficar lento.
  //
  // NÃO pega no lock: a escrita é sempre o mesmo valor na mesma célula, numa
  // coluna que mais ninguém escreve, logo dois GET em simultâneo não se
  // estorvam — e o escreverRespostas reconfirma a linha antes de lhe tocar.
  // Pegar no lock a cada GET era roubá-lo ao caminho da reserva, que só o
  // espera 3,5 s e falha fechado quando não o consegue.
  try {
    espelharRespostas_(io, linhas);
  } catch (errEspelho) {
    // Como na reconciliação: falhar aqui não pode impedir o GET, mas engolir
    // o erro escondia um espelho que nunca funciona atrás de um GET perfeito.
    console.log("Espelho na aba das respostas falhou (o GET segue): " + errEspelho);
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
// POST: reservar um lugar, ou confirmar pelo webhook
// ===============================
// Os dois tipos de pedido distinguem-se pelo CORPO: o do widget é JSON
// (text/plain) com `acao`; o da JotForm é form-encoded e traz `formID` e
// `rawRequest`, que o Apps Script desdobra em e.parameter.
function doPost(e) {
  var params = (e && e.parameter) || {};

  if (params.formID !== undefined || params.rawRequest !== undefined) {
    var ioWebhook = ioReal_();

    // AUTENTICAR PRIMEIRO, pegar no lock depois. O endereço é público por
    // desenho: enquanto o lock vinha primeiro, um POST com `rawRequest` e sem
    // `k` ficava dez segundos na fila do mutex, e alguns por segundo bastavam
    // para as reservas verdadeiras (3,5 s de espera) receberem
    // lock_indisponivel e o formulário deixar de aceitar reservas.
    // A RESPOSTA AO WEBHOOK NÃO DIZ O QUE FALHOU — é sempre o mesmo {ok:false},
    // como a emenda especifica. Distinguir `segredo_invalido` de
    // `formulario_inesperado` dizia a quem estivesse a adivinhar o segredo o
    // instante exacto em que acertou, e nada aqui o limita em tentativas; o
    // `webhook_nao_configurado` anunciava até que não há segredo definido. O
    // detalhe fica no console.log, onde o dono o lê e um estranho não.
    //
    // Os códigos do ramo do widget ficam como estão: o widget precisa deles
    // para dizer ao hóspede o que aconteceu.
    var portao = portaoWebhook_(params, ioWebhook);
    if (!portao.ok) return resposta_({ ok: false });

    var lockWebhook = LockService.getScriptLock();
    // A confirmação corre no MESMO mutex da reserva: lê a folha, escolhe uma
    // linha e escreve-a. Sem o lock, escolhia uma linha que um doPost a
    // decorrer já tinha expirado.
    if (!lockWebhook.tryLock(ESPERA_LOCK_WEBHOOK_MS)) {
      console.log("Webhook não conseguiu o lock: nada confirmado.");
      return resposta_({ ok: false });
    }
    try {
      var r = confirmarWebhook_(params, ioWebhook);
      // AQUI NÃO SE ESPELHA, e não se volte a acrescentar. O espelho já
      // esteve neste sítio: relia a aba `Reservas` inteira (a segunda vez, que
      // o confirmarWebhook_ já a tinha lido), lia a `Form responses` inteira,
      // escrevia e dava flush — tudo DENTRO deste lock de 10 s, e quase sempre
      // para um plano VAZIO, porque a linha desta submissão ainda nem existe:
      // o webhook e a integração do Sheets são independentes e não têm ordem
      // garantida entre si. Só alongava a secção crítica por que as reservas
      // dos hóspedes esperam 3,5 s — e falham FECHADAS quando não a conseguem.
      //
      // A passagem do GET apanha tudo, e é esse o desenho: o doGet corre
      // sempre que um hóspede abre uma data, com números de linha frescos.
      return resposta_(r.ok ? r : { ok: false });
    } catch (err) {
      console.log("Webhook falhou: " + err);
      return resposta_({ ok: false });
    } finally {
      lockWebhook.releaseLock();
    }
  }

  // Um webhook que chegue de outra maneira (multipart, p.ex., que o Apps
  // Script não desdobra em e.parameter) cai aqui e não confirma nada. E sem
  // confirmações a reconciliação fica desarmada para sempre, sem nada onde
  // olhar. Por isso deixamos rasto em vez de recusar em silêncio.
  var conteudo = String((e && e.postData && e.postData.contents) || "");
  if (conteudo.indexOf("rawRequest") >= 0 || conteudo.indexOf("formID") >= 0) {
    console.log("Este POST parece um webhook da JotForm, mas não trouxe " +
      "formID nem rawRequest em e.parameter (tipo: " +
      ((e && e.postData && e.postData.type) || "desconhecido") +
      "). Nada foi confirmado.");
  }

  var pedido;
  try {
    pedido = JSON.parse(conteudo || "{}");
  } catch (err2) {
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
  } catch (err3) {
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
//
// A guarda é sobre o CONTEÚDO da linha 1, não sobre o número de colunas. A
// versão anterior saía cedo quando getLastColumn() >= 7, e numa aba antiga
// bastava a primeira reserva (que já é escrita com sete valores) para o
// getLastColumn passar a 7: os títulos `quarto` e `nome` nunca chegavam a ser
// escritos, que é precisamente o caso para que isto existe.
function cabecalhoCerto_(linha) {
  for (var i = 0; i < CABECALHO_RESERVAS.length; i++) {
    var celula = String((linha || [])[i] == null ? "" : (linha || [])[i]).trim();
    if (celula !== CABECALHO_RESERVAS[i]) return false;
  }
  return true;
}

function garantirCabecalho_(aba) {
  var colunas = Math.max(aba.getLastColumn(), CABECALHO_RESERVAS.length);
  var linha1 = aba.getRange(1, 1, 1, colunas).getValues()[0];
  if (cabecalhoCerto_(linha1)) return;
  aba.getRange(1, 1, 1, CABECALHO_RESERVAS.length).setValues([CABECALHO_RESERVAS]);
}

function preparar_() {
  var reservas = folha_(ABA_RESERVAS, true);
  if (reservas.getLastRow() < 1) reservas.appendRow(CABECALHO_RESERVAS);
  garantirCabecalho_(reservas);

  // Texto simples nas duas colunas de DATA (ver formatarTexto_), e SÓ
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
  }

  // O `quarto`, o `nome` e a `submissao` ficam FORA dessa guarda, e é de
  // propósito. O risco acima é o de reformatar uma coluna cujas células JÁ
  // foram coagidas; estas três são colunas NOVAS, vazias em todas as linhas
  // anteriores, e o setNumberFormat("@") não altera valor nenhum — não há
  // aqui nada que possa ser desfeito.
  //
  // Presas à guarda, ficavam em "Automático" em todas as folhas que já tinham
  // linhas — que é o caso da folha do dono, com as reservas de teste. E aí:
  //
  // - a `submissao` recebia no primeiro `confirmar` um `submissionID` de 19
  //   dígitos, o que passa a precisão de um double: o Sheets guardava
  //   6437228876324829184 no lugar de 6437228876324828909. A chave deixava de
  //   casar com o texto da aba das respostas, o plano do espelho saía sempre
  //   vazio, e a funcionalidade morria em SILÊNCIO — com o preparar() a dizer
  //   que estava tudo bem;
  // - o `quarto` "007" era guardado como o número 7 (medido), e um `nome`
  //   começado por "=" ou por "+" é lido pelo Sheets como fórmula e a célula
  //   devolve um erro em vez do nome. Nada no programa lê estas duas colunas,
  //   por isso nenhum lugar está em risco — mas é o dono que as lê todas as
  //   manhãs para saber quem se senta à mesa.
  //
  // Ver os testes "numa aba Reservas que já tem linhas, o submissionID
  // sobrevive ao preparar()" e "... o quarto \"007\" sobrevive ao preparar()".
  formatarTexto_(reservas, COL_QUARTO);
  formatarTexto_(reservas, COL_NOME);
  formatarTexto_(reservas, COL_SUBMISSAO);

  var caps = folha_(ABA_CAPACIDADES, true);
  if (caps.getLastRow() < 1) {
    caps.appendRow(CABECALHO_CAPACIDADES);
    caps.appendRow(["08:00-08:45", 3]);
    caps.appendRow(["08:45-09:30", 2]);
    caps.appendRow(["09:30-10:15", 3]);
    caps.appendRow(["10:15-11:00", 2]);
  }

  // O estado da configuração do webhook, para o dono CONFIRMAR na
  // instalação. O segredo é reportado como "definido" e NUNCA impresso: este
  // registo de execução é copiável e vai aparecer em capturas de ecrã.
  var io = ioReal_();
  var ultimo = io.ultimoWebhook();

  // E o estado do espelho na aba das respostas, na MESMA mensagem. Sem isto,
  // uma coluna renomeada desligava a funcionalidade em silêncio e o dono
  // ficava à espera de valores que nunca apareciam — foi assim que o espelho
  // do JotForm passou meses partido sem ninguém dar por isso.
  var respostas = io.lerRespostas();
  var espelho;
  if (!respostas) {
    // A ABA não existe. Dizê-lo por palavras é o ponto: enquanto isto
    // reportava as colunas, uma aba renomeada saía como "Coluna do ID: EM
    // FALTA. Coluna da reserva: EM FALTA" e mandava o dono procurar
    // cabeçalhos que estão lá, intactos, na aba com o outro nome.
    espelho = ". Aba \"" + ABA_RESPOSTAS + "\": EM FALTA (a integração do " +
      "JotForm ainda não a criou, ou a aba mudou de nome; enquanto faltar, a " +
      "reserva não aparece ao lado do menu — as reservas e os lugares não são " +
      "afectados)";
  } else {
    var idId = colunaSubmissao_(respostas);
    var idDestino = colunaDestino_(respostas);
    espelho = ". Coluna do ID: " +
      (idId < 0 ? "EM FALTA" : "\"" + tituloDaColuna_(respostas, idId) + "\"") +
      ". Coluna da reserva: " +
      (idDestino < 0 ? "EM FALTA" : "\"" + tituloDaColuna_(respostas, idDestino) + "\"") +
      (idId < 0 || idDestino < 0
        ? " (enquanto houver EM FALTA, a reserva não aparece na aba \"" +
          ABA_RESPOSTAS + "\"; as reservas e os lugares não são afectados)"
        : "");
  }

  // E se o espelho corre SOZINHO. Sem gatilho, a reserva só aparece quando
  // alguém abre o formulário — que funciona, mais tarde, e é por isso que
  // precisa de ser dito: é o estado mais fácil de confundir com "está bom".
  var gatilho = ". Espelho automático: " +
    (gatilhosDoEspelho_(ScriptApp.getProjectTriggers()).length
      ? "a cada " + MINUTOS_GATILHO_ESPELHO + " min"
      : "EM FALTA (corra instalarGatilhoEspelho uma vez, e autorize; sem ele a " +
        "reserva só aparece na aba \"" + ABA_RESPOSTAS + "\" quando alguém abrir o " +
        "formulário)");

  return "Abas prontas. Segredo do webhook: " +
    (io.segredo() ? "definido" : "EM FALTA") +
    ". Formulário esperado: " + (io.formIdEsperado() ? io.formIdEsperado() : "EM FALTA") +
    ". Último webhook recebido: " + (ultimo ? ultimo : "NUNCA") +
    (ultimo ? "" : " (enquanto for NUNCA, nenhum lugar é libertado)") +
    espelho + gatilho + ".";
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
    maisAntigaActiva_: maisAntigaActiva_,
    validarPedido_: validarPedido_,
    planoReconciliacao_: planoReconciliacao_,
    primeiroWebhookChegou_: primeiroWebhookChegou_,
    webhookEmudeceu_: webhookEmudeceu_,
    reconciliar_: reconciliar_,
    achatarValor_: achatarValor_,
    campoPorNome_: campoPorNome_,
    NOME_CAMPO_QUARTO: NOME_CAMPO_QUARTO,
    NOME_CAMPO_NOME: NOME_CAMPO_NOME,
    dadosDoWebhook_: dadosDoWebhook_,
    confirmarWebhook_: confirmarWebhook_,
    colunaSubmissao_: colunaSubmissao_,
    colunaDestino_: colunaDestino_,
    normalizarId_: normalizarId_,
    planoRespostas_: planoRespostas_,
    espelharRespostas_: espelharRespostas_,
    gatilhosDoEspelho_: gatilhosDoEspelho_,
    espelhoAgendado: espelhoAgendado,
    instalarGatilhoEspelho: instalarGatilhoEspelho,
    removerGatilhoEspelho: removerGatilhoEspelho,
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
