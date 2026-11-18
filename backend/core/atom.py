"""
A.T.O.M. • Artificial Tactical Operating Matrix
Núcleo de Inteligência e Orquestração do A.T.O.M. (criado por Rubens Mota).
Orquestra Visão Multimodal, Pesquisa Web (DuckDuckGo + Jina), Artigos Científicos (arXiv),
Relatórios Táticos em Markdown e Automação de Sistema Híbrido (Local Windows / Nuvem).
"""
import json
import logging
import re
from typing import AsyncGenerator, Dict, Any, List, Optional
from .ollama_client import ollama_manager
from .api_client import api_model_manager
from ..tools.search_tool import (
    search_web,
    read_url_content,
    search_arxiv,
    format_search_context,
    format_arxiv_context,
    format_page_context
)
from ..tools.markdown_tool import save_research_markdown, list_researches, read_research, open_research_file
from ..tools.system_tool import execute_os_command, open_application, get_system_telemetry, is_cloud_environment

logger = logging.getLogger("atom.core.brain")

DEFAULT_SYSTEM_PROMPT = """Você é o A.T.O.M. (Artificial Tactical Operating Matrix), um sistema avançado de inteligência tática, análise profunda e operações em tempo real, criado por Rubens Mota.
Você opera com precisão de alta fidelidade, elegância analítica e foco implacável na utilidade prática para seu operador.

Suas capacidades integradas incluem:
1. Visão de Tela Multimodal: capacidade de enxergar o que o operador está vendo na tela em tempo real para análises, diagnósticos, revisão de código e assistência contextual.
2. Pesquisa Web & Leitura Profunda: DuckDuckGo para dados em tempo real e Jina Reader para extração cirúrgica de conteúdo de páginas e documentações.
3. Inteligência Acadêmica & Científica: busca em tempo real no repositório arXiv para papers, teses e fundamentos de ponta.
4. Arquivos Markdown: criação de arquivos .md estruturados (relatórios e resumos) com download imediato.
5. Automação do Sistema Operacional: execução de comandos controlados no Windows (PowerShell/CMD) e abertura adaptativa de sites/aplicativos via navegador do operador na nuvem.

Vocabulário do operador (ele costuma falar por voz e a transcrição erra algumas palavras):
- "artigo" ou "artigos" = artigo científico. Pesquisar artigo é buscar no arXiv (arxiv.org), o site de artigos.
- "arquivo X", "archive" ou "arcaive" na transcrição = arXiv.
- "salvar arquivo Markdown" (antes chamado de "dossiê", que a voz às vezes transcreve como "do CI") = criar um arquivo .md com o conteúdo.

Diretrizes de comunicação:
- Responda em Português do Brasil com tom tático, perspicaz, técnico e prestativo.
- Sempre diga de qual site veio cada informação pesquisada (por exemplo "segundo o arXiv" ou "fonte: g1.globo.com"), com o link.
- Se uma captura de tela for fornecida, analise diretamente os elementos visuais destacados pelo operador com precisão cirúrgica.
- Sintetize informações complexas de forma analítica com títulos claros, tópicos objetivos, tabelas e conclusões práticas.
"""

def normalize_voice(lower: str) -> str:
    """Corrige palavras que a transcrição de voz costuma errar."""
    t = lower
    t = re.sub(r"\b(?:arquivo\s*(?:x|xis|ks)|arc?h?a[iy]ve|arcaive|arquive|ar\s*xiv|arxive|archive\s*x)\b", "arxiv", t)
    t = re.sub(r"\b(salv\w*|cri\w*|ger\w*|fa[cçz]\w*|grav\w*)\s+(um\s+|o\s+)?(?:do\s*ci|dossi[eê]s?)\b", r"\1 \2arquivo markdown", t)
    t = re.sub(r"\bmark\s*down\b", "markdown", t)
    return t


