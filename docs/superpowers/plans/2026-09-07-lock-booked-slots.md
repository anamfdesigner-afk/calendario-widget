# Atomic Slot Locking — Implementation Plan

> **Desactualizado em parte.** Este plano descreve o `semear`, a aba
> `Form responses` e a reconciliação por contagens como se estivessem vivos.
> Não estão: foram substituídos pela confirmação por webhook da JotForm. A
> peça autoritativa é
> `docs/superpowers/specs/2026-09-07-webhook-confirmation-amendment.md` — onde
> os dois discordarem, vale a emenda.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make breakfast slots impossible to overbook, by moving vacancy counting and seat claiming into a Google Apps Script web app that reserves atomically under `LockService`.

**Architecture:** A bound Apps Script web app on the submissions spreadsheet owns two tabs — `Reservas` (the claim ledger, the only live source of occupancy) and `Capacidades` (slot times and limits, editable in Sheets). `GET` returns remaining vacancies for a date; `POST` claims a seat inside a script-wide mutex, idempotent by a per-page-load token. `widget.js` stops parsing a spreadsheet altogether: it reads counts from `GET` and claims at submit, failing **closed** if the claim cannot be confirmed. Abandoned claims are released by comparing claim counts against the rows JotForm actually wrote to `Form responses`.

**Tech Stack:** Google Apps Script (plain ES5-style JS, `LockService`, `SpreadsheetApp`, `ContentService`), vanilla browser JS, `node:test` + `node:assert` for tests (built in — no dependencies), `curl` for deploy verification.

**Spec:** `docs/superpowers/specs/2026-09-07-lock-booked-slots-design.md`

## Global Constraints

- **Comments and all guest-facing strings in Portuguese.** The surrounding JotForm is in English; the widget is not. Match the existing style.
- **No dependencies, no build step.** Tests use only `node:test` / `node:assert`. Never add a `package.json` with dependencies.
- **`node --check widget.js` and `node --check < reservas.gs` are the syntax gate.** Run both before every commit.
- **`reservas.gs` must be valid in Apps Script's runtime.** Use `var`, `function` declarations, and avoid optional chaining / `??` — the V8 runtime supports modern syntax, but the file is also loaded by the Node tests via `new Function`, so keep it plain and side-effect-free at top level except constant declarations.
- **No spreadsheet IDs, endpoint URLs with secrets, or guest data in tracked files.** This repository is **public**. The script is bound to the spreadsheet, so it needs no ID. `RESERVAS_URL` is a deploy URL and is safe to commit (it exposes only vacancy counts), matching the existing precedent for `SHEETY_GET_URL`.
- **`DEBUG_FORCADO` must be committed as `false`.** It shipped `true` once and guests saw Portuguese diagnostics in the live form.
- **Stage files explicitly. Never `git add -A` in this repository** — it once swept the owner's unrelated edit into a commit.
- **Never write into the submissions spreadsheet by hand.** A misplaced click once overwrote a real guest's email. Cleanup is done by the script's `limparTestes()` function, never by typing in cells.
- **`CLAUDE.md` is deliberately untracked.** Update it, never commit it.
- **The widget's submit handler must always answer.** Every branch ends in `sendSubmit(...)` or `showWidgetError(...)` (which sends `valid:false` internally). Never call `sendSubmit` after `showWidgetError`.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014w2ZAC4mUd953oDdz6qAZh
  ```

## File Structure

| File | Responsibility |
|---|---|
| `reservas.gs` (create) | The whole server side. Pure helpers (parsing, counting, validation, reconciliation planning) plus a thin Apps Script shell (`doGet`, `doPost`, sheet I/O, `LockService`). Ends with a `module.exports` block guarded by `typeof module`, ignored by Apps Script, used by the Node tests. |
| `tests/carregar.mjs` (create) | Test loaders. `carregarGs()` runs `reservas.gs` in the same realm with stubbed Apps Script globals; `carregarWidget()` runs `widget.js` against a minimal DOM stub. No dependencies. |
| `tests/reservas.test.mjs` (create) | Unit tests for every pure helper in `reservas.gs`. |
| `tests/widget.test.mjs` (create) | Unit tests for `widget.js` pure helpers and its HTTP wrappers against a stubbed `fetch`. |
| `docs/instalacao-reservas.md` (create) | Portuguese step-by-step guide the owner follows to install and deploy the script. Standalone — forwardable without context. |
| `widget.js` (modify) | Swap the Sheety read for the new endpoint; claim at submit; fail closed. |
| `CLAUDE.md` (modify, never commit) | Record the new architecture and retire the stale Sheety notes. |

`reservas.gs` stays a single file: Apps Script has no module system, and the owner pastes one file into one editor. Splitting it would make installation worse, which is the constraint that dominates here.

---

### Task 1: Test harness and `Capacidades` parsing

**Files:**
- Create: `tests/carregar.mjs`
- Create: `reservas.gs`
- Test: `tests/reservas.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `carregarGs(caminho, stubs) -> object` (the `module.exports` of a `.gs` file). `capacidades_(linhas: any[][]) -> Array<{horario: string, vagas: number}>` preserving sheet row order. `capacidadeDe_(caps, horario: string) -> number` returning `-1` for an unknown slot.

- [ ] **Step 1: Write the loader**

Create `tests/carregar.mjs`:

```js
import { readFileSync } from "node:fs";

// Corre um ficheiro .gs no MESMO realm do Node (new Function, não vm), para
// que o assert.deepStrictEqual funcione: objetos criados dentro de um vm
// têm outro Object.prototype e o assert estrito rejeita-os.
//
// Os globais do Apps Script entram como PARÂMETROS da função, pelo que ficam
// sombreados dentro do script e podem ser esboçados nos testes.
export function carregarGs(caminho, stubs = {}) {
  const mod = { exports: {} };
  const nomes = ["SpreadsheetApp", "LockService", "Utilities", "ContentService"];
  const fn = new Function("module", ...nomes, readFileSync(caminho, "utf8"));
  fn(mod, ...nomes.map(n => stubs[n]));
  return mod.exports;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/reservas.test.mjs`:

