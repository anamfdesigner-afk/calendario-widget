import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { carregarGs } from "./carregar.mjs";

const CAMINHO_GS = fileURLToPath(new URL("../reservas.gs", import.meta.url));
const gs = carregarGs(CAMINHO_GS);

const CABECALHO_CAP = ["horario", "vagas"];

test("capacidades_ lê a aba e mantém a ordem das linhas", () => {
  const linhas = [
    CABECALHO_CAP,
    ["08:00-08:45", 3],
    ["08:45-09:30", 2],
    ["09:30-10:15", 3]
  ];
  assert.deepEqual(gs.capacidades_(linhas), [
    { horario: "08:00-08:45", vagas: 3 },
    { horario: "08:45-09:30", vagas: 2 },
    { horario: "09:30-10:15", vagas: 3 }
  ]);
});

test("capacidades_ ignora linhas inválidas em vez de as adivinhar", () => {
  const linhas = [
    CABECALHO_CAP,
    ["", 2],                 // sem horário
    ["10:15-11:00", "x"],    // vagas não numéricas
    ["manhã", 2],            // horário com formato errado
    ["11:00-11:45", -1],     // negativo
    ["11:45-12:30", 0],      // zero é válido: horário fechado
    ["12:30-13:15", 2]
  ];
  assert.deepEqual(gs.capacidades_(linhas), [
    { horario: "11:45-12:30", vagas: 0 },
    { horario: "12:30-13:15", vagas: 2 }
  ]);
});

test("capacidades_ ignora duplicados posteriores", () => {
  const linhas = [CABECALHO_CAP, ["08:00-08:45", 3], ["08:00-08:45", 9]];
  assert.deepEqual(gs.capacidades_(linhas), [{ horario: "08:00-08:45", vagas: 3 }]);
});

test("capacidades_ aguenta uma aba vazia", () => {
  assert.deepEqual(gs.capacidades_([]), []);
  assert.deepEqual(gs.capacidades_([CABECALHO_CAP]), []);
});

test("capacidadeDe_ devolve -1 para um horário desconhecido", () => {
  const caps = [{ horario: "08:00-08:45", vagas: 3 }];
  assert.equal(gs.capacidadeDe_(caps, "08:00-08:45"), 3);
  assert.equal(gs.capacidadeDe_(caps, "23:00-23:45"), -1);
});

// A ordem das colunas é estável e o `quarto`/`nome` foram acrescentados ao
// fim: mudar a posição de uma coluna existente tornaria ilegível todas as
// linhas já guardadas, e uma linha ilegível é um lugar vendido que deixa de
// contar para a ocupação.
const CAB = [
  "token", "data", "horario", "criado", "estado", "quarto", "nome", "submissao"
];

const CAPS = [
  { horario: "08:00-08:45", vagas: 3 },
  { horario: "08:45-09:30", vagas: 2 }
];

test("o cabeçalho da aba Reservas traz quarto, nome e submissao no fim", () => {
  // Com o espelho morto, a folha das respostas tem a identidade mas não a
  // reserva, e o registo tinha a reserva mas não a identidade: ninguém
  // conseguia dizer quem tinha que horário. A `submissao` é a chave que
  // volta a ligar as duas tabelas.
  const livro = livroFalso({});
  const gsComStub = carregarCom(livro.stubs);
  gsComStub.preparar();
  assert.deepEqual(livro.folhas["Reservas"].dados[0], CAB);
});

test("normalizarData_ aceita Date e ISO completo", () => {
  assert.equal(gs.normalizarData_("2025-12-31"), "2025-12-31");
  assert.equal(gs.normalizarData_("2025-12-31T00:00:00.000Z"), "2025-12-31");
  // O Sheets devolve células de data como Date. Usamos os getters locais
  // porque o fuso do projeto é Europe/Lisbon.
  assert.equal(gs.normalizarData_(new Date(2026, 8, 8, 12, 0, 0)), "2026-09-08");
  assert.equal(gs.normalizarData_(""), "");
  assert.equal(gs.normalizarData_(null), "");
});

// ===============================
// OCUPAÇÃO: ACTIVO **MAIS** CONFIRMADO
// ===============================

test("ocupados_ conta o activo e o confirmado, na data e horário certos", () => {
  const linhas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", new Date(), "activo", "", ""],
    ["t2", "2026-09-08", "08:00-08:45", new Date(), "expirado", "", ""],
    ["t3", "2026-09-08", "08:45-09:30", new Date(), "confirmado", "12", "Ana"],
    ["t4", "2026-09-09", "08:00-08:45", new Date(), "activo", "", ""]
  ];
  assert.equal(gs.ocupados_(linhas, "2026-09-08", "08:00-08:45"), 1);
  assert.equal(gs.ocupados_(linhas, "2026-09-08", "08:45-09:30"), 1);
  assert.equal(gs.ocupados_(linhas, "2026-09-10", "08:00-08:45"), 0);
});

test("uma reserva confirmada ocupa lugar tal como uma activa", () => {
  // Contar só as activas devolvia ao mercado exatamente os lugares certos:
  // os que o webhook já confirmou.
  const linhas = [
    CAB,
    ["t1", "2026-09-08", "08:45-09:30", new Date(), "confirmado", "12", "Ana Silva"],
    ["t2", "2026-09-08", "08:45-09:30", new Date(), "confirmado", "14", "Rui Dias"]
  ];
  assert.equal(gs.ocupados_(linhas, "2026-09-08", "08:45-09:30"), 2);
  assert.equal(gs.ocupaLugar_("activo"), true);
  assert.equal(gs.ocupaLugar_("confirmado"), true);
  assert.equal(gs.ocupaLugar_("expirado"), false);
  assert.equal(gs.ocupaLugar_(""), false);
});

test("ocupados_ normaliza a data das células", () => {
  const linhas = [CAB, ["t1", new Date(2026, 8, 8), "08:00-08:45", new Date(), "activo", "", ""]];
  assert.equal(gs.ocupados_(linhas, "2026-09-08", "08:00-08:45"), 1);
});

test("linhaDoToken_ encontra as linhas activas e as confirmadas", () => {
  const linhas = [
    CAB,
    ["tA", "2026-09-08", "08:00-08:45", new Date(), "expirado", "", ""],
    ["tA", "2026-09-08", "08:45-09:30", new Date(), "activo", "", ""]
  ];
  assert.deepEqual(gs.linhaDoToken_(linhas, "tA"), {
    indice: 2, data: "2026-09-08", horario: "08:45-09:30"
  });
  assert.equal(gs.linhaDoToken_(linhas, "tZ"), null);

  // Um hóspede que volte atrás no formulário e submeta outra vez traz o
  // MESMO token: se a linha já confirmada não fosse encontrada, ficava com
  // dois lugares e o primeiro, por estar `confirmado`, nunca era libertado.
  const confirmada = [
    CAB,
    ["tB", "2026-09-08", "08:45-09:30", new Date(), "confirmado", "12", "Ana"]
  ];
  assert.deepEqual(gs.linhaDoToken_(confirmada, "tB"), {
    indice: 1, data: "2026-09-08", horario: "08:45-09:30"
  });
});

test("maisAntigaActiva_ devolve a linha activa mais antiga do slot", () => {
  const linhas = [
    CAB,
    ["t1", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 3 * 60 * 1000), "activo", "", ""],
    ["t2", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 8 * 60 * 1000), "activo", "", ""],
    ["t3", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 9 * 60 * 1000), "confirmado", "1", "X"],
    ["t4", "2026-09-08", "08:00-08:45", gs.criadoIso_(AGORA - 10 * 60 * 1000), "activo", "", ""]
  ];
  assert.equal(gs.maisAntigaActiva_(linhas, "2026-09-08", "08:45-09:30", AGORA, JANELA), 2);
  // Já confirmada não volta a ser confirmada, e o slot errado não conta.
  assert.equal(gs.maisAntigaActiva_(linhas, "2026-09-09", "08:45-09:30", AGORA, JANELA), -1);
  assert.equal(gs.maisAntigaActiva_([CAB], "2026-09-08", "08:45-09:30", AGORA, JANELA), -1);
});

test("maisAntigaActiva_ prefere a activa mais antiga DENTRO da janela das órfãs", () => {
  // Uma linha `activo` abandonada só é libertada quando alguém bate num slot
  // cheio, logo um horário com lugares de sobra acumula fantasmas
  // indefinidamente. Sem esta preferência, uma fantasma de três horas absorvia
  // a confirmação da submissão que acabou de chegar, e a linha verdadeira,
  // deixada `activo`, era expirada 21 minutos depois.
  const linhas = [
    CAB,
    ["fantasma", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 3 * 60 * 60 * 1000), "activo", "", ""],
    ["real", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 30 * 1000), "activo", "", ""]
  ];
  assert.equal(gs.maisAntigaActiva_(linhas, "2026-09-08", "08:45-09:30", AGORA, JANELA), 2);

  // Sem nenhuma dentro da janela, volta a valer a mais antiga de todas: mais
  // vale confirmar uma linha velha do que não confirmar nenhuma.
  const soFantasmas = [
    CAB,
    ["f2", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 2 * 60 * 60 * 1000), "activo", "", ""],
    ["f1", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 3 * 60 * 60 * 1000), "activo", "", ""]
  ];
  assert.equal(gs.maisAntigaActiva_(soFantasmas, "2026-09-08", "08:45-09:30", AGORA, JANELA), 2);
});

test("maisAntigaActiva_ não ignora uma linha sem timestamp legível", () => {
  // Ignorá-la fazia o webhook não encontrar nada e não confirmar nada: a
  // reserva ficava `activo` e era revendida 20 minutos depois.
  const linhas = [
    CAB,
    ["t1", "2026-09-08", "08:45-09:30", "", "activo", "", ""]
  ];
  assert.equal(gs.maisAntigaActiva_(linhas, "2026-09-08", "08:45-09:30", AGORA, JANELA), 1);

  // Mas não passa à frente de uma linha que se sabe estar dentro da janela:
  // não se sabe se a ilegível ainda é uma submissão a decorrer.
  const comLegivel = [
    CAB,
    ["ilegivel", "2026-09-08", "08:45-09:30", "", "activo", "", ""],
    ["real", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 30 * 1000), "activo", "", ""]
  ];
  assert.equal(gs.maisAntigaActiva_(comLegivel, "2026-09-08", "08:45-09:30", AGORA, JANELA), 2);
});

test("validarPedido_ rejeita cada campo inválido com o seu código", () => {
  const bom = { token: "abcd-1234-efgh", data: "2026-09-08", horario: "08:00-08:45" };
  assert.deepEqual(gs.validarPedido_(bom, CAPS, "2026-09-07"), {
    ok: true, token: "abcd-1234-efgh", data: "2026-09-08", horario: "08:00-08:45"
  });

  assert.equal(gs.validarPedido_({ ...bom, token: "curto" }, CAPS, "2026-09-07").erro, "token_invalido");
  assert.equal(gs.validarPedido_({ ...bom, token: "tem espaços aqui" }, CAPS, "2026-09-07").erro, "token_invalido");
  assert.equal(gs.validarPedido_({ ...bom, data: "8/9/2026" }, CAPS, "2026-09-07").erro, "data_invalida");
  assert.equal(gs.validarPedido_({ ...bom, data: "2026-09-06" }, CAPS, "2026-09-07").erro, "data_passada");
  assert.equal(gs.validarPedido_({ ...bom, horario: "23:00-23:45" }, CAPS, "2026-09-07").erro, "horario_desconhecido");
});

test("validarPedido_ aceita hoje", () => {
  const hoje = { token: "abcd-1234-efgh", data: "2026-09-07", horario: "08:00-08:45" };
  assert.deepEqual(gs.validarPedido_(hoje, CAPS, "2026-09-07"), {
    ok: true, token: "abcd-1234-efgh", data: "2026-09-07", horario: "08:00-08:45"
  });
});

test("validarPedido_ devolve os valores normalizados, não os do pedido", () => {
  // É por estes que o reservar_ conta e escreve. Um array stringifica num
  // valor que passa a validação mas compara `!==` diferente de todas as
  // strings guardadas — e então o slot parecia sempre livre.
  const emArray = {
    token: ["abcd-1234-efgh"], data: ["2026-09-08"], horario: ["08:00-08:45"]
  };
  assert.deepEqual(gs.validarPedido_(emArray, CAPS, "2026-09-07"), {
    ok: true, token: "abcd-1234-efgh", data: "2026-09-08", horario: "08:00-08:45"
  });
});

const JANELA = 20 * 60 * 1000;
// Meio-dia LOCAL de 8/9/2026, não meio-dia UTC. O `hoje` do reservar_ vem
// de normalizarData_(new Date(io.agora())), que usa os getters locais: com
// um instante fixado em UTC, a leste de UTC+12 o `hoje` caía no dia
// seguinte ao PEDIDO.data e vários testes falhavam com data_passada.
const AGORA = new Date(2026, 8, 8, 12, 0, 0).getTime();
const VELHO = new Date(AGORA - 60 * 60 * 1000);   // 1 hora: fora da janela
const NOVO = new Date(AGORA - 60 * 1000);         // 1 minuto: dentro da janela

// Prova de que o webhook funciona: chegou há um minuto. Sem isto a
// reconciliação não corre — é a guarda central desta versão.
//
// RELATIVO ao AGORA de propósito. Com uma data fixa em UTC, a distância até ao
// AGORA (que é meio-dia LOCAL) mudava com o fuso da máquina, e a guarda do
// canal mudo — marca com mais de duas horas e reservas por confirmar mais
// novas do que ela — disparava em São Paulo e não disparava em Lisboa.
const WEBHOOK_JA_CHEGOU = gs.criadoIso_(AGORA - 60 * 1000);

// ===============================
// RECONCILIAÇÃO: UMA ÓRFÃ É UMA ACTIVA VELHA
// ===============================
// Deixou de se INFERIR se uma submissão se concretizou comparando contagens
// com uma coluna da folha das respostas — coluna que nunca existiu, porque o
// espelho do JotForm nunca escreveu nela. Agora ou o webhook confirmou, ou
// não confirmou.

test("planoReconciliacao_ liberta a activa que já passou da janela", () => {
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", VELHO, "activo", "", ""],
    ["t2", "2026-09-08", "08:00-08:45", NOVO, "activo", "", ""]
  ];
  assert.deepEqual(gs.planoReconciliacao_(reservas, AGORA, JANELA), [1]);
});

test("planoReconciliacao_ nunca toca em linhas dentro da janela", () => {
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", NOVO, "activo", "", ""],
    ["t2", "2026-09-08", "08:00-08:45", NOVO, "activo", "", ""]
  ];
  assert.deepEqual(gs.planoReconciliacao_(reservas, AGORA, JANELA), []);
});

test("planoReconciliacao_ NUNCA liberta uma reserva confirmada", () => {
  // Uma linha confirmada é uma reserva a valer, por muito antiga que seja.
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", new Date(AGORA - 30 * 24 * 3600 * 1000), "confirmado", "12", "Ana"],
    ["t2", "2026-09-08", "08:00-08:45", VELHO, "expirado", "", ""],
    ["t3", "2026-09-08", "08:00-08:45", VELHO, "activo", "", ""]
  ];
  assert.deepEqual(gs.planoReconciliacao_(reservas, AGORA, JANELA), [3]);
});

test("planoReconciliacao_ deixa em paz uma linha sem timestamp legível", () => {
  const reservas = [CAB, ["t1", "2026-09-08", "08:00-08:45", "", "activo", "", ""]];
  assert.deepEqual(gs.planoReconciliacao_(reservas, AGORA, JANELA), []);
});

test("planoReconciliacao_ lê o criado a partir da string ISO", () => {
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", gs.criadoIso_(AGORA - 60 * 60 * 1000), "activo", "", ""],
    ["t2", "2026-09-08", "08:00-08:45", gs.criadoIso_(AGORA - 60 * 1000), "activo", "", ""]
  ];
  assert.deepEqual(gs.planoReconciliacao_(reservas, AGORA, JANELA), [1]);
});

