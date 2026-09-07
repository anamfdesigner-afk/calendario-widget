import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarGs } from "./carregar.mjs";

const gs = carregarGs(new URL("../reservas.gs", import.meta.url).pathname);

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

const CAB = ["token", "data", "horario", "criado", "estado"];
const CAPS = [
  { horario: "08:00-08:45", vagas: 3 },
  { horario: "08:45-09:30", vagas: 2 }
];

test("normalizarData_ aceita Date e ISO completo", () => {
  assert.equal(gs.normalizarData_("2025-12-31"), "2025-12-31");
  assert.equal(gs.normalizarData_("2025-12-31T00:00:00.000Z"), "2025-12-31");
  // O Sheets devolve células de data como Date. Usamos os getters locais
  // porque o fuso do projeto é Europe/Lisbon.
  assert.equal(gs.normalizarData_(new Date(2026, 8, 8, 12, 0, 0)), "2026-09-08");
  assert.equal(gs.normalizarData_(""), "");
  assert.equal(gs.normalizarData_(null), "");
});

test("normalizarReserva_ tolera espaçamento à volta do separador", () => {
  assert.equal(gs.normalizarReserva_("2026-09-08|08:00-08:45"), "2026-09-08 | 08:00-08:45");
  assert.equal(gs.normalizarReserva_("  2026-09-08   |   08:00-08:45 "), "2026-09-08 | 08:00-08:45");
  assert.equal(gs.normalizarReserva_(null), "");
});

test("activos_ conta só o estado activo, na data e horário certos", () => {
  const linhas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", new Date(), "activo"],
    ["t2", "2026-09-08", "08:00-08:45", new Date(), "expirado"],
    ["t3", "2026-09-08", "08:45-09:30", new Date(), "activo"],
    ["t4", "2026-09-09", "08:00-08:45", new Date(), "activo"]
  ];
  assert.equal(gs.activos_(linhas, "2026-09-08", "08:00-08:45"), 1);
  assert.equal(gs.activos_(linhas, "2026-09-08", "08:45-09:30"), 1);
  assert.equal(gs.activos_(linhas, "2026-09-10", "08:00-08:45"), 0);
});

test("activos_ normaliza a data das células", () => {
  const linhas = [CAB, ["t1", new Date(2026, 8, 8), "08:00-08:45", new Date(), "activo"]];
  assert.equal(gs.activos_(linhas, "2026-09-08", "08:00-08:45"), 1);
});

test("linhaDoToken_ encontra só linhas activas", () => {
  const linhas = [
    CAB,
    ["tA", "2026-09-08", "08:00-08:45", new Date(), "expirado"],
    ["tA", "2026-09-08", "08:45-09:30", new Date(), "activo"]
  ];
  assert.deepEqual(gs.linhaDoToken_(linhas, "tA"), {
    indice: 2, data: "2026-09-08", horario: "08:45-09:30"
  });
  assert.equal(gs.linhaDoToken_(linhas, "tZ"), null);
});

test("validarPedido_ rejeita cada campo inválido com o seu código", () => {
  const bom = { token: "abcd-1234-efgh", data: "2026-09-08", horario: "08:00-08:45" };
  assert.deepEqual(gs.validarPedido_(bom, CAPS, "2026-09-07"), { ok: true });

  assert.equal(gs.validarPedido_({ ...bom, token: "curto" }, CAPS, "2026-09-07").erro, "token_invalido");
  assert.equal(gs.validarPedido_({ ...bom, token: "tem espaços aqui" }, CAPS, "2026-09-07").erro, "token_invalido");
  assert.equal(gs.validarPedido_({ ...bom, data: "8/9/2026" }, CAPS, "2026-09-07").erro, "data_invalida");
  assert.equal(gs.validarPedido_({ ...bom, data: "2026-09-06" }, CAPS, "2026-09-07").erro, "data_passada");
  assert.equal(gs.validarPedido_({ ...bom, horario: "23:00-23:45" }, CAPS, "2026-09-07").erro, "horario_desconhecido");
});

