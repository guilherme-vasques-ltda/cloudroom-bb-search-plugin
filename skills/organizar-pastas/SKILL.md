---
name: organizar-pastas
description: Organiza threads em pastas (seções do Cloudroom) dentro de um projeto, como "Revisores", "Feature X" ou "Geral". Use quando pedirem para organizar, agrupar ou arrumar threads/agentes em pastas, ou ao criar uma thread que claramente pertence a um grupo existente.
---

# Organizar threads em pastas

As pastas da barra lateral são as **seções** do Cloudroom. Uma thread fica em no
máximo uma pasta. A mesma pasta vale em qualquer projeto; o plugin mostra, dentro
de cada projeto, só as pastas que têm threads dele. Threads filhas aparecem sob a
mãe, então basta pôr a mãe na pasta.

## Comandos

```sh
room-cli thread section list --json                 # pastas existentes
room-cli thread section create "Revisores" --json   # cria (devolve o id sec_...)
room-cli thread section rename <sec_id> "Novo nome"
room-cli thread update <thr_id> --section <sec_id>  # põe a thread na pasta
room-cli thread update <thr_id> --clear-section     # tira da pasta
room-cli thread list --project <proj_id> --json     # threads do projeto
room-cli thread list --section <sec_id> --json      # threads de uma pasta
```

## Regras

- Antes de criar, rode `section list` e reutilize uma pasta com o mesmo sentido.
  Nada de duplicatas ("Revisores" e "Revisão").
- Nomes curtos, pelo papel ou pela frente de trabalho: "Revisores", "Geral",
  "Feature X", "Infra". Sem datas nem ids no nome.
- Mova só threads raiz (sem `parentThreadId`); as filhas seguem a mãe.
- Não apague pastas (`section delete`) nem mexa em threads de outro projeto sem
  pedido explícito.
- Ao terminar, diga em uma linha quais pastas criou e quantas threads moveu.
