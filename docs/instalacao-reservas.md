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

### Confira a mensagem (importante)

Em baixo, no editor, abre-se o painel **Registo de execução**. Lá aparece
uma linha assim:

```
Abas prontas. Aba das respostas: Form responses. Reservas já existentes trazidas para o registo: 4
```

Duas coisas a confirmar nessa linha:

- **A aba das respostas.** Tem de ser o nome da aba onde o formulário
  grava as respostas dos hóspedes (é a que já lá estava). Se disser
  **NENHUMA**, o programa não a encontrou — **avise-me antes de continuar**,
  porque assim os lugares de reservas abandonadas nunca são libertados.
- **As reservas já existentes.** É o número de reservas futuras que já
  tinha no formulário e que o programa trouxe para a aba **Reservas**. Se
  tinha reservas para os próximos dias, este número não deve ser `0`.

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

**Envie esse URL.** É a única coisa de que preciso para ligar o formulário.

### O que "Qualquer pessoa" quer dizer, exatamente

"Qualquer pessoa" é necessário porque quem preenche o formulário não tem
sessão Google. O programa só responde com o número de lugares livres e só
aceita marcar reservas — **não deixa ninguém ler a folha**. Nem os nomes,
nem os emails, nem as respostas: nada disso sai por ali.

Três coisas que também deve saber, sem alarme:

- **Quem tiver o endereço pode marcar reservas.** Não pode ler nada, mas
  pode ocupar lugares — em teoria, todos os lugares de um dia, sem
  aparecer no formulário. Isso repara-se por si: uma reserva que não
  chegue a ser submetida no formulário é libertada ao fim de 20 minutos.
- **O endereço vai ficar num repositório de código público**, porque é o
  formulário que precisa dele para funcionar. É por isso que o programa
  não devolve nada da folha.
- **"Só responde com lugares livres" é uma garantia desta versão do
  programa.** Se o programa for alterado, a garantia é a da versão nova —
  e é essa a razão de o ponto seguinte existir.

## 8. Se mais tarde alterar o programa

Alterar as capacidades **não** exige republicar: são lidas da folha a cada
pedido.

Se alterar o próprio programa, tem de fazer **Implementar → Gerir
implementações → (lápis) → Versão: Nova versão → Implementar**. O URL
mantém-se.

## Aviso

Não edite a aba **Reservas**. É o programa que a mantém. Há uma única
exceção: se um hóspede cancelar a reserva por telefone, ou se a sua própria
reserva de teste precisar ser cancelada, pode mudar a coluna `estado` dessa
linha de `activo` para `expirado`. Isto liberta o lugar. A linha fica
registada como prova.

Não faça nada mais: não acrescente linhas, não apague linhas, e não mude
`token`, `data`, `horario` ou `criado`.

**Sobre `semear`:** existe uma função `semear` que faz só a parte do
`preparar` que traz as reservas já existentes do formulário para a aba
**Reservas**. Corre-se do mesmo modo. Não precisa dela na instalação — o
`preparar` já a chama — e correr duas vezes não duplica nada. Só a use se
eu lhe pedir.

**Sobre `limparTestes`:** Se correr a função `limparTestes` (do mesmo modo
que correu o `preparar` no ponto 5), ela apaga apenas as linhas deixadas
pelo teste de carga do programador — as
que têm `token` a começar por `conc-teste-`. Se tiver feito uma reserva real
através do formulário para testar se funciona, essa reserva tem um `token`
normal e `limparTestes` não a apaga. Use a solução acima: mude o `estado`
para `expirado`.