```js
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
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `node --test`
Expected: FAIL — `reservas.gs` does not exist yet (`ENOENT`).

- [ ] **Step 4: Write the minimal implementation**

Create `reservas.gs`:

```js
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
// EXPORTAÇÃO PARA OS TESTES
// ===============================
// No Apps Script "module" não existe, logo este bloco é ignorado. Em Node
// é o que dá acesso às funções puras (ver tests/carregar.mjs).
if (typeof module !== "undefined") {
  module.exports = {
    capacidades_: capacidades_,
    capacidadeDe_: capacidadeDe_
  };
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `node --test`
Expected: PASS, 5 tests.

- [ ] **Step 6: Syntax gate**

Run: `node --check < reservas.gs`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add reservas.gs tests/carregar.mjs tests/reservas.test.mjs
git commit -m "$(cat <<'MSG'
Add reservas.gs with Capacidades parsing and a test harness

The harness loads the .gs file in Node's own realm via new Function, with
the Apps Script globals passed in as parameters so they can be stubbed. A
vm context would give objects a different prototype and defeat strict deep
equality.

Capacidades is the source of truth for both slot times and limits, so it
returns an array and preserves row order: that order is the button order in
the widget. Malformed rows are skipped rather than guessed at.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014w2ZAC4mUd953oDdz6qAZh
MSG
)"
```

---

### Task 2: Normalisation, validation and occupancy counting

**Files:**
- Modify: `reservas.gs`
- Test: `tests/reservas.test.mjs`

**Interfaces:**
- Consumes: `capacidades_`, `capacidadeDe_` from Task 1.
- Produces: `normalizarData_(v) -> string` (`"AAAA-MM-DD"`, accepts a `Date` or a string); `normalizarReserva_(v) -> string` (single `" | "` separator); `activos_(linhas, data, horario) -> number`; `linhaDoToken_(linhas, token) -> {indice, data, horario} | null` (`indice` is the 0-based index into `linhas`, header included); `validarPedido_(pedido, caps, hoje) -> {ok: true} | {ok: false, erro: string}` with `erro` one of `token_invalido`, `data_invalida`, `data_passada`, `horario_desconhecido`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/reservas.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test`
Expected: FAIL — `gs.normalizarData_ is not a function`.

- [ ] **Step 3: Write the implementation**

In `reservas.gs`, insert before the export block:

```js
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
```

Extend the export block to:

```js
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
```

- [ ] **Step 4: Run tests and the syntax gate**

Run: `node --test && node --check < reservas.gs`
Expected: PASS, 12 tests; no syntax output.

- [ ] **Step 5: Commit**

```bash
git add reservas.gs tests/reservas.test.mjs
git commit -m "$(cat <<'MSG'
Add normalisation, validation and occupancy counting to reservas.gs

activos_ is the only definition of live occupancy: rows in Reservas with
state "activo" for that date and slot. Form responses never enters the
count, only reconciliation, so the slot list and the claim cannot drift
apart the way the widget's two sources used to.

Dates are normalised on read because Sheets returns date cells as Date
objects, and validarPedido_ compares ISO strings directly since their
lexicographic order is chronological.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014w2ZAC4mUd953oDdz6qAZh
MSG
)"
```

---

### Task 3: Reconciliation planning

This is the task where a mistake loses real bookings, so read the safety rule in Step 3 before writing code.

**Files:**
- Modify: `reservas.gs`
- Test: `tests/reservas.test.mjs`

