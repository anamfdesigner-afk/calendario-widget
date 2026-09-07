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
