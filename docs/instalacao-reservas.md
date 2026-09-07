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

Não edite a aba **Reservas**. É o programa que a mantém. Há uma única
exceção: se um hóspede cancelar a reserva por telefone, ou se a sua própria
reserva de teste precisar ser cancelada, pode mudar a coluna `estado` dessa
linha de `activo` para `expirado`. Isto liberta o lugar. A linha fica
registada como prova.

Não faça nada mais: não acrescente linhas, não apague linhas, e não mude
`token`, `data`, `horario` ou `criado`.

**Sobre `limparTestes`:** Se correr a função `limparTestes` (como no ponto 4),
ela apaga apenas as linhas deixadas pelo teste de carga do programador — as
que têm `token` a começar por `conc-teste-`. Se tiver feito uma reserva real
através do formulário para testar se funciona, essa reserva tem um `token`
normal e `limparTestes` não a apaga. Use a solução acima: mude o `estado`
para `expirado`.
