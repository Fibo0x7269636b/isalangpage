---
title: Título do conceito
description: Uma frase sobre o que a página explica.
section: Conceitos
order: 100
---

<!-- Comece pelo problema concreto que o recurso resolve. Evite introduções genéricas. -->

## O problema

Descreva a situação em que um programa erraria sem este recurso.

## Como o compilador verifica

Explique em que fase a verificação acontece (HIR, Core, regiões) e qual informação o checker usa.

```isalang
fn main() -> i32 {
  return 0;
}
```

## Programa rejeitado

Mostre o erro e o código de diagnóstico real. Blocos marcados com `fail` precisam ser rejeitados pelo compilador.

```isalang fail
fn main() -> i32 {
  let first = String::from("Isalang");
  let second = first.move();
  print(first);
  return 0;
}
```

## Representação no Core

Se ajudar, inclua um trecho de `--emit-core` gerado pelo compilador atual.

## Limitações

Liste o que a implementação atual não cobre.
