# Bloquear horários já reservados (lock atómico de vagas)

*Design / spec — 2026-09-07*

## 1. Problema

O widget lê as vagas de uma folha Sheety antiga que **já não recebe escritas**. As reservas
novas são gravadas pela integração JotForm → Google Sheets noutra folha. Consequência: as
contagens de vagas estão congeladas e nunca descem, e a revalidação na submissão
(`slotAindaTemVagas`) está inerte — passa sempre, porque consulta uma folha que nunca muda.

Além disso, mesmo com a leitura corrigida, duas submissões simultâneas podem passar as duas
na verificação: não existe nada do lado do servidor que reserve de forma atómica.

## 2. Objetivos

- As vagas mostradas refletem as reservas reais e descem à medida que há reservas.
- **É impossível sobre-reservar**, mesmo com submissões simultâneas.
- Uma reserva abandonada não consome um lugar para sempre.
- O dono do hotel pode alterar horários e capacidades sem tocar em código.

### Não-objetivos

- Não há hold ao escolher o horário: navegar no calendário não consome lugares.
- Não há cancelamento nem alteração de reservas pelo hóspede.
- Não se traduz a interface (assunto separado, já oferecido ao dono).

## 3. Decisões tomadas

| Decisão | Escolha |
|---|---|
| Rigor do lock | Impossível sobre-reservar (atómico) |
| Onde vive o lock | Google Apps Script Web App ligado à folha das submissões |
| Quem instala | O dono da folha, com um guia em português escrito para o efeito |
| Momento em que o lugar é tomado | Na submissão do formulário |
| Reservas abandonadas | Libertadas automaticamente, por reconciliação de contagens |
| Sem resposta do serviço | **Falha fechada** — a submissão é bloqueada |
| Capacidades | Numa aba `Capacidades`, editável no Sheets |

