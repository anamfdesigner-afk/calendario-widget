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
// Meio-dia LOCAL de 8/9/2026, não meio-dia UTC. O `hoje` do reservar_ vem
// de normalizarData_(new Date(io.agora())), que usa os getters locais: com
// um instante fixado em UTC, a leste de UTC+12 o `hoje` caía no dia
// seguinte ao PEDIDO.data e 14 testes falhavam com data_passada.
const AGORA = new Date(2026, 8, 8, 12, 0, 0).getTime();
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
  const { io, estado } = ioFalso(
    [
      CAB,
      ["x1", "2026-09-08", "08:45-09:30", velho, "activo"],
      ["x2", "2026-09-08", "08:45-09:30", velho, "activo"]
    ],
    { submissoes: [["Reserva"], ["2026-09-08 | 08:45-09:30"]] }
  );
  // Duas reservas antigas, mas só uma submissão: uma é órfã e liberta lugar.
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: true, estado: "novo" });
  // Só o "reservado: true" não chegava: era precisamente esta a asserção
  // que faltava para apanhar uma reconciliação que expira demasiado (o
  // caso da marca de água) ou a linha errada (a de quem pede).
  assert.deepEqual(estado.expiradas, [1], "exatamente UMA órfã, a mais antiga");
  assert.equal(estado.reservas[1][4], "expirado");
  assert.equal(estado.reservas[2][4], "activo", "a que tem submissão sobrevive");
  assert.equal(estado.acrescentadas.length, 1);
  assert.equal(estado.acrescentadas[0][0], PEDIDO.token);
  // Capacidade 2: a x2 mais a nova. O lugar libertado foi reaproveitado
  // uma única vez.
  assert.equal(gs.activos_(estado.reservas, "2026-09-08", "08:45-09:30"), 2);
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
// A RECONCILIAÇÃO NÃO PODE TOCAR NA RESERVA DE QUEM PEDE
// ===============================

test("uma troca recusada não pode revogar o lugar que o hóspede já tinha", () => {
  const maisVelho = new Date(AGORA - 3 * 60 * 60 * 1000);
  const velho = new Date(AGORA - 60 * 60 * 1000);
  const { io, estado } = ioFalso(
    [
      CAB,
      [PEDIDO.token, "2026-09-08", "08:00-08:45", maisVelho, "activo"],
      ["x9", "2026-09-08", "08:00-08:45", velho, "activo"],
      ["x1", "2026-09-08", "08:45-09:30", velho, "activo"],
      ["x2", "2026-09-08", "08:45-09:30", velho, "activo"]
    ],
    { submissoes: [
        ["Reserva"],
        ["2026-09-08 | 08:00-08:45"],
        ["2026-09-08 | 08:45-09:30"],
        ["2026-09-08 | 08:45-09:30"]
      ] }
  );
  // O plano é calculado sobre TODO o registo, logo inclui a linha de quem
  // pede: no slot 08:00-08:45 há duas antigas e só uma submissão, e a mais
  // antiga é a do próprio token. O pedido é para o 08:45-09:30, que está
  // cheio e coberto pelas submissões — a recusa é correta, mas antes desta
  // correção vinha acompanhada da expiração da reserva já confirmada do
  // hóspede.
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: false, motivo: "cheio", restantes: 0 });
  assert.deepEqual(estado.expiradas, [], "a reserva de quem pede tem de sobreviver à recusa");
  assert.equal(estado.reservas[1][4], "activo");
});

test("reconciliar_ liberta as outras órfãs mas nunca o índice excluído", () => {
  const velho = new Date(AGORA - 60 * 60 * 1000);
  const { io, estado } = ioFalso(
    [
      CAB,
      ["t1", "2026-09-08", "08:00-08:45", velho, "activo"],
      ["t2", "2026-09-08", "08:00-08:45", velho, "activo"]
    ],
    { submissoes: [["Reserva"], ["2026-09-08 | 08:00-08:45"]] }
  );
  // Excedente 1, e a candidata é a linha 1 — excluída. Nada expira.
  assert.equal(gs.reconciliar_(io, 1), 0);
  assert.deepEqual(estado.expiradas, []);
  // Sem exclusão, expira.
  assert.equal(gs.reconciliar_(io, -1), 1);
  assert.deepEqual(estado.expiradas, [1]);
});

