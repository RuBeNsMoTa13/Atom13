/**
 * MODO LIVE DO ATOM (Gemini Live API)
 * Conversa por voz em tempo real: o microfone fica aberto o tempo todo, o Gemini responde com voz
 * nativa e, se você começar a falar, ele para na hora para te ouvir (o próprio Gemini detecta).
 *
 * O navegador conecta direto no Google por WebSocket:
 * - com a chave colada na aba, usa a própria chave;
 * - com a chave guardada na Vercel, o servidor entrega um token de uso único (a chave nunca vem pro navegador).
 */

const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage';
const IN_RATE = 16000;   // o Gemini recebe PCM 16 kHz
const OUT_RATE = 24000;  // e devolve PCM 24 kHz

const WORKLET = `
class AtomMic extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('atom-mic', AtomMic);
`;

function toBase64(bytes) {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class AtomLive {
  /**
   * @param {object} h callbacks: onState(state), onUserText(text, final), onAtomText(text, final),
   *   onTurn(userText, atomText), onMouth(level|null), onMicLevel(0..100), onError(msg), onClose(reason)
   */
  constructor(h = {}) {
    this.h = h;
    this.ws = null;
    this.active = false;
    this.sources = new Set();
    this.userText = '';
    this.atomText = '';
  }

  emit(name, ...args) {
    try { if (this.h[name]) this.h[name](...args); } catch (e) { console.warn('[LIVE]', name, e); }
  }

  async start({ voice = 'Fenrir', systemPrompt = '', sessionKey = null, native = true, functions = [], _retry = false } = {}) {
    if (this.active) return;
    this.active = true;
    this.emit('onState', 'CONNECTING');
    try {
      const res = await fetch('/api/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_key: sessionKey, native })
      });
      const info = await res.json().catch(() => ({}));
      if (!res.ok || !info.success) throw new Error(info.error || 'Não consegui preparar o modo Live.');
      if (!this.active) return;

      const url = info.auth === 'token'
        ? `${WS_BASE}.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(info.token)}`
        : `${WS_BASE}.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(sessionKey)}`;
      this.model = info.model;

      await this.openSocket(url, {
        setup: {
          model: `models/${info.model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
          },
          systemInstruction: { parts: [{ text: systemPrompt }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ googleSearch: {} }].concat(functions.length ? [{ functionDeclarations: functions }] : [])
        }
      });
      if (!this.active) return;
      await this.startPlayback();
      await this.startMic();
      this.emit('onState', 'LISTENING');
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const stillWanted = this.active; // se a pessoa desligou no meio, não tenta de novo
      this.stop(true);
      if (!stillWanted) return;
      // O modelo "mesma voz" pode não existir para a chave: tenta uma vez o de áudio nativo
      if (!native && !_retry) {
        this.emit('onFallback', msg);
        return this.start({ voice, systemPrompt, sessionKey, native: true, functions, _retry: true });
      }
      this.emit('onError', msg);
    }
  }

  openSocket(url, setupMsg) {
    return new Promise((resolve, reject) => {
      let ready = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => { if (!ready) reject(new Error('O Gemini Live não respondeu a tempo.')); }, 15000);
      ws.onopen = () => ws.send(JSON.stringify(setupMsg));
      ws.onerror = () => { if (!ready) { clearTimeout(timer); reject(new Error('Falha ao conectar no Gemini Live.')); } };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        if (!ready) { reject(new Error(ev.reason || `Conexão recusada pelo Gemini Live (código ${ev.code}).`)); return; }
        if (this.active) { this.stop(true); this.emit('onClose', ev.reason || 'A sessão Live terminou.'); }
      };
      ws.onmessage = async (ev) => {
        let data = ev.data;
        if (data instanceof Blob) data = await data.text();
        let msg;
        try { msg = JSON.parse(data); } catch (e) { return; }
        if (msg.setupComplete && !ready) { ready = true; clearTimeout(timer); resolve(); return; }
        this.handle(msg);
      };
    });
  }

  handle(msg) {
    // O Gemini pediu para rodar funções (artigos, arquivo Markdown...): o app roda e devolve o resultado
    if (msg.toolCall && msg.toolCall.functionCalls) {
      this.emit('onToolCall', msg.toolCall.functionCalls);
      return;
    }
    if (msg.goAway) this.emit('onError', 'O Gemini vai encerrar esta sessão Live em instantes (limite de tempo). É só ligar de novo.');
    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.interrupted) {
      // Você começou a falar: o Atom cala na hora
      this.stopPlayback();
      if (this.atomText) { this.emit('onAtomText', this.atomText + ' …', true); }
      this.emit('onState', 'LISTENING');
    }
    if (sc.inputTranscription && sc.inputTranscription.text) {
      this.userText += sc.inputTranscription.text;
      this.emit('onUserText', this.userText.trim(), false);
      if (!this.playing) this.emit('onState', 'LISTENING');
    }
    if (sc.outputTranscription && sc.outputTranscription.text) {
      this.atomText += sc.outputTranscription.text;
      this.emit('onAtomText', this.atomText.trim(), false);
    }
    const parts = (sc.modelTurn && sc.modelTurn.parts) || [];
    parts.forEach((p) => {
      const d = p.inlineData;
      if (d && d.data && /audio\/pcm/.test(d.mimeType || '')) {
        const m = /rate=(\d+)/.exec(d.mimeType);
        this.playPcm(fromBase64(d.data), m ? parseInt(m[1], 10) : OUT_RATE);
      }
    });
    if (sc.turnComplete || sc.interrupted) {
      const u = this.userText.trim();
      const a = this.atomText.trim();
      if (u || a) this.emit('onTurn', u, a + (sc.interrupted && a ? ' …' : ''));
      this.userText = '';
      this.atomText = '';
    }
  }

  /* ---------------- Microfone -> Gemini ---------------- */

  async startMic() {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.inCtx = new Ctx();
    await this.inCtx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.inCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.inCtx.createMediaStreamSource(this.micStream);
    this.micNode = new AudioWorkletNode(this.inCtx, 'atom-mic');
    const ratio = this.inCtx.sampleRate / IN_RATE;
    let pending = [];
    let pendingLen = 0;
    let carry = 0;
    let levelTick = 0;
    this.micNode.port.onmessage = (ev) => {
      const input = ev.data;
      // Reamostra para 16 kHz (média simples entre amostras)
      const outLen = Math.floor((input.length - carry) / ratio);
      const out = new Int16Array(Math.max(0, outLen));
      let sum = 0;
      for (let i = 0; i < out.length; i++) {
        const pos = carry + i * ratio;
        const a = Math.floor(pos);
        const b = Math.min(input.length - 1, a + 1);
        const v = input[a] + (input[b] - input[a]) * (pos - a);
        sum += v * v;
        out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      }
      carry = carry + out.length * ratio - input.length;
      if (carry < 0) carry = 0;
      pending.push(out);
      pendingLen += out.length;
      if (++levelTick % 8 === 0 && out.length) {
        const db = 20 * Math.log10(Math.sqrt(sum / out.length) + 1e-8);
        this.emit('onMicLevel', Math.max(0, Math.min(100, Math.round((db + 60) * 2))));
      }
      if (pendingLen >= IN_RATE / 10) { // manda a cada ~100 ms
        const all = new Int16Array(pendingLen);
        let o = 0;
        pending.forEach((c) => { all.set(c, o); o += c.length; });
        pending = [];
        pendingLen = 0;
        this.send({ realtimeInput: { audio: { data: toBase64(new Uint8Array(all.buffer)), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
      }
    };
    src.connect(this.micNode);
  }

  /** Quadro da tela compartilhada (JPEG em base64, sem o prefixo data:) para o Atom ver. */
  sendFrame(base64jpeg) {
    if (!base64jpeg) return;
    this.send({ realtimeInput: { video: { data: base64jpeg.replace(/^data:image\/\w+;base64,/, ''), mimeType: 'image/jpeg' } } });
  }

  /** Resultado das funções, para o Gemini continuar a conversa. */
  sendToolResponse(responses) {
    this.send({ toolResponse: { functionResponses: responses } });
  }

  /** Mensagem escrita durante o Live. */
  sendText(text) {
    if (!text) return;
    this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  /* ---------------- Gemini -> alto-falante ---------------- */

  async startPlayback() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.outCtx = new Ctx();
    await this.outCtx.resume();
    this.outGain = this.outCtx.createGain();
    this.outAnalyser = this.outCtx.createAnalyser();
    this.outAnalyser.fftSize = 512;
    this.outGain.connect(this.outAnalyser);
    this.outAnalyser.connect(this.outCtx.destination);
    this.nextTime = 0;
    this.playing = false;
    const buf = new Float32Array(this.outAnalyser.fftSize);
    let level = 0;
    const tick = () => {
      if (!this.outCtx) return;
      if (this.playing) {
        this.outAnalyser.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        const target = Math.min(1, Math.max(0, (Math.sqrt(s / buf.length) - 0.02) * 4.5));
        level = target > level ? level + (target - level) * 0.7 : level + (target - level) * 0.35;
        this.emit('onMouth', level);
      }
      this.mouthRaf = requestAnimationFrame(tick);
    };
    this.mouthRaf = requestAnimationFrame(tick);
  }

  playPcm(bytes, rate) {
    if (!this.outCtx) return;
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const audioBuf = this.outCtx.createBuffer(1, samples.length, rate);
    const ch = audioBuf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
    const src = this.outCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.outGain);
    const now = this.outCtx.currentTime;
    if (this.nextTime < now + 0.03) this.nextTime = now + 0.06;
    src.start(this.nextTime);
    this.nextTime += audioBuf.duration;
    this.sources.add(src);
    if (!this.playing) { this.playing = true; this.emit('onState', 'SPEAKING'); this.emit('onMouth', 0); }
    src.onended = () => {
      this.sources.delete(src);
      if (this.sources.size === 0 && this.playing) {
        this.playing = false;
        this.emit('onMouth', 0);
        this.emit('onState', 'LISTENING');
      }
    };
  }

  stopPlayback() {
    this.sources.forEach((s) => { try { s.onended = null; s.stop(); } catch (e) {} });
    this.sources.clear();
    this.playing = false;
    if (this.outCtx) this.nextTime = this.outCtx.currentTime;
    this.emit('onMouth', 0);
  }

  /* ---------------- Encerrar ---------------- */

  stop(silent = false) {
    const wasActive = this.active;
    this.active = false;
    this.stopPlayback();
    cancelAnimationFrame(this.mouthRaf);
    try { if (this.micNode) { this.micNode.port.onmessage = null; this.micNode.disconnect(); } } catch (e) {}
    try { if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (this.inCtx) this.inCtx.close(); } catch (e) {}
    try { if (this.outCtx) this.outCtx.close(); } catch (e) {}
    try { if (this.ws) { this.ws.onclose = null; this.ws.close(); } } catch (e) {}
    this.ws = null; this.micNode = null; this.micStream = null; this.inCtx = null; this.outCtx = null;
    this.emit('onMouth', null);
    if (wasActive && !silent) this.emit('onState', 'OFF');
  }
}