test("validarPedido_ aceita hoje", () => {
  const hoje = { token: "abcd-1234-efgh", data: "2026-09-07", horario: "08:00-08:45" };
  assert.deepEqual(gs.validarPedido_(hoje, CAPS, "2026-09-07"), { ok: true });
});

const JANELA = 20 * 60 * 1000;
const AGORA = Date.parse("2026-09-08T12:00:00Z");
const VELHO = new Date(AGORA - 60 * 60 * 1000);   // 1 hora: fora da janela
const NOVO = new Date(AGORA - 60 * 1000);         // 1 minuto: dentro da janela

test("colunaReserva_ encontra a coluna pelo cabeçalho", () => {
  const linhas = [
    ["Submission Date", "Email", "Reserva", "typeA137"],
    ["2026-09-01", "a@b.pt", "2026-09-08 | 08:00-08:45", ""]
  ];
  assert.equal(gs.colunaReserva_(linhas), 2);
});

test("colunaReserva_ cai para a coluna cujos valores têm o formato certo", () => {
  const linhas = [
    ["Submission Date", "Email", "Coluna Renomeada"],
    ["2026-09-01", "a@b.pt", "2026-09-08 | 08:00-08:45"],
    ["2026-09-02", "c@d.pt", "2026-09-08 | 08:45-09:30"]
  ];
  assert.equal(gs.colunaReserva_(linhas), 2);
});

test("colunaReserva_ devolve -1 quando não há nada reconhecível", () => {
  assert.equal(gs.colunaReserva_([["Data", "Email"], ["2026-09-01", "a@b.pt"]]), -1);
  assert.equal(gs.colunaReserva_([]), -1);
});

test("colunaReserva_ recusa uma coluna Reserva vazia (integração do JotForm não mapeada)", () => {
  // O cabeçalho "Reserva" existe, mas nenhuma linha tem lá um valor no
  // formato certo. Aceitar isto às cegas puxaria a contagem de submissões
  // a zero e faria a reconciliação libertar reservas reais.
  const linhas = [
    ["Submission Date", "Email", "Reserva"],
    ["2026-09-01", "a@b.pt", ""],
    ["2026-09-02", "c@d.pt", ""]
  ];
  assert.equal(gs.colunaReserva_(linhas), -1);
});

test("colunaReserva_ devolve -1 para uma aba só com cabeçalho", () => {
  assert.equal(gs.colunaReserva_([["Submission Date", "Email", "Reserva"]]), -1);
});

test("contarSubmissoes_ agrupa por valor normalizado", () => {
  const linhas = [
    ["Reserva"],
    ["2026-09-08 | 08:00-08:45"],
    ["2026-09-08|08:00-08:45"],
    ["2026-09-08 | 08:45-09:30"],
    [""]
  ];
  assert.deepEqual(gs.contarSubmissoes_(linhas, 0), {
    "2026-09-08 | 08:00-08:45": 2,
    "2026-09-08 | 08:45-09:30": 1
  });
});

test("planoReconciliacao_ liberta a órfã antiga sem rasto nas submissões", () => {
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", VELHO, "activo"],
    ["t2", "2026-09-08", "08:00-08:45", VELHO, "activo"]
  ];
  // Só UMA das duas chegou às submissões: a outra é órfã.
  const subs = { "2026-09-08 | 08:00-08:45": 1 };
  assert.deepEqual(gs.planoReconciliacao_(reservas, subs, AGORA, JANELA), [1]);
});

test("planoReconciliacao_ escolhe as mais antigas primeiro", () => {
  const maisVelho = new Date(AGORA - 3 * 60 * 60 * 1000);
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", VELHO, "activo"],
    ["t2", "2026-09-08", "08:00-08:45", maisVelho, "activo"]
  ];
  // Ambas expiram; os índices vêm por ordem crescente.
  assert.deepEqual(gs.planoReconciliacao_(reservas, {}, AGORA, JANELA), [1, 2]);
});

test("planoReconciliacao_ nunca toca em linhas dentro da janela", () => {
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", NOVO, "activo"],
    ["t2", "2026-09-08", "08:00-08:45", NOVO, "activo"]
  ];
  assert.deepEqual(gs.planoReconciliacao_(reservas, {}, AGORA, JANELA), []);
});

