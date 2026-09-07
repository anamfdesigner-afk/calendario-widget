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
2. Em **Fuso horário**, procure a entrada **Lisboa** (ou **Lisbon** se a conta
   estiver em inglês). Ela aparece como **Lisboa (Europe/Lisbon)** ou
   **Lisbon (Europe/Lisbon)**. O número de horas ao lado muda com as estações
   — pode aparecer `GMT+01:00` (verão) ou `GMT+00:00` (inverno) — ambas são
   corretas desde que seja a cidade Lisboa/Lisbon.
3. Não escolha **London** mesmo que mostre o mesmo número de horas — tem de
   ser Lisboa.

Isto é importante: sem o fuso certo, as reservas de madrugada ficam no dia
errado.

## 4. Definir o fuso horário da folha (é outro!)

Há **dois** fusos horários diferentes, e são independentes um do outro: o do
programa (o ponto anterior) e o da própria folha de cálculo. Convém que
sejam o mesmo.

1. Volte ao separador da folha de cálculo.
2. Menu **Ficheiro → Configurações** (em inglês, **File → Settings**).
3. Em **Fuso horário**, escolha também **Lisboa** / **(GMT+01:00) Lisbon**.
4. **Guardar configurações**.

## 5. Criar as abas

1. Volte ao **Editor** (o ícone `<>` à esquerda).
2. Na barra de cima, na caixa que diz o nome da função, escolha
   **preparar**.
3. Clique em **Executar**.
4. Na primeira vez a Google pede autorização: **Rever autorizações** →
   escolha a sua conta → **Avançadas** → **Ir para (nome do projeto)** →
   **Permitir**. É normal; o programa é seu e só toca nesta folha.
5. Volte à folha de cálculo. Deve ver duas abas novas em baixo:
   **Reservas** e **Capacidades**.

A aba **Reservas** tem oito colunas: `token`, `data`, `horario`, `criado`,
`estado`, `quarto`, `nome` e `submissao`. O `quarto` e o `nome` são
preenchidos sozinhos quando a reserva se concretiza — é aí que fica escrito
**quem** tem cada horário, e é essa a lista que a cozinha lê de manhã. A
`submissao` é uso interno: é o número que liga cada reserva à linha
correspondente na aba das respostas do formulário.

### Confira a mensagem

Em baixo, no editor, abre-se o painel **Registo de execução**. Lá aparece
uma linha assim:

```
Abas prontas. Segredo do webhook: EM FALTA. Formulário esperado: EM FALTA. Último webhook recebido: NUNCA (enquanto for NUNCA, nenhum lugar é libertado). Coluna do ID: EM FALTA. Coluna da reserva: EM FALTA (enquanto houver EM FALTA, a reserva não aparece na aba "Form responses"; as reservas e os lugares não são afectados).
```

**Os `EM FALTA` e o `NUNCA` são o esperado nesta altura**: a senha e o
número do formulário só são guardados no ponto 8, e o aviso do formulário só é
ligado aí. Nada disto é erro.

A mensagem termina a dizer quais são as **duas colunas da aba das respostas**
que o programa usa para escrever a reserva ao lado das escolhas de menu do
hóspede — a do número da submissão e a da própria reserva. Enquanto alguma
disser `EM FALTA`, essa escrita fica desligada: **a reserva não aparece na aba
das respostas**. As reservas e os lugares não são afectados — o formulário
continua a funcionar na mesma e a aba **Reservas** continua completa.

Depois do ponto 8, correr o `preparar` outra vez deve mostrar
`Segredo do webhook: definido`, o número do formulário, uma data em vez de
`NUNCA`, e as duas colunas com nome (algo como `Coluna do ID: "Submission ID".
Coluna da reserva: "typeA137".`) — e é assim que se confirma que tudo ficou
ligado.

## 6. Conferir as capacidades

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

### O formato da hora tem de ser exato

Tem de ser exatamente `HH:MM-HH:MM`: quatro dígitos, dois pontos, um
hífen sem espaços à volta. Estes exemplos **não** funcionam e o horário
desaparece do formulário sem dar erro:

| Errado | Certo |
|---|---|
| `08:00 - 08:45` (espaços) | `08:00-08:45` |
| `8:00-8:45` (sem o zero) | `08:00-08:45` |
| `08:00–08:45` (travessão longo) | `08:00-08:45` |

**Se um horário desaparecer do formulário, é quase sempre isto.** Confira o
formato antes de procurar outra coisa.

### Mudar a hora de um horário que já tem reservas

**Nunca reescreva o texto do `horario` de uma linha que possa já ter
reservas.** As reservas guardadas ficam ligadas ao texto antigo: se o
mudar, o programa deixa de as ver, o horário aparece vazio e os lugares já
vendidos são vendidos outra vez.

Para mudar uma hora, faça assim:

1. Acrescente uma **linha nova** com a hora nova e os lugares que quiser.
2. Na linha antiga, ponha `vagas` a `0`.

A linha antiga deixa de aceitar reservas novas mas continua a proteger as
que já existem.

## 7. Publicar

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

**Envie esse URL.** É o que preciso para ligar o formulário. (A senha do
ponto 8 é sua e **não** me deve ser enviada.)

### O que "Qualquer pessoa" quer dizer, exatamente

"Qualquer pessoa" é necessário porque quem preenche o formulário não tem
sessão Google. O programa só responde com o número de lugares livres e só
aceita marcar reservas — **não deixa ninguém ler a folha**. Nem os nomes,
nem os emails, nem as respostas: nada disso sai por ali.

Três coisas que também deve saber, sem alarme:

- **Quem tiver o endereço pode marcar reservas.** Não pode ler nada, mas
  pode ocupar lugares — em teoria, todos os lugares de um dia, sem
  aparecer no formulário. Isso repara-se por si: com o aviso do ponto 8
  ligado, uma reserva que não chegue a ser submetida no formulário é
  libertada ao fim de 20 minutos.
- **O endereço vai ficar num repositório de código público**, porque é o
  formulário que precisa dele para funcionar. É por isso que o programa
  não devolve nada da folha.
- **"Só responde com lugares livres" é uma garantia desta versão do
  programa.** Se o programa for alterado, a garantia é a da versão nova —
  e é essa a razão de o ponto 9 existir.

## 8. Ligar o aviso de submissão (o passo mais importante)

O programa marca o lugar quando o hóspede submete, mas sozinho **não fica a
saber** se a submissão chegou mesmo ao fim. Quem lho diz é um aviso que o
JotForm envia a cada formulário concluído.

Enquanto este aviso não estiver ligado, o programa **não liberta lugar
nenhum**: uma reserva começada e abandonada fica a ocupar lugar para sempre.
É de propósito. Um lugar preso vê-se e corrige-se à mão; se o programa
libertasse lugares sem nunca receber avisos, libertaria também os que foram
mesmo vendidos, e o mesmo pequeno-almoço era vendido duas vezes, em silêncio.

São duas metades — uma senha guardada no programa, e o aviso criado no
formulário — e têm de levar a **mesma** senha. Faça-as por esta ordem.

### 8.1 A senha

Esta senha não é para decorar — vai ser colada duas vezes e nunca mais
escrita. Por isso não a invente: use uma **comprida e ao calhas**, com pelo
menos 32 caracteres, só letras, números e hífenes, sem espaços e sem acentos.

Cole isto, ou algo com este aspeto:

```
7xQ4-vK9m-Ld2T-pR8w-Zc5N-hJ3b-Ya6E-Qs1U
```

Guarde-a onde guarda as suas senhas; não precisa de ma enviar.

Serve para o programa saber que o aviso vem mesmo do seu formulário. O
endereço do programa fica escrito num sítio público (é o formulário que
precisa dele), e sem senha qualquer pessoa que o encontrasse podia mandar
avisos falsos. Uma senha curta ou com palavras pode ser adivinhada por
tentativas, e ninguém está a contar as tentativas de quem tenta.

### 8.2 Guardar a senha no programa

1. No editor do Apps Script, clique na roda dentada (**Definições do
   projeto**).
2. Desça até **Propriedades do script** e clique em **Adicionar propriedade
   do script**. Acrescente **duas**:

| Propriedade | Valor |
|---|---|
| `segredoWebhook` | a senha que escolheu |
| `formIdEsperado` | `253294429726062` |