**Interfaces:**
- Consumes: `normalizarData_`, `normalizarReserva_` from Task 2.
- Produces: `colunaReserva_(linhas) -> number` (0-based column index, `-1` if not found); `contarSubmissoes_(linhas, idxColuna) -> Object` mapping `"AAAA-MM-DD | HH:MM-HH:MM"` to a count; `planoReconciliacao_(reservas, submissoes, agoraMs, janelaMs) -> number[]` (ascending row indices to mark `expirado`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/reservas.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test`
Expected: FAIL — `gs.colunaReserva_ is not a function`.

- [ ] **Step 3: Write the implementation**

**Safety rule, and the reason this task is dangerous.** Reconciliation releases claims that have no matching submission row. If the `Reserva` column cannot be found, every count is zero, every old claim looks orphaned, and reconciliation would release *real* bookings — reopening slots and causing exactly the overbooking this whole change exists to prevent. So a missing column, or a missing `Form responses` tab, must make reconciliation a **no-op**. That guard lives in the shell (Task 4); `colunaReserva_` returning `-1` is how it is signalled.

In `reservas.gs`, insert before the export block:

```js
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
function colunaReserva_(linhas) {
  if (!linhas || !linhas.length) return -1;

  var cabecalho = linhas[0] || [];
  for (var c = 0; c < cabecalho.length; c++) {
    if (/reserva/i.test(String(cabecalho[c] == null ? "" : cabecalho[c]))) return c;
  }

  // Rede de segurança: a coluna com mais valores no formato certo.
  var melhor = -1;
  var melhorContagem = 0;
  var largura = 0;
  for (var i = 0; i < linhas.length; i++) {
    largura = Math.max(largura, (linhas[i] || []).length);
  }
  for (var col = 0; col < largura; col++) {
    var n = 0;
    for (var r = 1; r < linhas.length; r++) {
      var v = normalizarReserva_((linhas[r] || [])[col]);
      if (FORMATO_RESERVA_COMPLETO.test(v)) n++;
    }
    if (n > melhorContagem) {
      melhorContagem = n;
      melhor = col;
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
```

Add `colunaReserva_`, `contarSubmissoes_` and `planoReconciliacao_` to the export block.

- [ ] **Step 4: Run tests and the syntax gate**

Run: `node --test && node --check < reservas.gs`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add reservas.gs tests/reservas.test.mjs
git commit -m "$(cat <<'MSG'
Add count-based reconciliation planning to reservas.gs

A real booking leaves a row in both Reservas and Form responses; an
abandoned one leaves only the first. So the surplus of claims older than
the window, over the submissions actually recorded for that slot, are
orphans and can be released.

Matching on counts rather than identity is what avoids needing a new
hidden JotForm field to carry the token. The cost is that we cannot tell
which row is the orphan, only how many there are.

colunaReserva_ returns -1 when it cannot find the column. Callers must
treat that as "reconcile nothing": with every count at zero, every old
claim would look abandoned and real bookings would be released, reopening
slots and causing the overbooking this change exists to prevent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014w2ZAC4mUd953oDdz6qAZh
MSG
)"
```

---

### Task 4: The Apps Script shell — `doGet`, `doPost`, and the mutex

**Files:**
- Modify: `reservas.gs`
- Test: `tests/reservas.test.mjs`

**Interfaces:**
- Consumes: every pure helper from Tasks 1-3.
- Produces: `preparar()` (owner runs once: creates both tabs, seeds capacities); `limparTestes()` (deletes rows whose token starts with `conc-teste-`); `doGet(e)`; `doPost(e)`; `reservar_(pedido) -> object` (the claim, pure logic plus injected I/O — the testable core of `doPost`).

`reservar_` takes an I/O object so the mutex logic can be tested without Apps Script:

```
reservar_(pedido, io) where io = {
  lerReservas() -> any[][],
  lerCapacidades() -> any[][],
  lerSubmissoes() -> any[][] | null,
  acrescentar(linha) -> void,
  expirar(indices) -> void,
  agora() -> number
}
```

- [ ] **Step 1: Write the failing tests**

Append to `tests/reservas.test.mjs`:

```js
function ioFalso(reservas, opcoes = {}) {
  const estado = {
    reservas: reservas.map(l => l.slice()),
    acrescentadas: [],
    expiradas: []
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test`
Expected: FAIL — `gs.reservar_ is not a function`.

- [ ] **Step 3: Write the implementation**

In `reservas.gs`, insert before the export block:

```js
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
```

Add near the top constants:

```js
var JANELA_ORFAS_MS = 20 * 60 * 1000;
var ESPERA_LOCK_MS = 20000;
var ESPERA_LOCK_GET_MS = 5000;
```

Then add the Apps Script shell (not unit-tested — verified by Task 6):

```js
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
    acrescentar: function (linha) { folha_(ABA_RESERVAS, true).appendRow(linha); },
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
```

Add `reservar_` to the export block.

- [ ] **Step 4: Run tests and the syntax gate**

Run: `node --test && node --check < reservas.gs`
Expected: PASS, 32 tests.

- [ ] **Step 5: Commit**

```bash
git add reservas.gs tests/reservas.test.mjs
git commit -m "$(cat <<'MSG'
Add the claim core, doGet/doPost and the LockService mutex

reservar_ holds all the logic with I/O injected, so the ordering that
matters can be tested in Node without Apps Script. Capacity is checked
before the token's previous claim is released: otherwise a guest switching
to a full slot would lose the seat they already held and gain nothing.

Reconciliation runs on the claim path only when the slot looks full, since
that is the only case where it can change the answer, and on GET as well —
a slot whose seats are all orphans would show "Sem vagas", nobody would
submit against it, and the claim-path cleanup would never fire.

preparar() creates the tabs and seeds capacities so the owner never has to
build them by hand; limparTestes() removes concurrency-test rows for the
same reason.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014w2ZAC4mUd953oDdz6qAZh
MSG
)"
```

---

### Task 5: The owner's installation guide

**Files:**
- Create: `docs/instalacao-reservas.md`

**Interfaces:**
- Consumes: `preparar()`, `doGet`, `doPost` from Task 4.
- Produces: the deploy URL, which Task 7 puts into `widget.js` as `RESERVAS_URL`.

- [ ] **Step 1: Write the guide**

It must be forwardable on its own — the owner has no context and will not read the spec. Portuguese, numbered, naming exactly what they will see on screen.

Create `docs/instalacao-reservas.md`:

```markdown
# Instalar o sistema de reservas (15 minutos)

Isto instala um pequeno programa dentro da folha de cálculo das respostas
do formulário. Serve para impedir que dois hóspedes reservem o mesmo lugar
ao pequeno-almoço.

Não é preciso instalar nada no computador. Só precisa da conta Google que é
dona da folha de cálculo das respostas.

## 1. Abrir o editor

1. Abra a folha de cálculo das respostas do formulário.
2. No menu de cima: **Extensões → Apps Script**.
3. Abre-se um separador novo com um ficheiro chamado `Código.gs` e umas
   linhas de exemplo lá dentro.

## 2. Colar o programa

1. Apague **tudo** o que está nesse ficheiro.
2. Cole o conteúdo do ficheiro `reservas.gs` que lhe foi enviado.
3. Clique no ícone do disquete (**Guardar projeto**).

## 3. Definir o fuso horário

1. À esquerda, clique na roda dentada (**Definições do projeto**).
2. Em **Fuso horário**, escolha **(GMT+00:00) Lisbon**.

Isto é importante: sem o fuso certo, as reservas de madrugada ficam no dia
errado.

## 4. Criar as abas

1. Volte ao **Editor** (o ícone `<>` à esquerda).
2. Na barra de cima, na caixa que diz o nome da função, escolha
   **preparar**.
3. Clique em **Executar**.
4. Na primeira vez a Google pede autorização: **Rever autorizações** →
   escolha a sua conta → **Avançadas** → **Ir para (nome do projeto)** →
   **Permitir**. É normal; o programa é seu e só toca nesta folha.
5. Volte à folha de cálculo. Deve ver duas abas novas em baixo:
   **Reservas** e **Capacidades**.

## 5. Conferir as capacidades

Abra a aba **Capacidades**. Deve ter:

| horario | vagas |
|---|---|
| 08:00-08:45 | 3 |
| 08:45-09:30 | 2 |
| 09:30-10:15 | 3 |
| 10:15-11:00 | 2 |

**É aqui que muda os horários e o número de lugares.** Alterar um número
tem efeito imediato, sem mexer em mais nada. Para fechar um horário, ponha
`0`. Para acrescentar um horário, acrescente uma linha no mesmo formato
(`HH:MM-HH:MM`).

Não mude os nomes das colunas nem apague a primeira linha.

## 6. Publicar

1. No editor do Apps Script, canto superior direito: **Implementar → Nova
   implementação**.
2. Na roda dentada ao lado de "Selecionar tipo", escolha **Aplicação web**.
3. Preencha:
   - **Descrição:** `Reservas`
   - **Executar como:** **Eu**
   - **Quem tem acesso:** **Qualquer pessoa**
4. Clique **Implementar**.
5. Copie o **URL da aplicação web**. É um endereço comprido que começa por
   `https://script.google.com/macros/s/...`.

**Envie esse URL.** É a única coisa de que preciso para ligar o formulário.

"Qualquer pessoa" é necessário porque quem preenche o formulário não tem
sessão Google. O programa só responde com o número de lugares livres e só
aceita marcar reservas — não deixa ninguém ler a folha.

## 7. Se mais tarde alterar o programa

Alterar as capacidades **não** exige republicar: são lidas da folha a cada
pedido.

Se alterar o próprio programa, tem de fazer **Implementar → Gerir
implementações → (lápis) → Versão: Nova versão → Implementar**. O URL
mantém-se.

## Aviso

Não escreva à mão na aba **Reservas**. É o programa que a mantém. Se
precisar de apagar as linhas de teste, execute a função **limparTestes**
como no ponto 4.
```

- [ ] **Step 2: Check the guide against the script**

Confirm every function name the guide tells the owner to run exists in `reservas.gs`:

Run: `grep -n 'function preparar\|function limparTestes' reservas.gs`
Expected: both found.

- [ ] **Step 3: Commit**

```bash
git add docs/instalacao-reservas.md
git commit -m "$(cat <<'MSG'
Add the owner's installation guide for reservas.gs

Written to be forwarded on its own: the owner has no context and will not
read the spec, so it names what they see on screen and explains the scary
authorisation prompt rather than assuming they will click through it.

Capacities are called out as the one thing they can safely change, and the
Reservas tab as the one thing they must not type into.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014w2ZAC4mUd953oDdz6qAZh
MSG
)"
```

---

### Task 6: Deploy and verify the lock is real

**This task is a gate.** The design rests on two assumptions that only a real deployment can settle: that Apps Script accepts a cross-origin `POST` without a preflight, and that `LockService` genuinely serialises simultaneous claims. Do not start Task 7 until both are confirmed.

**Files:** none — verification only. Record the results in the plan or the commit message for Task 7.

**Interfaces:**
- Consumes: the deploy URL from Task 5.
- Produces: a confirmed working URL for `RESERVAS_URL`.

- [ ] **Step 1: Send the guide and script to the owner, and wait for the URL**

Hand over `docs/instalacao-reservas.md` and `reservas.gs`. Ask them to reply with the web app URL.

- [ ] **Step 2: Verify `GET`**

```bash
URL="<o URL da aplicação web>"
curl -sS -L "$URL?data=2026-12-31"
```

Expected: `{"ok":true,"data":"2026-12-31","slots":[{"horario":"08:00-08:45","capacidade":3,"restantes":3}, ...]}`

If it returns HTML instead of JSON, the deployment's "Who has access" is not `Anyone`. If it returns `capacidades_ilegiveis`, `preparar()` was not run.

- [ ] **Step 3: Verify `POST` crosses origins without a preflight**

The `Content-Type` must be `text/plain;charset=utf-8`. Apps Script has no `doOptions`, so `application/json` would trigger a CORS preflight the server cannot answer, and the browser would block it — while `curl` would still succeed. So also check the response carries a permissive CORS header.

```bash
curl -sS -L -D /tmp/hdr.txt -X POST "$URL" \
  -H 'Content-Type: text/plain;charset=utf-8' \
  -H 'Origin: https://anamfdesigner-afk.github.io' \
  -d '{"acao":"reservar","token":"conc-teste-0","data":"2026-12-31","horario":"08:45-09:30"}'
grep -i 'access-control-allow-origin' /tmp/hdr.txt
```

Expected: `{"ok":true,"reservado":true,"estado":"novo"}` and an `access-control-allow-origin` header on the final response.

**If that header is absent, stop and report it.** The browser will block the call even though `curl` works, and the design needs revisiting — the fallback is a `<form>`-target or `no-cors` beacon, which cannot read a response and therefore cannot support failing closed.

- [ ] **Step 4: Verify idempotency**

```bash
curl -sS -L -X POST "$URL" -H 'Content-Type: text/plain;charset=utf-8' \
  -d '{"acao":"reservar","token":"conc-teste-0","data":"2026-12-31","horario":"08:45-09:30"}'
```

Expected: `{"ok":true,"reservado":true,"estado":"repetido"}` — the same token must not consume a second seat.

- [ ] **Step 5: The concurrency test — the only proof the lock works**

`08:45-09:30` has capacity 2, and `conc-teste-0` already holds one. Fire five *different* tokens simultaneously; exactly one more may succeed.

```bash
URL="<o URL>"
rm -f /tmp/conc-*.json
for i in 1 2 3 4 5; do
  curl -sS -L -o "/tmp/conc-$i.json" -X POST "$URL" \
    -H 'Content-Type: text/plain;charset=utf-8' \
    -d "{\"acao\":\"reservar\",\"token\":\"conc-teste-$i\",\"data\":\"2026-12-31\",\"horario\":\"08:45-09:30\"}" &
done
wait
cat /tmp/conc-*.json
echo "aceites: $(grep -l '"reservado":true' /tmp/conc-*.json | wc -l)"
```

Expected: `aceites: 1`, and the other four returning `{"ok":true,"reservado":false,"motivo":"cheio","restantes":0}`.

If more than one is accepted, the lock is not working — check that `doPost` wraps `reservar_` in `tryLock`/`releaseLock` and that `ioReal_().expirar` calls `SpreadsheetApp.flush()`. Do not proceed.

- [ ] **Step 6: Verify the slot now reads as full**

```bash
curl -sS -L "$URL?data=2026-12-31"
```

Expected: `08:45-09:30` shows `"restantes":0`.

- [ ] **Step 7: Clean up the test rows**

Ask the owner to run **limparTestes** from the Apps Script editor (guide, section 4), or run it yourself if you have editor access. Then confirm:

```bash
curl -sS -L "$URL?data=2026-12-31"
```

Expected: `08:45-09:30` back to `"restantes":2`.

**Never delete these rows by typing in the spreadsheet.**

- [ ] **Step 8: Confirm the reconciliation prerequisite**

Reconciliation compares against the `Reserva` column in `Form responses`. `CLAUDE.md` lists "map `Reserva` into the Google Sheets integration" as still pending. Ask the owner to confirm a recent submission actually produced a `Reserva` value in that tab, and read it visually — that sheet is not readable programmatically (CSV export returns 401, `gviz` needs OAuth).

If it is not mapped: the lock still works correctly, but abandoned seats never auto-release. Record that as a known gap and continue.

---

### Task 7: Point the widget at the new endpoint

Reads only — no claiming yet. After this task vacancy counts become live, which is already a visible improvement, and the widget's behaviour on submit is unchanged.

**Files:**
- Modify: `widget.js`
- Create: `tests/widget.test.mjs`
- Modify: `tests/carregar.mjs`

**Interfaces:**
- Consumes: the verified URL from Task 6.
- Produces: `buscarVagas(data) -> Promise<Array<{horario, capacidade, restantes}>>`; the module-export block on `widget.js` exposing `formatarValor`, `hojeLocal`, `buscarVagas`, `carregarSlots`, `selecionar`.

- [ ] **Step 1: Add the widget loader to the test harness**

Append to `tests/carregar.mjs`:

```js
// Esboço mínimo de DOM: só o suficiente para o widget.js arrancar fora do
// browser. O widget mexe no DOM ao carregar (iniciarUI), por isso não dá
// para o importar sem isto.
export function elementoFalso() {
  const el = {
    hidden: false, textContent: "", value: "", min: "",
    filhos: [], dataset: {}, ouvintes: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(tipo, fn) { (el.ouvintes[tipo] ||= []).push(fn); },
    setAttribute() {},
    appendChild(c) { el.filhos.push(c); return c; },
    querySelectorAll: seletor =>
      seletor === "button" ? el.filhos.filter(f => f.etiqueta === "button") : []
  };
  return el;
}

export function carregarWidget(caminho, stubs = {}) {
  const els = {};
  const documento = {
    getElementById: id => (els[id] ||= elementoFalso()),
    createElement: etiqueta => Object.assign(elementoFalso(), { etiqueta }),
    body: { scrollHeight: 400 }
  };
  const mod = { exports: {} };
  const nomes = ["document", "location", "JFCustomWidget", "fetch", "crypto", "console"];
  const dados = {
    document: documento,
    location: { search: "" },
    JFCustomWidget: undefined,
    fetch: async () => { throw new Error("fetch inesperado no teste"); },
    crypto: { randomUUID: () => "abcd-1234-efgh-5678" },
    console: { log() {}, error() {} },
    ...stubs
  };
  new Function("module", ...nomes, readFileSync(caminho, "utf8"))(mod, ...nomes.map(n => dados[n]));
  return { api: mod.exports, els, documento };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/widget.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarWidget } from "./carregar.mjs";

const CAMINHO = new URL("../widget.js", import.meta.url).pathname;

function respostaJson(corpo, ok = true) {
  return async () => ({ ok, status: ok ? 200 : 500, json: async () => corpo });
}

test("o widget arranca sem browser e define o mínimo do datePicker", () => {
  const { els } = carregarWidget(CAMINHO);
  assert.match(els.datePicker.min, /^\d{4}-\d{2}-\d{2}$/);
});

test("formatarValor mantém o formato que a folha espera", () => {
  const { api } = carregarWidget(CAMINHO);
  assert.equal(api.formatarValor("2026-09-08", "08:00-08:45"), "2026-09-08 | 08:00-08:45");
});

test("buscarVagas devolve os slots do endpoint", async () => {
  const slots = [{ horario: "08:00-08:45", capacidade: 3, restantes: 1 }];
  const { api } = carregarWidget(CAMINHO, {
    fetch: respostaJson({ ok: true, data: "2026-09-08", slots })
  });
  assert.deepEqual(await api.buscarVagas("2026-09-08"), slots);
});

test("buscarVagas pede a data certa por query string", async () => {
  let pedido = null;
  const { api } = carregarWidget(CAMINHO, {
    fetch: async url => {
      pedido = url;
      return { ok: true, status: 200, json: async () => ({ ok: true, slots: [] }) };
    }
  });
  await api.buscarVagas("2026-09-08");
  assert.match(pedido, /[?&]data=2026-09-08/);
});

test("buscarVagas estoura quando a resposta não tem ok", async () => {
  const { api } = carregarWidget(CAMINHO, {
    fetch: respostaJson({ ok: false, erro: "capacidades_ilegiveis" })
  });
  await assert.rejects(() => api.buscarVagas("2026-09-08"), /capacidades_ilegiveis/);
});

test("buscarVagas estoura num HTTP de erro", async () => {
  const { api } = carregarWidget(CAMINHO, { fetch: respostaJson({}, false) });
  await assert.rejects(() => api.buscarVagas("2026-09-08"), /HTTP 500/);
});

test("carregarSlots desenha um botão por slot com vagas e texto para os cheios", async () => {
  const { api, els } = carregarWidget(CAMINHO, {
    fetch: respostaJson({
      ok: true,
      slots: [
        { horario: "08:00-08:45", capacidade: 3, restantes: 2 },
        { horario: "08:45-09:30", capacidade: 2, restantes: 0 }
      ]
    })
  });
  els.datePicker.value = "2026-09-08";
  await api.carregarSlots("2026-09-08");

  const botoes = els.slotsList.filhos.filter(f => f.etiqueta === "button");
  assert.equal(botoes.length, 1);
  assert.equal(botoes[0].dataset.slot, "08:00-08:45");

  const paragrafos = els.slotsList.filhos.filter(f => f.etiqueta === "p");
  assert.equal(paragrafos.length, 1);
  assert.match(paragrafos[0].textContent, /08:45-09:30.*Sem vagas/);
});

test("carregarSlots mostra erro quando o endpoint falha", async () => {
  const { api, els } = carregarWidget(CAMINHO, {
    fetch: async () => { throw new Error("rede morreu"); }
  });
  await api.carregarSlots("2026-09-08");
  assert.match(els.slotsList.textContent, /Erro ao carregar vagas/);
});

test("selecionar ignora um botão cuja data não é a que está à vista", async () => {
  const { api, els } = carregarWidget(CAMINHO, {
    fetch: respostaJson({ ok: true, slots: [] })
  });
  els.datePicker.value = "2026-09-08";
  api.selecionar("0202-09-10", "08:00-08:45");
  assert.equal(els.estado.textContent, "Nenhum horário escolhido.");
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test`
Expected: FAIL — `api.buscarVagas is not a function` (`widget.js` has no export block yet).

- [ ] **Step 4: Rewrite the widget's read path**

In `widget.js`:

Replace the whole `SHEETY_GET_URL` / `SHEETY_COLLECTION` / `COLUNA_DATA` / `COLUNA_HORARIO` / `COLUNAS_RESERVA` config block with:

```js
// URL da aplicação web do Apps Script (ver docs/instalacao-reservas.md).
// Só expõe contagens de vagas e aceita marcar reservas; não dá para ler a
// folha através dele.
const RESERVAS_URL =
  "<URL confirmado na Task 6>";

// Token desta sessão. A reserva no servidor é idempotente por token: se um
// pedido der timeout podemos repeti-lo sem consumir dois lugares, e um
// hóspede que corrija outro campo e volte a submeter continua com um só.
// Recarregar a página gera novo token (ver riscos no spec).
const TOKEN = (function () {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* browsers antigos */ }
  return "t-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
})();
```

Delete `SLOTS` (capacities now come from the endpoint), and delete `FORMATO_RESERVA`, `normalizarData`, `normalizarReserva`, `valorCombinado`, `linhaOcupaSlot`, `buscarReservas`, `limiteDoSlot`, `vagasRestantes`.

Replace the "LEITURA DA FOLHA" section with:

```js
// ===============================
// LEITURA DAS VAGAS
// ===============================
// O widget já não interpreta uma folha de cálculo: recebe números. Foi
// sempre um nome de coluna que não casava — em silêncio — a causa dos bugs
// anteriores.
async function buscarVagas(data) {
  const url = RESERVAS_URL + "?data=" + encodeURIComponent(data);
  const resposta = await fetch(url, { cache: "no-store" });
  if (!resposta.ok) throw new Error("HTTP " + resposta.status);
  const corpo = await resposta.json();
  if (!corpo || !corpo.ok) throw new Error((corpo && corpo.erro) || "resposta sem ok");
  return corpo.slots || [];
}
```

Rewrite `carregarSlots` — keep the generation guard exactly as it is:

```js
async function carregarSlots(selectedDate) {
  if (!selectedDate) return;

  // O <input type="date"> dispara "change" por segmento, por isso podem
  // ficar vários pedidos em curso. Sem esta guarda, o que respondesse por
  // ÚLTIMO desenhava os botões — e os botões guardam a data no closure.
  // Sintoma real observado: escrever 09/10/2026 e sair "0202-09-10".
  const minhaGeracao = ++geracao;

  slotsDiv.hidden = false;
  slotsList.textContent = "A carregar...";
  ajustarAltura();

  let slots;
  try {
    slots = await buscarVagas(selectedDate);
    if (minhaGeracao !== geracao) return;
    log(`${slots.length} horários recebidos para ${selectedDate}.`);
  } catch (err) {
    if (minhaGeracao !== geracao) return;
    console.error("Erro ao carregar vagas", err);
    slotsList.textContent = "Erro ao carregar vagas. Tente novamente.";
    log("ERRO no GET das vagas: " + err.message);
    ajustarAltura();
    return;
  }

  slotsList.textContent = "";

  slots.forEach(slot => {
    if (slot.restantes <= 0) {
      const p = document.createElement("p");
      p.textContent = `${slot.horario} — Sem vagas`;
      slotsList.appendChild(p);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.slot = slot.horario;
    btn.dataset.restantes = slot.restantes;
    btn.addEventListener("click", () => selecionar(selectedDate, slot.horario));
    slotsList.appendChild(btn);
  });

  desenharBotoes();
  ajustarAltura();
}
```

At the very end of `widget.js` add:

```js
// Só para os testes em Node. No browser "module" não existe, logo este
// bloco é ignorado.
if (typeof module !== "undefined") {
  module.exports = {
    formatarValor: formatarValor,
    hojeLocal: hojeLocal,
    buscarVagas: buscarVagas,
    carregarSlots: carregarSlots,
    selecionar: selecionar
  };
}
```

- [ ] **Step 5: Run tests and the syntax gate**

Run: `node --test && node --check widget.js`
Expected: PASS, 41 tests.

- [ ] **Step 6: Check locally in a browser**

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765/index.html?debug=1`, then drive the field from JS rather than clicking it — the native date-picker popup freezes CDP screenshots once open:

```js
const dp = document.getElementById('datePicker');
dp.value = '2026-12-31';
dp.dispatchEvent(new Event('change'));
```

Expected: slots render with real remaining counts from the endpoint, and the debug panel shows the horários received.

- [ ] **Step 7: Commit and deploy**

```bash
node --check widget.js
git add widget.js tests/carregar.mjs tests/widget.test.mjs
git commit -m "$(cat <<'MSG'
Read vacancies from the Apps Script endpoint instead of Sheety

Vacancy counts were frozen because nothing had written to the Sheety sheet
since the widget stopped POSTing to it. Counts now come from the claim
ledger, so they actually go down.

The widget no longer parses a spreadsheet at all: it receives numbers, and
slot times and capacities come from the Capacidades tab. That deletes the
tolerant column-guessing along with the whole class of bug it existed to
work around, and it removes the Sheety endpoint from this public repo.

Submit behaviour is deliberately unchanged in this commit; claiming lands
next.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014w2ZAC4mUd953oDdz6qAZh
MSG
)"
git push origin main
```

- [ ] **Step 8: Confirm the deploy actually landed**

Pages serves with `max-age=600`, so a browser that already has the old copy keeps it for up to 10 minutes. Do not assume — poll:

```bash
until curl -sS -H 'Cache-Control: no-cache' \
  https://anamfdesigner-afk.github.io/calendario-widget/widget.js | diff -q - widget.js; do
  echo "ainda não; a esperar"; sleep 15
done
echo "live matches HEAD"
```

---

### Task 8: Claim at submit, failing closed

**Files:**
- Modify: `widget.js`
- Modify: `tests/widget.test.mjs`

**Interfaces:**
- Consumes: `buscarVagas`, `TOKEN`, `RESERVAS_URL` from Task 7.
- Produces: `pedirReserva(data, horario) -> Promise<object>`; `reservarLugar(data, horario) -> Promise<object>` (one retry); `comPrazo(promessa, ms) -> Promise` (rejects with `Error("prazo esgotado")`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/widget.test.mjs`:

```js
function jfFalso() {
  const registo = { submits: [], erros: [], dados: [], campos: [] };
  return {
    registo,
    jf: {
      subscribe(evento, fn) { (registo[evento] ||= []).push(fn); },
      sendData(d) { registo.dados.push(d); },
      sendSubmit(s) { registo.submits.push(s); },
      showWidgetError(m) { registo.erros.push(m); },
      hideWidgetError() {},
      requestFrameResize() {},
      isWidgetOnBuilder: () => false,
      setFieldsValueById(o) { registo.campos.push(o); },
      setFieldsValueByLabel(o) { registo.campos.push(o); }
    }
  };
}

test("pedirReserva envia text/plain, para não disparar preflight CORS", async () => {
  let opcoes = null;
  const { api } = carregarWidget(CAMINHO, {
    fetch: async (url, o) => {
      opcoes = o;
      return { ok: true, status: 200, json: async () => ({ ok: true, reservado: true, estado: "novo" }) };
    }
  });
  await api.pedirReserva("2026-09-08", "08:00-08:45");
  assert.equal(opcoes.method, "POST");
  assert.match(opcoes.headers["Content-Type"], /^text\/plain/);
  const corpo = JSON.parse(opcoes.body);
  assert.equal(corpo.acao, "reservar");
  assert.equal(corpo.data, "2026-09-08");
  assert.equal(corpo.horario, "08:00-08:45");
  assert.match(corpo.token, /^[A-Za-z0-9-]{8,64}$/);
});

test("reservarLugar repete uma vez antes de desistir", async () => {
  let tentativas = 0;
  const { api } = carregarWidget(CAMINHO, {
    fetch: async () => {
      tentativas++;
      if (tentativas === 1) throw new Error("rede falhou");
      return { ok: true, status: 200, json: async () => ({ ok: true, reservado: true, estado: "novo" }) };
    }
  });
  const r = await api.reservarLugar("2026-09-08", "08:00-08:45");
  assert.equal(tentativas, 2);
  assert.equal(r.reservado, true);
});

test("reservarLugar estoura quando as duas tentativas falham", async () => {
  const { api } = carregarWidget(CAMINHO, {
    fetch: async () => { throw new Error("rede falhou"); }
  });
  await assert.rejects(() => api.reservarLugar("2026-09-08", "08:00-08:45"), /rede falhou/);
});

test("submit com reserva aceita espelha o valor e valida", async () => {
  const { jf, registo } = jfFalso();
  const { api, els } = carregarWidget(CAMINHO, {
    JFCustomWidget: jf,
    fetch: async (url, o) =>
      o && o.method === "POST"
        ? { ok: true, status: 200, json: async () => ({ ok: true, reservado: true, estado: "novo" }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, slots: [{ horario: "08:00-08:45", capacidade: 3, restantes: 2 }] }) }
  });
  els.datePicker.value = "2026-09-08";
  await api.carregarSlots("2026-09-08");
  api.selecionar("2026-09-08", "08:00-08:45");

  await api.tratarSubmit();
  assert.deepEqual(registo.submits, [{ valid: true, value: "2026-09-08 | 08:00-08:45" }]);
  assert.deepEqual(registo.erros, []);
});

test("submit com slot cheio recusa e não valida", async () => {
  const { jf, registo } = jfFalso();
  const { api, els } = carregarWidget(CAMINHO, {
    JFCustomWidget: jf,
    fetch: async (url, o) =>
      o && o.method === "POST"
        ? { ok: true, status: 200, json: async () => ({ ok: true, reservado: false, motivo: "cheio", restantes: 0 }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, slots: [{ horario: "08:00-08:45", capacidade: 3, restantes: 1 }] }) }
  });
  els.datePicker.value = "2026-09-08";
  await api.carregarSlots("2026-09-08");
  api.selecionar("2026-09-08", "08:00-08:45");

  await api.tratarSubmit();
  assert.equal(registo.submits.length, 0, "showWidgetError já envia valid:false por dentro");
  assert.match(registo.erros[0], /sem vagas/i);
});

test("submit FALHA FECHADA quando o serviço não responde", async () => {
  const { jf, registo } = jfFalso();
  const { api, els } = carregarWidget(CAMINHO, {
    JFCustomWidget: jf,
    fetch: async (url, o) => {
      if (o && o.method === "POST") throw new Error("serviço morto");
      return { ok: true, status: 200, json: async () => ({ ok: true, slots: [{ horario: "08:00-08:45", capacidade: 3, restantes: 2 }] }) };
    }
  });
  els.datePicker.value = "2026-09-08";
  await api.carregarSlots("2026-09-08");
  api.selecionar("2026-09-08", "08:00-08:45");

  await api.tratarSubmit();
  assert.equal(registo.submits.length, 0, "não deixamos passar sem confirmação");
  assert.match(registo.erros[0], /Não foi possível confirmar/);
});

test("submit sem escolha e obrigatório mostra erro e não chama sendSubmit", async () => {
  const { jf, registo } = jfFalso();
  const { api } = carregarWidget(CAMINHO, { JFCustomWidget: jf });
  await api.tratarSubmit();
  assert.equal(registo.submits.length, 0);
  assert.match(registo.erros[0], /Escolha uma data/);
});

test("o submit responde SEMPRE, por um caminho ou pelo outro", async () => {
  const { jf, registo } = jfFalso();
  const { api, els } = carregarWidget(CAMINHO, {
    JFCustomWidget: jf,
    fetch: async (url, o) => {
      if (o && o.method === "POST") return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ ok: true, slots: [{ horario: "08:00-08:45", capacidade: 3, restantes: 2 }] }) };
    }
  });
  els.datePicker.value = "2026-09-08";
  await api.carregarSlots("2026-09-08");
  api.selecionar("2026-09-08", "08:00-08:45");
  await api.tratarSubmit();
  // O formulário fica pendurado se não houver resposta nenhuma.
  assert.equal(registo.submits.length + registo.erros.length > 0, true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test`
Expected: FAIL — `api.pedirReserva is not a function`.

- [ ] **Step 3: Replace the submit path**

In `widget.js`, delete `TIMEOUT_REVALIDACAO_MS` and the whole `slotAindaTemVagas` function, and add:

```js
// Orçamento por tentativa de reserva. Duas tentativas, logo o pior caso é
// o dobro. Mantido curto porque o formulário está à espera da resposta.
const ORCAMENTO_RESERVA_MS = 5000;
```

Add before the JotForm wiring:

```js
// ===============================
// RESERVAR O LUGAR
// ===============================
function comPrazo(promessa, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("prazo esgotado")), ms);
    promessa.then(
      v => { clearTimeout(id); resolve(v); },
      e => { clearTimeout(id); reject(e); }
    );
  });
}

