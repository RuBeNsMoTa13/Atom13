<!--
Data/Hora: 2026-10-15T22:39:00-03:00 (UTC-3)
Branch: Web-Atom
Commit: 7dce1c2
Status: Atualizado
-->

# Backlog — A.T.O.M.

Este é o backlog oficial e único de rastreabilidade do projeto **A.T.O.M.** Qualquer nova demanda, débito técnico ou funcionalidade deve ser registrada exclusivamente neste documento.

---

## 🎯 Transformação A.T.O.M. (Execução do `plano.md`)

- [x] **Passo 1: Deploy em Nuvem (Render / Procfile)**
  - [x] Criar `Procfile` com comando de inicialização Uvicorn e porta `$PORT`.
  - [x] Testar compatibilidade de portas locais e em container.
- [x] **Passo 2: Catálogo de Modelos Cloud (`config/api_models.json`)**
  - [x] Cadastrar `gemini-flash-latest` (Google Gemini padrão).
  - [x] Cadastrar `gemini-3.6-flash` (Google Gemini 3.6).
  - [x] Cadastrar `groq-llama-vision` (`meta-llama/llama-4-scout-17b-16e-instruct`).
  - [x] Documentar catálogo neural e integração Ollama em `docs/modelos/catalogo-e-ia.md`.
- [x] **Passo 3: Ferramenta de Pesquisa com DuckDuckGo & ArXiv & Jina (`search_tool.py`)**
  - [x] Implementar fallback resiliente via `ddgs` (DuckDuckGo).
  - [x] Implementar extração limpa de páginas via `r.jina.ai`.
  - [x] Implementar busca em artigos acadêmicos via API XML do `arXiv`.
  - [x] Adicionar cache em memória com TTL de 30 minutos.
- [x] **Passo 4: Ferramenta de Sistema Operacional Adaptativa (`system_tool.py`)**
  - [x] Implementar detecção automática de ambiente (`is_cloud_environment()`).
  - [x] Configurar allowlist segura para ambiente de nuvem.
  - [x] Habilitar retorno com intenção `open_url` quando em nuvem para abertura no navegador do cliente.
- [x] **Passo 5: Geração de Relatórios Markdown & Download (`markdown_tool.py`)**
  - [x] Atualizar persona nos relatórios para A.T.O.M. por Rubens Mota.
  - [x] Criar função `get_research_file_path()` com proteção contra path traversal.
  - [x] Adicionar campo `download_url` no retorno estruturado de dossiês.
- [x] **Passo 6: Cliente de API Multimodal (`api_client.py`)**
  - [x] Suportar `image_base64` via Google GenAI SDK (`types.Part.from_bytes`) e fallback REST.
  - [x] Suportar envio de imagens em formato URL base64 para Groq Vision e OpenAI.
  - [x] Garantir fallback inteligente para `gemini-flash-latest`.
- [x] **Passo 7: Servidor FastAPI com Rotas de Download e Visão (`server.py`)**
  - [x] Atualizar título da aplicação para **Atom**.
  - [x] Adicionar `image_base64` no esquema Pydantic `ChatRequest`.
  - [x] Implementar rota `GET /api/researches/{filename}/download` com `FileResponse`.
  - [x] Otimizar verificação do Ollama com socket probe rápido para não travar na nuvem.
- [x] **Passo 8: Cérebro do A.T.O.M. com Orquestração Completa (`atom.py`)**
  - [x] Definir persona oficial A.T.O.M. por Rubens Mota.
  - [x] Orquestrar visão multimodal, arXiv, DuckDuckGo e Jina.
  - [x] Emitir eventos SSE `client_action` e `report_created`.
- [x] **Passo 9: Interface Front-end com Novo Design System, Visão, Download e PWA**
  - [x] Aplicar Design System **escuro e vermelho** em `style.css` com paleta `#ef4444` e fontes `Space Grotesk` / `JetBrains Mono`.
  - [x] Implementar cantoneiras nos painéis HUD e `border-radius: 4px`.
  - [x] Atualizar animação do canvas para órbitas quânticas e elétrons pulsantes em `reactor.js`.
  - [x] Criar botão `#screen-share-btn` com compressão canvas (máx 1280px JPEG 0.75) e badge no composer.
  - [x] Renderizar cards com botão de download no chat ao disparar `report_created`.
  - [x] Adicionar botões de download na gaveta de dossiês e no leitor modal.
  - [x] Criar `manifest.json`, `atom-icon.svg` e `sw.js` para suporte PWA desktop e mobile.

---

## ☁️ Versão Online (Vercel) — 2026-11-18

- [x] Deploy na Vercel (`app.py`, `vercel.json`, cockpit em `public/`): https://atom13.vercel.app
- [x] Sem limite de mensagens por padrão (decisão do Rubens, 18/11). Se um dia precisar, é só definir `ATOM_RATE_LIMIT_PER_HOUR` na Vercel (ex.: 20).
- [x] Catálogo de modelos e pull do Ollama bloqueados no modo nuvem.
- [x] Dossiês em `/tmp` e download direto pelo navegador.
- [x] Miniatura ao vivo da tela compartilhada (estilo Discord), clique para ampliar.
- [ ] Configurar `GEMINI_API_KEY` (e `GROQ_API_KEY`) nas variáveis da Vercel.
- [ ] Esconder no modo online os botões que só funcionam no PC (calculadora, bloco de notas, baixar modelo Ollama, abrir pasta no Windows).
- [ ] Guardar os dossiês do visitante no próprio navegador para a gaveta de dossiês funcionar online.
- [ ] Atualizar README e `docs/deploy` com a Vercel (hoje falam só do Render).

## 🔮 Futuras Expansões
- [ ] Implementar suporte a gravação contínua de sessão de tela para envio sob demanda.
- [ ] Adicionar exportação de dossiês para PDF com tema escuro.
- [ ] Integrar telemetria de GPU (NVIDIA CUDA) no painel de hardware quando rodando localmente.