3. **Guardar propriedades do script.**

O nome das propriedades tem de ser escrito exatamente assim, com as
maiúsculas nos mesmos sítios. O segundo valor é o número do seu formulário —
é o que aparece no endereço dele.

### 8.3 Criar o aviso no JotForm

1. Abra o formulário no JotForm.
2. **Settings** (Definições) → **Integrations** (Integrações).
3. Procure **WebHooks** na lista e escolha-o.
4. No campo do endereço, cole o URL do ponto 7 seguido de `?k=` e da sua
   senha, tudo junto e sem espaços:

```
https://script.google.com/macros/s/AKfy...../exec?k=7xQ4-vK9m-Ld2T-pR8w-Zc5N-hJ3b-Ya6E-Qs1U
```

5. **Complete Integration** (Completar integração).

### 8.4 Confirmar que funciona (não salte isto)

1. Faça uma reserva de teste no **link público** do formulário — nunca no
   construtor.
2. Abra a aba **Reservas**. Ao fim de alguns segundos, a linha da sua
   reserva deve passar de `activo` para **`confirmado`**, e as colunas
   `quarto` e `nome` devem ficar preenchidas.

Se a linha ficar em `activo`, o aviso não está a chegar: quase sempre é a
senha do ponto 8.1 escrita de maneira diferente nas duas metades. **Avise-me**
— até isto funcionar, nenhum lugar abandonado é libertado.

Para apagar a reserva de teste, mude o `estado` dessa linha para
`expirado` (ver o Aviso no fim).

## 9. Se mais tarde alterar o programa

Alterar as capacidades **não** exige republicar: são lidas da folha a cada
pedido.

Se alterar o próprio programa, tem de fazer **Implementar → Gerir
implementações → (lápis) → Versão: Nova versão → Implementar**. O URL
mantém-se.

Faça-o sempre assim, e **nunca** por "Nova implementação": essa dá um URL
diferente, e o URL antigo está escrito dentro do formulário — a partir daí o
formulário deixaria de aceitar reservas. Se acontecer, avise-me.

Mais uma coisa, se um dia lhe enviar uma versão nova: se essa versão usar um
serviço da Google que a atual não usa (enviar emails, por exemplo), a
autorização que deu na instalação já não chega. Nesse caso **corra uma vez
uma função a partir do editor** — como fez no ponto 5 — para aparecer o ecrã
de autorização e o aceitar. Sem isso o programa pode falhar precisamente na
parte nova, e do lado do formulário isso vê-se como reservas que não são
aceites. Se lhe enviar uma versão assim, digo-lho.

## Aviso

Não edite a aba **Reservas**. É o programa que a mantém. **Nunca acrescente
nem apague linhas nessa aba.** A única célula que pode mudar é o `estado`:

- **Cancelar uma reserva.** Se um hóspede cancelar por telefone, ou se
  quiser apagar uma reserva de teste, mude a coluna `estado` dessa linha
  para `expirado`. Isto liberta o lugar, e a linha fica registada como prova.
  Serve tanto para linhas `activo` como para linhas `confirmado`.

Nada mais: não mude `token`, `data`, `horario` nem `criado`.

As colunas `quarto` e `nome` são escritas pelo programa quando a reserva se
concretiza. Pode lê-las à vontade — é para isso que existem — e corrigir um
nome mal escrito não faz mal nenhum: o programa não as lê para contar
lugares. A `submissao` é diferente: não a altere, é ela que liga a reserva à
linha da aba das respostas.

**Sobre o `preparar`:** pode voltar a correr sempre que quiser. Não estraga
nada, não duplica reservas, e depois do ponto 8 serve para confirmar, na
linha do **Registo de execução**, que o aviso do formulário já chegou.

**Sobre `limparTestes`:** Se correr a função `limparTestes` (do mesmo modo
que correu o `preparar` no ponto 5), ela apaga apenas as linhas deixadas
pelo teste de carga do programador — as
que têm `token` a começar por `conc-teste-`. Se tiver feito uma reserva real
através do formulário para testar se funciona, essa reserva tem um `token`
normal e `limparTestes` não a apaga. Use a solução acima: mude o `estado`
para `expirado`.
