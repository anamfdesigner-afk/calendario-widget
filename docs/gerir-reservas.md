# Gerir as reservas na folha (guia rápido)

Tudo o que precisa está em duas abas da folha de cálculo: **Reservas** e **Capacidades**.
Não é preciso mexer no programa para nada do dia a dia.

---

## 1. Ver as reservas do dia

Abra a aba **Reservas**. Cada linha é um lugar ao pequeno-almoço:

| coluna | o que é |
|---|---|
| `data` | o dia da reserva |
| `horario` | a hora escolhida |
| `quarto` | o número do quarto |
| `nome` | o nome do hóspede |
| `estado` | ver em baixo |
| `token`, `criado`, `submissao` | uso interno do programa — ignore |

Para a lista da manhã, ordene ou filtre pela coluna **`data`**.

### O que quer dizer o `estado`

- **`confirmado`** — reserva feita e concluída. É uma reserva a sério.
- **`activo`** — o hóspede acabou de submeter e a confirmação ainda vem a caminho.
  Normalmente passa a `confirmado` em segundos. Ocupa lugar na mesma.
- **`expirado`** — lugar libertado. Fica na folha só como registo.

Se uma linha ficar em **`activo` durante horas**, avise-me: quer dizer que a confirmação
automática deixou de chegar. Não é grave e não vende lugares a mais — mas convém ver porquê.

### A reserva também aparece na aba das respostas

Na aba **Form responses** — a que a JotForm enche com as respostas do
formulário — a reserva aparece na coluna **`typeA137`**, ao lado das escolhas
de menu do hóspede, no formato `2026-09-08 | 08:45-09:30`.

Essa coluna é preenchida **pelo programa**, sozinha. Não escreva lá à mão: o
programa só preenche células vazias, por isso o que escrever fica e a reserva
verdadeira nunca chega a aparecer nessa linha.

O valor pode demorar um pouco a aparecer — a reserva e a linha da resposta
chegam à folha por caminhos diferentes, e o programa junta-as da próxima vez
que alguém abrir o formulário. Se uma linha ficar sem reserva durante muito
tempo, avise-me.

---

## 2. Cancelar uma reserva (hóspede desistiu, ligou a cancelar)

1. Na aba **Reservas**, encontre a linha (pelo `quarto` e pela `data`).
2. Na coluna **`estado`**, escreva **`expirado`** por cima do que lá estiver.

Pronto. O lugar fica livre para outro hóspede logo a seguir.

**É esta a única célula que pode alterar à mão.** A linha não se apaga: fica lá como registo
do que aconteceu.

---

## 3. Mudar horários ou número de lugares

Abra a aba **Capacidades**:

| horario | vagas |
|---|---|
| 08:00-08:45 | 3 |
| 08:45-09:30 | 2 |

- **Mudar quantos lugares tem um horário:** mude o número na coluna `vagas`.
- **Fechar um horário:** ponha `0`.
- **Acrescentar um horário:** acrescente uma linha, no formato exacto `HH:MM-HH:MM`
  (dois dígitos em tudo, com o traço no meio e sem espaços).

As alterações fazem efeito na hora seguinte que alguém abrir o formulário. Não é preciso
publicar nem avisar ninguém.

> **Cuidado com uma coisa:** não reescreva a hora de uma linha que já tenha reservas. As
> reservas antigas ficariam órfãs e os lugares podiam ser vendidos outra vez. Para mudar uma
> hora que já tem reservas, **acrescente uma linha nova** com a hora certa e ponha `0` nas
> `vagas` da antiga.

---

## 4. O que não deve fazer

Na aba **Reservas**:

- ❌ não acrescente nem apague linhas
- ❌ não altere `token`, `data`, `horario`, `criado` nem `submissao`
- ✅ só a coluna `estado`, como no ponto 2

Na aba **Form responses**:

- ❌ não escreva na coluna `typeA137` — é o programa que a preenche
- ❌ não lhe mude o título, nem o do `Submission ID`
- ❌ **não ordene nem apague linhas** — nesta aba as linhas têm de ficar pela
  ordem em que chegaram. Para ver as respostas por outra ordem, use um filtro
  ou uma cópia da aba.

O programa procura estas duas colunas pelo título. Se algum mudar, a reserva
deixa de aparecer nessa aba (as reservas e os lugares continuam bem).

Nas duas abas:

- ❌ não mude o nome das abas (**Reservas**, **Capacidades**)
- ❌ não apague nem renomeie a primeira linha (os títulos das colunas)

O programa procura as abas e as colunas por estes nomes. Se mudarem, deixa de funcionar.

---

## 5. Se alguma coisa parecer errada

- **Um horário aparece "Sem vagas" mas a folha parece vazia** — veja se há linhas `activo`
  antigas. Ponha-as a `expirado` se souber que não são reservas reais, ou avise-me.
- **Um horário desapareceu do formulário** — quase sempre é o formato da hora na aba
  **Capacidades**. Tem de ser exactamente `08:00-08:45`.
- **As colunas `quarto` e `nome` ficam vazias** — as reservas continuam boas; é só a
  identificação que não está a chegar. Avise-me.
- **A coluna `typeA137` da aba das respostas fica vazia** — as reservas continuam boas
  e estão todas na aba **Reservas**; é só a cópia que não está a chegar. Avise-me.
- **Qualquer outra coisa** — não tente corrigir à mão na folha. Diga-me o que vê.
