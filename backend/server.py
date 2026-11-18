import io
import json
import logging
import os
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
try:
    import speech_recognition as sr
except ImportError:
    sr = None

from .core.ollama_client import ollama_manager
from .core.api_client import api_model_manager
from .core.jarvis import jarvis_brain
from .tools.markdown_tool import list_researches, read_research, open_research_file, get_research_file_path
from .tools.system_tool import get_system_telemetry, execute_os_command, get_environment_info, is_cloud_environment

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("atom.server")

BASE_DIR = Path(__file__).resolve().parent.parent
# O cockpit fica em public/ (a Vercel serve essa pasta direto pela CDN).
FRONTEND_DIR = BASE_DIR / "public"
if not FRONTEND_DIR.exists():
    FRONTEND_DIR = BASE_DIR / "frontend"

# --- LIMITE DE USO DA CHAVE DO SERVIDOR (MODO NUVEM) ---
# Desligado por padrão (0 = sem limite). Para ligar, defina ATOM_RATE_LIMIT_PER_HOUR
# na Vercel: visitantes sem chave própria passam a ter N mensagens por IP por hora.
RATE_LIMIT_PER_HOUR = int(os.environ.get("ATOM_RATE_LIMIT_PER_HOUR", "0") or 0)
_usage: Dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "desconhecido"