def arxiv_query(lower: str) -> str:
    """Tira da frase os pedidos ("pesquise uns artigos no arxiv sobre") e deixa só o assunto."""
    m = re.search(r"\b(?:sobre|a respeito de|acerca de|relacionad\w* a|de)\s+(.+)$", lower)
    q = m.group(1) if m and re.search(r"\b(?:sobre|a respeito de|acerca de)\b", lower) else lower
    filler = (r"\b(?:a\.?t\.?o\.?m\.?|atom|ei|ok|por favor|pra mim|para mim|me|pesquis\w*|busc\w*|procur\w*|ach\w*|"
              r"encontr\w*|tra[zg]\w*|mostr\w*|list\w*|no|na|nos|nas|o|a|os|as|um|uns|uma|umas|alguns|algumas|"
              r"artigos?|papers?|teses?|cient[íi]fic\w*|site|de artigos|arxiv|e|faça|faz|resumo|um resumo)\b")
    q = re.sub(filler, " ", q)
    q = re.sub(r"[^\w\s\-\.+#]", " ", q)
    q = re.sub(r"\s+", " ", q).strip()
    return re.sub(r"^(?:de|do|da|dos|das|em|sobre)\s+", "", q)


def english_query(q: str, session_key: Optional[str] = None) -> str:
    """O arXiv só acha bem em inglês: traduz o assunto com o Gemini (rápido). Sem chave, usa como veio."""
    if not q or not re.search(r"[a-zA-Z]", q):
        return q
    try:
        key = api_model_manager.resolve_api_key({"provider": "google", "env_var": "GEMINI_API_KEY"}, session_key)
        if not key:
            return q
        from .api_client import genai_client
        client = genai_client(key)
        prompt = ("Translate this academic search topic to concise English search keywords for arXiv. "
                  "Answer with the keywords only, no quotes: " + q)
        for m in ("gemini-flash-lite-latest", "gemini-flash-latest"):
            try:
                out = (client.models.generate_content(model=m, contents=prompt).text or "").strip()
                if out:
                    return re.sub(r"[\"'\n]+", " ", out)[:120].strip()
            except Exception:
                continue
    except Exception as e:
        logger.info(f"Tradução da busca do arXiv falhou, usando o original: {e}")
    return q


