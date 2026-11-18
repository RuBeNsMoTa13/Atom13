<!--
Data/Hora: 2026-10-15T22:39:00-03:00 (UTC-3)
Branch: Web-Atom
Commit: 7dce1c2
Status: Atualizado
-->

# Documentação & Auditoria — A.T.O.M.

Bem-vindo ao índice central de governança, arquitetura e rastreabilidade técnica do **Atom** concebido e desenvolvido por **Rubens Mota**.

---

## 🗂️ Índice Geral de Documentação Técnica

### 1. Governança, Arquitetura & Backlog
- 🏛️ **[Fonte Primária da Verdade (GEMINI.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/GEMINI.md)** — Stack tecnológica, diretrizes invioláveis e visão geral do sistema.
- 🎯 **[Backlog & Status de Tarefas (docs/todo.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/docs/todo.md)** — Rastreabilidade oficial de tarefas concluídas e futuras expansões.
- 📐 **[Arquitetura Geral do Sistema (docs/arquitetura/atom.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/docs/arquitetura/atom.md)** — Diagrama mermaid, componentes híbridos e orquestração.
- 📋 **[Plano dos 9 Passos (plano.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/plano.md)** — Especificação e validação da migração completa.

### 2. Modelos de IA & Inteligência Neural
- 🧠 **[Catálogo de Modelos de IA & Arquitetura Híbrida (docs/modelos/catalogo-e-ia.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/docs/modelos/catalogo-e-ia.md)** — Modelos cloud oficiais (Gemini Flash, Groq Vision), modelos locais via Ollama, matriz comparativa e segurança de chaves.
- 👁️ **[Visão Multimodal de Tela (docs/fluxos/visao-multimodal.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/docs/fluxos/visao-multimodal.md)** — Ciclo completo `getDisplayMedia`, canvas JPEG 1280px / 0.75, streaming base64 e injeção em Gemini e Groq Vision.
- 🔬 **[Pesquisa Aprofundada & Síntese Científica (docs/fluxos/pesquisa-e-sintese.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/docs/fluxos/pesquisa-e-sintese.md)** — DuckDuckGo (`ddgs`), bypass Jina Reader (`r.jina.ai`), API XML do arXiv e geração de dossiês.

### 3. Referência de API & Contratos de Dados
- 📡 **[Especificação de Endpoints REST & Eventos SSE (docs/api/endpoints.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/docs/api/endpoints.md)** — Rotas `/api/health`, `/api/models`, `/api/researches/{filename}/download`, `/api/chat/stream` e protocolo de eventos Server-Sent Events.

### 4. Deploy, Infraestrutura & PWA
- 🌐 **[Guia de Deploy: Render (Cloud) & Windows (Local) (docs/deploy/render-e-local.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/docs/deploy/render-e-local.md)** — Inicialização em 1 clique via `run_atom.bat`, manual no PowerShell, deploy no Render com `Procfile` e instalação PWA.

### 5. Design System & Interface Visual
- 🎨 **[Especificação do Design System escuro e vermelho (docs/design-system/escuro-e-vermelho.md)](https://github.com/RuBeNsMoTa13/atom13/blob/main/docs/design-system/escuro-e-vermelho.md)** — Tokens HSL/Hex, tipografia (Space Grotesk + JetBrains Mono), geometria 4px e animação do Reator Quântico 2D.

---

## 🛡️ Padrão de Governança
Todos os arquivos localizados neste diretório obedecem aos seguintes critérios de auditoria:
1. **Cabeçalho Mandatório de Rastreabilidade** contendo Data/Hora em UTC-3, Branch ativa e Commit de referência.
2. **Proibição de Markdown Solto**: Novos relatórios e especificações devem ser agrupados em subdiretórios temáticos (`docs/arquitetura/`, `docs/fluxos/`, `docs/api/`, `docs/deploy/`, `docs/design-system/`).
3. **Backlog Centralizado**: O arquivo [docs/todo.md](https://github.com/RuBeNsMoTa13/atom13/blob/main/docs/todo.md) é a única fonte oficial de pendências e melhorias.