function ioFalso(reservas, opcoes = {}) {
  const estado = {
    reservas: reservas.map(l => l.slice()),
    acrescentadas: [],
    expiradas: [],
    confirmadas: [],
    // A aba das respostas, tal como a integração do JotForm a mantém: o
    // cabeçalho na linha 1 e uma linha por submissão. Por omissão não existe.
    respostas: (opcoes.respostas || []).map(l => l.slice()),
    escritasRespostas: [],
    // Por omissão NUNCA chegou webhook nenhum: é o estado de uma instalação
    // nova, e é ele que trava a reconciliação.
    ultimoWebhook: opcoes.ultimoWebhook === undefined ? null : opcoes.ultimoWebhook,
    segredo: opcoes.segredo === undefined ? "s3gr3d0-do-webhook" : opcoes.segredo,
    formId: opcoes.formId === undefined ? "253294429726062" : opcoes.formId,
    // O anel dos submissionID já confirmados, como vive nas propriedades do
    // script: texto simples, um id por linha.
    submissoes: opcoes.submissoes === undefined ? "" : opcoes.submissoes
  };
  return {
    estado,
    io: {
      lerReservas: () => estado.reservas,
      lerCapacidades: () => opcoes.capacidades || [
        ["horario", "vagas"],
        ["08:00-08:45", 3],
        ["08:45-09:30", 2]
      ],
      acrescentar: linha => {
        estado.acrescentadas.push(linha);
        estado.reservas.push(linha);
      },
      expirar: indices => {
        estado.expiradas.push(...indices);
        indices.forEach(i => { estado.reservas[i][4] = "expirado"; });
      },
      confirmar: (indice, quarto, nome, submissao) => {
        estado.confirmadas.push({ indice, quarto, nome, submissao });
        estado.reservas[indice][4] = "confirmado";
        estado.reservas[indice][5] = quarto;
        estado.reservas[indice][6] = nome;
        estado.reservas[indice][7] = submissao;
      },
      lerRespostas: () => estado.respostas,
      escreverRespostas: plano => {
        plano.forEach(p => {
          estado.escritasRespostas.push([p.linha, p.coluna, p.valor]);
          if (!estado.respostas[p.linha - 1]) estado.respostas[p.linha - 1] = [];
          estado.respostas[p.linha - 1][p.coluna - 1] = p.valor;
        });
      },
      segredo: () => estado.segredo,
      formIdEsperado: () => estado.formId,
      ultimoWebhook: () => estado.ultimoWebhook,
      gravarUltimoWebhook: ms => { estado.ultimoWebhook = new Date(ms).toISOString(); },
      submissoesVistas: () => estado.submissoes,
      gravarSubmissoesVistas: texto => { estado.submissoes = texto; },
      agora: () => opcoes.agora || AGORA
    }
  };
}

const PEDIDO = { token: "abcd-1234-efgh", data: "2026-09-08", horario: "08:45-09:30" };

test("reservar_ toma um lugar livre", () => {
  const { io, estado } = ioFalso([CAB]);
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: true, estado: "novo" });
  assert.equal(estado.acrescentadas.length, 1);
  assert.equal(estado.acrescentadas[0][0], PEDIDO.token);
  assert.equal(estado.acrescentadas[0][4], "activo");
  // A linha nasce com o quarto, o nome e a submissão vazios: são-lhe escritos
  // na confirmação, e é a submissão que os traz. A largura fica presa ao
  // CABECALHO_RESERVAS: uma linha mais curta do que o cabeçalho devolve
  // `undefined` na coluna que falta, onde o código conta com "".
  assert.deepEqual(estado.acrescentadas[0].length, CAB.length);
  assert.equal(estado.acrescentadas[0][5], "");
  assert.equal(estado.acrescentadas[0][6], "");
  assert.equal(estado.acrescentadas[0][7], "");
});

test("reservar_ é idempotente para o mesmo token e slot", () => {
  const { io, estado } = ioFalso([
    CAB,
    [PEDIDO.token, "2026-09-08", "08:45-09:30", new Date(AGORA), "activo", "", ""]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: true, estado: "repetido" });
  assert.equal(estado.acrescentadas.length, 0, "não deve consumir um segundo lugar");
});

test("reservar_ é idempotente mesmo depois de o webhook ter confirmado", () => {
  const { io, estado } = ioFalso([
    CAB,
    [PEDIDO.token, "2026-09-08", "08:45-09:30", new Date(AGORA), "confirmado", "12", "Ana"]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: true, estado: "repetido" });
  assert.equal(estado.acrescentadas.length, 0, "dois lugares para um hóspede");
});

test("reservar_ recusa quando o slot está cheio", () => {
  const { io, estado } = ioFalso([
    CAB,
    ["x1", "2026-09-08", "08:45-09:30", new Date(AGORA), "activo", "", ""],
    ["x2", "2026-09-08", "08:45-09:30", new Date(AGORA), "confirmado", "12", "Ana"]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: false, motivo: "cheio", restantes: 0 });
  assert.equal(estado.acrescentadas.length, 0);
});

test("reservar_ recusa um slot cheio mesmo com a data, o horário ou o token em array", () => {
  // O Apps Script desdobra `data=x&data=y` num array, e um POST JSON pode
  // trazer o que quiser. A validação testava String(pedido.data) e o
  // reservar_ usava pedido.data em bruto: o array passava a validação e
  // comparava diferente de todas as strings guardadas, o ocupados_ contava
  // ZERO e a capacidade ficava sem efeito. Num slot de dois lugares já cheio,
  // a string recusava e o array reservava.
  const cheio = () => [
    CAB,
    ["x1", "2026-09-08", "08:45-09:30", new Date(AGORA), "activo", "", ""],
    ["x2", "2026-09-08", "08:45-09:30", new Date(AGORA), "confirmado", "12", "Ana"]
  ];
  const recusa = { ok: true, reservado: false, motivo: "cheio", restantes: 0 };

  const comData = ioFalso(cheio());
  assert.deepEqual(gs.reservar_({ ...PEDIDO, data: ["2026-09-08"] }, comData.io), recusa);
  assert.equal(comData.estado.acrescentadas.length, 0);

  const comHorario = ioFalso(cheio());
  assert.deepEqual(gs.reservar_({ ...PEDIDO, horario: ["08:45-09:30"] }, comHorario.io), recusa);
  assert.equal(comHorario.estado.acrescentadas.length, 0);
});

test("reservar_ continua idempotente com o token em array", () => {
  // Sem normalizar, o linhaDoToken_ não encontrava a linha do próprio
  // hóspede e ele ficava com dois lugares no mesmo horário.
  const { io, estado } = ioFalso([
    CAB,
    [PEDIDO.token, "2026-09-08", "08:45-09:30", new Date(AGORA), "activo", "", ""]
  ]);
  const r = gs.reservar_({ ...PEDIDO, token: [PEDIDO.token] }, io);
  assert.deepEqual(r, { ok: true, reservado: true, estado: "repetido" });
  assert.equal(estado.acrescentadas.length, 0, "dois lugares para um hóspede");
});

test("reservar_ escreve na folha as strings normalizadas, nunca o array", () => {
  // Uma célula com um array dentro é uma linha ilegível, e uma linha ilegível
  // é um lugar vendido que deixa de contar para a ocupação.
  const { io, estado } = ioFalso([CAB]);
  gs.reservar_({ token: ["abcd-1234-efgh"], data: ["2026-09-08"], horario: ["08:45-09:30"] }, io);
  const linha = estado.acrescentadas[0];
  assert.equal(typeof linha[0], "string");
  assert.equal(typeof linha[1], "string");
  assert.equal(typeof linha[2], "string");
  assert.deepEqual(linha.slice(0, 3), ["abcd-1234-efgh", "2026-09-08", "08:45-09:30"]);
  assert.equal(gs.ocupados_(estado.reservas, "2026-09-08", "08:45-09:30"), 1);
});

test("reservar_ troca de slot sem perder o lugar antigo antes de garantir o novo", () => {
  const { io, estado } = ioFalso([
    CAB,
    [PEDIDO.token, "2026-09-08", "08:00-08:45", new Date(AGORA), "activo", "", ""]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: true, estado: "trocado" });
  assert.deepEqual(estado.expiradas, [1]);
  assert.equal(estado.acrescentadas.length, 1);
});

test("uma linha confirmada É libertada quando o mesmo token troca de horário", () => {
  // "Uma linha `confirmado` nunca é libertada" vale para a RECONCILIAÇÃO, não
  // para tudo: aqui é o próprio hóspede a mudar de ideias, e ficar com os dois
  // lugares seria pior. O lugar novo é garantido primeiro; só depois se larga
  // o antigo.
  const { io, estado } = ioFalso([
    CAB,
    [PEDIDO.token, "2026-09-08", "08:00-08:45", new Date(AGORA), "confirmado", "12", "Ana"]
  ]);

  const r = gs.reservar_(PEDIDO, io);

  assert.deepEqual(r, { ok: true, reservado: true, estado: "trocado" });
  assert.deepEqual(estado.expiradas, [1]);
  assert.equal(estado.reservas[1][4], "expirado");
  assert.equal(estado.acrescentadas.length, 1);
  assert.equal(estado.acrescentadas[0][4], "activo", "a nova espera pelo seu webhook");
  assert.equal(gs.ocupados_(estado.reservas, "2026-09-08", "08:00-08:45"), 0, "um hóspede, um lugar");
  assert.equal(gs.ocupados_(estado.reservas, "2026-09-08", "08:45-09:30"), 1);
});

test("reservar_ NÃO liberta o lugar antigo se o novo slot estiver cheio", () => {
  const { io, estado } = ioFalso([
    CAB,
    [PEDIDO.token, "2026-09-08", "08:00-08:45", new Date(AGORA), "activo", "", ""],
    ["x1", "2026-09-08", "08:45-09:30", new Date(AGORA), "activo", "", ""],
    ["x2", "2026-09-08", "08:45-09:30", new Date(AGORA), "activo", "", ""]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.equal(r.reservado, false);
  assert.deepEqual(estado.expiradas, [], "o lugar já garantido tem de sobreviver");
  assert.equal(estado.reservas[1][4], "activo");
});

test("reservar_ reconcilia antes de recusar, e o lugar órfão é reaproveitado", () => {
  const { io, estado } = ioFalso(
    [
      CAB,
      ["x1", "2026-09-08", "08:45-09:30", VELHO, "activo", "", ""],
      ["x2", "2026-09-08", "08:45-09:30", NOVO, "activo", "", ""]
    ],
    { ultimoWebhook: WEBHOOK_JA_CHEGOU }
  );
  // A x1 já passou dos 20 minutos sem ser confirmada: é órfã e liberta o
  // lugar. A x2 é recente e não pode ser tocada.
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: true, estado: "novo" });
  assert.deepEqual(estado.expiradas, [1], "exatamente a activa velha");
  assert.equal(estado.reservas[1][4], "expirado");
  assert.equal(estado.reservas[2][4], "activo", "a recente sobrevive");
  assert.equal(estado.acrescentadas.length, 1);
  assert.equal(gs.ocupados_(estado.reservas, "2026-09-08", "08:45-09:30"), 2);
});

test("reservar_ não liberta reservas confirmadas para dar lugar a ninguém", () => {
  const antigo = new Date(AGORA - 30 * 24 * 3600 * 1000);
  const { io, estado } = ioFalso(
    [
      CAB,
      ["x1", "2026-09-08", "08:45-09:30", antigo, "confirmado", "12", "Ana"],
      ["x2", "2026-09-08", "08:45-09:30", antigo, "confirmado", "14", "Rui"]
    ],
    { ultimoWebhook: WEBHOOK_JA_CHEGOU }
  );
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: false, motivo: "cheio", restantes: 0 });
  assert.deepEqual(estado.expiradas, []);
});

test("reservar_ devolve erro de capacidades ilegíveis sem reservar", () => {
  const { io, estado } = ioFalso([CAB], { capacidades: [["horario", "vagas"]] });
  assert.deepEqual(gs.reservar_(PEDIDO, io), { ok: false, erro: "capacidades_ilegiveis" });
  assert.equal(estado.acrescentadas.length, 0);
});

test("reservar_ propaga os erros de validação", () => {
  const { io } = ioFalso([CAB]);
  assert.deepEqual(
    gs.reservar_({ ...PEDIDO, horario: "23:00-23:45" }, io),
    { ok: false, erro: "horario_desconhecido" }
  );
});

test("reservar_ guarda o criado como string ISO em UTC, não como Date", () => {
  const { io, estado } = ioFalso([CAB]);
  gs.reservar_(PEDIDO, io);
  const criado = estado.acrescentadas[0][3];
  assert.equal(typeof criado, "string", "um Date deixaria o Sheets escolher o fuso");
  assert.match(criado, ISO_UTC);
});

// ===============================
// NADA É LIBERTADO ANTES DE CHEGAR O PRIMEIRO WEBHOOK
// ===============================
// É a guarda mais importante desta versão. Um webhook mal configurado —
// segredo errado, URL errado, integração nunca criada — não confirma nada, e
// sem esta guarda TODAS as reservas seriam libertadas 20 minutos depois de
// serem feitas e os lugares revendidos, em silêncio.

test("primeiroWebhookChegou_ só é verdade com marca gravada", () => {
  assert.equal(gs.primeiroWebhookChegou_({ ultimoWebhook: () => null }), false);
  assert.equal(gs.primeiroWebhookChegou_({ ultimoWebhook: () => "" }), false);
  assert.equal(gs.primeiroWebhookChegou_({ ultimoWebhook: () => "   " }), false);
  assert.equal(gs.primeiroWebhookChegou_({}), false, "sem a função, não há prova");
  assert.equal(gs.primeiroWebhookChegou_({ ultimoWebhook: () => WEBHOOK_JA_CHEGOU }), true);
});

test("sem nenhum webhook recebido não se liberta NADA, nem uma activa velha", () => {
  const { io, estado } = ioFalso([
    CAB,
    ["x1", "2026-09-08", "08:45-09:30", VELHO, "activo", "", ""],
    ["x2", "2026-09-08", "08:45-09:30", VELHO, "activo", "", ""]
  ]);
  // Duas activas velhas num slot de dois lugares. Se a reconciliação
  // corresse, libertava as duas e revendia os dois lugares a este pedido.
  const r = comRegisto(() => gs.reservar_(PEDIDO, io));
  assert.deepEqual(estado.expiradas, [], "nenhum lugar vendido pode ser revendido");
  assert.equal(estado.reservas[1][4], "activo");
  assert.equal(estado.reservas[2][4], "activo");
  assert.equal(estado.acrescentadas.length, 0);
  // E diz porque é que recusou: sem isto, quem investigasse "porque é que as
  // órfãs nunca são libertadas?" não tinha nada onde olhar.
  assert.match(r, /não chegou nenhum webhook/);
});

test("a mesma activa velha é libertada depois de chegar um webhook", () => {
  const reservas = [
    CAB,
    ["x1", "2026-09-08", "08:45-09:30", VELHO, "activo", "", ""],
    ["x2", "2026-09-08", "08:45-09:30", VELHO, "activo", "", ""]
  ];
  const antes = ioFalso(reservas);
  assert.equal(gs.reconciliar_(antes.io, -1), 0);
  assert.deepEqual(antes.estado.expiradas, []);

  const depois = ioFalso(reservas, { ultimoWebhook: WEBHOOK_JA_CHEGOU });
  assert.equal(gs.reconciliar_(depois.io, -1), 2);
  assert.deepEqual(depois.estado.expiradas, [1, 2]);
});

// ===============================
// A GUARDA VOLTA A SER EXAMINADA, NÃO É UM TRINCO DE UMA VEZ SÓ
// ===============================
// A versão anterior olhava só para a marca ser não-vazia. Bastava a instalação
// ter funcionado um dia: se depois disso a integração fosse apagada,
// desativada, ou o URL ou o segredo editados na JotForm, nada voltava a ser
// confirmado, a marca ficava lá, a reconciliação ficava ARMADA — e todas as
// reservas feitas a partir daí eram libertadas aos 20 minutos e revendidas,
// em silêncio, para o resto da vida da implantação.

const TRES_HORAS = 3 * 60 * 60 * 1000;

test("nada é libertado quando as reservas chegam e as confirmações não", () => {
  const { io, estado } = ioFalso(
    [
      CAB,
      ["real1", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 30 * 60 * 1000), "activo", "", ""],
      ["real2", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 25 * 60 * 1000), "activo", "", ""]
    ],
    { ultimoWebhook: gs.criadoIso_(AGORA - TRES_HORAS) }
  );

  const registo = comRegisto(() => assert.equal(gs.reconciliar_(io, -1), 0));

  assert.deepEqual(estado.expiradas, [], "estas duas reservas foram mesmo vendidas");
  assert.equal(estado.reservas[1][4], "activo");
  assert.equal(estado.reservas[2][4], "activo");
  assert.match(registo, /As reservas estão a chegar e as confirmações não/);
});

