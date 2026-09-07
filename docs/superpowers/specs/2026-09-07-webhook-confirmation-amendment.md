# Emenda: confirmação por webhook em vez do espelho

*Emenda ao design `2026-09-07-lock-booked-slots-design.md` — 2026-09-07*

Esta emenda substitui as secções §5 (aba `Reservas`), §6 (contrato POST), §8 (reconciliação)
e §12 (pré-requisito) do design original. Tudo o resto — o lock atómico, a aba `Capacidades`,
o falhar fechado, o fluxo do widget — mantém-se.

## 1. Porquê

O espelho **não funciona**. Verificado no formulário publicado em 2026-09-07:

- escolher um horário preenche a resposta do próprio widget
  (`q137_typeA137` = `2026-09-08 | 08:00-08:45`);
- o campo `Reserva` (`id_135`, input `q135_respostaFinal`) fica **vazio**;
- continua vazio depois de lhe retirar a classe `always-hidden` e o tornar visível, logo não é
  por estar escondido;
- o campo é escrivível (uma escrita directa por JS funciona);
- o `fields:fill` continua implementado no `jotform.forms.js` e no `for-widgets-server.js` da
  JotForm, logo a funcionalidade não foi retirada.

Consequência: o campo `Reserva` nunca teve valor em submissão nenhuma, e por isso **nunca
chegou a existir coluna `Reserva`** na folha das respostas. A integração estava bem
configurada; não havia nada para exportar.

Isto invalida a nota no `CLAUDE.md` de que o dono confirmou que o `Reserva` recebia o valor.
O `setFieldsValueById`/`ByLabel` é um `postMessage` que não devolve nada e nunca dá erro — um
espelho partido é indistinguível de um espelho a funcionar visto de dentro do widget, que é
exactamente o risco que aquele ficheiro documenta.

## 2. A troca

A reconciliação deixa de **inferir** se uma reserva se concretizou comparando contagens com
uma coluna da folha, e passa a **ser informada** por um webhook da JotForm, disparado a cada
submissão concluída.

Um lugar passa a ter dois estados em vez de um:

| estado | significado |
|---|---|
| `activo` | lugar tomado na submissão, ainda por confirmar |
| `confirmado` | o webhook confirmou que a submissão se concluiu |
| `expirado` | libertado (abandono ou cancelamento à mão) |

Ocupação em vivo = linhas `activo` **mais** linhas `confirmado`.
Uma órfã passa a ser, simplesmente, **uma linha `activo` com mais de 20 minutos**: se a
submissão se tivesse concluído, o webhook já teria chegado.

## 3. O que isto apaga

Deixam de ser precisos, e saem do código:

`ABA_SUBMISSOES`, `escolherAbaSubmissoes_`, `nomeAbaSubmissoes_`, `colunaReserva_`,
`contarSubmissoes_`, `submissoesFiaveis_`, `marcaSemeadura_`, `marcaDe_`, a marca de água em
`PropertiesService`, `semear_`/`semear`, e a leitura inteira da aba das respostas.

Com eles desaparecem os problemas que viviam lá dentro: a coluna `Reserva` em branco a
libertar reservas reais, a marca de água re-marcável, a aba de respostas velha escolhida por
engano, e o `preparar()` a poder desarmar a própria guarda. Não são corrigidos — deixam de ter
onde existir.

## 4. Contrato do webhook

A JotForm publica cada submissão em `POST <URL da aplicação web>?k=<segredo>`, com
`Content-Type: application/x-www-form-urlencoded`.

O `doPost` distingue os dois tipos de pedido pelo corpo: o do widget é JSON (`text/plain`) com
`acao`, o da JotForm é form-encoded e traz `formID` e `rawRequest`.

Verificações, por esta ordem — qualquer uma que falhe devolve `{ok:false}` e **não** confirma
nada:

1. `k` coincide com o segredo guardado em `PropertiesService`.
2. `formID` é o do formulário esperado.
3. `rawRequest` traz uma reserva no formato `AAAA-MM-DD | HH:MM-HH:MM`.

O segredo **nunca** entra no repositório: vive na configuração do webhook na JotForm e nas
propriedades do script. Sem esta verificação, qualquer pessoa que descubra o URL podia forjar
confirmações e tornar uma reserva falsa impossível de libertar.

### Efeito

Dentro do mesmo lock do `doPost`:

1. Encontrar a linha `activo` **mais antiga** para aquela data e horário.
2. Passá-la a `confirmado`.
3. Escrever nela o **quarto** e o **nome** vindos da submissão.

Se não houver nenhuma linha `activo` para aquele par (o webhook chegou depois de a
reconciliação já ter libertado a linha, ou a submissão não passou pelo widget), regista-se no
log e não se cria nada: inventar uma reserva a partir de um webhook seria dar a um POST
anónimo o poder de ocupar lugares.

### Identidade

A aba `Reservas` ganha duas colunas, `quarto` e `nome`. Com o espelho morto, a linha da folha
das respostas tem a identidade mas não a reserva, e o registo tinha a reserva mas não a
identidade — ninguém conseguia dizer quem tinha que horário. As duas colunas fecham isso, e é
o registo que a cozinha passa a ler de manhã.

Guarda-se o quarto e o nome, **não o email**: chega para servir o pequeno-almoço e mantém ao
mínimo os dados pessoais duplicados numa segunda aba.

**Limite conhecido:** a confirmação escolhe a linha `activo` mais antiga do horário. Se dois
hóspedes reservarem o mesmo horário com segundos de intervalo, os nomes podem trocar de linha.
As reservas e os horários ficam sempre certos; só o par nome-linha é que pode trocar. Distingui-los
exigiria levar um identificador dentro do valor que o widget grava, o que sujaria o valor que o
dono vê, por um erro que não afecta lugares.

## 5. O que se perde

`semear_` lia as reservas já existentes a partir da coluna `Reserva`. Como essa coluna nunca
vai existir, **não há forma automática de recuperar as reservas futuras já feitas**. Se
existirem reservas para hoje ou depois no momento da instalação, os seus lugares aparecem
livres e podem ser vendidos outra vez.

**Resolvido na prática:** o dono confirmou em 2026-09-07 que **não existem reservas** e que o
formulário ainda não está em serviço, logo não há nada a recuperar. O procedimento manual que
esta secção previa foi **retirado do guia de propósito**: mandava o dono escrever à mão numa
aba gerida pelo script, o que é uma armadilha sem nada a ganhar. Não o volte a acrescentar sem
uma razão nova — e, se alguma vez for preciso, as linhas têm de entrar como `confirmado` e não
como `activo`, senão o primeiro webhook arma a reconciliação e liberta-as todas de uma vez.

## 6. Falhar fechado, na direcção certa

Se o webhook nunca chegar — mal configurado, segredo errado, JotForm em baixo — nenhuma reserva
é confirmada e **todas** são libertadas ao fim de 20 minutos. Isso é sobre-reserva, que é a
direcção errada; o desenho anterior, com a marca de água, errava para o lado seguro.

Por isso a reconciliação só corre se o webhook já alguma vez tiver chegado: grava-se a data da
última confirmação recebida, e enquanto não houver nenhuma, **nada é libertado**. Um webhook
que nunca funcionou deixa lugares órfãos presos, o que é visível e corrigível à mão; um webhook
partido a libertar tudo revendia lugares vendidos, em silêncio.
