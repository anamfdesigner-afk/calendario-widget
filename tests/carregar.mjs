import { readFileSync } from "node:fs";

// Corre um ficheiro .gs no MESMO realm do Node (new Function, não vm), para
// que o assert.deepStrictEqual funcione: objetos criados dentro de um vm
// têm outro Object.prototype e o assert estrito rejeita-os.
//
// Os globais do Apps Script entram como PARÂMETROS da função, pelo que ficam
// sombreados dentro do script e podem ser esboçados nos testes.
export function carregarGs(caminho, stubs = {}) {
  const mod = { exports: {} };
  const nomes = [
    "SpreadsheetApp", "LockService", "Utilities", "ContentService", "PropertiesService",
    "ScriptApp"
  ];
  const fn = new Function("module", ...nomes, readFileSync(caminho, "utf8"));
  fn(mod, ...nomes.map(n => stubs[n]));
  return mod.exports;
}

// ===============================
// DOM MÍNIMO PARA O widget.js
// ===============================
// Não é um browser: é só o contrato entre o widget e a página, escrito à mão
// para os testes correrem em Node sem dependência nenhuma. Se o widget passar
// a tocar noutra parte do DOM, é aqui que se acrescenta.
class ElementoFalso {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.filhos = [];
    this.dataset = {};
    this.atributos = {};
    this.classes = new Set();
    this.ouvintes = {};
    this.hidden = false;
    this.value = "";
    this.min = "";
    this.type = "";
    this.texto = "";

    const classes = this.classes;
    this.classList = {
      toggle(nome, ligar) {
        if (ligar) classes.add(nome);
        else classes.delete(nome);
      },
      contains(nome) {
        return classes.has(nome);
      }
    };
  }

  // Como no DOM: ler junta o texto dos filhos, escrever apaga-os.
  get textContent() {
    if (this.filhos.length) return this.filhos.map(f => f.textContent).join("");
    return this.texto;
  }

  set textContent(v) {
    this.texto = String(v);
    this.filhos = [];
  }

  appendChild(filho) {
    this.filhos.push(filho);
    return filho;
  }

  addEventListener(tipo, fn) {
    if (!this.ouvintes[tipo]) this.ouvintes[tipo] = [];
    this.ouvintes[tipo].push(fn);
  }

  // Não existe no DOM: é como os testes carregam num botão ou mudam a data.
  disparar(tipo) {
    (this.ouvintes[tipo] || []).forEach(fn => fn());
  }

  setAttribute(nome, valor) {
    this.atributos[nome] = String(valor);
  }

  getAttribute(nome) {
    return Object.prototype.hasOwnProperty.call(this.atributos, nome)
      ? this.atributos[nome]
      : null;
  }

  // Só o seletor que o widget usa ("button"). Devolve um array — tem forEach,
  // que é tudo o que o desenharBotoes precisa.
  querySelectorAll(seletor) {
    const alvo = String(seletor).toUpperCase();
    return this.filhos.filter(f => f.tagName === alvo);
  }

  get scrollHeight() {
    return 100;
  }
}

export function documentoFalso() {
  const elementos = {
    datePicker: new ElementoFalso("input"),
    slots: new ElementoFalso("div"),
    slotsList: new ElementoFalso("div"),
    estado: new ElementoFalso("div"),
    debug: new ElementoFalso("div")
  };
  elementos.slots.hidden = true;
  elementos.debug.hidden = true;

  return {
    elementos,
    body: new ElementoFalso("body"),
    getElementById(id) {
      return Object.prototype.hasOwnProperty.call(elementos, id)
        ? elementos[id]
        : null;
    },
    createElement(tag) {
      return new ElementoFalso(tag);
    }
  };
}

// Os globais do browser que o widget.js toca. Entram como PARÂMETROS, pelo
// mesmo motivo do carregarGs: ficam sombreados dentro do ficheiro e um stub
// `undefined` é indistinguível de "não existe" (é assim que se testa o
// arranque sem JotForm e sem crypto.randomUUID).
const AMBIENTE_WIDGET = [
  "document", "location", "JFCustomWidget", "fetch", "crypto",
  "console", "setTimeout", "clearTimeout"
];

export function carregarWidget(caminho, stubs = {}) {
  const documento = "document" in stubs ? stubs.document : documentoFalso();

  const padroes = {
    document: documento,
    location: { search: "" },
    JFCustomWidget: undefined,
    fetch: async () => { throw new Error("fetch não esboçado neste teste"); },
    crypto: { randomUUID: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    // Silencioso por omissão: o widget regista muito, e o `node --test` fica
    // ilegível com isso pelo meio.
    console: { log() {}, error() {}, warn() {} },
    setTimeout,
    clearTimeout
  };

  const valores = AMBIENTE_WIDGET.map(
    n => (n in stubs ? stubs[n] : padroes[n])
  );

  // O OBRIGATORIO é uma constante do ficheiro e não há maneira de o mudar de
  // fora. Para exercitar o ramo "não obrigatório" da submissão, o teste troca
  // a linha na FONTE — e confirma que a troca aconteceu, senão passaria a
  // testar o outro ramo em silêncio.
  let fonte = readFileSync(caminho, "utf8");
  if (typeof stubs.transformarFonte === "function") fonte = stubs.transformarFonte(fonte);

  const mod = { exports: {} };
  const fn = new Function("module", ...AMBIENTE_WIDGET, fonte);
  fn(mod, ...valores);
  return { widget: mod.exports, documento };
}