test("uma marca velha sem reservas feitas depois dela ainda reconcilia", () => {
  // Estar calado não é sintoma nenhum: de noite não há submissões. O sintoma
  // é haver reservas por confirmar mais novas do que a última confirmação.
  const { io, estado } = ioFalso(
    [
      CAB,
      ["antiga", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 5 * 60 * 60 * 1000), "activo", "", ""]
    ],
    { ultimoWebhook: gs.criadoIso_(AGORA - TRES_HORAS) }
  );

  assert.equal(gs.reconciliar_(io, -1), 1);
  assert.deepEqual(estado.expiradas, [1]);
});

test("webhookEmudeceu_ mede a marca contra o limite e contra as linhas activas", () => {
  const activaNova = [
    CAB,
    ["nova", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 60 * 1000), "activo", "", ""]
  ];
  const io = marca => ({ ultimoWebhook: () => marca });

  // Duas horas: o limite. Dentro dele o canal ainda conta como vivo.
  const limite = 2 * 60 * 60 * 1000;
  assert.equal(
    gs.webhookEmudeceu_(io(gs.criadoIso_(AGORA - limite)), activaNova, AGORA),
    false, "no limite ainda não emudeceu"
  );
  assert.equal(
    gs.webhookEmudeceu_(io(gs.criadoIso_(AGORA - limite - 1000)), activaNova, AGORA),
    true
  );
  // Sem linhas activas mais novas do que a marca, não há sintoma.
  const soConfirmadas = [
    CAB,
    ["feita", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 60 * 1000), "confirmado", "12", "Ana"]
  ];
  assert.equal(gs.webhookEmudeceu_(io(gs.criadoIso_(AGORA - TRES_HORAS)), soConfirmadas, AGORA), false);
  // Uma marca ilegível (propriedade editada à mão) não é deste guarda.
  assert.equal(gs.webhookEmudeceu_(io("ontem à tarde"), activaNova, AGORA), false);
  assert.equal(gs.webhookEmudeceu_({}, activaNova, AGORA), false);
});

test("doGet também para de libertar quando o canal emudece", () => {
  // As duas guardas vivem no reconciliar_ de propósito: se divergissem,
  // fechar o buraco num caminho deixava-o aberto no outro.
  const agora = Date.now();
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["real1", "2099-01-01", "08:45-09:30", gs.criadoIso_(agora - 30 * 60 * 1000), "activo", "", ""],
      ["real2", "2099-01-01", "08:45-09:30", gs.criadoIso_(agora - 25 * 60 * 1000), "activo", "", ""]
    ],
    Capacidades: CAPS_FOLHA
  }, {
    propriedades: {
      segredoWebhook: SEGREDO,
      formIdEsperado: FORM_ID,
      ultimoWebhook: gs.criadoIso_(agora - TRES_HORAS)
    }
  });
  const gsComStub = carregarCom(livro.stubs);

  let r;
  const registo = comRegisto(() => {
    r = corpo(gsComStub.doGet({ parameter: { data: "2099-01-01" } }));
  });

  assert.equal(livro.folhas["Reservas"].dados[1][4], "activo");
  assert.equal(livro.folhas["Reservas"].dados[2][4], "activo");
  assert.equal(r.slots[1].restantes, 0);
  assert.match(registo, /As reservas estão a chegar e as confirmações não/);
});

test("reconciliar_ liberta as outras órfãs mas nunca o índice excluído", () => {
  const { io, estado } = ioFalso(
    [
      CAB,
      ["t1", "2026-09-08", "08:00-08:45", VELHO, "activo", "", ""],
      ["t2", "2026-09-08", "08:00-08:45", VELHO, "activo", "", ""]
    ],
    { ultimoWebhook: WEBHOOK_JA_CHEGOU }
  );
  assert.equal(gs.reconciliar_(io, 1), 1);
  assert.deepEqual(estado.expiradas, [2], "a linha de quem pede tem de sobreviver");
});

test("uma troca recusada não pode revogar o lugar que o hóspede já tinha", () => {
  const { io, estado } = ioFalso(
    [
      CAB,
      // A do próprio token já passou dos 20 minutos: um hóspede que demore a
      // trocar de horário. Sem a exclusão, a recusa vinha acompanhada da
      // perda do lugar que ele já tinha.
      [PEDIDO.token, "2026-09-08", "08:00-08:45", VELHO, "activo", "", ""],
      ["x1", "2026-09-08", "08:45-09:30", new Date(AGORA), "confirmado", "12", "Ana"],
      ["x2", "2026-09-08", "08:45-09:30", new Date(AGORA), "confirmado", "14", "Rui"]
    ],
    { ultimoWebhook: WEBHOOK_JA_CHEGOU }
  );
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: false, motivo: "cheio", restantes: 0 });
  assert.deepEqual(estado.expiradas, [], "a reserva de quem pede tem de sobreviver");
  assert.equal(estado.reservas[1][4], "activo");
});

// ===============================
// O WEBHOOK DA JOTFORM
// ===============================

const FORM_ID = "253294429726062";
const SEGREDO = "s3gr3d0-do-webhook";

// Um rawRequest como a JotForm o envia: JSON com os campos por nome, o de
// nome como objeto {first, last}, e a reserva no campo do widget.
function raw(reserva = "2026-09-08 | 08:45-09:30", extra = {}) {
  return JSON.stringify(Object.assign({
    slug: "submit/" + FORM_ID,
    q3_nome: { first: "Ana", last: "Silva" },
    q5_quarto: "12",
    q4_email: "ana@exemplo.pt",
    q137_typeA137: reserva
  }, extra));
}

const SUBMISSAO = "6000000000000000001";

function webhook(extra = {}) {
  return Object.assign(
    { k: SEGREDO, formID: FORM_ID, rawRequest: raw(), submissionID: SUBMISSAO },
    extra
  );
}

test("achatarValor_ junta um nome partido em first e last", () => {
  assert.equal(gs.achatarValor_({ first: "Ana", last: "Silva" }), "Ana Silva");
  assert.equal(gs.achatarValor_("  Rui  "), "Rui");
  assert.equal(gs.achatarValor_(12), "12");
  assert.equal(gs.achatarValor_(null), "");
  assert.equal(gs.achatarValor_({ first: "", last: "" }), "");
});

test("campoPorNome_ prefere as chaves com forma de resposta e ignora os metadados", () => {
  // O rawRequest traz metadados no mesmo objeto. Um `formName` casa
  // /nome|name/i, e sem esta preferência podia ganhar ao nome do hóspede — a
  // decisão ficava com a ordem das chaves, que é a JotForm que escolhe.
  const comMetadados = {
    formName: "Breakfast at Montecarmo12",
    q2_formName: "Breakfast at Montecarmo12",
    slug: "submit/253294429726062",
    q3_nome: { first: "Ana", last: "Silva" }
  };
  assert.equal(gs.campoPorNome_(comMetadados, /nome|name/i), "Ana Silva");

  // E a ordem não decide: as mesmas chaves ao contrário dão o mesmo.
  const aoContrario = {
    q3_nome: { first: "Ana", last: "Silva" },
    q2_formName: "Breakfast at Montecarmo12",
    formName: "Breakfast at Montecarmo12"
  };
  assert.equal(gs.campoPorNome_(aoContrario, /nome|name/i), "Ana Silva");

  // A segunda passagem continua a existir: uma chave sem a forma `q<n>_`
  // ainda serve, se não houver nada melhor. É a tolerância de sempre.
  assert.equal(gs.campoPorNome_({ quarto: "12" }, /quarto|room/i), "12");
});

test("campoPorNome_ é tolerante ao nome do campo e nunca devolve a reserva", () => {
  const campos = {
    q9_roomNumber: "14",
    q2_fullName: { first: "Rui", last: "Dias" },
    q137_typeA137: "2026-09-08 | 08:45-09:30"
  };
  assert.equal(gs.campoPorNome_(campos, /quarto|room/i), "14");
  assert.equal(gs.campoPorNome_(campos, /nome|name/i), "Rui Dias");
  // A reserva casa /nome|name/i pelo "Name"? Não: o valor é que é
  // descartado, porque um valor no formato da reserva não é o nome de
  // ninguém.
  assert.equal(gs.campoPorNome_({ q1_reservaName: "2026-09-08 | 08:45-09:30" }, /name/i), "");
  assert.equal(gs.campoPorNome_({}, /nome/i), "");
});

test("o quarto é encontrado nas chaves reais deste formulário", () => {
  // Verificado no DOM do formulário publicado: o campo do quarto chega como
  // `q6_typeA` e não tem "quarto" nem "room" no nome. Com o padrão anterior
  // a coluna `quarto` ficava vazia em TODAS as reservas e o registo que a
  // cozinha lê de manhã perdia metade da identidade.
  const campos = {
    q6_typeA: "12",
    q5_name: { first: "Ana", last: "Silva" },
    q4_email: "ana@exemplo.pt",
    q137_typeA137: "2026-09-08 | 08:45-09:30"
  };

  assert.equal(gs.campoPorNome_(campos, gs.NOME_CAMPO_QUARTO), "12");
  assert.equal(gs.campoPorNome_(campos, gs.NOME_CAMPO_NOME), "Ana Silva");
  assert.deepEqual(gs.dadosDoWebhook_(JSON.stringify(campos)), {
    data: "2026-09-08", horario: "08:45-09:30", quarto: "12", nome: "Ana Silva"
  });
});

test("o padrão do quarto não apanha qualquer caixa de texto curta", () => {
  // `typeA` é o nome genérico da JotForm para uma caixa de texto curta: um
  // `/typea/i` à solta apanhava a primeira que aparecesse. O que identifica
  // este campo é o ID DA PERGUNTA — o que ata a constante a ESTE formulário.
  assert.equal(
    gs.campoPorNome_({ q6_typeA: "12", q7_typeA: "outra caixa" }, gs.NOME_CAMPO_QUARTO),
    "12"
  );
  assert.equal(
    gs.campoPorNome_({ q7_typeA: "outra caixa" }, gs.NOME_CAMPO_QUARTO),
    ""
  );
  // Um campo mesmo chamado "quarto" continua a ganhar ao id: é a primeira
  // passagem do campoEm_, a que compara contra o nome da pergunta.
  assert.equal(
    gs.campoPorNome_({ q6_typeA: "12", q9_quarto: "14" }, gs.NOME_CAMPO_QUARTO),
    "14"
  );
});

test("dadosDoWebhook_ lê a reserva, o quarto e o nome", () => {
  assert.deepEqual(gs.dadosDoWebhook_(raw()), {
    data: "2026-09-08", horario: "08:45-09:30", quarto: "12", nome: "Ana Silva"
  });
});

test("dadosDoWebhook_ tolera espaçamento e um corpo que não é JSON", () => {
  assert.deepEqual(gs.dadosDoWebhook_("Reserva:2026-09-08|08:45-09:30"), {
    data: "2026-09-08", horario: "08:45-09:30", quarto: "", nome: ""
  });
});

test("dadosDoWebhook_ devolve null sem reserva legível", () => {
  assert.equal(gs.dadosDoWebhook_(JSON.stringify({ q3_nome: "Ana" })), null);
  assert.equal(gs.dadosDoWebhook_(""), null);
  assert.equal(gs.dadosDoWebhook_(null), null);
  // Uma data sozinha não é uma reserva: sem horário não se sabe que lugar
  // confirmar.
  assert.equal(gs.dadosDoWebhook_("2026-09-08"), null);
});

// ===============================
// SÓ A RESPOSTA DO WIDGET PODE NOMEAR UM LUGAR
// ===============================
// A JotForm ordena o rawRequest pelo id da pergunta, logo qualquer campo
// escrito pelo hóspede aparece ANTES do campo do widget. Enquanto a reserva
// era procurada no texto todo (e o `match` sem /g devolve a primeira), bastava
// escrever `2026-12-25 | 08:00-08:45` na caixa do quarto para o webhook —
// assinado pela JotForm, sem segredo nenhum pelo meio — confirmar a linha de
// OUTRO hóspede naquele horário, e uma linha `confirmado` não é libertada pela
// reconciliação: o horário ficava preso para sempre.

test("um campo do hóspede não pode nomear o lugar, e a ordem das chaves não decide", () => {
  const hospedePrimeiro = JSON.stringify({
    q3_nome: { first: "Ata", last: "Cante" },
    q5_quarto: "2026-12-25 | 08:00-08:45",
    q137_typeA137: "2026-09-08 | 08:45-09:30"
  });
  const widgetPrimeiro = JSON.stringify({
    q137_typeA137: "2026-09-08 | 08:45-09:30",
    q5_quarto: "2026-12-25 | 08:00-08:45",
    q3_nome: { first: "Ata", last: "Cante" }
  });

  const esperado = { data: "2026-09-08", horario: "08:45-09:30", quarto: "", nome: "Ata Cante" };
  assert.deepEqual(gs.dadosDoWebhook_(hospedePrimeiro), esperado);
  assert.deepEqual(gs.dadosDoWebhook_(widgetPrimeiro), esperado);
});

test("o webhook do atacante confirma a linha DELE, nunca a da vítima", () => {
  const { io, estado } = ioFalso([
    CAB,
    ["vitima", "2026-12-25", "08:00-08:45", gs.criadoIso_(AGORA - 60 * 1000), "activo", "", ""],
    ["atacante", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 30 * 1000), "activo", "", ""]
  ]);
  const rawAtaque = JSON.stringify({
    q3_nome: { first: "Ata", last: "Cante" },
    q5_quarto: "2026-12-25 | 08:00-08:45",
    q137_typeA137: "2026-09-08 | 08:45-09:30"
  });

  assert.deepEqual(gs.confirmarWebhook_(webhook({ rawRequest: rawAtaque }), io), {
    ok: true, confirmado: true
  });
  assert.deepEqual(estado.confirmadas.map(c => c.indice), [2], "a linha do próprio atacante");
  assert.equal(estado.reservas[1][4], "activo", "o lugar da vítima não pode ser tocado");
  assert.equal(estado.reservas[1][6], "", "nem ganhar o nome de outra pessoa");
});

test("um campo do hóspede sozinho, sem a chave do widget, não confirma nada", () => {
  assert.equal(gs.dadosDoWebhook_(JSON.stringify({ q5_quarto: "2026-12-25 | 08:00-08:45" })), null);

  const { io, estado } = ioFalso([
    CAB,
    ["vitima", "2026-12-25", "08:00-08:45", gs.criadoIso_(AGORA - 60 * 1000), "activo", "", ""]
  ]);
  comRegisto(() => {
    assert.deepEqual(
      gs.confirmarWebhook_(webhook({
        rawRequest: JSON.stringify({ q5_quarto: "2026-12-25 | 08:00-08:45" })
      }), io),
      { ok: false, erro: "reserva_ilegivel" }
    );
  });
  assert.deepEqual(estado.confirmadas, []);
  assert.equal(estado.reservas[1][4], "activo");
});

test("duas reservas diferentes em chaves de reserva não confirmam nenhuma", () => {
  // Escolher uma delas seria deixar a ordem decidir. Recusar custa uma
  // confirmação (a linha volta ao mercado ao fim de 20 minutos); escolher mal
  // prende o lugar de outro hóspede para sempre.
  const duas = JSON.stringify({
    q9_reservaDoQuarto: "2026-12-25 | 08:00-08:45",
    q137_typeA137: "2026-09-08 | 08:45-09:30"
  });
  // A chave do widget existe e é única: é ela que decide, e a outra é ignorada.
  assert.deepEqual(gs.dadosDoWebhook_(duas), {
    data: "2026-09-08", horario: "08:45-09:30", quarto: "", nome: ""
  });

  // Sem a chave do widget, duas chaves "reserva" com valores diferentes são
  // ambíguas e não nomeiam lugar nenhum.
  let r;
  const registo = comRegisto(() => {
    r = gs.dadosDoWebhook_(JSON.stringify({
      q9_reservaA: "2026-12-25 | 08:00-08:45",
      q10_reservaB: "2027-01-01 | 09:30-10:15"
    }));
  });
  assert.equal(r, null);
  assert.match(registo, /ambíguo/);
});