test("planoReconciliacao_ não liberta nada quando as submissões cobrem tudo", () => {
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", VELHO, "activo"],
    ["t2", "2026-09-08", "08:00-08:45", VELHO, "activo"]
  ];
  const subs = { "2026-09-08 | 08:00-08:45": 5 };
  assert.deepEqual(gs.planoReconciliacao_(reservas, subs, AGORA, JANELA), []);
});

test("planoReconciliacao_ ignora linhas já expiradas", () => {
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", VELHO, "expirado"]
  ];
  assert.deepEqual(gs.planoReconciliacao_(reservas, {}, AGORA, JANELA), []);
});

test("planoReconciliacao_ trata cada slot em separado", () => {
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", VELHO, "activo"],
    ["t2", "2026-09-08", "08:45-09:30", VELHO, "activo"]
  ];
  const subs = { "2026-09-08 | 08:45-09:30": 1 };
  assert.deepEqual(gs.planoReconciliacao_(reservas, subs, AGORA, JANELA), [1]);
});

function ioFalso(reservas, opcoes = {}) {
  const estado = {
    reservas: reservas.map(l => l.slice()),
    acrescentadas: [],
    expiradas: [],
    // A marca de água das submissões (C2). Zero = nunca registada, que é o
    // estado de uma instalação antiga; os testes que precisam dela passam-na.
    marca: opcoes.marca === undefined ? 0 : opcoes.marca
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
      lerSubmissoes: () => (opcoes.submissoes === undefined ? null : opcoes.submissoes),
      acrescentar: linha => {
        estado.acrescentadas.push(linha);
        estado.reservas.push(linha);
      },
      expirar: indices => {
        estado.expiradas.push(...indices);
        indices.forEach(i => { estado.reservas[i][4] = "expirado"; });
      },
      marcaSubmissoes: () => estado.marca,
      gravarMarca: n => { estado.marca = n; },
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
});

test("reservar_ é idempotente para o mesmo token e slot", () => {
  const { io, estado } = ioFalso([
    CAB,
    [PEDIDO.token, "2026-09-08", "08:45-09:30", new Date(AGORA), "activo"]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: true, estado: "repetido" });
  assert.equal(estado.acrescentadas.length, 0, "não deve consumir um segundo lugar");
});

test("reservar_ recusa quando o slot está cheio", () => {
  const { io, estado } = ioFalso([
    CAB,
    ["x1", "2026-09-08", "08:45-09:30", new Date(AGORA), "activo"],
    ["x2", "2026-09-08", "08:45-09:30", new Date(AGORA), "activo"]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: false, motivo: "cheio", restantes: 0 });
  assert.equal(estado.acrescentadas.length, 0);
});

test("reservar_ troca de slot sem perder o lugar antigo antes de garantir o novo", () => {
  const { io, estado } = ioFalso([
    CAB,
    [PEDIDO.token, "2026-09-08", "08:00-08:45", new Date(AGORA), "activo"]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: true, estado: "trocado" });
  assert.deepEqual(estado.expiradas, [1]);
  assert.equal(estado.acrescentadas.length, 1);
});

