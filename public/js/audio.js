/**
 * SISTEMA DE ÁUDIO & VOZ DO J.A.R.V.I.S.
 * - Efeitos sonoros futuristas sintetizados em tempo real via Web Audio API.
 * - Reconhecimento de fala híbrido de alta resiliência:
 *   1) Web Speech API nativo em tempo real (digita ao vivo no chat).
 *   2) Gravação direta de hardware (MediaRecorder) com envio para o backend STT (/api/audio/transcribe)
 *      para funcionamento 100% garantido no Brave, Edge, Chrome, Firefox e redes com bloqueio.
 * - Síntese de fala (TTS) com perfil vocal sci-fi do JARVIS.
 */

import { JarvisAPI } from './api.js';

export class JarvisAudio {
  constructor(onSpeechRecognized, onStateChange, onErrorMessage = null, onStatusMessage = null) {
    this.onSpeechRecognized = onSpeechRecognized;
    this.onStateChange = onStateChange;
    this.onErrorMessage = onErrorMessage;
    this.onStatusMessage = onStatusMessage;

    this.audioCtx = null;
    this.micStream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.analyser = null;
    this.volumeTimer = null;

    this.isListening = false;
    this.isTranscribing = false;
    // Conversa: segurar para falar (não para no silêncio), limite de espera sem fala e avisos para o app
    this.holdToTalk = false;
    this.idleLimit = 0;          // em décimos de segundo; 0 = espera para sempre
    this.discardNext = false;
    this.isSpeakingNow = false;
    this.onSpeechDone = null;    // o Atom terminou de falar sem ser interrompido
    this.onNothingHeard = null;  // a escuta acabou sem nenhuma frase
    this.onIdleTimeout = null;   // ninguém falou dentro do limite
    this.onMouth = null;         // abertura da boca do Atom (0..1) seguindo a voz; null = solta
    this.hasSpoken = false;
    this.currentText = '';
    this.sfxEnabled = true;
    this.ttsEnabled = true;

    // TTS Config
    this.voiceRate = 1.05;
    this.voicePitch = 0.95;
    // Voz: "natural" (Gemini, no servidor) ou "navegador"; escolha salva neste navegador
    this.speechToken = 0;
    this.currentAudio = null;
    try {
      this.voiceEngine = localStorage.getItem('atom_voz_motor') || 'natural';
      this.geminiVoice = localStorage.getItem('atom_voz_gemini') || 'Fenrir';
    } catch (e) {
      this.voiceEngine = 'natural';
      this.geminiVoice = 'Fenrir';
    }
    this.selectedVoice = null;
    this.voices = [];

    // STT Native Config
    this.recognition = null;

    this.initAudioContext();
    this.initSpeechSynthesis();
    this.initSpeechRecognition();
  }

  initAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    } catch (e) {
      console.warn("Web Audio API não inicializado:", e);
    }
  }

  ensureAudioContext() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /* ==========================================================================
     SÍNTESE DE EFEITOS SONOROS SCI-FI (WEB AUDIO API)
     ========================================================================== */

  playStartupSFX() {
    if (!this.sfxEnabled || !this.audioCtx) return;
    this.ensureAudioContext();
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.5);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  }

  playToolBeep() {
    if (!this.sfxEnabled || !this.audioCtx) return;
    this.ensureAudioContext();
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(780, now + 0.08);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  playCancelSFX() {
    if (!this.sfxEnabled || !this.audioCtx) return;
    this.ensureAudioContext();
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  playCompletionChime() {
    if (!this.sfxEnabled || !this.audioCtx) return;
    this.ensureAudioContext();
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    [660, 880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);

      gain.gain.setValueAtTime(0.08, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.25);
    });
  }

  /* ==========================================================================
     RECONHECIMENTO DE FALA (STT) - MOTOR HÍBRIDO NATIVO + HARDWARE BACKEND
     ========================================================================== */

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.info("Web Speech API nativo não disponível neste browser. O sistema usará o gravador de hardware com backend STT.");
      return;
    }

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'pt-BR';
      this.recognition.continuous = true;
      this.recognition.interimResults = true;

      const transcriptEl = document.getElementById('speech-transcript');
      const bannerEl = document.getElementById('speech-banner');

      this.recognition.onstart = () => {
        if (bannerEl) bannerEl.classList.remove('hidden');
        if (transcriptEl) transcriptEl.innerText = '● Microfone ativo. Pode falar seu comando...';
      };

      this.recognition.onresult = (event) => {
        let interim = '';
        let finalTranscript = '';

        for (let i = 0; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalTranscript += item[0].transcript + ' ';
          } else {
            interim += item[0].transcript;
          }
        }

        const text = (finalTranscript + interim).trim();

        // ESCRITA AO VIVO NO CAMPO DO CHAT!
        if (text) {
          this.currentText = text;
          this.hasSpoken = true;

          const chatInput = document.getElementById('chat-input');
          if (chatInput) {
            chatInput.value = text;
            chatInput.style.height = 'auto';
            chatInput.style.height = `${Math.min(chatInput.scrollHeight, 220)}px`;
          }

          if (transcriptEl) {
            transcriptEl.innerText = `● "${text}"`;
          }
        }
      };

      this.recognition.onerror = (event) => {
        console.warn("SpeechRecognition nativo aviso/erro:", event.error);
        // Não travar: o gravador continua e o servidor transcreve. Erros que não passam sozinhos
        // (sem rede para o serviço do navegador, bloqueado) não devem ficar reiniciando em loop.
        if (['network', 'not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
          this.nativeBroken = true;
        }
      };

      this.recognition.onend = () => {
        // Se ainda estamos escutando e o browser finalizou a sessão nativa antes da hora, tentar reiniciar
        if (this.isListening && this.recognition && !this.nativeBroken) {
          try {
            this.recognition.start();
          } catch (e) {}
        }
      };
    } catch (e) {
      console.warn("Erro ao configurar SpeechRecognition nativo:", e);
      this.recognition = null;
    }
  }

  async toggleListening() {
    if (this.isListening) {
      await this.stopListening();
    } else {
      await this.startListening();
    }
  }

  async startListening() {
    if (this.blocked) { if (this.onBlocked) this.onBlocked(); return; } // modo Live ligado: fala normal travada
    this.ensureAudioContext();
    this.stopSpeaking();

    if (this.isListening || this.isTranscribing) return;

    this.currentText = '';
    this.hasSpoken = false;
    this.audioChunks = [];
    this.dropTranscription = false;

    const bannerEl = document.getElementById('speech-banner');
    const transcriptEl = document.getElementById('speech-transcript');
    if (bannerEl) bannerEl.classList.remove('hidden');
    if (transcriptEl) transcriptEl.innerText = '● Microfone conectando...';

    // 1. Obter Stream do Microfone de Hardware
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (err) {
      console.warn("Erro ao acessar microfone:", err);
      let msg = "Microfone inacessível no navegador.";
      if (err.name === 'NotAllowedError') {
        msg = "Permissão de microfone negada! Clique no cadeado na barra de endereços do navegador e marque 'Permitir'.";
      } else if (err.name === 'NotFoundError') {
        msg = "Nenhum microfone encontrado conectado ao computador.";
      }
      if (this.onErrorMessage) this.onErrorMessage(msg);
      if (transcriptEl) transcriptEl.innerText = msg;
      if (bannerEl) bannerEl.classList.remove('hidden');
      alert(msg);
      return;
    }

    this.isListening = true;
    if (this.onStateChange) this.onStateChange('LISTENING');
    this.playToolBeep();

    // 2. Conectar AnalyserNode para medir volume em tempo real & verificar som real
    try {
      this.ensureAudioContext();
      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      source.connect(this.analyser);
      this.startVolumeMonitor();
    } catch (e) {
      console.warn("AnalyserNode não inicializado:", e);
    }

    // 3. Iniciar Gravador de Hardware (MediaRecorder para Fallback de Alta Precisão)
    try {
      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          mimeType = 'audio/ogg;codecs=opus';
        }

        const options = mimeType ? { mimeType } : {};
        this.mediaRecorder = new MediaRecorder(this.micStream, options);
        this.audioChunks = [];

        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.audioChunks.push(e.data);
          }
        };

        this.mediaRecorder.start(100); // Coletar fatias a cada 100ms
      }
    } catch (e) {
      console.warn("MediaRecorder falhou ao iniciar:", e);
    }

    // 4. Iniciar SpeechRecognition Nativo (Web Speech API)
    this.nativeBroken = false;
    if (this.recognition) {
      try {
        this.recognition.start();
      } catch (e) {
        // Ignorar se já iniciado
      }
    }
  }

  startVolumeMonitor() {
    if (!this.analyser) return;

    const dataArray = new Float32Array(this.analyser.fftSize);
    const transcriptEl = document.getElementById('speech-transcript');
    let silenceCount = 0;
    let zeroCount = 0;
    let floor = null; // ruído de fundo do ambiente, aprendido enquanto ouve

    const checkVolume = () => {
      if (!this.isListening) return;

      const vol = JarvisAudio.micLevel(this.analyser, dataArray);
      floor = floor === null ? vol : Math.min(floor + 0.15, vol);
      this.lastMicLevel = vol;

      // Fala = bem acima do ruído de fundo
      if (vol > Math.max(18, floor + 14)) {
        this.hasSpoken = true;
        silenceCount = 0;
        zeroCount = 0;

        if (!this.currentText && transcriptEl) {
          transcriptEl.innerText = `Captando voz [Volume: ${vol}%] - Fale seu comando...`;
        }
      } else {
        if (!this.hasSpoken) {
          zeroCount++;
          if (this.idleLimit && zeroCount >= this.idleLimit && !this.holdToTalk) {
            this.discardNext = true;
            this.stopListening();
            if (this.onIdleTimeout) this.onIdleTimeout();
            return;
          }
          if (zeroCount === 30 && transcriptEl) { // 3 segundos de silêncio absoluto
            transcriptEl.innerText = `● Microfone ativo [Vol: ${vol}%] - Ainda não ouvi fala. Verifique se não está mudo no Windows ou fale mais perto`;
          }
        } else {
          silenceCount++;
          // Se o usuário falou e agora ficou em silêncio por ~1.6 segundos (16 * 100ms)
          if (silenceCount >= 16 && !this.holdToTalk) {
            if (this.onStatusMessage) this.onStatusMessage("Silêncio detectado após a fala. Processando ordem...");
            this.stopListening();
            return;
          }
        }
      }

      this.volumeTimer = setTimeout(checkVolume, 100);
    };

    checkVolume();
  }

  async stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    clearTimeout(this.volumeTimer);

    const transcriptEl = document.getElementById('speech-transcript');
    const bannerEl = document.getElementById('speech-banner');

    // 1. Parar reconhecimento nativo
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }

    // 2. Parar gravador de hardware
    const recorder = this.mediaRecorder;
    const stream = this.micStream;

    const stopHardwarePromise = new Promise((resolve) => {
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = () => {
          if (stream) {
            stream.getTracks().forEach(t => t.stop());
          }
          resolve();
        };
        recorder.stop();
      } else {
        if (stream) {
          stream.getTracks().forEach(t => t.stop());
        }
        resolve();
      }
    });

    await stopHardwarePromise;
    this.holdToTalk = false;

    // Escuta encerrada por falta de fala: descarta sem mandar nada
    if (this.discardNext) {
      this.discardNext = false;
      this.currentText = '';
      if (bannerEl) bannerEl.classList.add('hidden');
      if (this.onStateChange) this.onStateChange('IDLE');
      return;
    }

    // 3. Avaliar resultado do reconhecimento
    const recognizedText = (this.currentText || '').trim();

    // Cenário A: O navegador já transcreveu texto via Web Speech API nativo
    if (recognizedText) {
      if (transcriptEl) transcriptEl.innerText = `"${recognizedText}"`;
      setTimeout(() => {
        if (bannerEl) bannerEl.classList.add('hidden');
      }, 1500);

      this.currentText = '';
      if (this.onStateChange) this.onStateChange('IDLE');
      if (this.onSpeechRecognized) {
        this.onSpeechRecognized(recognizedText);
      }
      return;
    }

    // Cenário B: Web Speech API nativo não transcreveu nada (Brave, silêncio do Google ou sem suporte)
    // Enviar o áudio captado do microfone para o backend Python JARVIS decodificar!
    if (this.audioChunks.length > 0) {
      const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });

      // Se tiver dados de áudio reais (> 800 bytes)
      if (audioBlob.size > 800) {
        this.isTranscribing = true;
        if (this.onStateChange) this.onStateChange('THINKING');
        if (transcriptEl) transcriptEl.innerText = 'Atom entendendo o que você falou...';
        if (this.onStatusMessage) this.onStatusMessage("Transcrevendo áudio via servidor neural...");

        try {
          // Converte para WAV no navegador: o servidor online não tem ffmpeg para ler WebM
          let upload = audioBlob;
          try { upload = await this.blobToWav(audioBlob); } catch (convErr) { console.warn('Conversão para WAV falhou, enviando original:', convErr); }
          let sessionKey = null;
          try { sessionKey = sessionStorage.getItem('jarvis_key_google'); } catch (e) {}
          const res = await JarvisAPI.transcribeAudio(upload, sessionKey);
          this.isTranscribing = false;
          if (this.dropTranscription) {
            // Mandaram parar enquanto o servidor transcrevia: joga fora
            this.dropTranscription = false;
            if (bannerEl) bannerEl.classList.add('hidden');
            if (this.onStateChange) this.onStateChange('IDLE');
            return;
          }

          if (res && res.success && res.text && res.text.trim()) {
            const finalSpoken = res.text.trim();
            if (transcriptEl) transcriptEl.innerText = `"${finalSpoken}"`;
            setTimeout(() => {
              if (bannerEl) bannerEl.classList.add('hidden');
            }, 1500);

            // Escrever imediatamente no input
            const chatInput = document.getElementById('chat-input');
            if (chatInput) {
              chatInput.value = finalSpoken;
              chatInput.style.height = 'auto';
              chatInput.style.height = `${Math.min(chatInput.scrollHeight, 220)}px`;
            }

            if (this.onStateChange) this.onStateChange('IDLE');
            if (this.onSpeechRecognized) {
              this.onSpeechRecognized(finalSpoken);
            }
            return;
          } else {
            const err = res?.error || "Nenhuma palavra compreensível identificada.";
            if (transcriptEl) transcriptEl.innerText = err;
            if (this.onStatusMessage) this.onStatusMessage(`[TRANSCRIÇÃO]: ${err}`);
            setTimeout(() => {
              if (bannerEl) bannerEl.classList.add('hidden');
            }, 3000);
          }
        } catch (postErr) {
          this.isTranscribing = false;
          console.error("Erro na transcrição de áudio:", postErr);
          if (transcriptEl) transcriptEl.innerText = 'Erro de conexão ao transcrever áudio.';
        }
      } else {
        if (transcriptEl) transcriptEl.innerText = 'Áudio muito curto ou sem fala.';
        setTimeout(() => {
          if (bannerEl) bannerEl.classList.add('hidden');
        }, 2000);
      }
    } else {
      if (bannerEl) bannerEl.classList.add('hidden');
    }

    if (this.onStateChange) this.onStateChange('IDLE');
    if (this.onNothingHeard) setTimeout(() => this.onNothingHeard(), 0);
  }

  /** Converte o áudio gravado (WebM/Ogg) em WAV 16 kHz mono, que qualquer servidor entende. */
  async blobToWav(blob) {
    this.ensureAudioContext();
    const decoded = await this.audioCtx.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const frames = Math.max(1, Math.ceil(decoded.duration * rate));
    const offline = new OfflineAudioContext(1, frames, rate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const pcm = (await offline.startRendering()).getChannelData(0);

    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Volume do microfone de 0 a 100 em escala de decibéis (como os medidores de áudio):
   * silêncio fica perto de 0, fala normal entre 50 e 80, grito perto de 100.
   * A conta antiga (média das frequências) quase nunca passava de 20%.
   */
  static micLevel(analyser, buf) {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const db = 20 * Math.log10(rms + 1e-8);
    return Math.max(0, Math.min(100, Math.round((db + 60) * 2)));
  }

  async testMicrophoneHardware(onProgress, onResult) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.ensureAudioContext();
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const dataArray = new Float32Array(analyser.fftSize);
      let maxVol = 0;
      let count = 0;

      const timer = setInterval(() => {
        const pct = JarvisAudio.micLevel(analyser, dataArray);
        if (pct > maxVol) maxVol = pct;
        count++;

        if (onProgress) onProgress(pct);

        if (count >= 25) { // 2.5 segundos de teste
          clearInterval(timer);
          stream.getTracks().forEach(t => t.stop());
          if (onResult) onResult(maxVol);
        }
      }, 100);
    } catch (e) {
      if (onResult) onResult(-1, e.message);
    }
  }

  /* ==========================================================================
     SÍNTESE VOCAL (TEXT-TO-SPEECH)
     ========================================================================== */

  initSpeechSynthesis() {
    if (!('speechSynthesis' in window)) {
      console.warn("SpeechSynthesis não suportado.");
      return;
    }

    const loadVoices = () => {
      this.voices = window.speechSynthesis.getVoices();
      const select = document.getElementById('voice-select');
      if (!select) return;

      select.innerHTML = '';
      let defaultIdx = 0;

      // Prefere vozes em português marcadas como naturais (Edge "Online (Natural)", Google, neurais)
      const score = (v) => {
        const n = v.name.toLowerCase();
        let sc = 0;
        if (/^pt/i.test(v.lang)) sc += 10;
        if (/pt-br/i.test(v.lang)) sc += 5;
        if (/natural|online|neural|google|premium|enhanced/.test(n)) sc += 8;
        return sc;
      };
      let bestScore = -1;
      this.voices.forEach((v, idx) => {
        const option = document.createElement('option');
        option.value = idx;
        option.textContent = `${v.name} (${v.lang})`;
        const sc = score(v);
        if (sc >= 18) option.textContent += ' (mais natural)';
        if (sc > bestScore) { bestScore = sc; defaultIdx = idx; }
        select.appendChild(option);
      });
      try {
        const saved = localStorage.getItem('atom_voz_navegador');
        const i = this.voices.findIndex((v) => v.name === saved);
        if (i >= 0) defaultIdx = i;
      } catch (e) {}

      if (this.voices.length > 0) {
        select.value = defaultIdx;
        this.selectedVoice = this.voices[defaultIdx];
      }
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  /** Fala a resposta: voz natural do Gemini quando der; senão a voz do navegador. */
  speak(text) {
    if (!this.ttsEnabled || this.blocked) return false;
    this.stopSpeaking(true);
    const cleanText = this.cleanForSpeech(text);
    if (!cleanText) return false;
    this.isSpeakingNow = true;
    this.isPreview = false;
    if (this.voiceEngine === 'natural') {
      this.speakNatural(cleanText, this.geminiVoice).catch(() => this.speakBrowser(cleanText));
    } else {
      this.speakBrowser(cleanText);
    }
    return true;
  }

  /** O Atom está falando (ou buscando o áudio para falar)? */
  isSpeaking() {
    return this.isSpeakingNow || !!this.currentAudio || ('speechSynthesis' in window && window.speechSynthesis.speaking);
  }

  finishSpeech(token) {
    if (token !== this.speechToken) return;
    this.isSpeakingNow = false;
    if (this.onStateChange) this.onStateChange('IDLE');
    const preview = this.isPreview;
    this.isPreview = false;
    if (!preview && this.onSpeechDone) this.onSpeechDone();
  }

  cleanForSpeech(text) {
    return String(text || '')
      .replace(/\[TOOL:[^\]]+\]/g, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#*`_~>|]/g, '')
      .replace(/https?:\/\/\S+/g, 'link na web')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Divide em pedaços curtos (frases) para a primeira parte começar a tocar rápido. */
  splitForSpeech(text, max = 280) {
    const sentences = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
    const chunks = [];
    let cur = '';
    sentences.forEach((snt) => {
      if ((cur + snt).length > max && cur) { chunks.push(cur.trim()); cur = ''; }
      if (snt.length > max) {
        for (let i = 0; i < snt.length; i += max) chunks.push(snt.slice(i, i + max).trim());
      } else cur += snt;
    });
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(Boolean);
  }

  async fetchNatural(text, voice) {
    let key = null;
    try { key = sessionStorage.getItem('jarvis_key_google'); } catch (e) {}
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, session_key: key })
    });
    if (!res.ok) {
      let msg = 'voz natural indisponível';
      try { msg = (await res.json()).error || msg; } catch (e) {}
      throw new Error(msg);
    }
    return URL.createObjectURL(await res.blob());
  }

  async speakNatural(text, voice) {
    const token = ++this.speechToken;
    const chunks = this.splitForSpeech(text);
    let next = this.fetchNatural(chunks[0], voice);
    let started = false;
    for (let i = 0; i < chunks.length; i++) {
      let url;
      try {
        url = await next;
      } catch (e) {
        if (!started) throw e; // nada tocou ainda: cai para a voz do navegador
        break;
      }
      if (token !== this.speechToken) { URL.revokeObjectURL(url); return; }
      if (i + 1 < chunks.length) next = this.fetchNatural(chunks[i + 1], voice);
      if (!started) { started = true; if (this.onStateChange) this.onStateChange('SPEAKING'); }
      await new Promise((resolve) => {
        const audio = new Audio(url);
        this.currentAudio = audio;
        audio.playbackRate = this.voiceRate || 1;
        this.trackMouth(audio);
        audio.onended = audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(() => resolve());
      });
      if (token !== this.speechToken) return;
    }
    this.currentAudio = null;
    this.stopMouth();
    this.finishSpeech(token);
  }

  /** Mede o volume da voz que está tocando e abre a boca do Atom na mesma medida, quadro a quadro. */
  trackMouth(audio) {
    this.stopMouth(true);
    if (!this.onMouth || !this.audioCtx) return;
    // Se o contexto de áudio ainda estiver suspenso, ligar o som nele deixaria a voz muda: usa a animação automática
    if (this.audioCtx.state !== 'running') { this.ensureAudioContext(); this.onMouth(null); return; }
    try {
      const src = this.audioCtx.createMediaElementSource(audio);
      const an = this.audioCtx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.2;
      src.connect(an);
      an.connect(this.audioCtx.destination);
      const buf = new Uint8Array(an.fftSize);
      let level = 0;
      const tick = () => {
        if (this.currentAudio !== audio) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
        const rms = Math.sqrt(sum / buf.length);
        // abre rápido e fecha um pouco mais devagar, como uma boca de verdade
        const target = Math.min(1, Math.max(0, (rms - 0.02) * 4.5));
        level = target > level ? level + (target - level) * 0.7 : level + (target - level) * 0.35;
        this.onMouth(level);
        this.mouthRaf = requestAnimationFrame(tick);
      };
      this.onMouth(0);
      this.mouthRaf = requestAnimationFrame(tick);
    } catch (e) {
      // Sem análise de áudio: a boca usa a animação automática
      this.onMouth(null);
    }
  }

  stopMouth(keepOpen = false) {
    cancelAnimationFrame(this.mouthRaf);
    clearTimeout(this.mouthWordTimer);
    if (!keepOpen && this.onMouth) this.onMouth(null);
  }

  /** Amostra curta de uma voz (botão "ouvir" no Sistema). */
  previewVoice(engine, voiceName) {
    const sample = 'Oi, eu sou o Atom. É assim que eu vou falar com você.';
    this.stopSpeaking(true);
    this.isPreview = true;
    if (engine === 'natural') return this.speakNatural(sample, voiceName);
    this.speakBrowser(sample);
    return Promise.resolve();
  }

  speakBrowser(cleanText) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    if (!cleanText) return;
    const token = this.speechToken;
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'pt-BR';
    utterance.rate = this.voiceRate;
    utterance.pitch = this.voicePitch;

    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
    }

    utterance.onstart = () => {
      if (this.onStateChange) this.onStateChange('SPEAKING');
      if (this.onMouth) this.onMouth(0);
    };
    // A voz do navegador não deixa medir o som: a boca abre a cada palavra dita
    utterance.onboundary = (ev) => {
      if (!this.onMouth || token !== this.speechToken || (ev.name && ev.name !== 'word')) return;
      this.onMouth(0.85);
      clearTimeout(this.mouthWordTimer);
      this.mouthWordTimer = setTimeout(() => { if (token === this.speechToken) this.onMouth(0.15); }, 140);
    };

    utterance.onend = () => { if (token === this.speechToken) this.stopMouth(); this.finishSpeech(token); };

    utterance.onerror = () => {
      if (token === this.speechToken) this.isSpeakingNow = false;
      if (this.onStateChange) this.onStateChange('IDLE');
    };

    window.speechSynthesis.speak(utterance);
  }

  stopSpeaking(silent = false) {
    this.speechToken = (this.speechToken || 0) + 1;
    this.isSpeakingNow = false;
    this.stopMouth();
    if (this.currentAudio) {
      try { this.currentAudio.pause(); } catch (e) {}
      this.currentAudio = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (!silent && this.onStateChange) this.onStateChange('IDLE');
  }
}