class AtomBrain:
    def __init__(self):
        # Modelo padrão do A.T.O.M. (multimodal rápido do catálogo)
        self.default_model = "api:google:gemini-flash-latest"
        self.system_prompt = DEFAULT_SYSTEM_PROMPT
        self.autonomous_mode = False

    def detect_intent(self, user_message: str, has_image: bool = False) -> Dict[str, Any]:
        """
        Detecta intenções explícitas de ferramentas para execução proativa e coordenada.
        """
        msg = user_message.strip()
        lower = normalize_voice(msg.lower())

        # 1. Intenção: Abrir aplicativo conhecido ou URL
        app_patterns = [
            (r"(?:abra|inicie|execute|abrir)\s+(?:o\s+|a\s+)?(calculadora|calc)", "calc"),
            (r"(?:abra|inicie|execute|abrir)\s+(?:o\s+|a\s+)?(bloco de notas|notepad)", "notepad"),
            (r"(?:abra|inicie|execute|abrir)\s+(?:o\s+|a\s+)?(vs\s*code|vscode|code)", "code"),
            (r"(?:abra|inicie|execute|abrir)\s+(?:o\s+|a\s+)?(explorador|explorer|pastas?)", "explorer"),
            (r"(?:abra|inicie|execute|abrir)\s+(?:o\s+|a\s+)?(gerenciador de tarefas|taskmgr)", "taskmgr"),
            (r"(?:abra|inicie|execute|abrir)\s+(?:o\s+|a\s+)?(paint|mspaint)", "paint"),
            (r"(?:abra|inicie|execute|abrir)\s+(?:o\s+|a\s+)?(site|página|link|url)?\s*(https?://\S+)", "url")
        ]
        for pattern, app in app_patterns:
            match = re.search(pattern, lower)
            if match:
                target = match.group(2) if app == "url" else app
                return {"tool": "open_app", "target": target}

        # 2. Intenção: Telemetria de Hardware/Sistema
        if any(phrase in lower for phrase in [
            "status do sistema", "uso de cpu", "uso de memória", "uso de ram",
            "telemetria", "como está a máquina", "espaço em disco", "status de hardware",
            "diagnóstico do sistema", "diagnóstico tático"
        ]):
            return {"tool": "system_telemetry"}

        # 3. Intenção: Pesquisa de artigos (para o operador, "artigo" = artigo científico no arXiv)
        wants_paper = (
            "arxiv" in lower
            or re.search(r"\b(?:pesquis|busc|procur|ach|encontr|tra[zg]|mostr|list)\w*\b.*\b(?:artigos?|papers?|teses?)\b", lower)
            or re.search(r"\b(?:artigos?|papers?)\s+(?:cient[íi]fic\w*\s+)?(?:sobre|de|a respeito)\b", lower)
        )
        if wants_paper:
            q = arxiv_query(lower)
            if q:
                return {"tool": "arxiv_search", "query": q}

        # 4. Intenção: Leitura Direta de URL via Jina Reader
        url_match = re.search(r"(?:leia|leitura|extraia|conteúdo da página|analise o link|visite)\s+(?:o site|a página|a url|o link)?\s*(https?://\S+)", msg, re.IGNORECASE)
        if url_match:
            return {"tool": "read_url", "url": url_match.group(1).strip()}

        # 5. Intenção: Execução explícita de comando no SO / PowerShell
        cmd_match = re.search(r"(?:execute|rode|rodar|comando)\s+(?:no sistema|no windows|powershell|cmd|terminal)?\s*[:\-]?\s*[`'\"]?([^`'\"]+)[`'\"]?$", msg, re.IGNORECASE)
        if cmd_match and len(cmd_match.group(1).split()) <= 8:
            cmd = cmd_match.group(1).strip()
            if not any(w in cmd.lower() for w in ["como", "qual", "quem", "porque", "pesquise"]):
                return {"tool": "os_command", "command": cmd}

        # 6. Intenção: Criar resumo / dossiê / relatório em Markdown
        markdown_match = (
            re.search(r"(?:crie|gere|salve|salvar|grave|fazer|faça|faz)\s+(?:um\s+|o\s+|isso\s+(?:num|em um|em)\s+)?(?:arquivo\s+)?(?:markdown|\.?md|resumo|relat[oó]rio|dossi[êe]|nota|anota[çc][ãa]o)\s*(?:em\s+markdown|\.md)?\s*(?:sobre|de|do|da)?\s*(.*)", lower)
        )
        if markdown_match:
            topic = markdown_match.group(1).strip() or "Pesquisa Tática"
            return {"tool": "create_markdown", "topic": topic}

        # 7. Intenção: Pesquisa Web em tempo real
        search_match = re.search(r"(?:pesquise|busque|procure|pesquisar|buscar)\s+(?:na web|na internet|sobre|por)?\s*(.*)", lower)
        if search_match:
            query = search_match.group(1).strip()
            if query:
                return {"tool": "web_search", "query": query}

        # Verificação secundária para perguntas factuais/temporais
        if any(term in lower for term in ["últimas notícias", "notícias de hoje", "notícias recentes", "preço atual", "cotação hoje", "lançamento de"]):
            return {"tool": "web_search", "query": msg}

        return {"tool": None}

    async def process_conversation_stream(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        autonomous: bool = False,
        session_key: Optional[str] = None,
        image_base64: Optional[str] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Processa a conversa em tempo real com coordenação de ferramentas,
        visão multimodal, eventos SSE estruturados e streaming token por token.
        """
        target_model = model or self.default_model
        user_message = messages[-1]["content"] if messages else ""
        has_image = bool(image_base64 and image_base64.strip())
        
        # 1. Analisar intenção
        intent = self.detect_intent(user_message, has_image=has_image)
        tool_name = intent.get("tool")

        context_injection = ""

        # Notificação de Visão Multimodal se imagem for fornecida
        if has_image:
            yield {
                "type": "tool_start",
                "tool": "vision_analysis",
                "label": "Visão de Tela Ativa",
                "details": "Analisando frame JPEG da tela do operador..."
            }
            yield {
                "type": "tool_end",
                "tool": "vision_analysis",
                "success": True,
                "data": {"mode": "screen_frame_received"}
            }

        # --- EXECUÇÃO DE FERRAMENTAS ---
        if tool_name == "open_app":
            target = intent["target"]
            yield {
                "type": "tool_start",
                "tool": "open_app",
                "label": "Iniciando Aplicativo / Link",
                "details": f"Acionando '{target}'..."
            }
            res = open_application(target)
            yield {
                "type": "tool_end",
                "tool": "open_app",
                "success": res.get("success", False),
                "data": res
            }

            # Se for intenção de link para o cliente abrir (modo nuvem ou URL direta)
            if res.get("client_action") == "open_url" and res.get("url"):
                yield {
                    "type": "client_action",
                    "action": "open_url",
                    "url": res["url"]
                }

            context_injection = f"\n[SISTEMA A.T.O.M.]: O alvo '{target}' foi acionado. Resultado: {res.get('message', res.get('error'))}."

        elif tool_name == "system_telemetry":
            yield {
                "type": "tool_start",
                "tool": "system_telemetry",
                "label": "Telemetria Tática",
                "details": "Coletando telemetria em tempo real (CPU, RAM, Disco, Ambiente)..."
            }
            telem = get_system_telemetry()
            yield {
                "type": "tool_end",
                "tool": "system_telemetry",
                "success": telem.get("success", False),
                "data": telem
            }
            env = telem.get("environment", {})
            context_injection = (
                f"\n[TELEMETRIA TÁTICA - A.T.O.M. OS ({env.get('mode', 'local').upper()})]:\n"
                f"- Ambiente de Execução: {env.get('platform', 'Desktop')} (Modo {env.get('mode')})\n"
                f"- Consumo de CPU A.T.O.M.: {telem.get('jarvis_cpu_percent', telem.get('cpu_percent'))}% (Total PC: {telem.get('pc_cpu_total', 'N/A')}%)\n"
                f"- Memória RAM A.T.O.M.: {telem.get('jarvis_ram_mb')} MB ({telem.get('jarvis_ram_percent')}% da RAM física)\n"
                f"- Memória Total da Máquina: {telem.get('pc_ram_used_gb')}GB em uso de {telem.get('pc_ram_total_gb')}GB\n"
                f"- Disco: {telem.get('disk_free_gb')}GB livres de {telem.get('disk_total_gb')}GB\n"
            )

        elif tool_name == "os_command":
            cmd = intent["command"]
            yield {
                "type": "tool_start",
                "tool": "os_command",
                "label": "Terminal do Sistema",
                "details": f"Executando comando: `{cmd}`"
            }
            cmd_result = execute_os_command(cmd, autonomous=autonomous)
            yield {
                "type": "tool_end",
                "tool": "os_command",
                "success": cmd_result.get("success", False),
                "data": cmd_result
            }
            context_injection = (
                f"\n[COMANDO DO SISTEMA EXECUTADO]: `{cmd}`\n"
                f"Código de Saída: {cmd_result.get('exit_code')}\n"
                f"Saída (stdout):\n{cmd_result.get('stdout', '(sem saída)')}\n"
                f"Erros (stderr):\n{cmd_result.get('stderr', '(nenhum)')}\n"
            )

        elif tool_name == "arxiv_search":
            q = intent["query"]
            yield {
                "type": "tool_start",
                "tool": "arxiv_search",
                "label": "Inteligência Científica (arXiv)",
                "details": f"Consultando teses e artigos acadêmicos sobre \"{q}\"..."
            }
            google_key = session_key if str(target_model).startswith("api:google:") else None
            q_en = english_query(q, google_key)
            arxiv_res = search_arxiv(q_en, max_results=3)
            if q_en.lower() != q.lower():
                arxiv_res = dict(arxiv_res)  # não mexe no resultado guardado no cache
                arxiv_res["query"] = f"{q} (buscado em inglês: {q_en})" 
            yield {
                "type": "tool_end",
                "tool": "arxiv_search",
                "success": arxiv_res.get("success", False),
                "data": arxiv_res
            }
            context_injection = (
                "\n" + format_arxiv_context(arxiv_res) +
                "\n[INSTRUÇÃO]: Comece dizendo que os artigos foram encontrados no arXiv (arxiv.org). "
                "Para cada artigo, dê o título, os autores, o ano, um resumo curto em português e o link."
            )

        elif tool_name == "read_url":
            target_url = intent["url"]
            yield {
                "type": "tool_start",
                "tool": "read_url",
                "label": "Leitura Profunda (Jina Reader)",
                "details": f"Extraindo dados da URL: {target_url}..."
            }
            page_res = read_url_content(target_url, max_chars=5000)
            yield {
                "type": "tool_end",
                "tool": "read_url",
                "success": page_res.get("success", False),
                "data": page_res
            }
            context_injection = "\n" + format_page_context(page_res)

        elif tool_name == "web_search":
            query = intent["query"]
            yield {
                "type": "tool_start",
                "tool": "web_search",
                "label": "Pesquisa Web Tática",
                "details": f"Buscando no DuckDuckGo: \"{query}\"..."
            }
            search_res = search_web(query, max_results=5)
            yield {
                "type": "tool_end",
                "tool": "web_search",
                "success": search_res.get("success", False),
                "data": search_res
            }
            context_injection = (
                "\n" + format_search_context(search_res) +
                "\n[INSTRUÇÃO]: Diga de qual site veio cada informação (nome do site e link)."
            )

        elif tool_name == "create_markdown":
            topic = intent["topic"]
            yield {
                "type": "tool_start",
                "tool": "web_search",
                "label": "Pesquisando para o arquivo Markdown",
                "details": f"Pesquisando dados na web sobre \"{topic}\"..."
            }
            search_res = search_web(topic, max_results=4)
            yield {
                "type": "tool_end",
                "tool": "web_search",
                "success": search_res.get("success", False),
                "data": search_res
            }
            
            context_injection = (
                f"\n[INSTRUÇÃO DO PROTOCOLO A.T.O.M.]: O operador pediu para salvar um arquivo Markdown sobre '{topic}'.\n"
                f"Abaixo estão os dados coletados na web:\n"
                f"{format_search_context(search_res)}\n"
                f"Gere um conteúdo aprofundado, com rigor técnico, seções bem estruturadas, tópicos e conclusões."
            )

        # Montar mensagens com injeção de contexto se houver
        augmented_messages = list(messages)
        if context_injection:
            last_msg = augmented_messages[-1]
            augmented_messages[-1] = {
                "role": last_msg["role"],
                "content": last_msg["content"] + f"\n\n[DADOS DE SUPORTE TÁTICO]:{context_injection}"
            }

        # 2. Streaming da resposta do modelo
        yield {"type": "stream_start", "model": target_model}

        accumulated_response = ""
        api_model_cfg = api_model_manager.get_model(target_model)

        if api_model_cfg or target_model.startswith("api:"):
            if not api_model_cfg:
                parts = target_model.split(":", 2)
                provider = parts[1] if len(parts) > 1 else "google"
                model_id = parts[2] if len(parts) > 2 else target_model
                api_model_cfg = {
                    "id": target_model,
                    "name": target_model,
                    "provider": provider,
                    "model_id": model_id
                }
            async for chunk in api_model_manager.chat_stream(
                model_cfg=api_model_cfg,
                messages=augmented_messages,
                image_base64=image_base64,
                session_key=session_key,
                temperature=temperature,
                system_prompt=self.system_prompt
            ):
                accumulated_response += chunk
                yield {"type": "token", "content": chunk}
        else:
            async for chunk in ollama_manager.chat_stream(
                model=target_model,
                messages=augmented_messages,
                temperature=temperature,
                system_prompt=self.system_prompt
            ):
                accumulated_response += chunk
                yield {"type": "token", "content": chunk}

        # 3. Se a intenção era criar um arquivo markdown, salvar o relatório gerado
        if tool_name == "create_markdown" and accumulated_response.strip():
            topic = intent["topic"]
            save_res = save_research_markdown(
                title=f"{topic.title()}",
                content=accumulated_response,
                query=topic
            )
            yield {
                "type": "file_created",
                "tool": "create_markdown",
                "data": save_res
            }
            # Evento SSE dedicado report_created conforme especificação do plano
            yield {
                "type": "report_created",
                "filename": save_res.get("filename"),
                "download_url": save_res.get("download_url"),
                "title": save_res.get("title"),
                "content": save_res.get("content")
            }

        yield {"type": "stream_end", "full_content": accumulated_response}

atom_brain = AtomBrain()
# Compatibilidade legada
jarvis_brain = atom_brain