def _check_rate_limit(request: Request) -> Optional[int]:
    """Retorna None se liberado, ou os minutos até liberar se o limite estourou."""
    if not is_cloud_environment() or RATE_LIMIT_PER_HOUR <= 0:
        return None
    now = time.time()
    hits = _usage[_client_ip(request)]
    while hits and now - hits[0] > 3600:
        hits.popleft()
    if len(hits) >= RATE_LIMIT_PER_HOUR:
        return max(1, int((3600 - (now - hits[0])) // 60) + 1)
    hits.append(now)
    return None


def _block_in_cloud():
    if is_cloud_environment():
        raise HTTPException(status_code=403, detail="Indisponível na versão online do A.T.O.M.")

app = FastAPI(title="A.T.O.M. Tactical OS", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELOS PYDANTIC ---
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    model: Optional[str] = None
    temperature: Optional[float] = 0.7
    autonomous: Optional[bool] = False
    session_key: Optional[str] = None
    image_base64: Optional[str] = None

class PullModelRequest(BaseModel):
    model_name: str

class AddApiModelRequest(BaseModel):
    name: str
    provider: str
    model_id: str
    base_url: Optional[str] = None
    description: Optional[str] = None

class TestApiModelRequest(BaseModel):
    provider: str
    model_id: str
    api_key: str
    base_url: Optional[str] = None

class ExecuteCmdRequest(BaseModel):
    command: str
    autonomous: Optional[bool] = False

class OpenResearchRequest(BaseModel):
    filename: Optional[str] = None

# --- ROTAS DA API ---

@app.get("/api/health")
def health_check():
    ollama_ok = ollama_manager.is_available()
    return {
        "status": "online",
        "system": "A.T.O.M. Tactical Operating Matrix",
        "ollama_connected": ollama_ok,
        "environment": get_environment_info()
    }

@app.get("/api/models")
def get_models():
    """Lista todos os modelos locais (Ollama) e modelos de nuvem (API)."""
    local_models = ollama_manager.list_models()
    api_models = api_model_manager.list_models()
    return {
        "success": True,
        "local_models": local_models,
        "api_models": api_models,
        "default_model": jarvis_brain.default_model
    }

@app.get("/api/models/google")
def get_google_models(session_key: Optional[str] = None):
    """Consulta os modelos do Google Gemini disponíveis para a chave configurada."""
    models = api_model_manager.list_google_models(session_key=session_key)
    return {"success": True, "models": models}

@app.post("/api/models/api")
def add_api_model(req: AddApiModelRequest):
    """Cadastra um novo modelo de API (apenas metadados e provedor, sem chaves)."""
    _block_in_cloud()
    return api_model_manager.add_model(req.model_dump())

@app.delete("/api/models/api/{model_id}")
def delete_api_model(model_id: str):
    """Remove um modelo de API cadastrado do catálogo."""
    _block_in_cloud()
    success = api_model_manager.delete_model(model_id)
    if not success:
        raise HTTPException(status_code=404, detail="Modelo não encontrado")
    return {"success": True}

@app.post("/api/models/api/test")
async def test_api_model(req: TestApiModelRequest):
    """Testa uma chave e conexão com a API sem salvar nada no servidor."""
    return await api_model_manager.test_connection(
        provider=req.provider,
        model_id=req.model_id,
        api_key=req.api_key,
        base_url=req.base_url
    )

@app.post("/api/models/pull")
async def pull_model(req: PullModelRequest):
    """Baixa um novo modelo do repositório Ollama com streaming de progresso SSE."""
    _block_in_cloud()
    async def event_generator():
        async for progress in ollama_manager.pull_model_stream(req.model_name):
            yield f"data: {json.dumps(progress, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

STT_MODEL = os.environ.get("ATOM_STT_MODEL", "gemini-flash-latest")


def _transcribe_with_gemini(content: bytes, mime: str, session_key: Optional[str]) -> Optional[str]:
    """Transcreve a fala com o Gemini (funciona online, sem ffmpeg). Devolve None se não houver chave."""
    key = api_model_manager.resolve_api_key({"provider": "google", "env_var": "GEMINI_API_KEY"}, session_key)
    if not key:
        return None
    from google.genai import types
    from .core.api_client import genai_client, best_flash_model
    client = genai_client(key)
    def ask(model):
        return client.models.generate_content(model=model, contents=parts, config=types.GenerateContentConfig(temperature=0))
    parts = [types.Content(role="user", parts=[
            types.Part.from_bytes(data=content, mime_type=mime),
            types.Part.from_text(text=(
                "Transcreva exatamente o que a pessoa fala neste áudio, em português do Brasil. "
                "Responda só com o texto falado, sem aspas e sem comentários. "
                "Se não houver fala compreensível, responda apenas: [silencio]"
            )),
        ])]
    try:
        resp = ask(STT_MODEL)
    except Exception as e:
        logger.warning(f"[TRANSCRIÇÃO] {STT_MODEL} falhou ({e}); tentando o Flash mais novo")
        resp = ask(best_flash_model(client, key))
    text = (getattr(resp, "text", "") or "").strip()
    return "" if text.lower().strip("[] .") == "silencio" else text


@app.post("/api/audio/transcribe")
async def transcribe_audio(audio: UploadFile = File(...), session_key: Optional[str] = Form(None)):
    """Transcreve o áudio do microfone. O navegador manda WAV; usa o Gemini quando há chave e o
    SpeechRecognition (Google Web Speech) como reserva."""
    try:
        content = await audio.read()
        if not content or len(content) < 400:
            return {"success": False, "error": "Áudio muito curto ou vazio."}
        is_wav = content.startswith(b'RIFF')
        mime = "audio/wav" if is_wav else (audio.content_type or "audio/webm").split(";")[0]

        gemini_error = None
        try:
            text = _transcribe_with_gemini(content, mime, session_key)
            if text:
                logger.info("[TRANSCRIÇÃO VIA GEMINI]: ok")
                return {"success": True, "text": text}
            if text == "":
                return {"success": False, "error": "Não ouvi nenhuma fala. Fale um pouco mais perto do microfone."}
        except Exception as g_err:
            gemini_error = g_err
            logger.warning(f"[TRANSCRIÇÃO VIA GEMINI]: falhou, tentando reserva: {g_err}")

        buf = io.BytesIO(content)
        # Se não começar com cabeçalho RIFF (WAV puro), converter via pydub
        if not is_wav:
            try:
                from pydub import AudioSegment
                seg = AudioSegment.from_file(io.BytesIO(content))
                buf = io.BytesIO()
                seg.export(buf, format="wav")
                buf.seek(0)
            except Exception as conv_err:
                logger.warning(f"Tentativa de conversão de formato de áudio: {conv_err}")

        if sr is None:
            if gemini_error:
                return {"success": False, "error": f"Falha ao transcrever com o Gemini: {gemini_error}"}
            return {"success": False, "error": "Sem chave do Gemini e sem SpeechRecognition para transcrever o áudio."}

        recognizer = sr.Recognizer()

        with sr.AudioFile(buf) as source:
            audio_data = recognizer.record(source)

        text = recognizer.recognize_google(audio_data, language="pt-BR")
        logger.info(f"[TRANSCRIÇÃO DE ÁUDIO SUCESSO]: '{text}'")
        return {"success": True, "text": text}
    except sr.UnknownValueError:
        logger.info("[TRANSCRIÇÃO DE ÁUDIO]: Nenhuma fala compreensível detectada no arquivo.")
        return {"success": False, "error": "Nenhuma fala audível detectada. Verifique se o microfone está ativo."}
    except sr.RequestError as e:
        logger.warning(f"[TRANSCRIÇÃO DE ÁUDIO]: Erro de rede na API Google: {e}")
        return {"success": False, "error": f"Erro de conexão no serviço de transcrição: {e}"}
    except Exception as e:
        logger.error(f"[ERRO TRANSCRIÇÃO]: {e}")
        return {"success": False, "error": f"Falha ao processar áudio: {str(e)}"}

@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    """Processa a conversa em tempo real com execução de ferramentas, visão de tela e streaming SSE."""
    if not (req.session_key and req.session_key.strip()):
        wait_min = _check_rate_limit(request)
        if wait_min is not None:
            msg = (f"Limite de {RATE_LIMIT_PER_HOUR} mensagens por hora da versão online atingido. "
                   f"Tente de novo em {wait_min} min, ou cole sua própria chave de API no painel de chaves para continuar sem limite.")

            async def limited():
                yield f"data: {json.dumps({'type': 'error', 'error': msg}, ensure_ascii=False)}\n\n"

            return StreamingResponse(limited(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    messages_payload = [{"role": m.role, "content": m.content} for m in req.messages]

    async def sse_generator():
        try:
            async for event in jarvis_brain.process_conversation_stream(
                messages=messages_payload,
                model=req.model,
                temperature=req.temperature or 0.7,
                autonomous=req.autonomous or False,
                session_key=req.session_key,
                image_base64=req.image_base64
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Erro no streaming do chat: {e}", exc_info=True)
            err_payload = {"type": "error", "error": str(e)}
            yield f"data: {json.dumps(err_payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.get("/api/telemetry")
def get_telemetry():
    """Retorna métricas em tempo real de hardware e status do Ollama."""
    telemetry = get_system_telemetry()
    telemetry["ollama_connected"] = ollama_manager.is_available()
    return telemetry

@app.get("/api/researches")
def get_researches():
    """Lista todos os arquivos de pesquisa Markdown criados."""
    items = list_researches()
    return {"success": True, "count": len(items), "items": items}

@app.get("/api/researches/{filename}")
def get_research_content(filename: str):
    """Retorna o conteúdo do arquivo Markdown solicitado."""
    res = read_research(filename)
    if not res:
        raise HTTPException(status_code=404, detail="Dossiê não encontrado")
    return res

@app.get("/api/researches/{filename}/download")
def download_research(filename: str):
    """Permite o download direto do arquivo de pesquisa Markdown (.md)."""
    file_path = get_research_file_path(filename)
    if not file_path:
        raise HTTPException(status_code=404, detail="Relatório não encontrado ou caminho inválido.")
    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{file_path.name}"'}
    )

@app.post("/api/researches/open")
def open_research(req: OpenResearchRequest):
    """Abre o arquivo ou a pasta no Windows Explorer."""
    return open_research_file(req.filename)

@app.post("/api/cmd/execute")
def execute_command(req: ExecuteCmdRequest):
    """Execução direta de comando via terminal HUD do operador."""
    return execute_os_command(req.command, autonomous=req.autonomous or False)

# --- ARQUIVOS ESTÁTICOS DO FRONTEND ---
# Na Vercel a pasta public/ já é servida pela CDN; o mount fica só para o uso local/Render.
if os.environ.get("VERCEL"):
    pass
elif FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:
    logger.warning(f"Diretório frontend não encontrado em: {FRONTEND_DIR}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.server:app", host="0.0.0.0", port=8000, reload=False)