test("uma reserva escondida no meio de uma frase não nomeia lugar nenhum", () => {
  // O valor da chave tem de ser uma reserva e mais NADA.
  assert.equal(
    gs.dadosDoWebhook_(JSON.stringify({
      q137_typeA137: "quero 2026-09-08 | 08:45-09:30 se possível"
    })),
    null
  );
  // E o texto solto exige fronteiras: uma data presa a outro dígito não conta.
  assert.equal(gs.dadosDoWebhook_("x12026-09-08 | 08:45-09:30"), null);
});

test("num corpo que não é JSON, duas reservas diferentes também são ambíguas", () => {
  let r;
  const registo = comRegisto(() => {
    r = gs.dadosDoWebhook_("a=2026-12-25 | 08:00-08:45&b=2026-09-08 | 08:45-09:30");
  });
  assert.equal(r, null);
  assert.match(registo, /não é um objeto JSON/);
  // A mesma reserva repetida não é ambiguidade nenhuma.
  assert.deepEqual(gs.dadosDoWebhook_("a=2026-09-08 | 08:45-09:30&b=2026-09-08 | 08:45-09:30"), {
    data: "2026-09-08", horario: "08:45-09:30", quarto: "", nome: ""
  });
});

const DUAS_ACTIVAS = [
  CAB,
  ["novo1", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 60 * 1000), "activo", "", ""],
  ["velho1", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 5 * 60 * 1000), "activo", "", ""]
];

test("um webhook válido confirma a activa mais antiga e escreve quarto e nome", () => {
  const { io, estado } = ioFalso(DUAS_ACTIVAS);
  const r = comRegisto(() => {
    assert.deepEqual(gs.confirmarWebhook_(webhook(), io), { ok: true, confirmado: true });
  });
  assert.equal(r, "", "um webhook normal não precisa de escrever no registo");

  assert.deepEqual(estado.confirmadas,
    [{ indice: 2, quarto: "12", nome: "Ana Silva", submissao: SUBMISSAO }]);
  assert.equal(estado.reservas[2][4], "confirmado");
  assert.equal(estado.reservas[2][5], "12");
  assert.equal(estado.reservas[2][6], "Ana Silva");
  // A chave que liga esta reserva à linha da aba das respostas. Sem ela, o
  // espelho não tem por onde casar e a reserva nunca aparece ao lado do menu.
  assert.equal(estado.reservas[2][7], SUBMISSAO);
  assert.equal(estado.reservas[1][4], "activo", "a outra linha fica como estava");
  // E fica a prova de que o webhook funciona: é ela que arma a reconciliação.
  assert.equal(estado.ultimoWebhook, new Date(AGORA).toISOString());
});

test("uma fantasma velha não absorve a confirmação da reserva verdadeira", () => {
  // Verificado antes da correção: a fantasma de três horas ficava
  // `confirmado` com o nome do hóspede que acabou de submeter, a linha real
  // ficava `activo` e era expirada 21 minutos depois. O hóspede perdia o
  // lugar; ao re-submeter criava uma segunda linha, um segundo webhook
  // confirmava-a, e ficavam dois lugares permanentes para um hóspede.
  const { io, estado } = ioFalso([
    CAB,
    ["fantasma", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 3 * 60 * 60 * 1000), "activo", "", ""],
    ["real", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 30 * 1000), "activo", "", ""]
  ]);

  assert.deepEqual(gs.confirmarWebhook_(webhook(), io), { ok: true, confirmado: true });
  assert.deepEqual(estado.confirmadas,
    [{ indice: 2, quarto: "12", nome: "Ana Silva", submissao: SUBMISSAO }]);
  assert.equal(estado.reservas[2][4], "confirmado", "a reserva verdadeira");
  assert.equal(estado.reservas[1][4], "activo", "a fantasma continua a ser uma fantasma");

  // E 21 minutos depois é a FANTASMA que é libertada, não a reserva real.
  const depois = ioFalso(estado.reservas, {
    ultimoWebhook: gs.criadoIso_(AGORA),
    agora: AGORA + 21 * 60 * 1000
  });
  assert.equal(gs.reconciliar_(depois.io, -1), 1);
  assert.deepEqual(depois.estado.expiradas, [1]);
  assert.equal(depois.estado.reservas[2][4], "confirmado");
});

test("um webhook com o segredo errado não confirma nada", () => {
  const { io, estado } = ioFalso(DUAS_ACTIVAS);
  const registo = comRegisto(() => {
    assert.deepEqual(gs.confirmarWebhook_(webhook({ k: "outro" }), io), {
      ok: false, erro: "segredo_invalido"
    });
    assert.deepEqual(gs.confirmarWebhook_(webhook({ k: undefined }), io), {
      ok: false, erro: "segredo_invalido"
    });
  });
  assert.deepEqual(estado.confirmadas, []);
  // E sobretudo: não arma a reconciliação. Senão qualquer POST anónimo
  // punha o script a libertar reservas.
  assert.equal(estado.ultimoWebhook, null);
  assert.match(registo, /segredo/);
});

test("um webhook de outro formulário não confirma nada", () => {
  const { io, estado } = ioFalso(DUAS_ACTIVAS);
  const registo = comRegisto(() => {
    assert.deepEqual(gs.confirmarWebhook_(webhook({ formID: "999" }), io), {
      ok: false, erro: "formulario_inesperado"
    });
  });
  assert.deepEqual(estado.confirmadas, []);
  assert.equal(estado.ultimoWebhook, null);
  assert.match(registo, /999/);
});

test("um webhook sem reserva legível não confirma nada", () => {
  const { io, estado } = ioFalso(DUAS_ACTIVAS);
  const registo = comRegisto(() => {
    assert.deepEqual(
      gs.confirmarWebhook_(webhook({ rawRequest: JSON.stringify({ q3_nome: "Ana" }) }), io),
      { ok: false, erro: "reserva_ilegivel" }
    );
    assert.deepEqual(gs.confirmarWebhook_(webhook({ rawRequest: undefined }), io), {
      ok: false, erro: "reserva_ilegivel"
    });
  });
  assert.deepEqual(estado.confirmadas, []);
  assert.equal(estado.ultimoWebhook, null, "um corpo ilegível não prova nada");
  assert.match(registo, /AAAA-MM-DD/);
});

test("sem segredo ou sem formulário nas propriedades, recusa em vez de aceitar", () => {
  const semSegredo = ioFalso(DUAS_ACTIVAS, { segredo: null });
  const semForm = ioFalso(DUAS_ACTIVAS, { formId: "" });
  const registo = comRegisto(() => {
    assert.deepEqual(gs.confirmarWebhook_(webhook(), semSegredo.io), {
      ok: false, erro: "webhook_nao_configurado"
    });
    assert.deepEqual(gs.confirmarWebhook_(webhook(), semForm.io), {
      ok: false, erro: "webhook_nao_configurado"
    });
  });
  assert.deepEqual(semSegredo.estado.confirmadas, []);
  assert.deepEqual(semForm.estado.confirmadas, []);
  assert.equal(semSegredo.estado.ultimoWebhook, null);
  assert.match(registo, /segredoWebhook/);
  assert.match(registo, /formIdEsperado/);
});

test("um webhook sem linha activa correspondente não cria reserva nenhuma", () => {
  // Inventar uma reserva a partir de um webhook seria dar a um POST o poder
  // de ocupar lugares. A reconciliação pode já ter libertado a linha, ou a
  // submissão pode não ter passado pelo widget.
  const { io, estado } = ioFalso([
    CAB,
    ["outro", "2026-09-08", "08:00-08:45", gs.criadoIso_(AGORA), "activo", "", ""],
    ["feita", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA), "confirmado", "9", "Zé"]
  ]);
  const registo = comRegisto(() => {
    assert.deepEqual(gs.confirmarWebhook_(webhook(), io), {
      ok: true, confirmado: false, motivo: "sem_reserva_activa"
    });
  });
  assert.deepEqual(estado.confirmadas, []);
  assert.equal(estado.acrescentadas.length, 0, "nada é criado");
  assert.equal(estado.reservas.length, 3);
  assert.match(registo, /sem linha activa/);
  // O canal está de pé — é isso que se prova aqui — mesmo sem linha para
  // confirmar.
  assert.equal(estado.ultimoWebhook, new Date(AGORA).toISOString());
});

// ===============================
// UMA ENTREGA REPETIDA NÃO CONFIRMA UMA SEGUNDA LINHA
// ===============================
// Uma confirmação é permanente e não se desfaz. Nada registava de que
// submissão tinha vindo, pelo que uma entrega repetida — a JotForm a repetir
// um pedido que expirou no transporte, ou o dono a reenviar à mão — encontrava
// a linha do hóspede já `confirmado` e confirmava a SEGUINTE mais antiga: a
// linha de outro hóspede, com o quarto e o nome do primeiro.

test("o mesmo submissionID entregue duas vezes confirma exactamente uma linha", () => {
  const { io, estado } = ioFalso([
    CAB,
    ["primeiro", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 5 * 60 * 1000), "activo", "", ""],
    ["segundo", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 60 * 1000), "activo", "", ""]
  ]);

  assert.deepEqual(gs.confirmarWebhook_(webhook(), io), { ok: true, confirmado: true });

  const registo = comRegisto(() => {
    assert.deepEqual(gs.confirmarWebhook_(webhook(), io), {
      ok: true, confirmado: false, motivo: "submissao_repetida"
    });
  });

  assert.deepEqual(estado.confirmadas.map(c => c.indice), [1], "uma linha, uma só vez");
  assert.equal(estado.reservas[2][4], "activo", "a linha do outro hóspede não pode ser tocada");
  assert.equal(estado.reservas[2][6], "", "nem ganhar o nome do primeiro");
  assert.match(registo, /repetido/);
});

test("submissões diferentes confirmam linhas diferentes", () => {
  const { io, estado } = ioFalso([
    CAB,
    ["primeiro", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 5 * 60 * 1000), "activo", "", ""],
    ["segundo", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 60 * 1000), "activo", "", ""]
  ]);

  assert.deepEqual(gs.confirmarWebhook_(webhook(), io), { ok: true, confirmado: true });
  assert.deepEqual(gs.confirmarWebhook_(webhook({ submissionID: "6000000000000000002" }), io), {
    ok: true, confirmado: true
  });

  assert.deepEqual(estado.confirmadas.map(c => c.indice), [1, 2]);
  assert.deepEqual(estado.submissoes.split("\n"),
    ["6000000000000000002", SUBMISSAO], "os mais recentes à cabeça");
});

test("uma entrega que não confirmou nada pode ser repetida à vontade", () => {
  // Nada foi gasto, e guardar o id impediria a confirmação verdadeira que
  // ainda pode chegar depois de a linha ser criada.
  const { io, estado } = ioFalso([CAB]);
  comRegisto(() => {
    assert.deepEqual(gs.confirmarWebhook_(webhook(), io), {
      ok: true, confirmado: false, motivo: "sem_reserva_activa"
    });
  });
  assert.equal(estado.submissoes, "", "nada a lembrar");
});

test("um webhook sem submissionID continua a confirmar", () => {
  // Não se pode desduplicar o que não vem identificado, e recusar seria
  // deixar a reserva por confirmar e o lugar a ser revendido aos 20 minutos.
  const { io, estado } = ioFalso(DUAS_ACTIVAS);
  assert.deepEqual(gs.confirmarWebhook_(webhook({ submissionID: undefined }), io), {
    ok: true, confirmado: true
  });
  assert.deepEqual(estado.confirmadas.map(c => c.indice), [2]);
  assert.equal(estado.submissoes, "");
});

test("o anel de submissões não cresce sem fim", () => {
  const cheio = [];
  for (let i = 0; i < 60; i++) cheio.push("id-" + i);
  const { io, estado } = ioFalso(DUAS_ACTIVAS, { submissoes: cheio.join("\n") });

  gs.confirmarWebhook_(webhook(), io);

  const guardadas = estado.submissoes.split("\n");
  assert.equal(guardadas.length, 50);
  assert.equal(guardadas[0], SUBMISSAO, "o mais recente à cabeça");
  assert.equal(guardadas[49], "id-48", "os mais velhos caem");
});

test("um webhook válido arma a reconciliação, e só ele", () => {
  const reservas = [
    CAB,
    ["orfa", "2026-09-08", "08:00-08:45", VELHO, "activo", "", ""],
    ["nova", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA - 60 * 1000), "activo", "", ""]
  ];
  const { io, estado } = ioFalso(reservas);

  // Antes de qualquer webhook: a órfã fica presa (é o lado seguro).
  comRegisto(() => assert.equal(gs.reconciliar_(io, -1), 0));
  assert.deepEqual(estado.expiradas, []);

  // Chega o webhook da reserva nova. Confirma-a e deixa a marca.
  assert.deepEqual(gs.confirmarWebhook_(webhook(), io), { ok: true, confirmado: true });
  assert.equal(estado.reservas[2][4], "confirmado");

  // E agora a órfã já pode ser libertada.
  assert.equal(gs.reconciliar_(io, -1), 1);
  assert.deepEqual(estado.expiradas, [1]);
});

// ===============================
// LIVRO FALSO (folha de cálculo em memória)
// ===============================
// Um SpreadsheetApp/LockService/ContentService/PropertiesService inteiro em
// memória. Existe porque a casca HTTP — o mutex, o release no finally, o
// salto quando o tryLock falha, a leitura do corpo — é a peça em que todo
// este desenho se apoia e não tinha teste nenhum.

function livroFalso(abas = {}, opcoes = {}) {
  const formatos = [];
  const propriedades = Object.assign({}, opcoes.propriedades);
  const folhas = {};
  const chamadas = { tryLock: [], releaseLock: 0, flush: 0 };

  function fazerFolha(nome, linhas) {
    const dados = linhas.map(l => l.slice());
    // O formato de cada coluna, tal como o setNumberFormat o deixa. Só serve
    // para o `coagirComoSheets`: numa célula em "Automático" o Sheets lê uma
    // string só de dígitos como NÚMERO, e um submissionID de 19 dígitos não
    // cabe num double — perde os últimos dígitos e deixa de casar com a aba
    // das respostas. Numa coluna em "@" (texto simples) fica como está.
    const formatoDaColuna = {};

    function comoOSheetsGuarda(coluna, v) {
      if (!opcoes.coagirComoSheets) return v;
      if (formatoDaColuna[coluna] === "@") return v;
      if (typeof v !== "string" || !/^\d+$/.test(v)) return v;
      return Number(v);
    }

    folhas[nome] = {
      dados,
      getName: () => nome,
      getLastRow: () => dados.length,
      getLastColumn: () => dados.reduce((m, l) => Math.max(m, l.length), 0),
      // As folhas reais nascem com 1000 linhas, muitas delas vazias.
      getMaxRows: () => Math.max(dados.length, 1000),
      getRange: (linha, coluna, nLinhas = 1, nColunas = 1) => {
        // Permite pôr uma aba a falhar, para provar que o lock é largado
        // mesmo quando o reservar_ estoura a meio.
        if (opcoes.abaExplosiva === nome) throw new Error("folha em chamas");
        return ({
        getValues: () => {
          const out = [];
          for (let r = linha - 1; r < linha - 1 + nLinhas; r++) {
            const fila = [];
            for (let c = coluna - 1; c < coluna - 1 + nColunas; c++) {
              const v = (dados[r] || [])[c];
              fila.push(v === undefined ? "" : v);
            }
            out.push(fila);
          }
          return out;
        },
        getValue: () => {
          const v = (dados[linha - 1] || [])[coluna - 1];
          return v === undefined ? "" : v;
        },
        setValue: v => {
          // Permite pôr a ESCRITA a falhar sem pôr a leitura a falhar: é
          // assim que uma reconciliação estoira sem levar atrás o GET.
          if (opcoes.escritaExplosiva === nome) throw new Error("célula em chamas");
          if (!dados[linha - 1]) dados[linha - 1] = [];
          dados[linha - 1][coluna - 1] = comoOSheetsGuarda(coluna, v);
        },
        setValues: filas => {
          filas.forEach((fila, r) => {
            const alvo = linha - 1 + r;
            if (!dados[alvo]) dados[alvo] = [];
            fila.forEach((v, c) => { dados[alvo][coluna - 1 + c] = v; });
          });
        },
        setNumberFormat: f => {
          formatos.push({ aba: nome, coluna, formato: f });
          formatoDaColuna[coluna] = f;
        }
        });
      },
      appendRow: l => { dados.push(l.slice()); },
      deleteRow: r => { dados.splice(r - 1, 1); }
    };
    return folhas[nome];
  }

  Object.keys(abas).forEach(nome => fazerFolha(nome, abas[nome]));

  const ss = {
    getSheetByName: nome => folhas[nome] || null,
    insertSheet: nome => fazerFolha(nome, []),
    getSheets: () => Object.keys(folhas).map(n => folhas[n])
  };

  const stubs = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush: () => { chamadas.flush++; }
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: ms => {
          chamadas.tryLock.push(ms);
          return opcoes.lockIndisponivel !== true;
        },
        releaseLock: () => { chamadas.releaseLock++; }
      })
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: function (texto) {
        return { texto: texto, setMimeType: function (m) { this.mime = m; return this; } };
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in propriedades ? propriedades[k] : null),
        setProperty: (k, v) => { propriedades[k] = v; }
      })
    }
  };

  return { stubs, folhas, formatos, propriedades, chamadas };
}