// ===============================
// FIABILIDADE DAS SUBMISSÕES (MARCA DE ÁGUA)
// ===============================
// A guarda do colunaReserva_ é ao nível da COLUNA: basta uma linha com
// valor certo. A premissa de que a reconciliação precisa é por LINHA: toda
// a reserva genuína tem submissão correspondente. Quando o espelho do
// JotForm deixa de escrever (um rótulo trocado é indistinguível de sucesso
// — já aconteceu neste repositório), as linhas históricas válidas mantêm o
// colunaReserva_ satisfeito, cada reserva nova parece órfã, e 20 minutos
// depois de cada reserva o lugar é libertado e revendido, em silêncio.
//
// A marca de água é a contagem de linhas da Form responses no momento da
// instalação. Linhas ANTES dela estão isentas (a folha tem ~49 linhas
// históricas cujo `Reserva` nunca foi escrito, e essas não podem bloquear
// a reconciliação para sempre). Linhas DEPOIS dela têm de ter todas uma
// reserva legível — o widget tem OBRIGATORIO = true, logo uma submissão
// nova sem reserva significa que o espelho está partido.

const SUBS_ESPELHO_PARTIDO = [
  ["Submission Date", "Email", "Reserva"],
  ["2026-09-01", "a@b.pt", "2026-09-08 | 08:45-09:30"],
  ["2026-09-02", "c@d.pt", ""]
];

test("submissoesFiaveis_ recusa uma linha em branco depois da marca de água", () => {
  // Marca 1 = na instalação a aba só tinha o cabeçalho; ambas as linhas são
  // novas, e a segunda não trouxe reserva.
  assert.equal(gs.submissoesFiaveis_(SUBS_ESPELHO_PARTIDO, 2, 1), false);
});

test("submissoesFiaveis_ isenta as linhas históricas anteriores à marca", () => {
  // Marca 3 = as duas linhas de dados já lá estavam na instalação.
  assert.equal(gs.submissoesFiaveis_(SUBS_ESPELHO_PARTIDO, 2, 3), true);
});

test("submissoesFiaveis_ aceita quando todas as linhas novas têm reserva", () => {
  const linhas = [
    ["Submission Date", "Email", "Reserva"],
    ["2026-09-01", "a@b.pt", ""],                          // histórica
    ["2026-09-02", "c@d.pt", "2026-09-08 | 08:45-09:30"]   // nova, completa
  ];
  assert.equal(gs.submissoesFiaveis_(linhas, 2, 2), true);
  assert.equal(gs.submissoesFiaveis_(linhas, -1, 0), false, "sem coluna não há provas");
});

test("um espelho partido não liberta nem revende reservas genuínas", () => {
  const velho = new Date(AGORA - 60 * 60 * 1000);
  const { io, estado } = ioFalso(
    [
      CAB,
      ["x1", "2026-09-08", "08:45-09:30", velho, "activo"],
      ["x2", "2026-09-08", "08:45-09:30", velho, "activo"]
    ],
    { submissoes: SUBS_ESPELHO_PARTIDO, marca: 1 }
  );
  // Capacidade 2, duas reservas genuínas. Uma das submissões perdeu o
  // valor: sem a marca de água a reconciliação via excedente 1, expirava a
  // x1 e admitia este terceiro hóspede.
  const r = gs.reservar_(PEDIDO, io);
  assert.deepEqual(r, { ok: true, reservado: false, motivo: "cheio", restantes: 0 });
  assert.deepEqual(estado.expiradas, [], "nenhuma reserva genuína pode ser revogada");
  assert.equal(estado.reservas[1][4], "activo");
});

test("as linhas históricas em branco continuam a permitir reconciliar órfãs", () => {
  const velho = new Date(AGORA - 60 * 60 * 1000);
  const { io, estado } = ioFalso(
    [
      CAB,
      ["x1", "2026-09-08", "08:45-09:30", velho, "activo"],
      ["x2", "2026-09-08", "08:45-09:30", velho, "activo"]
    ],
    // Marca 3: as duas linhas já existiam antes da instalação, logo a linha
    // em branco é histórica e não é prova de espelho partido.
    { submissoes: SUBS_ESPELHO_PARTIDO, marca: 3 }
  );
  const r = gs.reservar_(PEDIDO, io);
  assert.equal(r.reservado, true, "uma folha com histórico não pode travar a reconciliação");
  assert.deepEqual(estado.expiradas, [1]);
});

