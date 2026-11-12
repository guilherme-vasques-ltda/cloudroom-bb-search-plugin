# cloudroom-bb-search-plugin

Plugin do Cloudroom que troca a lista de threads da barra lateral por uma lista com **busca, filtros, pastas e tags**, mantendo a árvore de agentes (mãe → filhas).

<img src="docs/screenshot.png" alt="Barra lateral com busca, filtros e árvore de threads" width="458">

<sub>Imagem com dados de exemplo.</sub>

## O que tem

### Busca e filtros
- Busca por título, tag, pasta, projeto, agente, máquina, branch ou id. Não diferencia acento nem maiúscula; com várias palavras, todas precisam aparecer. `Esc` limpa.
- Filtros: **Projeto · Pasta · Agente** na primeira linha, **Máquina · Tag** na segunda, e "Incluir arquivadas".
- Projeto e Pasta se filtram entre si: escolhido um projeto, o filtro de Pasta só mostra as pastas dele, e vice-versa.
- Filtros **retráteis**: o ícone dentro da busca esconde e mostra a barra e indica quantos filtros estão ativos.
- **Limpar filtros** fica sempre à mão, com os filtros abertos ou recolhidos.
- Os filtros ficam salvos entre aberturas.

### Árvore e lista
- Agrupada por projeto, com a mesma árvore da lista nativa: threads filhas recuadas sob a mãe, com linha guia.
- **+ / −** no começo da linha abre e fecha as filhas; **⌄ / ⌃** na busca expandem ou retraem tudo.
- Ícone de onde a thread roda (notebook = local, nuvem = cloud) e ícone colorido do agente.
- Hora da última mensagem; passou de 24 h, mostra há quanto tempo ("há 3 d").
- Sinais de status: girando (rodando), amarelo pulsando (precisa de você), vermelho (erro), azul (mensagem na fila), cinza (não lida), caixa amarela (arquivada).
- Ao filtrar, a mãe de uma thread encontrada aparece junto, para não perder o contexto.

### Pastas
- As seções do Cloudroom aparecem como **pastas dentro de cada projeto**.
- **Clique direito** no nome do projeto ou numa pasta: criar, renomear e apagar pastas. Apagar pede confirmação; as threads ficam soltas.
- **Arraste** uma thread para uma pasta para mover; solte no nome do projeto para tirá-la da pasta.

### Fixadas
- Uma thread fixada fica sempre em primeiro **dentro do lugar dela** (topo da pasta, ou topo do projeto se estiver solta), com a árvore inteira.

### Tags
- Etiquetas pequenas antes da hora, até 2 por linha e "+N" para o resto.
- Uma tag com chave de Task (ex.: `MX-213`) fica destacada em amarelo: é assim que a thread se liga à Task.
- Para editar à mão: clique direito → **Tags…**, tags separadas por vírgula.

### Clique direito numa thread
Fixar/desafixar · Mover para pasta › · Nova pasta com esta thread · Tirar da pasta · Tags… · Renomear… · Copiar id · Arquivar/desarquivar.

### Arquivadas
- "Incluir arquivadas" busca todas as threads arquivadas, e elas entram na árvore, na busca e nos filtros.

## Para agentes

O plugin traz duas skills, que o Cloudroom entrega aos agentes, e um comando:

- **`organizar-pastas`**: organizar threads em pastas com `room-cli thread section ...` e `room-cli thread update <id> --section <sec_id>`.
- **`tags-de-threads`**: marcar threads com tags, incluindo a chave da Task em que o agente está trabalhando.

```sh
room-cli tags list [--thread <id>]          # sem --thread: a thread atual
room-cli tags add MX-213 revisão
room-cli tags remove revisão
room-cli tags set MX-213 urgente            # troca todas
room-cli tags clear
room-cli tags all --json                    # tags em uso + contagem
room-cli tags find MX-213 --json            # threads com a tag
room-cli tags rename revisao revisão        # em todas as threads
```

## Instalar

```sh
room-cli plugin install https://github.com/guilherme-vasques-ltda/cloudroom-bb-search-plugin --yes
```

Ou de uma cópia local: `npm install && room-cli plugin build . && room-cli plugin install . --yes`

Para voltar à lista padrão: Settings → Appearance → Sidebar.

## Limites conhecidos

O plugin usa partes experimentais do SDK do Cloudroom. Nesta versão (v151):

- O hook de threads devolve vazias as arquivadas e as seções. O plugin busca as duas pela API.
- O símbolo de status e o menu de contexto do próprio Cloudroom não funcionam dentro do plugin. Por isso o plugin desenha os seus.
- O plugin não sabe com certeza se uma thread roda local ou na nuvem: mostra "nuvem" quando a thread não tem máquina.
- O novo nome de uma pasta renomeada pode levar até 1 minuto para aparecer.

## Desenvolver

`room-cli plugin dev .` recompila e recarrega a cada mudança. Não mude o `name` do `package.json`: ele define o id do plugin, e mudar quebra o CSS.
