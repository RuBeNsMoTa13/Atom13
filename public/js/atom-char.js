/**
 * A.T.O.M. — personagem com rosto padrão (vermelho, olhos azul-noite) e corpo trocável.
 * Mesma API do antigo ArcReactor: setState('IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING').
 * Reações extras: vendo a tela, feliz, dormindo, confuso. Sempre de frente (só flutua).
 */
import { BODIES } from './atom-bodies.js';

const BODY_KEY = 'atom_corpo';
const SLEEP_AFTER_MS = 90 * 1000;

const LABELS = {
  parado:   ['ONLINE', 'ATOM'],
  ouvindo:  ['MIC ATIVO', 'OUVINDO'],
  pensando: ['PROCESSANDO', 'PENSANDO'],
  falando:  ['RESPONDENDO', 'FALANDO'],
  vendo:    ['VISÃO ATIVA', 'VENDO A TELA'],
  feliz:    ['PRONTO', 'FEITO'],
  dormindo: ['EM ESPERA', 'DORMINDO'],
  confuso:  ['ALGO DEU ERRADO', 'HMM?'],
};

function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

export class AtomCharacter {
  constructor(elId) {
    this.el = document.getElementById(elId);
    this.appState = 'IDLE';
    this.face = 'parado';
    this.seeing = false;
    this.flashTimer = null;
    this.sleepTimer = null;
    if (!this.el) return;

    const saved = safeGet(BODY_KEY);
    this.bodyId = BODIES.some(b => b.id === saved) ? saved : BODIES[0].id;
    this.el.innerHTML = '<div class="ch"></div>';
    this.ch = this.el.firstElementChild;
    this.renderBody();

    const fit = () => {
      const s = Math.min(this.el.clientWidth, this.el.clientHeight);
      if (s > 0) this.el.style.setProperty('--ac-size', (s / 100) + 'px');
    };
    fit();
    if (window.ResizeObserver) new ResizeObserver(fit).observe(this.el);

    // Clicar no Atom acorda / deixa ele feliz
    this.el.addEventListener('click', () => {
      if (this.face === 'dormindo') this.apply();
      else if (this.appState === 'IDLE') this.flash('feliz', 1600);
    });

    this.apply();
  }

  static get bodies() { return BODIES; }

  renderBody() {
    const b = BODIES.find(x => x.id === this.bodyId) || BODIES[0];
    this.ch.innerHTML = b.html;
    this.el.dataset.body = b.id;
  }

  setBody(id) {
    if (!BODIES.some(b => b.id === id)) return;
    this.bodyId = id;
    safeSet(BODY_KEY, id);
    this.renderBody();
    this.flash('feliz', 1400);
  }

  setState(newState) {
    this.appState = newState;
    clearTimeout(this.flashTimer);
    this.flashTimer = null;
    this.apply();
  }

  /** Visão de tela ligada/desligada: quando ocioso, o rosto fica "vendo a tela". */
  setSeeing(on) {
    this.seeing = !!on;
    if (!this.flashTimer) this.apply();
  }

  /** Reação curta (feliz, confuso) que volta sozinha para o estado atual. */
  flash(face, ms = 1800) {
    clearTimeout(this.flashTimer);
    this.show(face);
    this.flashTimer = setTimeout(() => { this.flashTimer = null; this.apply(); }, ms);
  }

  apply() {
    const map = { LISTENING: 'ouvindo', THINKING: 'pensando', SPEAKING: 'falando' };
    let face = map[this.appState] || (this.seeing ? 'vendo' : 'parado');
    this.show(face);
    clearTimeout(this.sleepTimer);
    if (face === 'parado') {
      this.sleepTimer = setTimeout(() => { if (!this.flashTimer) this.show('dormindo'); }, SLEEP_AFTER_MS);
    }
  }

  show(face) {
    this.face = face;
    if (!this.el) return;
    this.el.className = 'atom-char s-' + face;
    const [sub, title] = LABELS[face] || LABELS.parado;
    const subEl = document.getElementById('core-state-subtitle');
    const titleEl = document.getElementById('core-state-title');
    if (subEl) subEl.innerText = sub;
    if (titleEl) titleEl.innerText = title;
    const waveEl = document.getElementById('audio-waves');
    if (waveEl) waveEl.style.opacity = (face === 'ouvindo' || face === 'falando') ? '1' : '0.35';
  }

  /**
   * Boca acompanhando a voz: v de 0 (fechada) a 1 (bem aberta). null devolve a animação automática.
   * Usa atributo (e não classe) porque show() reescreve as classes a cada troca de rosto.
   */
  setAudioLevel(v) {
    if (!this.el) return;
    if (v === null || v === undefined) {
      delete this.el.dataset.lip;
      this.el.style.removeProperty('--boca');
      return;
    }
    this.el.dataset.lip = '1';
    this.el.style.setProperty('--boca', Math.max(0, Math.min(1, v)).toFixed(3));
  }
}