// text/plain é obrigatório: o Apps Script não tem doOptions, logo um
// application/json dispararia um preflight CORS que ninguém responde e o
// browser bloquearia o pedido (o curl passaria, o que engana).
async function pedirReserva(data, horario) {
  const resposta = await fetch(RESERVAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ acao: "reservar", token: TOKEN, data: data, horario: horario }),
    redirect: "follow"
  });
  if (!resposta.ok) throw new Error("HTTP " + resposta.status);
  const corpo = await resposta.json();
  if (!corpo || !corpo.ok) throw new Error((corpo && corpo.erro) || "resposta sem ok");
  return corpo;
}

// Uma repetição. É segura porque o servidor é idempotente por token: se o
// primeiro pedido chegou, o segundo devolve "repetido" e não gasta um
// segundo lugar.
async function reservarLugar(data, horario) {
  try {
    return await comPrazo(pedirReserva(data, horario), ORCAMENTO_RESERVA_MS);
  } catch (e) {
    log("1ª tentativa de reserva falhou (" + e.message + "); a repetir.");
    return await comPrazo(pedirReserva(data, horario), ORCAMENTO_RESERVA_MS);
  }
}

// ===============================
// SUBMISSÃO
// ===============================
// Extraída para poder ser testada. Responde SEMPRE: todos os caminhos
// acabam em sendSubmit ou em showWidgetError (que envia valid:false por
// dentro). Se algum ramo não respondesse, o hóspede ficava preso no botão.
async function tratarSubmit() {
  log(`Evento 'submit'. Valor: "${value}"`);

  if (OBRIGATORIO && value === "") {
    JFCustomWidget.showWidgetError("Escolha uma data e um horário.");
    return;
  }
  if (value === "") {
    JFCustomWidget.sendSubmit({ valid: true, value: value });
    return;
  }

  const partes = value.split("|");
  const dataEscolhida = (partes[0] || "").trim();
  const slotEscolhido = (partes[1] || "").trim();

  let r;
  try {
    r = await reservarLugar(dataEscolhida, slotEscolhido);
  } catch (e) {
    // FALHA FECHADA, por decisão do dono: sem confirmação não deixamos
    // passar, senão o lugar podia ficar sobre-reservado. Inverte o
    // comportamento antigo, que deixava passar quando a API falhava.
    log("Reserva não confirmada (" + e.message + "): a bloquear.");
    JFCustomWidget.showWidgetError(
      "Não foi possível confirmar a reserva. Tente novamente."
    );
    return;
  }

  if (!r.reservado) {
    log(`RECUSADO: ${slotEscolhido} ficou sem vagas.`);
    value = "";
    espelharEmCampo("");
    carregarSlots(dataEscolhida);
    JFCustomWidget.showWidgetError(
      "Esse horário acabou de ficar sem vagas. Escolha outro."
    );
    return;
  }

  log("Reserva confirmada: " + r.estado);
  espelharEmCampo(value);
  JFCustomWidget.sendSubmit({ valid: true, value: value });
}
```

Replace the `submit` subscriber body with:

```js
  JFCustomWidget.subscribe("submit", function () {
    // Nunca deixar a submissão pendurada: um throw aqui prendia o hóspede
    // no botão de submeter para sempre.
    tratarSubmit().catch(e => {
      log("ERRO inesperado no submit: " + e.message + " — a bloquear.");
      JFCustomWidget.showWidgetError(
        "Não foi possível confirmar a reserva. Tente novamente."
      );
    });
  });
