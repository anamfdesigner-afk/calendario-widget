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