test("reservar_ NÃO liberta o lugar antigo se o novo slot estiver cheio", () => {
  const { io, estado } = ioFalso([
    CAB,
    [PEDIDO.token, "2026-09-08", "08:00-08:45", new Date(AGORA), "activo"],
    ["x1", "2026-09-08", "08:45-09:30", new Date(AGORA), "activo"],
    ["x2", "2026-09-08", "08:45-09:30", new Date(AGORA), "activo"]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.equal(r.reservado, false);
  assert.deepEqual(estado.expiradas, [], "o lugar já garantido tem de sobreviver");
  assert.equal(estado.reservas[1][4], "activo");
});

test("reservar_ reconcilia antes de recusar, e o lugar órfão é reaproveitado", () => {
  const velho = new Date(AGORA - 60 * 60 * 1000);
  const { io } = ioFalso(
    [
      CAB,
      ["x1", "2026-09-08", "08:45-09:30", velho, "activo"],
      ["x2", "2026-09-08", "08:45-09:30", velho, "activo"]
    ],
    { submissoes: [["Reserva"], ["2026-09-08 | 08:45-09:30"]] }
  );
  // Duas reservas antigas, mas só uma submissão: uma é órfã e liberta lugar.
  const r = gs.reservar_(PEDIDO, io);
  assert.equal(r.reservado, true);
});

test("reservar_ não reconcilia quando as submissões são ilegíveis", () => {
  const velho = new Date(AGORA - 60 * 60 * 1000);
  const { io, estado } = ioFalso(
    [
      CAB,
      ["x1", "2026-09-08", "08:45-09:30", velho, "activo"],
      ["x2", "2026-09-08", "08:45-09:30", velho, "activo"]
    ],
    { submissoes: [["Data", "Email"], ["2026-09-01", "a@b.pt"]] }
  );
  const r = gs.reservar_(PEDIDO, io);
  assert.equal(r.reservado, false, "sem coluna Reserva não se liberta nada");
  assert.deepEqual(estado.expiradas, []);
});

test("reservar_ não reconcilia quando a coluna Reserva existe mas está vazia", () => {
  const velho = new Date(AGORA - 60 * 60 * 1000);
  const { io, estado } = ioFalso(
    [
      CAB,
      ["x1", "2026-09-08", "08:45-09:30", velho, "activo"],
      ["x2", "2026-09-08", "08:45-09:30", velho, "activo"]
    ],
    { submissoes: [
        ["Submission Date", "Email", "Reserva"],
        ["2026-09-01", "a@b.pt", ""],
        ["2026-09-02", "c@d.pt", ""]
      ] }
  );
  const r = gs.reservar_(PEDIDO, io);
  assert.equal(r.reservado, false, "coluna Reserva vazia não pode libertar reservas reais");
  assert.deepEqual(estado.expiradas, []);
});

test("reservar_ não reconcilia quando a aba de submissões não existe", () => {
  const velho = new Date(AGORA - 60 * 60 * 1000);
  const { io, estado } = ioFalso([
    CAB,
    ["x1", "2026-09-08", "08:45-09:30", velho, "activo"],
    ["x2", "2026-09-08", "08:45-09:30", velho, "activo"]
  ]);
  const r = gs.reservar_(PEDIDO, io);
  assert.equal(r.reservado, false);
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

// ===============================
// SEMEADURA DAS RESERVAS JÁ EXISTENTES
// ===============================
// Na instalação a aba Reservas está vazia, mas a Form responses já tem
// reservas futuras vendidas a hóspedes reais. Sem as semear, os lugares
// delas aparecem livres e são vendidos outra vez.

const SUBMISSOES_TRES = [
  ["Submission Date", "Email", "Reserva"],
  ["2026-09-01", "a@b.pt", "2026-09-09 | 08:00-08:45"],
  ["2026-09-02", "c@d.pt", "2026-09-09 | 08:00-08:45"],
  ["2026-09-03", "e@f.pt", "2026-09-09 | 08:00-08:45"]
];

const PEDIDO_09 = { token: "abcd-1234-efgh", data: "2026-09-09", horario: "08:00-08:45" };

test("semear_ traz para o registo as reservas futuras já submetidas", () => {
  const { io, estado } = ioFalso([CAB], { submissoes: SUBMISSOES_TRES });
  assert.equal(gs.semear_(io).semeadas, 3);
  assert.equal(gs.activos_(estado.reservas, "2026-09-09", "08:00-08:45"), 3);
  // Um token determinístico por linha de origem, no formato que o
  // validarPedido_ aceita.
  assert.deepEqual(estado.acrescentadas.map(l => l[0]), ["sub-000001", "sub-000002", "sub-000003"]);
});

test("os três lugares já vendidos não são revendidos depois de semear", () => {
  const { io } = ioFalso([CAB], { submissoes: SUBMISSOES_TRES });
  gs.semear_(io);
  // Capacidade 3, três reservas reais: o slot está cheio. Sem a semeadura
  // este pedido devolvia { reservado: true, estado: "novo" } — seis
  // pequenos-almoços vendidos para três lugares.
  assert.deepEqual(
    gs.reservar_(PEDIDO_09, io),
    { ok: true, reservado: false, motivo: "cheio", restantes: 0 }
  );
});

test("semear_ é idempotente: correr preparar() duas vezes não duplica lugares", () => {
  const { io, estado } = ioFalso([CAB], { submissoes: SUBMISSOES_TRES });
  gs.semear_(io);
  assert.equal(gs.semear_(io).semeadas, 0, "a segunda passagem não semeia nada");
  assert.equal(estado.acrescentadas.length, 3);
});

test("semear_ não ressuscita uma linha semeada que o dono cancelou à mão", () => {
  const { io, estado } = ioFalso([CAB], { submissoes: SUBMISSOES_TRES });
  gs.semear_(io);
  // O guia autoriza mudar `estado` para `expirado` (cancelamento por
  // telefone). Uma segunda semeadura não pode desfazer isso.
  estado.reservas[1][4] = "expirado";
  assert.equal(gs.semear_(io).semeadas, 0);
});

test("planoSemeadura_ ignora submissões de datas passadas", () => {
  const submissoes = [
    ["Reserva"],
    ["2026-09-01 | 08:00-08:45"],   // passado: o lugar já foi consumido
    ["2026-09-08 | 08:00-08:45"],   // hoje: conta
    ["2026-09-09 | 08:00-08:45"]    // futuro: conta
  ];
  const plano = gs.planoSemeadura_(submissoes, [CAB], "2026-09-08", AGORA);
  assert.deepEqual(plano.map(l => [l[1], l[2]]), [
    ["2026-09-08", "08:00-08:45"],
    ["2026-09-09", "08:00-08:45"]
  ]);
});

test("planoSemeadura_ ignora linhas sem reserva legível e abas ilegíveis", () => {
  const submissoes = [
    ["Submission Date", "Email", "Reserva"],
    ["2026-09-01", "a@b.pt", ""],
    ["2026-09-02", "c@d.pt", "qualquer coisa"],
    ["2026-09-03", "e@f.pt", "2026-09-09 | 08:00-08:45"]
  ];
  assert.equal(gs.planoSemeadura_(submissoes, [CAB], "2026-09-08", AGORA).length, 1);
  assert.deepEqual(gs.planoSemeadura_(null, [CAB], "2026-09-08", AGORA), []);
  assert.deepEqual(
    gs.planoSemeadura_([["Data", "Email"], ["2026-09-01", "a@b.pt"]], [CAB], "2026-09-08", AGORA),
    []
  );
});

test("uma reserva semeada satisfaz-se a si mesma na reconciliação", () => {
  // Cada linha semeada tem a sua própria submissão, logo o excedente é 0 e
  // a reconciliação não a liberta — nem passados os 20 minutos.
  const { io, estado } = ioFalso([CAB], { submissoes: SUBMISSOES_TRES });
  gs.semear_(io);
  const submissoes = gs.contarSubmissoes_(SUBMISSOES_TRES, 2);
  const depois = AGORA + 60 * 60 * 1000;
  assert.deepEqual(gs.planoReconciliacao_(estado.reservas, submissoes, depois, JANELA), []);
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
  const gsComStub = carregarGs(new URL("../reservas.gs", import.meta.url).pathname, {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ssFalso,
      flush: () => { chamadas.flush++; }
    }
  });

  gsComStub.ioReal_().acrescentar(["t1", "2026-09-08", "08:00-08:45", new Date(), "activo"]);

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
  const gsComStub = carregarGs(new URL("../reservas.gs", import.meta.url).pathname, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssFalso, flush: () => {} }
  });
  const io = gsComStub.ioReal_();

  assert.deepEqual(io.lerReservas(), [CAB]);

  io.acrescentar(["t1", "2026-09-08", "08:00-08:45", new Date(), "activo"]);

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
  const gsComStub = carregarGs(new URL("../reservas.gs", import.meta.url).pathname, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssFalso, flush: () => {} }
  });

  gsComStub.ioReal_().expirar([1]);

  // índice 1 (a segunda linha do array, cabeçalho incluído) → linha 2 da
  // folha; COL_ESTADO = 4 → coluna 5.
  assert.deepEqual(chamadasGetRange, [[2, 5]]);
});