```

Extend the export block with `pedirReserva`, `reservarLugar`, `comPrazo`, `tratarSubmit`.

- [ ] **Step 4: Run tests and the syntax gate**

Run: `node --test && node --check widget.js`
Expected: PASS, 49 tests.

- [ ] **Step 5: Verify `DEBUG_FORCADO` is off**

Run: `grep -n 'DEBUG_FORCADO = ' widget.js`
Expected: `const DEBUG_FORCADO = false;` — it shipped `true` once and guests saw the red panel.

- [ ] **Step 6: Commit and deploy**

```bash
node --check widget.js && node --test
git add widget.js tests/widget.test.mjs
git commit -m "$(cat <<'MSG'
Claim the seat atomically at submit, and fail closed

The submit-time re-check could only narrow the double-booking window: two
simultaneous submissions both passed it. The widget now claims the seat
through the Apps Script endpoint, which reserves under a script-wide mutex,
so the last seat can go to exactly one guest.

This reverses the documented fail-open behaviour: a submission the service
cannot confirm is now blocked, because failing open and guaranteeing no
overbooking are incompatible. The owner chose this explicitly. The GET on
date selection warms the runtime, so the claim is served warm.

The retry is safe because the server is idempotent by token. The handler
still always answers — every branch, including the catch, ends in
sendSubmit or showWidgetError.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014w2ZAC4mUd953oDdz6qAZh
MSG
)"
git push origin main
```

- [ ] **Step 7: Confirm the deploy landed**

```bash
until curl -sS -H 'Cache-Control: no-cache' \
  https://anamfdesigner-afk.github.io/calendario-widget/widget.js | diff -q - widget.js; do
  echo "ainda não; a esperar"; sleep 15