test("semear_ grava a marca de água com a contagem de linhas das submissões", () => {
  const { io, estado } = ioFalso([CAB], { submissoes: SUBMISSOES_TRES });
  gs.semear_(io);
  assert.equal(estado.marca, SUBMISSOES_TRES.length);
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

test("semear_ não duplica uma reserva que já foi feita pelo widget", () => {
  // Depois de o sistema entrar em serviço, as reservas normais têm tokens
  // reais (UUID do widget) e nenhum token sub-<indice>. Bastar "este token
  // ainda não existe" criava uma SEGUNDA linha para cada uma delas.
  const submissoes = [
    ["Submission Date", "Reserva"],
    ["2026-09-01", "2026-09-09 | 08:00-08:45"]
  ];
  const { io, estado } = ioFalso([CAB], { submissoes });
  assert.equal(gs.semear_(io).semeadas, 1);

  // O hóspede seguinte reserva pelo widget, e a submissão dele aparece.
  gs.reservar_({ ...PEDIDO_09, token: "real-uuid-1234" }, io);
  submissoes.push(["2026-09-10", "2026-09-09 | 08:00-08:45"]);
  assert.equal(gs.activos_(estado.reservas, "2026-09-09", "08:00-08:45"), 2);

  assert.equal(gs.semear_(io).semeadas, 0, "duas submissões, duas linhas — não três");
  assert.equal(gs.activos_(estado.reservas, "2026-09-09", "08:00-08:45"), 2);
});

test("semear_ apanha as reservas que entraram depois da instalação", () => {
  // O formulário continua a receber reservas entre a instalação do script e
  // a passagem do widget para o novo endereço: essas linhas não têm reserva
  // nenhuma no registo e os lugares delas seriam revendidos.
  const submissoes = [["Submission Date", "Reserva"], ["2026-09-01", "2026-09-09 | 08:00-08:45"]];
  const { io, estado } = ioFalso([CAB], { submissoes });
  gs.semear_(io);
  submissoes.push(["2026-09-05", "2026-09-09 | 08:00-08:45"]);

  assert.equal(gs.semear_(io).semeadas, 1);
  assert.equal(gs.activos_(estado.reservas, "2026-09-09", "08:00-08:45"), 2);
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
        setValue: v => {
          if (!dados[linha - 1]) dados[linha - 1] = [];
          dados[linha - 1][coluna - 1] = v;
        },
        setNumberFormat: f => { formatos.push({ aba: nome, coluna, formato: f }); }
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

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ===============================
// INDEPENDÊNCIA DOS DOIS FUSOS
// ===============================

test("criadoIso_ devolve sempre ISO-8601 em UTC", () => {
  const iso = gs.criadoIso_(AGORA);
  assert.match(iso, ISO_UTC);
  assert.equal(Date.parse(iso), AGORA);
});

test("reservar_ guarda o criado como string ISO em UTC, não como Date", () => {
  const { io, estado } = ioFalso([CAB]);
  gs.reservar_(PEDIDO, io);
  const criado = estado.acrescentadas[0][3];
  assert.equal(typeof criado, "string", "um Date deixaria o Sheets escolher o fuso");
  assert.match(criado, ISO_UTC);
});

test("planoSemeadura_ guarda o criado como string ISO em UTC", () => {
  const plano = gs.planoSemeadura_(SUBMISSOES_TRES, [CAB], "2026-09-08", AGORA);
  assert.match(plano[0][3], ISO_UTC);
});

test("planoReconciliacao_ lê o criado a partir da string ISO", () => {
  const reservas = [
    CAB,
    ["t1", "2026-09-08", "08:00-08:45", gs.criadoIso_(AGORA - 60 * 60 * 1000), "activo"],
    ["t2", "2026-09-08", "08:00-08:45", gs.criadoIso_(AGORA - 60 * 1000), "activo"]
  ];
  // A primeira está fora da janela e sem submissão; a segunda está dentro.
  assert.deepEqual(gs.planoReconciliacao_(reservas, {}, AGORA, JANELA), [1]);
});

test("preparar() põe as colunas data e criado em texto simples", () => {
  const livro = livroFalso({ "Form responses": [["Submission Date", "Reserva"]] });
  const gsComStub = carregarCom(livro.stubs);

  gsComStub.preparar();

  // COL_DATA = 1 e COL_CRIADO = 3 → colunas 2 e 4 da folha, formato "@".
  const naReservas = livro.formatos.filter(f => f.aba === "Reservas");
  assert.deepEqual(naReservas, [
    { aba: "Reservas", coluna: 2, formato: "@" },
    { aba: "Reservas", coluna: 4, formato: "@" }
  ]);
});

test("preparar() cria as abas e semeia as capacidades", () => {
  const livro = livroFalso({ "Form responses": [["Submission Date", "Reserva"]] });
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

// ===============================
// QUAL É A ABA DAS SUBMISSÕES
// ===============================

// Data bem no futuro de propósito: o preparar() corre com o Date.now() real
// (não com o AGORA fixo), e uma data próxima tornava este teste numa bomba
// de relógio — deixava de semear nada quando passasse.
const LINHAS_COM_RESERVA = [
  ["Submission Date", "Email", "Reserva"],
  ["2099-01-01", "a@b.pt", "2099-01-01 | 08:00-08:45"]
];

function lerDe(mapa) {
  return nome => mapa[nome] || [];
}

test("escolherAbaSubmissoes_ prefere o nome exato", () => {
  const nomes = ["Reservas", "Capacidades", "Respostas", "Form responses"];
  assert.equal(gs.escolherAbaSubmissoes_(nomes, lerDe({})), "Form responses");
});

test("escolherAbaSubmissoes_ aceita nomes traduzidos ou numerados", () => {
  assert.equal(
    gs.escolherAbaSubmissoes_(["Reservas", "Form Responses 1"], lerDe({})),
    "Form Responses 1"
  );
  assert.equal(
    gs.escolherAbaSubmissoes_(["Reservas", "Respostas do formulário"], lerDe({})),
    "Respostas do formulário"
  );
});

test("escolherAbaSubmissoes_ cai para a aba que tem reservas legíveis", () => {
  // Um nome que não diz nada: só o conteúdo a identifica.
  const nomes = ["Reservas", "Capacidades", "Folha1"];
  const ler = lerDe({ Folha1: LINHAS_COM_RESERVA });
  assert.equal(gs.escolherAbaSubmissoes_(nomes, ler), "Folha1");
});

test("escolherAbaSubmissoes_ nunca escolhe as nossas próprias abas", () => {
  // A aba Reservas tem data e horario em colunas separadas, logo nem o
  // formato completo casa — mas não pode ser candidata de qualquer modo.
  const ler = lerDe({ Reservas: LINHAS_COM_RESERVA, Capacidades: LINHAS_COM_RESERVA });
  assert.equal(gs.escolherAbaSubmissoes_(["Reservas", "Capacidades"], ler), null);
});

test("escolherAbaSubmissoes_ devolve null quando não há nada reconhecível", () => {
  assert.equal(gs.escolherAbaSubmissoes_(["Folha1"], lerDe({ Folha1: [["a"], ["b"]] })), null);
  assert.equal(gs.escolherAbaSubmissoes_([], lerDe({})), null);
  assert.equal(gs.escolherAbaSubmissoes_(null, lerDe({})), null);
});

test("ioReal_.lerSubmissoes lê uma aba de respostas renomeada", () => {
  const livro = livroFalso({
    Reservas: [CAB],
    Capacidades: [["horario", "vagas"], ["08:00-08:45", 3]],
    "Respostas ao formulário (1)": LINHAS_COM_RESERVA
  });
  const gsComStub = carregarCom(livro.stubs);
  assert.deepEqual(gsComStub.ioReal_().lerSubmissoes(), LINHAS_COM_RESERVA);
});

test("ioReal_.lerSubmissoes devolve null quando não existe aba de respostas", () => {
  const livro = livroFalso({ Reservas: [CAB] });
  const gsComStub = carregarCom(livro.stubs);
  assert.equal(gsComStub.ioReal_().lerSubmissoes(), null);
});

test("preparar() diz qual a aba de respostas que encontrou", () => {
  const livro = livroFalso({ "Respostas ao formulário": LINHAS_COM_RESERVA });
  const gsComStub = carregarCom(livro.stubs);
  const msg = gsComStub.preparar();
  assert.match(msg, /Respostas ao formulário/);
  assert.match(msg, /trazidas para o registo: 1/);
});

test("preparar() diz NENHUMA quando não encontra aba de respostas", () => {
  const livro = livroFalso({});
  const gsComStub = carregarCom(livro.stubs);
  assert.match(gsComStub.preparar(), /Aba das respostas: NENHUMA/);
});

// ===============================
// O GET NÃO PODE RECONCILIAR EM TODOS OS PEDIDOS
// ===============================

function corpo(resposta) {
  return JSON.parse(resposta.texto);
}

const CAPS_FOLHA = [["horario", "vagas"], ["08:00-08:45", 3], ["08:45-09:30", 2]];

test("algumSlotCheio_ vê o slot cheio e ignora o horário fechado", () => {
  const caps = [{ horario: "08:00-08:45", vagas: 1 }, { horario: "08:45-09:30", vagas: 0 }];
  const vazio = [CAB];
  // O horário de capacidade 0 tem 0 activos, logo passaria o >= e punha a
  // reconciliação a correr em todos os GET.
  assert.equal(gs.algumSlotCheio_(vazio, "2026-09-08", caps), false);
  const cheio = [CAB, ["t1", "2026-09-08", "08:00-08:45", "x", "activo"]];
  assert.equal(gs.algumSlotCheio_(cheio, "2026-09-08", caps), true);
  assert.equal(gs.algumSlotCheio_(cheio, "2026-09-09", caps), false, "só a data pedida");
});

test("doGet não pega no lock quando nenhum slot da data parece cheio", () => {
  const livro = livroFalso({
    Reservas: [CAB],
    Capacidades: CAPS_FOLHA,
    "Form responses": LINHAS_COM_RESERVA
  });
  const gsComStub = carregarCom(livro.stubs);

  const r = corpo(gsComStub.doGet({ parameter: { data: "2026-09-08" } }));

  assert.deepEqual(livro.chamadas.tryLock, [], "reconciliar em cada GET serializa os hóspedes");
  assert.deepEqual(r.slots, [
    { horario: "08:00-08:45", capacidade: 3, restantes: 3 },
    { horario: "08:45-09:30", capacidade: 2, restantes: 2 }
  ]);
});

test("doGet reconcilia quando um slot parece cheio, e liberta o lugar órfão", () => {
  const velhoIso = gs.criadoIso_(Date.now() - 60 * 60 * 1000);
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["x1", "2099-01-01", "08:45-09:30", velhoIso, "activo"],
      ["x2", "2099-01-01", "08:45-09:30", velhoIso, "activo"]
    ],
    Capacidades: CAPS_FOLHA,
    // Uma só submissão para duas reservas antigas: uma é órfã. É este o
    // caso que o caminho do GET existe para fechar — sem ele o slot ficava
    // "Sem vagas" para sempre e ninguém chegava a submeter contra ele.
    "Form responses": [
      ["Submission Date", "Reserva"],
      ["2099-01-01", "2099-01-01 | 08:45-09:30"]
    ]
  });
  const gsComStub = carregarCom(livro.stubs);

  const r = corpo(gsComStub.doGet({ parameter: { data: "2099-01-01" } }));

  assert.deepEqual(livro.chamadas.tryLock, [5000]);
  assert.equal(livro.chamadas.releaseLock, 1);
  assert.equal(livro.folhas["Reservas"].dados[1][4], "expirado");
  // E as contagens devolvidas já refletem a libertação, no mesmo pedido.
  assert.equal(r.slots[1].restantes, 1);
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

// ===============================
// A CASCA HTTP (doPost)
// ===============================
// É nesta casca que todo o desenho se apoia: o mutex, o release no finally,
// o salto oportunista quando o tryLock falha e a leitura do corpo.

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

test("doPost propaga a recusa de um slot cheio", () => {
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["x1", "2099-01-01", "08:45-09:30", gs.criadoIso_(Date.now()), "activo"],
      ["x2", "2099-01-01", "08:45-09:30", gs.criadoIso_(Date.now()), "activo"]
    ],
    Capacidades: CAPS_FOLHA
  });
  const gsComStub = carregarCom(livro.stubs);

  assert.deepEqual(post(gsComStub, PEDIDO_TEXTO), {
    ok: true, reservado: false, motivo: "cheio", restantes: 0
  });
  assert.equal(livro.chamadas.releaseLock, 1);
});

test("doGet ainda devolve contagens quando não consegue o lock", () => {
  const velhoIso = gs.criadoIso_(Date.now() - 60 * 60 * 1000);
  const livro = livroFalso(
    {
      Reservas: [
        CAB,
        ["x1", "2099-01-01", "08:45-09:30", velhoIso, "activo"],
        ["x2", "2099-01-01", "08:45-09:30", velhoIso, "activo"]
      ],
      Capacidades: CAPS_FOLHA,
      "Form responses": LINHAS_COM_RESERVA
    },
    { lockIndisponivel: true }
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

// ===============================
// AS FUNÇÕES DE MANUTENÇÃO TAMBÉM PRECISAM DO LOCK
// ===============================

test("preparar() corre dentro do lock e larga-o", () => {
  const livro = livroFalso({ "Form responses": LINHAS_COM_RESERVA });
  const gsComStub = carregarCom(livro.stubs);
  gsComStub.preparar();
  assert.deepEqual(livro.chamadas.tryLock, [20000]);
  assert.equal(livro.chamadas.releaseLock, 1);
});

test("limparTestes() apaga só as linhas de teste, dentro do lock", () => {
  const livro = livroFalso({
    Reservas: [
      CAB,
      ["conc-teste-1", "2099-01-01", "08:00-08:45", "x", "activo"],
      ["abcd-1234-efgh", "2099-01-01", "08:00-08:45", "x", "activo"],
      ["conc-teste-2", "2099-01-01", "08:00-08:45", "x", "activo"]
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
    Reservas: [CAB, ["conc-teste-1", "2099-01-01", "08:00-08:45", "x", "activo"]],
    Capacidades: CAPS_FOLHA,
    "Form responses": LINHAS_COM_RESERVA
  };
  const livro = livroFalso(abas, { lockIndisponivel: true });
  const gsComStub = carregarCom(livro.stubs);

  assert.match(gsComStub.preparar(), /ocupada/);
  assert.match(gsComStub.limparTestes(), /ocupada/);
  assert.match(gsComStub.semear(), /ocupada/);
  // Nada mudou: nem semeaduras, nem apagamentos.
  assert.equal(livro.folhas["Reservas"].dados.length, 2);
  assert.equal(livro.chamadas.releaseLock, 0);
});

test("semear() corre dentro do lock e relata quantas semeou", () => {
  const livro = livroFalso({
    Reservas: [CAB],
    Capacidades: CAPS_FOLHA,
    "Form responses": LINHAS_COM_RESERVA
  });
  const gsComStub = carregarCom(livro.stubs);

  assert.match(gsComStub.semear(), /submissões: 1/);
  assert.deepEqual(livro.chamadas.tryLock, [20000]);
  assert.equal(livro.chamadas.releaseLock, 1);
  // E gravou a marca de água nas ScriptProperties.
  assert.equal(livro.propriedades.marcaSubmissoes, String(LINHAS_COM_RESERVA.length));
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
  const gsComStub = carregarGs(CAMINHO_GS, {
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
  const gsComStub = carregarGs(CAMINHO_GS, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssFalso, flush: () => {} }
  });

  gsComStub.ioReal_().expirar([1]);

  // índice 1 (a segunda linha do array, cabeçalho incluído) → linha 2 da
  // folha; COL_ESTADO = 4 → coluna 5.
  assert.deepEqual(chamadasGetRange, [[2, 5]]);
});
