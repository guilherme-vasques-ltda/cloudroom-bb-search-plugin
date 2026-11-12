---
name: tags-de-threads
description: Adiciona, remove, renomeia e procura tags em threads do Cloudroom (ex.: chave de Task "MX-213", "revisão", "urgente"). Use quando pedirem para etiquetar/taguear threads, ligar uma thread a uma Task, ou ao começar a trabalhar numa Task (marque a thread com a chave dela).
---

# Tags de threads

As tags aparecem na barra lateral antes da hora da última mensagem, entram na
busca e no filtro "Tag". Uma tag no formato de chave de Task (`MX-213`) fica
destacada em amarelo: é assim que se liga uma thread a uma Task.

## Comandos

Sem `--thread`, valem para a thread atual.

```sh
room-cli tags list [--thread <thr_id>]
room-cli tags add MX-213 revisão [--thread <thr_id>]
room-cli tags remove revisão [--thread <thr_id>]
room-cli tags set MX-213 urgente [--thread <thr_id>]   # troca todas
room-cli tags clear [--thread <thr_id>]
room-cli tags all --json                                # tags em uso + contagem
room-cli tags find MX-213 --json                        # threads com a tag
room-cli tags rename revisao revisão                    # em todas as threads
```

## Regras

- Ao assumir uma Task, adicione a chave dela como tag na sua thread; ao
  terminar, mantenha (é histórico).
- Antes de criar tag nova, veja `tags all` e reutilize a grafia existente.
- Tags curtas, minúsculas para temas ("revisão", "infra"); chaves de Task em
  maiúsculas como no quadro.
- Não renomeie nem limpe tags de outras threads sem pedido.