function carregarCom(stubs) {
  return carregarGs(CAMINHO_GS, stubs);
}

// Apanha o que o script escreve no registo de execução. O console é global
// (não entra pelos stubs do carregarGs), por isso troca-se e repõe-se.
function comRegisto(fn) {
  const linhas = [];
  const original = console.log;
  console.log = (...args) => { linhas.push(args.map(String).join(" ")); };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return linhas.join("\n");
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Propriedades de uma instalação já a funcionar: webhook configurado e já
// recebido pelo menos uma vez.
// Estes testes medem o tempo pelo relógio real (Date.now()) e não pelo AGORA,
// por isso a marca também é relativa a ele: uma data fixa acabaria por ficar
// com mais de duas horas e desarmava a reconciliação sozinha, um dia
// qualquer, sem nada ter mudado no código.
const CONFIGURADO = {
  segredoWebhook: SEGREDO,
  formIdEsperado: FORM_ID,
  ultimoWebhook: gs.criadoIso_(Date.now() - 60 * 1000)
};

// ===============================
// INDEPENDÊNCIA DOS DOIS FUSOS
// ===============================

test("criadoIso_ devolve sempre ISO-8601 em UTC", () => {
  const iso = gs.criadoIso_(AGORA);
  assert.match(iso, ISO_UTC);
  assert.equal(Date.parse(iso), AGORA);
});

test("criadoMs_ lê tanto a string ISO como um Date da folha", () => {
  assert.equal(gs.criadoMs_(gs.criadoIso_(AGORA)), AGORA);
  assert.equal(gs.criadoMs_(new Date(AGORA)), AGORA);
  assert.equal(isFinite(gs.criadoMs_("")), false);
});

const CAPS_FOLHA = [["horario", "vagas"], ["08:00-08:45", 3], ["08:45-09:30", 2]];

test("preparar() põe data, criado, quarto, nome e submissao em texto simples", () => {
  const livro = livroFalso({});
  const gsComStub = carregarCom(livro.stubs);

  gsComStub.preparar();

  // COL_DATA = 1, COL_CRIADO = 3, COL_QUARTO = 5, COL_NOME = 6 e
  // COL_SUBMISSAO = 7 → colunas 2, 4, 6, 7 e 8 da folha, formato "@". O quarto
  // entra porque um quarto "007" seria coagido a 7; o nome porque um nome
  // começado por "=" ou "+" é lido como fórmula e a célula devolve um erro em
  // vez do nome; a submissão porque um id de 19 dígitos coagido a número perde
  // os últimos dígitos e deixa de casar com a aba das respostas.
  const naReservas = livro.formatos.filter(f => f.aba === "Reservas");
  assert.deepEqual(naReservas, [
    { aba: "Reservas", coluna: 2, formato: "@" },
    { aba: "Reservas", coluna: 4, formato: "@" },
    { aba: "Reservas", coluna: 6, formato: "@" },
    { aba: "Reservas", coluna: 7, formato: "@" },
    { aba: "Reservas", coluna: 8, formato: "@" }
  ]);
});

test("preparar() não reformata uma aba Reservas que já tem reservas", () => {
  // Uma versão anterior deste script deixava o appendRow coagir as strings em
  // células de DATA. Pôr essa coluna a texto simples não desfaz a coerção: a
  // célula pode passar a devolver o número de série do Sheets, o
  // normalizarData_ dá "46000", e todas as reservas guardadas ficam
  // invisíveis para o ocupados_ — os lugares delas seriam vendidos outra vez,
  // por causa de um segundo preparar().
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["t1", "2099-01-01", "08:00-08:45", "2026-09-08T11:00:00.000Z", "activo", "", ""]
    ]
  });
  const gsComStub = carregarCom(livro.stubs);

  gsComStub.preparar();

  // A `submissao` (coluna 8) é a excepção, e é a única: é uma coluna NOVA,
  // vazia em todas as linhas anteriores, logo não há coerção nenhuma para
  // desfazer — e sem este formato o primeiro id de 19 dígitos era coagido a
  // double e a funcionalidade morria em silêncio.
  assert.deepEqual(
    livro.formatos.filter(f => f.aba === "Reservas"),
    [{ aba: "Reservas", coluna: 8, formato: "@" }],
    "uma aba com dados só pode ser reformatada na coluna nova e vazia"
  );
  assert.equal(livro.folhas["Reservas"].dados.length, 2, "e nada lhe é acrescentado");
});

test("numa aba Reservas que já tem linhas, o submissionID sobrevive ao preparar()", () => {
  // A falha que este teste existe para impedir, de ponta a ponta: a aba
  // `Reservas` do dono JÁ tem linhas (as de teste). Enquanto o
  // formatarTexto_(COL_SUBMISSAO) esteve dentro da guarda do `getLastRow() <= 1`,
  // a coluna nova ficava em "Automático"; o primeiro `confirmar` escrevia lá
  // um id de 19 dígitos, o Sheets coagia-o a double e guardava
  // 6000000000000000000 em vez de 6000000000000000001; a chave deixava de
  // casar com o texto da aba das respostas, o plano saía vazio e a
  // funcionalidade morria em SILÊNCIO — com o preparar() a dizer alegremente
  // `Coluna do ID: "Submission ID"`.
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["t1", "2099-01-01", "08:45-09:30", gs.criadoIso_(Date.now() - 5000), "activo", "", "", ""]
    ],
    Capacidades: CAPS_FOLHA,
    "Form responses": [CAB_RESPOSTAS, respostaFalsa({ nome: "Ana Silva", id: SUBMISSAO })]
  }, { propriedades: CONFIGURADO, coagirComoSheets: true });
  const gsComStub = carregarCom(livro.stubs);

  gsComStub.preparar();

  gsComStub.doPost({
    parameter: webhook({ rawRequest: raw("2099-01-01 | 08:45-09:30") }),
    postData: { type: "application/x-www-form-urlencoded", contents: "formID=" + FORM_ID }
  });

  // O id tem de estar na folha como TEXTO. Se o Sheets o tivesse coagido,
  // aqui estaria o número 6000000000000000000.
  assert.equal(livro.folhas["Reservas"].dados[1][7], SUBMISSAO,
    "o id guardado tem de continuar a ser o id que chegou");

  gsComStub.doGet({ parameter: { data: "2099-01-01" } });

  assert.equal(livro.folhas["Form responses"].dados[1][3], "2099-01-01 | 08:45-09:30",
    "e a chave tem de casar com a da aba das respostas");
});

test("preparar() cria as abas e semeia as capacidades", () => {
  const livro = livroFalso({});
  const gsComStub = carregarCom(livro.stubs);

  gsComStub.preparar();

  assert.deepEqual(livro.folhas["Reservas"].dados, [CAB]);
  assert.deepEqual(livro.folhas["Capacidades"].dados, [
    ["horario", "vagas"],
    ["08:00-08:45", 3],
    ["08:45-09:30", 2],
    ["09:30-10:15", 3],
    ["10:15-11:00", 2]
  ]);
});

test("preparar() acrescenta quarto e nome ao cabeçalho de uma folha antiga", () => {
  // Numa aba criada por uma versão anterior, as colunas novas apareciam
  // cheias de nomes de hóspedes e sem título nenhum.
  const livro = livroFalso({
    Reservas: [
      ["token", "data", "horario", "criado", "estado"],
      ["t1", "2099-01-01", "08:00-08:45", "2026-09-08T11:00:00.000Z", "activo"]
    ]
  });
  const gsComStub = carregarCom(livro.stubs);

  gsComStub.preparar();

  assert.deepEqual(livro.folhas["Reservas"].dados[0], CAB);
  assert.deepEqual(
    livro.folhas["Reservas"].dados[1],
    ["t1", "2099-01-01", "08:00-08:45", "2026-09-08T11:00:00.000Z", "activo"],
    "as linhas de dados ficam intactas"
  );
});

test("preparar() escreve os títulos novos mesmo numa aba já com sete colunas", () => {
  // A guarda anterior saía cedo quando getLastColumn() >= 7. Numa aba criada
  // por uma versão antiga bastava a primeira reserva — que já é escrita com
  // sete valores — para o getLastColumn passar a 7, e os títulos `quarto` e
  // `nome` nunca chegavam a ser escritos: exactamente o caso que isto existe
  // para tratar.
  const livro = livroFalso({
    Reservas: [
      ["token", "data", "horario", "criado", "estado"],
      ["t1", "2099-01-01", "08:00-08:45", "2026-09-08T11:00:00.000Z", "activo", "", ""]
    ]
  });
  const gsComStub = carregarCom(livro.stubs);

  assert.equal(livro.folhas["Reservas"].getLastColumn(), 7, "a aba já tem sete colunas");
  gsComStub.preparar();

  assert.deepEqual(livro.folhas["Reservas"].dados[0], CAB);
});

test("preparar() deixa em paz um cabeçalho que já está certo", () => {
  const livro = livroFalso({ Reservas: [CAB, ["t1", "2099-01-01", "08:00-08:45", "x", "activo", "", ""]] });
  const gsComStub = carregarCom(livro.stubs);

  gsComStub.preparar();

  assert.deepEqual(livro.folhas["Reservas"].dados[0], CAB);
  assert.equal(livro.folhas["Reservas"].dados.length, 2);
});

// ===============================
// AS DUAS COLUNAS DA ABA DAS RESPOSTAS
// ===============================
// Descobertas pelo CABEÇALHO, nunca pela posição: uma coluna acertada por
// posição continua a escrever depois de a folha mudar, só que na célula
// errada — e aqui a célula errada é a resposta de um hóspede.

// O cabeçalho real: 23 colunas (A..W), o `typeA137` em D e o `Submission ID`
// em V. A coluna A chama-se "Submission Date" de propósito, para provar que o
// padrão do id não a apanha.
const CAB_RESPOSTAS = [
  "Submission Date", "Nome", "Email", "typeA137", "Quarto",
  "Sumo", "Fruta", "Pão", "Ovos", "Iogurte",
  "Bebida quente", "Cereais", "Doce", "Queijo", "Fiambre",
  "Manteiga", "Mel", "Bolo", "Notas", "Alergias",
  "Hora de chegada", "Submission ID", "Edit Link"
];

test("colunaSubmissao_ encontra a coluna do id pelo cabeçalho", () => {
  assert.equal(gs.colunaSubmissao_([CAB_RESPOSTAS]), 21, "coluna V");
  // A JotForm já escreveu este título de mais do que uma maneira, e o dono
  // pode reordenar as colunas à vontade — o que não pode é o script deixar de
  // as encontrar em silêncio.
  assert.equal(gs.colunaSubmissao_([["a", "submission id"]]), 1);
  assert.equal(gs.colunaSubmissao_([["a", "  SubmissionID  "]]), 1);
  assert.equal(gs.colunaSubmissao_([["Submission Date", "Nome"]]), -1,
    "'Submission Date' não é o id");
});

test("colunaDestino_ encontra a coluna da reserva pelo cabeçalho", () => {
  assert.equal(gs.colunaDestino_([CAB_RESPOSTAS]), 3, "coluna D");
  assert.equal(gs.colunaDestino_([["a", "Reserva"]]), 1, "o nome tolerante de sempre");
  assert.equal(gs.colunaDestino_([["a", "q137_typeA137"]]), 1);
});

test("sem coluna, as duas devolvem -1 em vez de adivinharem uma posição", () => {
  // É este -1 que DESLIGA a funcionalidade. Adivinhar seria escrever por cima
  // de respostas de hóspedes.
  assert.equal(gs.colunaSubmissao_([["Nome", "Email"]]), -1);
  assert.equal(gs.colunaDestino_([["Nome", "Email"]]), -1);
  assert.equal(gs.colunaSubmissao_([]), -1, "aba inexistente");
  assert.equal(gs.colunaDestino_([]), -1);
  assert.equal(gs.colunaSubmissao_([["", "", ""]]), -1, "cabeçalho em branco");
});

// Uma linha da aba das respostas com o formato real: 23 colunas, o destino em
// D (índice 3) e o id em V (índice 21).
function respostaFalsa(campos) {
  const fila = [];
  for (let i = 0; i < CAB_RESPOSTAS.length; i++) fila.push("");
  fila[1] = campos.nome === undefined ? "" : campos.nome;
  fila[3] = campos.destino === undefined ? "" : campos.destino;
  fila[21] = campos.id === undefined ? "" : campos.id;
  return fila;
}

function respostasFalsas(linhas) {
  return [CAB_RESPOSTAS].concat(linhas.map(respostaFalsa));
}

// Um submissionID a valer: 19 dígitos, guardado como TEXTO. O segundo difere
// do primeiro no ÚLTIMO dígito — o dígito que um double deita fora.
const ID_ANA = "6437228876324828909";
const ID_RUI = "6437228876324828910";

const IDX_ID = 21;
const IDX_DESTINO = 3;

function reservasComSubmissao() {
  return [
    CAB,
    ["t-ana", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA), "confirmado", "12", "Ana", ID_ANA],
    ["t-rui", "2026-09-08", "08:00-08:45", gs.criadoIso_(AGORA), "confirmado", "7", "Rui", ID_RUI]
  ];
}

test("planoRespostas_ aponta para a linha e a coluna certas da folha (1-based)", () => {
  // A aritmética 0-based→1-based vive toda aqui, e é a de maior consequência
  // desta funcionalidade: um deslize de um escreve a reserva por cima da
  // resposta de um hóspede.
  const submissoes = respostasFalsas([
    { nome: "Zé", id: "9999999999999999999" },
    { nome: "Ana", id: ID_ANA }
  ]);

  assert.deepEqual(
    gs.planoRespostas_(submissoes, reservasComSubmissao(), IDX_ID, IDX_DESTINO),
    [{ linha: 3, coluna: 4, colunaId: 22, id: ID_ANA, valor: "2026-09-08 | 08:45-09:30" }]
  );
});

test("planoRespostas_ não escreve numa linha cujo id não exista no registo", () => {
  // Nunca se inventa um valor a partir da data ou do horário: isso casaria a
  // reserva de um hóspede com a submissão de outro no mesmo slot.
  const submissoes = respostasFalsas([{ id: "9999999999999999999" }, { id: "" }]);
  assert.deepEqual(
    gs.planoRespostas_(submissoes, reservasComSubmissao(), IDX_ID, IDX_DESTINO), []);
});

test("planoRespostas_ preenche só células vazias", () => {
  // É esta guarda que torna a coisa idempotente — e que impede o espelho de
  // escrever por cima de uma correcção feita à mão.
  const submissoes = respostasFalsas([
    { id: ID_ANA, destino: "escrito à mão" },
    { id: ID_RUI, destino: "   " }
  ]);
  assert.deepEqual(
    gs.planoRespostas_(submissoes, reservasComSubmissao(), IDX_ID, IDX_DESTINO),
    [{ linha: 3, coluna: 4, colunaId: 22, id: ID_RUI, valor: "2026-09-08 | 08:00-08:45" }],
    "a de espaços em branco conta como vazia; a escrita fica intacta"
  );
});

test("planoRespostas_ casa um id de 19 dígitos sem perder o último", () => {
  // Se algum dos lados fosse coagido a double, os dois ids — que só diferem no
  // último dígito — normalizariam para a MESMA string e a reserva da Ana
  // aparecia na linha do Rui.
  const submissoes = respostasFalsas([{ id: ID_RUI }]);
  assert.deepEqual(
    gs.planoRespostas_(submissoes, reservasComSubmissao(), IDX_ID, IDX_DESTINO),
    [{ linha: 2, coluna: 4, colunaId: 22, id: ID_RUI, valor: "2026-09-08 | 08:00-08:45" }],
    "a linha do Rui recebe a reserva do Rui"
  );
});