done
echo "live matches HEAD"
```

---

### Task 9: Verify on the live form, then update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (**never commit it**)

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Book a real slot on the published form**

Use the published link, never the builder — `sendData`/`sendSubmit` are ignored there, and the widget logs a warning to say so.

Open `https://form.jotform.com/253294429726062`, pick a date, pick a slot, submit.

Confirm, in order:

1. The parent's hidden input `q137_typeA137` is non-empty before submitting. If it is empty, `sendData` never fired and the click missed — that is a missed click, not a broken mirror. The widget iframe is cross-origin, so clicks must be by screen coordinate and the page reflows between screenshot and click.
2. A new row appears in the `Reservas` tab with state `activo`.
3. The `Reserva` column in `Form responses` carries the same value.

- [ ] **Step 2: Verify the slot count dropped**

```bash
curl -sS -L "$URL?data=<a data que reservou>"
```

Expected: `restantes` for that slot is one lower than before. **This is the thing that never worked before** — counts were frozen.

- [ ] **Step 3: Verify a full slot is refused end-to-end**

Fill the slot (adjust its capacity in the `Capacidades` tab to `1` if that is quicker than making real bookings — it takes effect immediately, no redeploy). Then try to book it from the published form.

Expected: `Esse horário acabou de ficar sem vagas. Escolha outro.` and the form does not submit.

