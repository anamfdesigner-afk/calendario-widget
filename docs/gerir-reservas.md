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
| `token`, `criado` | uso interno do programa — ignore |

Para a lista da manhã, ordene ou filtre pela coluna **`data`**.

### O que quer dizer o `estado`

- **`confirmado`** — reserva feita e concluída. É uma reserva a sério.
- **`activo`** — o hóspede acabou de submeter e a confirmação ainda vem a caminho.
  Normalmente passa a `confirmado` em segundos. Ocupa lugar na mesma.
- **`expirado`** — lugar libertado. Fica na folha só como registo.

Se uma linha ficar em **`activo` durante horas**, avise-me: quer dizer que a confirmação
automática deixou de chegar. Não é grave e não vende lugares a mais — mas convém ver porquê.

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
- ❌ não altere `token`, `data`, `horario` nem `criado`
- ✅ só a coluna `estado`, como no ponto 2

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
- **Qualquer outra coisa** — não tente corrigir à mão na folha. Diga-me o que vê.