test("normalizarId_ nunca devolve notação científica nem encurta o id", () => {
  const numero = 6437228876324828909;

  // O String() de um double grande devolve a forma mais CURTA que volta ao
  // mesmo número — "…829000" — e deitava fora dígitos que ainda lá estavam.
  assert.equal(gs.normalizarId_(numero), "6437228876324829184");
  assert.notEqual(gs.normalizarId_(numero), String(numero));
  assert.doesNotMatch(gs.normalizarId_(numero), /[eE+]/);
  assert.equal(gs.normalizarId_(numero).length, 19);

  // E uma célula que o Sheets tenha formatado em notação científica.
  assert.doesNotMatch(gs.normalizarId_("6.4372288763248E+18"), /[eE+]/);

  assert.equal(gs.normalizarId_("  " + ID_ANA + "  "), ID_ANA, "texto é texto");
  assert.equal(gs.normalizarId_(null), "");
  assert.equal(gs.normalizarId_(""), "");
});

test("planoRespostas_ casa o mesmo id quando as duas células vêm como número", () => {
  // Um id de 19 dígitos num campo NUMÉRICO já perdeu precisão dentro do
  // Sheets, antes de chegar aqui. O que se garante é que as duas pontas são
  // lidas pela mesma régua: normalizadas em decimal, e nunca em notação
  // científica, casam uma com a outra.
  const numero = 6437228876324828909;
  const reservas = [
    CAB,
    ["t-ana", "2026-09-08", "08:45-09:30", gs.criadoIso_(AGORA), "confirmado", "12", "Ana", numero]
  ];
  const submissoes = respostasFalsas([{ id: numero }]);

  assert.deepEqual(
    gs.planoRespostas_(submissoes, reservas, IDX_ID, IDX_DESTINO),
    [{
      linha: 2, coluna: 4, colunaId: 22,
      id: gs.normalizarId_(numero), valor: "2026-09-08 | 08:45-09:30"
    }]
  );
});

test("planoRespostas_ com uma coluna em -1 não devolve plano nenhum", () => {
  const submissoes = respostasFalsas([{ id: ID_ANA }]);
  const reservas = reservasComSubmissao();
  assert.deepEqual(gs.planoRespostas_(submissoes, reservas, -1, IDX_DESTINO), []);
  assert.deepEqual(gs.planoRespostas_(submissoes, reservas, IDX_ID, -1), []);
});

test("espelharRespostas_ escreve uma vez e correr outra vez não escreve nada", () => {
  const { io, estado } = ioFalso(reservasComSubmissao(), {
    respostas: respostasFalsas([{ nome: "Ana", id: ID_ANA }, { nome: "Rui", id: ID_RUI }])
  });

  assert.equal(gs.espelharRespostas_(io), 2);
  assert.deepEqual(estado.escritasRespostas, [
    [2, 4, "2026-09-08 | 08:45-09:30"],
    [3, 4, "2026-09-08 | 08:00-08:45"]
  ]);

  // Segunda passagem: as células já não estão vazias.
  assert.equal(gs.espelharRespostas_(io), 0);
  assert.equal(estado.escritasRespostas.length, 2);

  // E as outras colunas ficaram exactamente como estavam.
  assert.equal(estado.respostas[1][1], "Ana");
  assert.equal(estado.respostas[1][IDX_ID], ID_ANA);
  assert.equal(estado.respostas.length, 3, "nenhuma linha foi acrescentada");
});

test("sem as colunas, o espelho fica desligado e DIZ que ficou", () => {
  // Uma funcionalidade que se desliga em silêncio é o espelho anterior deste
  // projeto: esteve partido meses porque nada o reportava.
  const { io, estado } = ioFalso(reservasComSubmissao(), {
    respostas: [["Submission Date", "Nome", "Submission ID"], ["x", "Ana", ID_ANA]]
  });

  let escreveu;
  const registo = comRegisto(() => { escreveu = gs.espelharRespostas_(io); });

  assert.equal(escreveu, 0);
  assert.deepEqual(estado.escritasRespostas, [], "nada é escrito sem coluna de destino");
  assert.match(registo, /Espelho desligado/);
  assert.match(registo, /typeA137/);
  assert.match(registo, /as reservas e os lugares não são afectados/);
});

test("sem reservas por espelhar, nem se lê a aba das respostas", () => {
  // Numa instalação nova não há nada para espelhar, e não vale a pena gastar
  // uma leitura da folha — nem encher o registo de avisos — a cada GET.
  let leituras = 0;
  const { io } = ioFalso([CAB, ["t1", "2026-09-08", "08:45-09:30", "x", "activo", "", "", ""]]);
  const original = io.lerRespostas;
  io.lerRespostas = () => { leituras++; return original(); };

  const registo = comRegisto(() => { assert.equal(gs.espelharRespostas_(io), 0); });

  assert.equal(leituras, 0);
  assert.equal(registo, "");
});

test("preparar() nomeia as duas colunas da aba das respostas", () => {
  const livro = livroFalso(
    { "Form responses": [CAB_RESPOSTAS] }, { propriedades: CONFIGURADO });
  const gsComStub = carregarCom(livro.stubs);

  const msg = gsComStub.preparar();

  assert.match(msg, /Coluna do ID: "Submission ID"/);
  assert.match(msg, /Coluna da reserva: "typeA137"/);
  assert.doesNotMatch(msg, /EM FALTA/);
  assert.deepEqual(
    livro.folhas["Form responses"].dados, [CAB_RESPOSTAS],
    "o preparar() lê a aba das respostas e não lhe toca"
  );
});

test("preparar() diz EM FALTA quando alguma das colunas não existe", () => {
  // A funcionalidade fica desligada, e o dono TEM de o saber: um espelho
  // partido em silêncio já custou meses a este projeto.
  const semAba = livroFalso({}, { propriedades: CONFIGURADO });
  const msgSemAba = carregarCom(semAba.stubs).preparar();
  assert.match(msgSemAba, /Coluna do ID: EM FALTA/);
  assert.match(msgSemAba, /Coluna da reserva: EM FALTA/);
  assert.match(msgSemAba, /a reserva não aparece na aba "Form responses"/);
  assert.match(msgSemAba, /as reservas e os lugares não são afectados/);

  // Só uma em falta chega para desligar tudo.
  const semDestino = livroFalso(
    { "Form responses": [["Nome", "Submission ID"]] }, { propriedades: CONFIGURADO });
  const msgSemDestino = carregarCom(semDestino.stubs).preparar();
  assert.match(msgSemDestino, /Coluna do ID: "Submission ID"/);
  assert.match(msgSemDestino, /Coluna da reserva: EM FALTA/);
  assert.match(msgSemDestino, /a reserva não aparece na aba/);
});

test("preparar() diz se o webhook está configurado, sem imprimir o segredo", () => {
  const livro = livroFalso({}, { propriedades: CONFIGURADO });
  const gsComStub = carregarCom(livro.stubs);

  const msg = gsComStub.preparar();

  assert.match(msg, /Segredo do webhook: definido/);
  assert.doesNotMatch(msg, new RegExp(SEGREDO), "o registo é copiável e vai para capturas de ecrã");
  assert.match(msg, new RegExp("Formulário esperado: " + FORM_ID));
  assert.match(msg, /Último webhook recebido: \d{4}-\d{2}-\d{2}T\d{2}:/);
});

test("preparar() avisa quando falta a configuração do webhook", () => {
  const livro = livroFalso({});
  const gsComStub = carregarCom(livro.stubs);

  const msg = gsComStub.preparar();

  assert.match(msg, /Segredo do webhook: EM FALTA/);
  assert.match(msg, /Formulário esperado: EM FALTA/);
  assert.match(msg, /Último webhook recebido: NUNCA/);
  assert.match(msg, /nenhum lugar é libertado/);
});

// ===============================
// O GET NÃO PODE RECONCILIAR EM TODOS OS PEDIDOS
// ===============================

function corpo(resposta) {
  return JSON.parse(resposta.texto);
}

test("algumSlotCheio_ vê o slot cheio e ignora o horário fechado", () => {
  const caps = [{ horario: "08:00-08:45", vagas: 1 }, { horario: "08:45-09:30", vagas: 0 }];
  const vazio = [CAB];
  // O horário de capacidade 0 tem 0 ocupados, logo passaria o >= e punha a
  // reconciliação a correr em todos os GET.
  assert.equal(gs.algumSlotCheio_(vazio, "2026-09-08", caps), false);
  const cheio = [CAB, ["t1", "2026-09-08", "08:00-08:45", "x", "activo", "", ""]];
  assert.equal(gs.algumSlotCheio_(cheio, "2026-09-08", caps), true);
  assert.equal(gs.algumSlotCheio_(cheio, "2026-09-09", caps), false, "só a data pedida");
});

test("doGet não pega no lock quando nenhum slot da data parece cheio", () => {
  const livro = livroFalso(
    { Reservas: [CAB], Capacidades: CAPS_FOLHA },
    { propriedades: CONFIGURADO }
  );
  const gsComStub = carregarCom(livro.stubs);

  const r = corpo(gsComStub.doGet({ parameter: { data: "2026-09-08" } }));

  assert.deepEqual(livro.chamadas.tryLock, [], "reconciliar em cada GET serializa os hóspedes");
  assert.deepEqual(r.slots, [
    { horario: "08:00-08:45", capacidade: 3, restantes: 3 },
    { horario: "08:45-09:30", capacidade: 2, restantes: 2 }
  ]);
});

test("doGet espelha a reserva mesmo sem nenhum slot cheio, e sem pegar no lock", () => {
  // O webhook e a integração do Sheets são independentes: quando o webhook
  // chega, a linha da submissão pode ainda não existir na aba das respostas.
  // É esta passagem que a apanha pouco depois — e por isso NÃO pode estar
  // presa ao caminho do slot cheio, ou a esmagadora maioria das reservas nunca
  // chegava a aparecer ao lado do menu.
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["t1", "2099-01-01", "08:45-09:30", gs.criadoIso_(Date.now() - 5000),
        "confirmado", "12", "Ana", SUBMISSAO]
    ],
    Capacidades: CAPS_FOLHA,
    "Form responses": [CAB_RESPOSTAS, respostaFalsa({ nome: "Ana", id: SUBMISSAO })]
  }, { propriedades: CONFIGURADO });
  const gsComStub = carregarCom(livro.stubs);

  const r = corpo(gsComStub.doGet({ parameter: { data: "2099-01-01" } }));

  assert.equal(livro.folhas["Form responses"].dados[1][3], "2099-01-01 | 08:45-09:30");
  // Sem lock: a escrita é sempre o mesmo valor na mesma célula, numa coluna
  // que mais ninguém escreve. Pegar no lock a cada GET era roubá-lo ao caminho
  // da reserva, que só o espera 3,5 s e falha fechado quando não o consegue.
  assert.deepEqual(livro.chamadas.tryLock, []);
  assert.equal(r.slots[1].restantes, 1, "e as contagens saem na mesma");
});

test("doGet registra a falha do espelho e ainda devolve as contagens", () => {
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["t1", "2099-01-01", "08:45-09:30", gs.criadoIso_(Date.now() - 5000),
        "confirmado", "12", "Ana", SUBMISSAO]
    ],
    Capacidades: CAPS_FOLHA,
    "Form responses": [CAB_RESPOSTAS, respostaFalsa({ id: SUBMISSAO })]
  }, { propriedades: CONFIGURADO, escritaExplosiva: "Form responses" });
  const gsComStub = carregarCom(livro.stubs);

  let r;
  const registo = comRegisto(() => {
    r = corpo(gsComStub.doGet({ parameter: { data: "2099-01-01" } }));
  });

  assert.equal(r.ok, true);
  assert.equal(r.slots[1].restantes, 1);
  assert.match(registo, /Espelho na aba das respostas falhou \(o GET segue\)/);
});

test("doGet reconcilia quando um slot parece cheio, e liberta o lugar órfão", () => {
  const velhoIso = gs.criadoIso_(Date.now() - 60 * 60 * 1000);
  const novoIso = gs.criadoIso_(Date.now() - 60 * 1000);
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["x1", "2099-01-01", "08:45-09:30", velhoIso, "activo", "", ""],
      ["x2", "2099-01-01", "08:45-09:30", novoIso, "activo", "", ""]
    ],
    Capacidades: CAPS_FOLHA
  }, { propriedades: CONFIGURADO });
  const gsComStub = carregarCom(livro.stubs);

  // Sem este caminho, um slot cujos lugares fossem TODOS órfãos aparecia
  // como "Sem vagas", ninguém chegava a submeter contra ele, e a
  // reconciliação do POST nunca corria.
  const r = corpo(gsComStub.doGet({ parameter: { data: "2099-01-01" } }));

  assert.deepEqual(livro.chamadas.tryLock, [5000]);
  assert.equal(livro.chamadas.releaseLock, 1);
  assert.equal(livro.folhas["Reservas"].dados[1][4], "expirado");
  assert.equal(livro.folhas["Reservas"].dados[2][4], "activo");
  // E as contagens devolvidas já refletem a libertação, no mesmo pedido.
  assert.equal(r.slots[1].restantes, 1);
});

test("doGet não liberta nada enquanto não tiver chegado nenhum webhook", () => {
  const velhoIso = gs.criadoIso_(Date.now() - 60 * 60 * 1000);
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["x1", "2099-01-01", "08:45-09:30", velhoIso, "activo", "", ""],
      ["x2", "2099-01-01", "08:45-09:30", velhoIso, "activo", "", ""]
    ],
    Capacidades: CAPS_FOLHA
  }, { propriedades: { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID } });
  const gsComStub = carregarCom(livro.stubs);

  let r;
  const registo = comRegisto(() => {
    r = corpo(gsComStub.doGet({ parameter: { data: "2099-01-01" } }));
  });

  assert.equal(livro.folhas["Reservas"].dados[1][4], "activo");
  assert.equal(livro.folhas["Reservas"].dados[2][4], "activo");
  assert.equal(r.slots[1].restantes, 0);
  assert.match(registo, /não chegou nenhum webhook/);
});

test("doGet registra a falha da reconciliação e ainda devolve as contagens", () => {
  const velhoIso = gs.criadoIso_(Date.now() - 60 * 60 * 1000);
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["x1", "2099-01-01", "08:45-09:30", velhoIso, "activo", "", ""],
      ["x2", "2099-01-01", "08:45-09:30", velhoIso, "activo", "", ""]
    ],
    Capacidades: CAPS_FOLHA
  }, { propriedades: CONFIGURADO, escritaExplosiva: "Reservas" });
  const gsComStub = carregarCom(livro.stubs);

  let r;
  const registo = comRegisto(() => {
    r = corpo(gsComStub.doGet({ parameter: { data: "2099-01-01" } }));
  });

  // Reconciliar é oportunista e a falha não pode travar o GET — mas engolir
  // o erro em silêncio escondia uma reconciliação que nunca funciona atrás
  // de um GET aparentemente perfeito.
  assert.equal(r.ok, true);
  assert.equal(r.slots[1].restantes, 0, "a libertação não aconteceu");
  assert.match(registo, /Reconciliação no GET falhou/);
  assert.equal(livro.chamadas.releaseLock, 1, "o lock tem de sair mesmo assim");
});

test("doGet rejeita uma data inválida sem tocar na folha", () => {
  const livro = livroFalso({ Reservas: [CAB], Capacidades: CAPS_FOLHA });
  const gsComStub = carregarCom(livro.stubs);
  assert.deepEqual(corpo(gsComStub.doGet({ parameter: { data: "8/9/2026" } })), {
    ok: false, erro: "data_invalida"
  });
  assert.deepEqual(corpo(gsComStub.doGet({})), { ok: false, erro: "data_invalida" });
  assert.deepEqual(livro.chamadas.tryLock, []);
});

test("doGet devolve capacidades_ilegiveis quando a aba não se lê", () => {
  const livro = livroFalso({ Reservas: [CAB], Capacidades: [["horario", "vagas"]] });
  const gsComStub = carregarCom(livro.stubs);
  assert.deepEqual(corpo(gsComStub.doGet({ parameter: { data: "2099-01-01" } })), {
    ok: false, erro: "capacidades_ilegiveis"
  });
});