Restore the capacity afterwards.

- [ ] **Step 4: Update `CLAUDE.md`**

Rewrite these parts to match reality:

- **"Two data stores, currently out of sync"** — replace entirely. There is now one live source: the `Reservas` tab via the Apps Script web app. Sheety is gone from the widget.
- **"Where the booking value actually goes"** — the mirror into `Reserva` is still the load-bearing export path and still needs the same warning. Add that the value is *also* now recorded in `Reservas` by the script, so a booking is no longer invisible if the mirror breaks.
- **Non-obvious invariants** — replace "the re-check fails open by design" with the opposite, and say why: failing open cannot coexist with a guarantee against overbooking, and the owner chose the guarantee.
- **Config constants** — drop `SHEETY_*`, `SLOTS`, `TIMEOUT_REVALIDACAO_MS`; add `RESERVAS_URL`, `TOKEN`, `ORCAMENTO_RESERVA_MS`.
- **Commands** — add `node --test` as a real gate, and `node --check < reservas.gs`.
- **Testing recipes** — replace "extract functions into a scratch ES module" with the permanent harness: `tests/carregar.mjs` loads both `reservas.gs` and `widget.js` in Node with stubs, no dependencies.
- **New section on the Apps Script side** — the CORS `text/plain` constraint, that changing capacities needs no redeploy but changing the script does, that `limparTestes()` exists so nobody types in the sheet, and that reconciliation is a no-op when the `Reserva` column cannot be found (and why that guard matters).
- **Known open issues** — remove "vacancy counts frozen" and "double-booking narrowed but not closed". Keep the Portuguese-UI-in-an-English-form item. Add: the token lives only in memory, so a page reload between submit attempts can consume two seats, released later by reconciliation; and deleting the always-empty `typeA137` column is still pending on the JotForm side.