A última linha inverte um invariante documentado no `CLAUDE.md` ("a revalidação falha aberta
por desenho: uma API morta não deve bloquear todas as reservas"). A inversão é deliberada:
falhar aberta e garantir que não há sobre-reserva são incompatíveis. Mitigação: o `GET` das
vagas, feito quando o hóspede escolhe a data, aquece o runtime do Apps Script, pelo que na
submissão o serviço está quente (~300–600 ms em vez de arranque a frio de 1–3 s).

## 4. Arquitetura

Três peças:

1. **`reservas.gs`** — Apps Script Web App ligado à folha das submissões. Um URL, duas
   operações: `GET` devolve vagas de uma data, `POST` reserva um lugar atomicamente.
2. **Duas abas** na mesma folha: `Reservas` (o registo de reservas) e `Capacidades`
   (horários e limites).
3. **`widget.js`** — deixa de ler o Sheety, passa a ler o novo endpoint, e reserva na
   submissão.

A contagem de vagas em vivo vem **só** da aba `Reservas`. A aba `Form responses` é usada
exclusivamente pela reconciliação. Um número, um sítio — é a divergência entre duas fontes
que produziu todos os bugs anteriores deste widget.

## 5. Modelo de dados

### Aba `Reservas`

| Coluna | Tipo | Notas |
|---|---|---|
| `token` | texto | UUID gerado pelo widget, um por carregamento de página |
| `data` | texto | `AAAA-MM-DD` |
| `horario` | texto | `HH:MM-HH:MM`, tem de existir em `Capacidades` |
| `criado` | data/hora | timestamp do servidor |
| `estado` | texto | `activo` \| `expirado` |

Linhas expiradas são **marcadas, não apagadas** — fica registo do que aconteceu.
Contam para a ocupação apenas as linhas com estado `activo`.

### Aba `Capacidades`

| Coluna | Tipo | Notas |
|---|---|---|
| `horario` | texto | `HH:MM-HH:MM` |
| `vagas` | número | inteiro ≥ 0 |

Esta aba é a fonte de verdade tanto dos **horários** como dos **limites**: o widget desenha
os botões pela ordem das linhas desta aba. Acrescentar um horário ou mudar uma capacidade
passa a ser uma edição no Sheets. Valores iniciais, iguais aos atuais em `SLOTS`:

```
08:00-08:45   3
08:45-09:30   2
09:30-10:15   3
10:15-11:00   2
```

Se a aba não existir, estiver vazia ou tiver valores ilegíveis, o script devolve
`{"ok": false, "erro": "capacidades_ilegiveis"}` e **não reserva nada** — coerente com
falhar fechado. Sem capacidades não há limite conhecido, e inventar um seria pior.

## 6. Contrato da API

Um único URL de Web App, implantado com *Execute as: me* e *Who has access: Anyone*.

### `GET ?data=AAAA-MM-DD`

```json
{
  "ok": true,
  "data": "2026-09-08",
  "slots": [
    { "horario": "08:00-08:45", "capacidade": 3, "restantes": 1 },
    { "horario": "08:45-09:30", "capacidade": 2, "restantes": 0 }
  ]
}
```

Serve também para aquecer o runtime antes da submissão, e é onde a reconciliação corre em
regime *best-effort* (§8).

### `POST` (corpo `text/plain` com JSON)

```json
{ "acao": "reservar", "token": "…", "data": "2026-09-08", "horario": "08:45-09:30" }
```

Respostas possíveis:

```json
{ "ok": true,  "reservado": true,  "estado": "novo" }        // lugar tomado
{ "ok": true,  "reservado": true,  "estado": "repetido" }    // mesmo token, mesmo slot
{ "ok": true,  "reservado": true,  "estado": "trocado" }     // mesmo token, slot diferente
{ "ok": true,  "reservado": false, "motivo": "cheio", "restantes": 0 }
{ "ok": false, "erro": "capacidades_ilegiveis" }
{ "ok": false, "erro": "data_invalida" }
{ "ok": false, "erro": "data_passada" }
{ "ok": false, "erro": "horario_desconhecido" }
{ "ok": false, "erro": "token_invalido" }
{ "ok": false, "erro": "lock_indisponivel" }
```

### Validação (rejeita com `ok:false`)

- `data` tem de casar `^\d{4}-\d{2}-\d{2}$` e não ser anterior a hoje (hora de Lisboa).
- `horario` tem de existir em `Capacidades`.
- `token` tem de casar `^[A-Za-z0-9-]{8,64}$`.

O fuso do projeto Apps Script tem de ser `Europe/Lisbon` (em `appsscript.json`), senão a
comparação com "hoje" e os timestamps saem errados.

## 7. A reserva atómica

`activos(data, horario)` = número de linhas de `Reservas` com estado `activo` **e** aquela
data **e** aquele horário. É a única definição de ocupação usada em vivo.

```
lock = LockService.getScriptLock()
if (!lock.tryLock(20000)) return { ok: false, erro: "lock_indisponivel" }
try {
  linhas    = ler(Reservas)
  existente = linha com este token e estado "activo"

  if (existente && existente.data == data && existente.horario == horario)
    return { reservado: true, estado: "repetido" }

  // A capacidade é verificada ANTES de libertar a escolha anterior: senão um
  // hóspede que troca para um horário cheio perdia o lugar que já tinha.
  livre = activos(data, horario) < capacidade(horario)
  if (!livre) {
    reconciliar()                       // só aqui: pode libertar lugares órfãos
    livre = activos(data, horario) < capacidade(horario)
  }
  if (!livre) return { reservado: false, motivo: "cheio", restantes: 0 }

  if (existente) marcar existente "expirado"    // agora sim: a troca é segura
  acrescentar { token, data, horario, agora, "activo" }
  return { reservado: true, estado: existente ? "trocado" : "novo" }
} finally {
  lock.releaseLock()
}
```

`LockService.getScriptLock()` é um mutex ao nível do script — é isto que torna impossível
duas submissões simultâneas intercalarem-se, e é exatamente o que o Sheety não oferece.

**Idempotência pelo token** faz duas coisas. Permite repetir um pedido que deu timeout sem
consumir dois lugares (essencial, porque falhamos fechado e vamos tentar outra vez). E cobre
o caso real mais comum: o hóspede submete, o JotForm recusa por causa de *outro* campo, o
hóspede corrige e volta a submeter — um lugar, não dois.

A reconciliação corre **dentro do lock, mas só quando o slot parece cheio**. Assim o caminho
normal fica rápido (não lê a `Form responses`) e uma recusa é sempre exata.

## 8. Reconciliação (auto-reparação)

Para cada par `data`+`horario`:

- `C` = linhas em `Form responses` cuja coluna `Reserva` é igual a `"data | horario"`.
- `P` = linhas de `Reservas` com estado `activo` **e mais de 20 minutos**.

Uma reserva genuína deixa rasto nos dois sítios. Uma abandonada deixa rasto só em
`Reservas`. Logo, as `P − C` linhas activas mais antigas são órfãs e passam a `expirado`.
Linhas com menos de 20 minutos nunca são tocadas — é a janela em que a integração do
JotForm ainda pode não ter escrito.

Isto casa por **contagens, não por identidade**, e por isso não precisa de campo novo no
JotForm nem de espelhar o token. É também o motivo pelo qual não conseguimos saber *qual*
das linhas é a órfã — e não precisamos, só de saber quantas.

### Quando corre

Nos dois caminhos, e por uma razão concreta:

- **No `POST`**, quando o slot parece cheio (§7), para que uma recusa seja sempre exata.
- **No `GET`**, porque um slot cujos lugares sejam *todos* órfãos apareceria como "Sem
  vagas" e ninguém chegaria a submeter contra ele — a reconciliação no `POST` nunca correria
  e as órfãs nunca seriam libertadas. É este caminho que fecha o ciclo.

No `GET` a reconciliação é *best-effort*: `tryLock(5000)` e, se o lock não vier, salta-se.
As contagens ficam no máximo ligeiramente velhas, o que para efeitos de desenho dos botões
é inofensivo — a decisão que conta é sempre tomada no `POST`, dentro do lock.

A leitura da coluna `Reserva` na `Form responses` é tolerante, como já é no widget hoje:
procura um cabeçalho que case `/reserva/i` e, se não encontrar, qualquer coluna cujos
valores casem `AAAA-MM-DD | HH:MM-HH:MM`.

## 9. Alterações no `widget.js`

### Sai

`SHEETY_GET_URL`, `SHEETY_COLLECTION`, `COLUNA_DATA`, `COLUNA_HORARIO`, `COLUNAS_RESERVA`,
`FORMATO_RESERVA`, `SLOTS`, `linhaOcupaSlot`, `valorCombinado`, `normalizarData`,
`normalizarReserva`, `buscarReservas`, `limiteDoSlot`, `vagasRestantes`.

O widget deixa de interpretar uma folha de cálculo: recebe números de um endpoint que
controlamos. Isto elimina toda a classe de bug que este projeto tem tido — nomes de coluna
que não casam e falham em silêncio. A leitura tolerante passa para o script, onde ainda é
precisa.

Fecha também o problema de o `SHEETY_GET_URL` estar exposto num repositório público: o novo
endpoint só revela contagens de vagas, não a folha.

### Entra

- `RESERVAS_URL` — o URL do Web App.
- `TOKEN` — `crypto.randomUUID()` uma vez por carregamento de página.
- `buscarVagas(data)` — `GET`, devolve a lista de slots já com `restantes`.
- `reservarLugar(data, horario)` — `POST`, com orçamento de ~8 s e **uma** repetição.

`carregarSlots()` mantém o número de geração (`geracao`) e o descarte de respostas velhas —
a corrida do `<input type="date">` não muda. Os botões continuam a guardar a data no closure
e `selecionar()` continua a reconfirmar contra o campo visível.

### Fluxo da submissão

1. Sem valor escolhido e `OBRIGATORIO` → `showWidgetError` (como hoje).
2. Com valor → `POST` da reserva, ~8 s, uma repetição em caso de silêncio.
3. `reservado: true` → espelhar em `Reserva` e `sendSubmit({ valid: true, value })`.
4. `motivo: "cheio"` → `showWidgetError("Esse horário acabou de ficar sem vagas. Escolha outro.")`
   e recarregar os horários.
5. Sem resposta ou `ok: false` após a repetição → `showWidgetError("Não foi possível confirmar
   a reserva. Tente novamente.")` — **falha fechada**.

O invariante mantém-se: **o handler responde sempre**. Todos os ramos, incluindo o `.catch`,
acabam em `sendSubmit` ou em `showWidgetError` (que envia `valid:false` por dentro). Nunca
chamar `sendSubmit` depois de `showWidgetError`.

## 10. Modos de falha

| Situação | Comportamento |
|---|---|
| Duas submissões simultâneas no último lugar | Uma reserva, a outra recebe `cheio`. Garantido pelo `LockService`. |
| Timeout na reserva, pedido chegou | A repetição devolve `repetido` — um lugar |
| Script indisponível | Ninguém reserva (falha fechada). Mitigado pelo aquecimento no `GET` |
| Aba `Capacidades` ilegível | `ok:false` → falha fechada. Nada é reservado |
| Hóspede desiste depois de reservar | Lugar libertado pela reconciliação após 20 min |
| `Reserva` não mapeada na integração | O lock funciona; as órfãs nunca são libertadas (ver §12) |
| Hóspede muda de horário e resubmete | Linha antiga marcada `expirado`, nova criada |

## 11. Restrição técnica principal (CORS)

O Apps Script não tem `doOptions`, logo **falha o preflight de CORS**. O `POST` tem de ser um
*simple request*: `Content-Type: text/plain;charset=utf-8`, com o JSON no corpo. Não usar
`application/json`, não acrescentar cabeçalhos personalizados.

O Web App responde também com um `302` para `script.googleusercontent.com`; o `fetch` segue o
redirecionamento e o destino tem CORS permissivo, mas isto tem de ser **verificado com `curl`
imediatamente após a implantação**, antes de mexer no `widget.js`. Se não se confirmar, o
desenho muda.

## 12. Pré-requisito a verificar

A reconciliação depende de a coluna `Reserva` ser realmente escrita na `Form responses`. O
`CLAUDE.md` lista "mapear `Reserva` na integração Google Sheets" como **ainda pendente**. Se
não estiver mapeada, o lock funciona corretamente, mas as reservas órfãs nunca são
libertadas. Confirmar antes do passo 3 da implantação.

## 13. Testes

- **O lock em si:** disparar 5 `POST` simultâneos a um horário de 2 lugares e verificar que
  exatamente 2 são aceites. É o único teste que prova a atomicidade, e corre contra a
  implantação real.
- **Funções do script** (`activos`, `capacidade`, `reconciliar`): escritas puras, para correr
  no editor do Apps Script contra arrays de exemplo.
- **Funções do widget:** extrair para um módulo ES de rascunho e correr contra respostas JSON
  reais, como já se fez para a contagem de vagas.
- **Fluxo local:** `python3 -m http.server 8765` e `?debug=1`, conduzindo o campo de data por
  JS (o popup nativo bloqueia screenshots).
- **Implantação:** o ciclo de `curl`-diff do `CLAUDE.md` — não assumir que o Pages já
  atualizou.

## 14. Ordem de implantação

1. Escrever `reservas.gs` e o guia em português para o dono.
2. Dono cria as abas `Reservas` e `Capacidades`, cola o script, implanta, envia o URL.
3. Verificar com `curl`: `GET`, `POST`, e o teste de concorrência.
4. Confirmar que `Reserva` chega à `Form responses` (§12).
5. Trocar a leitura do widget para o novo endpoint (as vagas passam a descer; ainda sem lock).
6. Acrescentar a reserva na submissão e o falhar-fechado.
7. Verificar no link público do formulário — nunca no construtor, onde `sendSubmit` é ignorado.

O widget continua a funcionar em todos os passos; só o passo 6 muda o comportamento do hóspede.

## 15. Riscos que ficam em aberto

- O `curl`-diff do Pages e o `max-age=600` continuam a valer: uma alteração que "não
  funcionou" é quase sempre cache.
- A reconciliação por contagens não distingue qual a linha órfã. Em agregado está certa; numa
  auditoria linha a linha pode marcar `expirado` numa linha diferente da que foi abandonada.
- O `token` vive só em memória: recarregar a página gera novo token. Um hóspede que recarregue
  entre duas tentativas de submissão pode consumir dois lugares (libertados depois pela
  reconciliação).
- Continua a ser preciso, do lado do JotForm, apagar a coluna `typeA137`, sempre vazia.