test("a resposta sai marcada como JSON", () => {
  const livro = livroFalso({ Reservas: [CAB], Capacidades: CAPS_FOLHA });
  const gsComStub = carregarCom(livro.stubs);
  const resposta = gsComStub.doGet({ parameter: { data: "2099-01-01" } });
  assert.equal(resposta.mime, "application/json");
});

test("doGet ainda devolve contagens quando não consegue o lock", () => {
  const velhoIso = gs.criadoIso_(Date.now() - 60 * 60 * 1000);
  const livro = livroFalso(
    {
      Reservas: [
        CAB,
        ["x1", "2099-01-01", "08:45-09:30", velhoIso, "activo", "", ""],
        ["x2", "2099-01-01", "08:45-09:30", velhoIso, "activo", "", ""]
      ],
      Capacidades: CAPS_FOLHA
    },
    { lockIndisponivel: true, propriedades: CONFIGURADO }
  );
  const gsComStub = carregarCom(livro.stubs);

  const r = corpo(gsComStub.doGet({ parameter: { data: "2099-01-01" } }));

  // O slot parece cheio, logo tenta o lock; não o consegue e salta a
  // reconciliação. As contagens ficam no máximo ligeiramente velhas — a
  // decisão que conta é sempre a do POST, dentro do lock.
  assert.deepEqual(livro.chamadas.tryLock, [5000]);
  assert.equal(livro.chamadas.releaseLock, 0);
  assert.equal(r.ok, true);
  assert.equal(r.slots[1].restantes, 0);
  assert.equal(livro.folhas["Reservas"].dados[1][4], "activo");
});

// ===============================
// A CASCA HTTP (doPost)
// ===============================
// É nesta casca que todo o desenho se apoia: o mutex, o release no finally,
// o salto oportunista quando o tryLock falha e a leitura do corpo. E é aqui
// que os dois tipos de pedido se distinguem: o widget manda JSON com `acao`,
// a JotForm manda form-encoded com formID e rawRequest.

function post(gsComStub, corpoTexto) {
  return corpo(gsComStub.doPost({ postData: { contents: corpoTexto } }));
}

const PEDIDO_TEXTO = JSON.stringify({
  acao: "reservar", token: "abcd-1234-efgh", data: "2099-01-01", horario: "08:45-09:30"
});

test("doPost reserva, larga o lock e espera-o só pelo orçamento do cliente", () => {
  const livro = livroFalso({ Reservas: [CAB], Capacidades: CAPS_FOLHA });
  const gsComStub = carregarCom(livro.stubs);

  const r = post(gsComStub, PEDIDO_TEXTO);

  assert.deepEqual(r, { ok: true, reservado: true, estado: "novo" });
  // 3500 ms: tem de caber no ORCAMENTO_RESERVA_MS de 5 s do widget, senão
  // o cliente desiste e o servidor reserva de qualquer modo.
  assert.deepEqual(livro.chamadas.tryLock, [3500]);
  assert.equal(livro.chamadas.releaseLock, 1, "o lock tem de ser largado sempre");
  assert.equal(livro.folhas["Reservas"].dados.length, 2);
  assert.equal(livro.chamadas.flush, 1);
});

test("doPost larga o lock mesmo quando o reservar_ estoura", () => {
  // Um lock retido é pior do que um erro: bloqueia todos os hóspedes
  // seguintes até o Apps Script o libertar por sua conta.
  const livro = livroFalso(
    { Reservas: [CAB], Capacidades: CAPS_FOLHA },
    { abaExplosiva: "Capacidades" }
  );
  const gsComStub = carregarCom(livro.stubs);

  assert.deepEqual(post(gsComStub, PEDIDO_TEXTO), { ok: false, erro: "erro_interno" });
  assert.equal(livro.chamadas.releaseLock, 1);
});

test("doPost devolve lock_indisponivel quando o tryLock falha", () => {
  const livro = livroFalso(
    { Reservas: [CAB], Capacidades: CAPS_FOLHA },
    { lockIndisponivel: true }
  );
  const gsComStub = carregarCom(livro.stubs);

  assert.deepEqual(post(gsComStub, PEDIDO_TEXTO), { ok: false, erro: "lock_indisponivel" });
  // Nada foi escrito, e não se larga um lock que não se tem.
  assert.equal(livro.folhas["Reservas"].dados.length, 1);
  assert.equal(livro.chamadas.releaseLock, 0);
});

test("doPost responde JSON a um corpo de literal null", () => {
  // O JSON.parse("null") tem sucesso, e o pedido.acao logo a seguir — já
  // fora do try — levantava um TypeError: o Apps Script devolvia uma
  // página HTML de erro em vez de JSON, e o widget não sabe ler isso.
  const livro = livroFalso({ Reservas: [CAB], Capacidades: CAPS_FOLHA });
  const gsComStub = carregarCom(livro.stubs);

  assert.deepEqual(post(gsComStub, "null"), { ok: false, erro: "acao_desconhecida" });
  assert.deepEqual(post(gsComStub, "123"), { ok: false, erro: "acao_desconhecida" });
  assert.deepEqual(livro.chamadas.tryLock, [], "nem vale a pena pegar no lock");
});

test("doPost trata um corpo ilegível e um corpo ausente", () => {
  const livro = livroFalso({ Reservas: [CAB], Capacidades: CAPS_FOLHA });
  const gsComStub = carregarCom(livro.stubs);

  assert.deepEqual(post(gsComStub, "{isto não é json"), { ok: false, erro: "corpo_invalido" });
  // Sem postData nenhum o corpo cai para "{}", que não tem acao.
  assert.deepEqual(corpo(gsComStub.doPost({})), { ok: false, erro: "acao_desconhecida" });
  assert.deepEqual(corpo(gsComStub.doPost()), { ok: false, erro: "acao_desconhecida" });
});

test("doPost deixa rasto quando um webhook chega por outro caminho", () => {
  // A JotForm manda form-encoded, que o Apps Script desdobra em e.parameter.
  // Se um dia mandar multipart (basta um campo de ficheiro no formulário), o
  // e.parameter vem vazio, nada é confirmado e a reconciliação fica
  // desarmada para sempre — sem nada onde olhar.
  const livro = livroFalso({ Reservas: [CAB], Capacidades: CAPS_FOLHA });
  const gsComStub = carregarCom(livro.stubs);

  let r;
  const registo = comRegisto(() => {
    r = corpo(gsComStub.doPost({
      postData: { type: "multipart/form-data", contents: 'name="rawRequest"' }
    }));
  });

  // O corpo nem sequer é JSON, logo a resposta é a do corpo ilegível — o que
  // interessa é que fica escrito que aquilo parecia um webhook.
  assert.deepEqual(r, { ok: false, erro: "corpo_invalido" });
  assert.match(registo, /parece um webhook/);
  assert.match(registo, /multipart/);
});

test("doPost propaga a recusa de um slot cheio", () => {
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["x1", "2099-01-01", "08:45-09:30", gs.criadoIso_(Date.now()), "activo", "", ""],
      ["x2", "2099-01-01", "08:45-09:30", gs.criadoIso_(Date.now()), "confirmado", "12", "Ana"]
    ],
    Capacidades: CAPS_FOLHA
  }, { propriedades: CONFIGURADO });
  const gsComStub = carregarCom(livro.stubs);

  assert.deepEqual(post(gsComStub, PEDIDO_TEXTO), {
    ok: true, reservado: false, motivo: "cheio", restantes: 0
  });
  assert.equal(livro.chamadas.releaseLock, 1);
});

// ===============================
// O WEBHOOK PELA CASCA HTTP
// ===============================

test("doPost encaminha um webhook da JotForm e confirma a linha, dentro do lock", () => {
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["velho1", "2026-09-08", "08:45-09:30", gs.criadoIso_(Date.now() - 5000), "activo", "", ""]
    ],
    Capacidades: CAPS_FOLHA
  }, { propriedades: { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID } });
  const gsComStub = carregarCom(livro.stubs);

  const r = corpo(gsComStub.doPost({
    parameter: webhook(),
    postData: { type: "application/x-www-form-urlencoded", contents: "formID=" + FORM_ID }
  }));

  assert.deepEqual(r, { ok: true, confirmado: true });
  const linha = livro.folhas["Reservas"].dados[1];
  assert.equal(linha[4], "confirmado");
  assert.equal(linha[5], "12");
  assert.equal(linha[6], "Ana Silva");
  assert.equal(linha[7], SUBMISSAO, "a chave que liga esta reserva à aba das respostas");
  // O mesmo mutex da reserva, com a espera do webhook, e sempre largado.
  assert.deepEqual(livro.chamadas.tryLock, [10000]);
  assert.equal(livro.chamadas.releaseLock, 1);
  // E a marca fica nas propriedades do script: é ela que arma a reconciliação.
  assert.match(livro.propriedades.ultimoWebhook, ISO_UTC);
});

test("uma confirmação espelha a reserva na aba das respostas, dentro do mesmo lock", () => {
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["t1", "2099-01-01", "08:45-09:30", gs.criadoIso_(Date.now() - 5000), "activo", "", "", ""]
    ],
    Capacidades: CAPS_FOLHA,
    "Form responses": [
      CAB_RESPOSTAS,
      respostaFalsa({ nome: "Zé", id: "9999999999999999999" }),
      respostaFalsa({ nome: "Ana Silva", id: SUBMISSAO })
    ]
  }, { propriedades: { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID } });
  const gsComStub = carregarCom(livro.stubs);

  const r = corpo(gsComStub.doPost({
    parameter: webhook({ rawRequest: raw("2099-01-01 | 08:45-09:30") }),
    postData: { type: "application/x-www-form-urlencoded", contents: "formID=" + FORM_ID }
  }));

  assert.deepEqual(r, { ok: true, confirmado: true });
  const respostas = livro.folhas["Form responses"].dados;
  assert.equal(respostas[2][3], "2099-01-01 | 08:45-09:30", "a linha da Ana, coluna D");
  assert.equal(respostas[1][3], "", "a linha sem reserva correspondente fica vazia");
  assert.equal(respostas.length, 3, "nenhuma linha é acrescentada nem apagada");
  // Tudo dentro do mutex que o webhook já tinha tomado — não se pega noutro.
  assert.deepEqual(livro.chamadas.tryLock, [10000]);
  assert.equal(livro.chamadas.releaseLock, 1);
});

test("um espelho que estoira não transforma uma confirmação boa numa recusa", () => {
  // Se este erro subisse, a resposta era {ok:false}, a JotForm repetia a
  // entrega e o anel anti-repetição já não a deixava confirmar nada: uma
  // reserva a valer perdida por causa de uma coluna de conveniência.
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["t1", "2099-01-01", "08:45-09:30", gs.criadoIso_(Date.now() - 5000), "activo", "", "", ""]
    ],
    Capacidades: CAPS_FOLHA,
    "Form responses": [CAB_RESPOSTAS, respostaFalsa({ id: SUBMISSAO })]
  }, {
    propriedades: { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID },
    escritaExplosiva: "Form responses"
  });
  const gsComStub = carregarCom(livro.stubs);

  let r;
  const registo = comRegisto(() => {
    r = corpo(gsComStub.doPost({
      parameter: webhook({ rawRequest: raw("2099-01-01 | 08:45-09:30") }),
      postData: { type: "application/x-www-form-urlencoded", contents: "formID=" + FORM_ID }
    }));
  });

  assert.deepEqual(r, { ok: true, confirmado: true });
  assert.equal(livro.folhas["Reservas"].dados[1][4], "confirmado");
  assert.match(registo, /Espelho na aba das respostas falhou/);
  assert.equal(livro.chamadas.releaseLock, 1);
});

test("doPost recusa um webhook com o segredo errado sem tocar na folha", () => {
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["velho1", "2026-09-08", "08:45-09:30", gs.criadoIso_(Date.now() - 5000), "activo", "", ""]
    ],
    Capacidades: CAPS_FOLHA
  }, { propriedades: { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID } });
  const gsComStub = carregarCom(livro.stubs);

  let r;
  comRegisto(() => {
    r = corpo(gsComStub.doPost({ parameter: webhook({ k: "errado" }) }));
  });

  // A resposta não diz O QUE falhou: dizê-lo era anunciar a quem estivesse a
  // adivinhar o segredo o instante em que acertou.
  assert.deepEqual(r, { ok: false });
  assert.equal(livro.folhas["Reservas"].dados[1][4], "activo");
  assert.equal(livro.propriedades.ultimoWebhook, undefined, "não arma a reconciliação");
  // E sobretudo: NÃO pega no lock. Antes pegava, e um POST anónimo com
  // rawRequest ficava dez segundos na fila do mutex — ver o teste seguinte.
  assert.deepEqual(livro.chamadas.tryLock, [], "um pedido não autenticado não espera pelo mutex");
  assert.equal(livro.chamadas.releaseLock, 0, "não se larga um lock que não se tem");
});

test("um POST anónimo com rawRequest não chega a pegar no lock das reservas", () => {
  // O endereço do web app é público por desenho. Enquanto o lock vinha antes
  // da autenticação, cada pedido destes ocupava a fila do mutex por dez
  // segundos: alguns por segundo e as reservas verdadeiras (que esperam 3,5 s)
  // recebiam lock_indisponivel — e o widget falha fechado de propósito, pelo
  // que o formulário deixava de aceitar reservas.
  const livro = livroFalso({
    Reservas: [CAB, ["v", "2026-09-08", "08:45-09:30", gs.criadoIso_(Date.now()), "activo", "", ""]],
    Capacidades: CAPS_FOLHA
  }, { propriedades: { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID } });
  const gsComStub = carregarCom(livro.stubs);

  comRegisto(() => {
    // Sem `k` nenhum, e depois com o formulário errado.
    gsComStub.doPost({ parameter: { formID: FORM_ID, rawRequest: raw() } });
    gsComStub.doPost({ parameter: webhook({ formID: "999" }) });
  });

  assert.deepEqual(livro.chamadas.tryLock, [], "nem uma tentativa de lock");
  assert.equal(livro.folhas["Reservas"].dados[1][4], "activo");
  assert.equal(livro.propriedades.ultimoWebhook, undefined);
});

test("as propriedades do webhook não são lidas duas vezes por engano", () => {
  // O doPost corre o portão e passa o MESMO io ao confirmarWebhook_, que o
  // volta a correr (para ser seguro chamado sozinho). O que não pode é
  // divergir: o mesmo pedido tem de dar a mesma resposta pelos dois caminhos.
  const livro = livroFalso({
    Reservas: [CAB, ["v", "2026-09-08", "08:45-09:30", gs.criadoIso_(Date.now()), "activo", "", ""]],
    Capacidades: CAPS_FOLHA
  }, { propriedades: { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID } });
  const gsComStub = carregarCom(livro.stubs);

  const r = corpo(gsComStub.doPost({ parameter: webhook() }));

  assert.deepEqual(r, { ok: true, confirmado: true });
  assert.equal(livro.folhas["Reservas"].dados[1][4], "confirmado");
});

test("a recusa do webhook é sempre igual, seja o que for que falhou", () => {
  // Distinguir `segredo_invalido` de `formulario_inesperado` dizia a quem
  // estivesse a adivinhar o segredo o instante exacto em que acertou — e nada
  // aqui o limita em tentativas. O `webhook_nao_configurado` anunciava até que
  // não há segredo nenhum definido.
  const semReserva = JSON.stringify({ q3_nome: "Ana" });
  const casos = [
    ["segredo errado", { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID }, webhook({ k: "errado" })],
    ["formulário errado", { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID }, webhook({ formID: "999" })],
    ["sem segredo definido", { formIdEsperado: FORM_ID }, webhook()],
    ["sem formulário definido", { segredoWebhook: SEGREDO }, webhook()],
    ["reserva ilegível", { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID },
      webhook({ rawRequest: semReserva })]
  ];

  const respostas = casos.map(([, propriedades, params]) => {
    const livro = livroFalso({ Reservas: [CAB], Capacidades: CAPS_FOLHA }, { propriedades });
    const gsComStub = carregarCom(livro.stubs);
    let r;
    const registo = comRegisto(() => { r = corpo(gsComStub.doPost({ parameter: params })); });
    // E o detalhe fica no registo, onde o dono o lê e um estranho não.
    assert.match(registo, /Webhook recusado|não encontrei/);
    return r;
  });

  respostas.forEach((r, i) => {
    assert.deepEqual(r, { ok: false }, casos[i][0] + " não pode dizer o que falhou");
  });
});