- [ ] **Step 5: Confirm `CLAUDE.md` is still untracked**

```bash
git status --short
```

Expected: `?? CLAUDE.md`. If it shows as staged or tracked, unstage it — the owner asked that it not be committed.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §4 Architecture (three pieces) | 1-4, 7, 8 |
| §5 `Reservas` tab | 1 (`preparar`), 4 |
| §5 `Capacidades` tab, unreadable ⇒ no claim | 1, 4 |
| §6 `GET` contract | 4, 6 |
| §6 `POST` contract and all response shapes | 4, 6 |
| §6 Validation and error codes | 2 |
| §6 `Europe/Lisbon` timezone | 5 (guide, section 3) |
| §7 Atomic claim, lock, idempotency, switch ordering | 4 |
| §8 Reconciliation, both trigger paths, `-1` safety rule | 3, 4 |
| §9 Widget removals and additions | 7, 8 |
| §9 Submit flow, always answers | 8 |
| §10 Failure modes | 4 (unit), 6 (concurrency), 8 (fail closed) |
| §11 CORS `text/plain` | 6 (gate), 8 |
| §12 `Reserva` mapping prerequisite | 6 step 8 |
| §13 Testing | 1-4, 6-8 |
| §14 Rollout order | task order |
| §15 Open risks | 9 step 4 |

No gaps found.

**Placeholder scan:** one intentional placeholder remains — `RESERVAS_URL = "<URL confirmado na Task 6>"` in Task 7, which cannot be known until the owner deploys. Task 6 is a gate that produces it. Every other step contains real code.

**Type consistency:** `capacidades_` returns `Array<{horario, vagas}>` and `capacidadeDe_` consumes that array in Tasks 2 and 4. `linhaDoToken_` returns `{indice, data, horario}`, and Task 4 uses `existente.indice`, `.data`, `.horario`. `planoReconciliacao_` returns row indices, consumed by `io.expirar(indices)` in Task 4 and converted to 1-based sheet rows in `ioReal_`. `buscarVagas` returns objects keyed `horario`/`capacidade`/`restantes`, matching what `doGet` emits in Task 4 and what `carregarSlots` reads in Task 7. `reservar_` returns `{ok, reservado, estado}` / `{ok, reservado:false, motivo, restantes}` / `{ok:false, erro}`, matching what `tratarSubmit` branches on in Task 8.

**One deliberate inconsistency with the spec:** the spec's §6 lists `lock_indisponivel` among the `POST` errors; the implementation also returns `corpo_invalido`, `acao_desconhecida` and `erro_interno`. These are strictly additional failure codes on the same `{ok:false, erro}` shape, and the widget treats every `ok:false` identically — fail closed — so no behaviour depends on the list being exhaustive.
