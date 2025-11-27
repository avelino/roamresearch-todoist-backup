# Roam Todoist Backup

Roam Research extension that keeps a read-only backup of all Todoist tasks inside dedicated task pages of your graph.

> plugin inspired by [logseq-todoist-backup](https://github.com/avelino/logseq-todoist-backup)

## Overview

- Read-only integration with the Todoist REST API.
- Manual sync pelo command palette do Roam (`Todoist: Sync backup`) ou pelo ícone na topbar.
- Sincronização automática com intervalo configurável (padrão 5 minutos).
- Cada tarefa vive em uma página dedicada `todoist/<todoist-id>`, preservando histórico por item.
- Atualiza blocos existentes com base em `todoist-id::`, evitando duplicidades e removendo tarefas inexistentes sem apagar concluídas.
- Gera blocos compatíveis com Roam, incluindo links, descrição, tags de projeto, labels saneadas e datas no padrão das páginas diárias.
- Converte labels inline do Todoist (`@label`) para hashtags (`#label`) para facilitar filtros dentro do Roam.

## Requirements

- Roam Research with extension support (Roam Depot or custom script loader).
- Todoist personal API token with read access.

## Configuration

Abra `Roam Depot → Extension Settings → Todoist Backup`. A aba exibe todos os campos configuráveis:

- **Todoist Token**: cole o token pessoal obtido em [Todoist Integrations](https://todoist.com/prefs/integrations).
- **Target Page Prefix**: prefixo das páginas de destino (padrão `todoist`). Cada tarefa é escrita em `prefix/<todoist-id>`.
- **Sync Interval (minutes)**: intervalo entre sincronizações automáticas (mínimo `1` minuto).
- **Download Comments**: ativa o download dos comentários do Todoist.
- **Excluded Task Title Patterns**: informe expressões regulares (uma por linha) para ignorar tarefas pelo título.
- **Enable Debug Logs**: habilita logs detalhados no console do navegador.
- **Status Alias**: personalize os rótulos exibidos para tarefas ativas, concluídas e removidas.

As alterações são aplicadas na próxima sincronização manual ou automática.

## Usage

- **Manual sync**: clique no ícone da topbar (📁) ou execute `Todoist: Sync backup`.
- **Automatic sync**: roda em segundo plano conforme o intervalo configurado.
- **Formato do bloco principal**:

```
[[January 2nd, 2025]] Title [todoist](https://todoist.com/showTask?id=123456789)
todoist-id:: [123456789](https://todoist.com/showTask?id=123456789)
todoist-project:: #Inbox
todoist-due:: January 2nd, 2025
todoist-desc:: Optional description
todoist-labels:: #label-1 #label-2
todoist-status:: ✅
```

Datas são renderizadas como `MMMM Do, YYYY`, alinhadas ao padrão das páginas diárias do Roam. Labels são sanitizadas e prefixadas com `#`. Quando a captura de comentários está ativa, um bloco filho `comments...` traz cada comentário do Todoist ordenado cronologicamente.

## Sync behavior

- Cada tarefa permanece na página `todoist/<todoist-id>`. Blocos existentes são atualizados, novos são adicionados e tarefas removidas do Todoist deixam de aparecer (concluídas permanecem).
- Datas exibidas usam o formato `MMMM Do, YYYY`, permitindo links diretos com páginas diárias do Roam.
- Comentários (quando habilitados) aparecem como blocos filhos com links diretos para o Todoist.
- Todo o fluxo é somente leitura em relação ao Todoist.

## Development

- `pnpm install`
- `pnpm build` produces `dist/extension.js`, which can be loaded through Roam's custom extensions workflow.
- Source code lives under `src/`; the entry point is `src/main.ts`.

Contributions are welcome—feel free to open issues or pull requests with improvements and suggestions.