test("doPost recusa o webhook sem confirmar às cegas quando não tem o lock", () => {
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["velho1", "2026-09-08", "08:45-09:30", gs.criadoIso_(Date.now() - 5000), "activo", "", ""]
    ],
    Capacidades: CAPS_FOLHA
  }, {
    lockIndisponivel: true,
    propriedades: { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID }
  });
  const gsComStub = carregarCom(livro.stubs);

  let r;
  const registo = comRegisto(() => { r = corpo(gsComStub.doPost({ parameter: webhook() })); });

  assert.deepEqual(r, { ok: false });
  assert.equal(livro.folhas["Reservas"].dados[1][4], "activo");
  assert.equal(livro.chamadas.releaseLock, 0);
  // O motivo fica no registo, que é onde o dono o lê.
  assert.match(registo, /não conseguiu o lock/);
});

test("doPost larga o lock quando a confirmação estoura", () => {
  const livro = livroFalso({
    Reservas: [CAB, ["v", "2026-09-08", "08:45-09:30", "x", "activo", "", ""]],
    Capacidades: CAPS_FOLHA
  }, {
    abaExplosiva: "Reservas",
    propriedades: { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID }
  });
  const gsComStub = carregarCom(livro.stubs);

  let r;
  const registo = comRegisto(() => { r = corpo(gsComStub.doPost({ parameter: webhook() })); });

  assert.deepEqual(r, { ok: false });
  assert.equal(livro.chamadas.releaseLock, 1);
  assert.match(registo, /Webhook falhou/);
});

// ===============================
// AS FUNÇÕES DE MANUTENÇÃO TAMBÉM PRECISAM DO LOCK
// ===============================

test("preparar() corre dentro do lock e larga-o", () => {
  const livro = livroFalso({});
  const gsComStub = carregarCom(livro.stubs);
  gsComStub.preparar();
  assert.deepEqual(livro.chamadas.tryLock, [20000]);
  assert.equal(livro.chamadas.releaseLock, 1);
});

test("limparTestes() apaga só as linhas de teste, dentro do lock", () => {
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["conc-teste-1", "2099-01-01", "08:00-08:45", "x", "activo", "", ""],
      ["abcd-1234-efgh", "2099-01-01", "08:00-08:45", "x", "activo", "", ""],
      ["conc-teste-2", "2099-01-01", "08:00-08:45", "x", "activo", "", ""]
    ],
    Capacidades: CAPS_FOLHA
  });
  const gsComStub = carregarCom(livro.stubs);

  assert.match(gsComStub.limparTestes(), /apagadas: 2/);
  // O deleteRow desloca índices: é por isso que isto precisa do mesmo lock
  // que o doPost, que já pode ter calculado o seu plano.
  assert.deepEqual(livro.folhas["Reservas"].dados.map(l => l[0]), ["token", "abcd-1234-efgh"]);
  assert.deepEqual(livro.chamadas.tryLock, [20000]);
  assert.equal(livro.chamadas.releaseLock, 1);
});

test("as funções de manutenção não mexem na folha sem o lock", () => {
  const abas = {
    Reservas: [CAB, ["conc-teste-1", "2099-01-01", "08:00-08:45", "x", "activo", "", ""]],
    Capacidades: CAPS_FOLHA
  };
  const livro = livroFalso(abas, { lockIndisponivel: true });
  const gsComStub = carregarCom(livro.stubs);

  assert.match(gsComStub.preparar(), /ocupada/);
  assert.match(gsComStub.limparTestes(), /ocupada/);
  // Nada mudou: nem cabeçalhos, nem apagamentos.
  assert.equal(livro.folhas["Reservas"].dados.length, 2);
  assert.equal(livro.chamadas.releaseLock, 0);
});

// ===============================
// ioReal_ (E/S real, com SpreadsheetApp esboçado)
// ===============================
// Estes testes carregam o .gs de novo com um SpreadsheetApp falso, porque o
// `gs` do topo do ficheiro já foi carregado sem stub nenhum — o parâmetro
// SpreadsheetApp fica preso ao valor (undefined) que tinha nessa altura.

test("ioReal_.acrescentar dá flush depois do appendRow", () => {
  // Sem o flush, o doPost pode largar o lock antes de o appendRow ficar
  // visível, e o pedido seguinte lê a folha sem ver o lugar já ocupado.
  const chamadas = { appendRow: [], flush: 0 };
  const folhaFalsa = {
    getLastRow: () => 1, // aba já tem cabeçalho: não há que semear nada aqui
    appendRow: linha => chamadas.appendRow.push(linha)
  };
  const ssFalso = { getSheetByName: () => folhaFalsa, insertSheet: () => folhaFalsa };
  const gsComStub = carregarGs(CAMINHO_GS, {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ssFalso,
      flush: () => { chamadas.flush++; }
    }
  });

  gsComStub.ioReal_().acrescentar(["t1", "2026-09-08", "08:00-08:45", "x", "activo", "", ""]);

  assert.equal(chamadas.appendRow.length, 1);
  assert.equal(chamadas.flush, 1);
});

test("ioReal_ semeia o cabeçalho numa aba Reservas vazia, e lerReservas trata [] como vazia", () => {
  // Uma aba que existe mas não tem linhas devolve [] de lerTudo_, que é
  // verdadeiro em JS — sem tratar este caso à parte, a primeira reserva
  // acrescentada ficaria na linha do cabeçalho e nunca seria contada.
  const linhas = [];
  const folhaFalsa = {
    getLastRow: () => linhas.length,
    getLastColumn: () => (linhas[0] || []).length,
    appendRow: linha => linhas.push(linha.slice())
  };
  const ssFalso = { getSheetByName: () => folhaFalsa, insertSheet: () => folhaFalsa };
  const gsComStub = carregarGs(CAMINHO_GS, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssFalso, flush: () => {} }
  });
  const io = gsComStub.ioReal_();

  assert.deepEqual(io.lerReservas(), [CAB]);

  io.acrescentar(["t1", "2026-09-08", "08:00-08:45", "x", "activo", "", ""]);

  assert.deepEqual(linhas[0], CAB);
  assert.equal(linhas.length, 2);
});

test("ioReal_.expirar converte índice 0-based em linha/coluna 1-based da folha", () => {
  // A aritmética (índice + 1, COL_ESTADO + 1) é a de maior consequência do
  // ficheiro — está correta "por inspeção", mas isso não chega: fica pinada
  // aqui contra uma folha falsa que grava as chamadas a getRange.
  const chamadasGetRange = [];
  const folhaFalsa = {
    getRange: (linha, coluna) => {
      chamadasGetRange.push([linha, coluna]);
      return { setValue: () => {} };
    }
  };
  const ssFalso = { getSheetByName: () => folhaFalsa, insertSheet: () => folhaFalsa };
  const gsComStub = carregarGs(CAMINHO_GS, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssFalso, flush: () => {} }
  });

  gsComStub.ioReal_().expirar([1]);

  // índice 1 (a segunda linha do array, cabeçalho incluído) → linha 2 da
  // folha; COL_ESTADO = 4 → coluna 5.
  assert.deepEqual(chamadasGetRange, [[2, 5]]);
});

test("ioReal_.confirmar escreve o estado primeiro, e depois quarto, nome e submissao", () => {
  // A ordem é deliberada: é o estado que protege o lugar da reconciliação.
  // Se a escrita falhar a meio, mais vale um lugar protegido sem nome do que
  // um nome guardado numa linha que ainda vai ser revendida.
  const escritas = [];
  const folhaFalsa = {
    getRange: (linha, coluna) => ({
      setValue: v => { escritas.push([linha, coluna, v]); }
    })
  };
  const ssFalso = { getSheetByName: () => folhaFalsa, insertSheet: () => folhaFalsa };
  let flushes = 0;
  const gsComStub = carregarGs(CAMINHO_GS, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssFalso, flush: () => { flushes++; } }
  });

  gsComStub.ioReal_().confirmar(1, "12", "Ana Silva", SUBMISSAO);

  // índice 1 → linha 2; COL_ESTADO = 4 → coluna 5; COL_QUARTO = 5 → 6;
  // COL_NOME = 6 → 7; COL_SUBMISSAO = 7 → coluna 8. Um deslize de um aqui
  // escrevia o id da submissão por cima do nome do hóspede.
  assert.deepEqual(escritas, [
    [2, 5, "confirmado"],
    [2, 6, "12"],
    [2, 7, "Ana Silva"],
    [2, 8, SUBMISSAO]
  ]);
  assert.equal(flushes, 1);
});

test("ioReal_.confirmar grava vazio quando o webhook não trouxe submissionID", () => {
  // O setValue(undefined) do Apps Script não é o mesmo que uma célula vazia, e
  // uma célula que o getValues devolva como undefined faz o normalizarId_
  // trabalhar sobre "undefined" — um id que casaria com outro igualmente vazio.
  const escritas = [];
  const folhaFalsa = {
    getRange: (linha, coluna) => ({
      setValue: v => { escritas.push([linha, coluna, v]); }
    })
  };
  const ssFalso = { getSheetByName: () => folhaFalsa, insertSheet: () => folhaFalsa };
  const gsComStub = carregarGs(CAMINHO_GS, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssFalso, flush: () => {} }
  });

  gsComStub.ioReal_().confirmar(1, "12", "Ana Silva");

  assert.deepEqual(escritas[3], [2, 8, ""]);
});

test("ioReal_.escreverRespostas escreve célula a célula e não mexe em mais nada", () => {
  // A aba das respostas é da integração do JotForm. A única coisa que aqui
  // fazemos é preencher células vazias de UMA coluna: nunca inserir nem apagar
  // linhas ou colunas, nunca escrever noutra coluna.
  const chamadas = { getRange: [], escritas: [] };
  const proibido = nome => () => { throw new Error("escreverRespostas chamou " + nome); };
  // As duas linhas ainda estão onde o plano as deixou, e o destino continua
  // vazio: as duas reconfirmações passam.
  const celulas = { "3|22": ID_ANA, "9|22": ID_RUI };
  const folhaFalsa = {
    getRange: (linha, coluna) => {
      chamadas.getRange.push([linha, coluna]);
      const chave = linha + "|" + coluna;
      return {
        getValue: () => (chave in celulas ? celulas[chave] : ""),
        setValue: v => { chamadas.escritas.push(v); }
      };
    },
    appendRow: proibido("appendRow"),
    deleteRow: proibido("deleteRow"),
    insertRows: proibido("insertRows"),
    insertColumns: proibido("insertColumns")
  };
  const ssFalso = { getSheetByName: () => folhaFalsa, insertSheet: proibido("insertSheet") };
  let flushes = 0;
  const gsComStub = carregarGs(CAMINHO_GS, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssFalso, flush: () => { flushes++; } }
  });

  gsComStub.ioReal_().escreverRespostas([
    { linha: 3, coluna: 4, colunaId: 22, id: ID_ANA, valor: "2026-09-08 | 08:45-09:30" },
    { linha: 9, coluna: 4, colunaId: 22, id: ID_RUI, valor: "2026-09-09 | 08:00-08:45" }
  ]);

  // As coordenadas vêm do plano tal como estão: o io não faz aritmética
  // nenhuma, e por isso não pode enganar-se num índice. Por cada entrada, uma
  // leitura do id e uma única célula de destino, lida e escrita.
  assert.deepEqual(chamadas.getRange, [[3, 22], [3, 4], [9, 22], [9, 4]]);
  assert.deepEqual(chamadas.escritas,
    ["2026-09-08 | 08:45-09:30", "2026-09-09 | 08:00-08:45"]);
  assert.equal(flushes, 1);
});

test("o dono ordenou as linhas entre o plano e a escrita: não se escreve na linha errada", () => {
  // O plano é calculado sobre números de linha lidos momentos antes, e a
  // escrita corre SEM lock (de propósito: ver o doGet). A integração do
  // JotForm só acrescenta linhas ao fim, mas o dono não — o guia ensina
  // ordenar como gesto normal do dia a dia. Se ele ordenar ou apagar uma linha
  // dentro dessa janela, a escrita cairia na linha de OUTRO hóspede.
  const livro = livroFalso({
    "Form responses": respostasFalsas([
      { nome: "Ana", id: ID_ANA },
      { nome: "Rui", id: ID_RUI }
    ])
  });
  const gsComStub = carregarCom(livro.stubs);
  const respostas = livro.folhas["Form responses"].dados;

  const plano = gsComStub.planoRespostas_(
    respostas, reservasComSubmissao(), IDX_ID, IDX_DESTINO);
  assert.equal(plano.length, 2, "as duas linhas entram no plano");

  // E agora o dono ordena a aba: a Ana e o Rui trocam de linha.
  const trocada = respostas[1];
  respostas[1] = respostas[2];
  respostas[2] = trocada;

  gsComStub.ioReal_().escreverRespostas(plano);

  assert.equal(respostas[1][IDX_DESTINO], "", "a linha do Rui não recebe a reserva da Ana");
  assert.equal(respostas[2][IDX_DESTINO], "", "nem a da Ana a do Rui");
});

test("uma célula de destino que ganhou valor entre o plano e a escrita fica intacta", () => {
  // A mesma janela, o outro lado: o `planoRespostas_` só escolhe células
  // vazias, mas entre o plano e a escrita alguém pode ter escrito ali à mão —
  // e uma correcção do dono nunca pode ser apagada por nós.
  const livro = livroFalso({
    "Form responses": respostasFalsas([
      { nome: "Ana", id: ID_ANA },
      { nome: "Rui", id: ID_RUI }
    ])
  });
  const gsComStub = carregarCom(livro.stubs);
  const respostas = livro.folhas["Form responses"].dados;

  const plano = gsComStub.planoRespostas_(
    respostas, reservasComSubmissao(), IDX_ID, IDX_DESTINO);
  respostas[1][IDX_DESTINO] = "escrito à mão";

  gsComStub.ioReal_().escreverRespostas(plano);

  assert.equal(respostas[1][IDX_DESTINO], "escrito à mão");
  assert.equal(respostas[2][IDX_DESTINO], "2026-09-08 | 08:00-08:45",
    "e a outra linha é escrita na mesma");
});

test("ioReal_.escreverRespostas não cria a aba das respostas quando ela não existe", () => {
  // Uma aba nossa com este nome faria a integração do JotForm criar outra ao
  // lado, e o dono ficava com duas abas de respostas e nenhuma completa.
  const ssFalso = {
    getSheetByName: () => null,
    insertSheet: () => { throw new Error("não se cria a aba das respostas"); }
  };
  let flushes = 0;
  const gsComStub = carregarGs(CAMINHO_GS, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssFalso, flush: () => { flushes++; } }
  });

  gsComStub.ioReal_().escreverRespostas([{ linha: 3, coluna: 4, valor: "x" }]);
  assert.equal(flushes, 0);
});

test("ioReal_ lê o segredo e o formulário das propriedades do script", () => {
  // Nunca do ficheiro: este código vive num repositório público, e quem
  // soubesse o segredo podia forjar confirmações e tornar uma reserva falsa
  // impossível de libertar.
  const guardadas = { segredoWebhook: SEGREDO, formIdEsperado: FORM_ID };
  const gsComStub = carregarGs(CAMINHO_GS, {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in guardadas ? guardadas[k] : null),
        setProperty: (k, v) => { guardadas[k] = v; }
      })
    }
  });
  const io = gsComStub.ioReal_();

  assert.equal(io.segredo(), SEGREDO);
  assert.equal(io.formIdEsperado(), FORM_ID);
  assert.equal(io.ultimoWebhook(), null);

  io.gravarUltimoWebhook(AGORA);
  assert.equal(guardadas.ultimoWebhook, new Date(AGORA).toISOString());
  assert.equal(io.ultimoWebhook(), new Date(AGORA).toISOString());

  // E o anel das submissões já confirmadas, que reconhece uma entrega
  // repetida sem gastar uma coluna da folha.
  assert.equal(io.submissoesVistas(), null);
  io.gravarSubmissoesVistas("6000000000000000001");
  assert.equal(guardadas.submissoesConfirmadas, "6000000000000000001");
  assert.equal(io.submissoesVistas(), "6000000000000000001");
});
