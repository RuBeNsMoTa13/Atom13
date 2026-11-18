/**
 * Conversas salvas no navegador (localStorage). Nada vai para o servidor.
 * Cada conversa: { id, title, updated, messages: [{ role, content }] }
 */
const LIST_KEY = 'atom_conversas';
const CURRENT_KEY = 'atom_conversa_atual';
const MAX_CONVERSAS = 60;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function newId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function titleFrom(messages) {
  const first = messages.find(m => m.role === 'user');
  if (!first) return 'Conversa nova';
  const t = String(first.content).replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 57) + '…' : t;
}

export const Conversas = {
  list() {
    const all = read(LIST_KEY, []);
    return Array.isArray(all) ? all.sort((a, b) => b.updated - a.updated) : [];
  },

  currentId() {
    try { return localStorage.getItem(CURRENT_KEY); } catch (e) { return null; }
  },

  setCurrent(id) {
    write(CURRENT_KEY, id || '');
  },

  get(id) {
    return this.list().find(c => c.id === id) || null;
  },

  newId,

  /** Salva (ou cria) a conversa. Conversa vazia não é guardada. */
  save(id, messages) {
    if (!id || !messages || messages.length === 0) return;
    let all = this.list().filter(c => c.id !== id);
    all.unshift({ id, title: titleFrom(messages), updated: Date.now(), messages });
    all = all.slice(0, MAX_CONVERSAS);
    // Se o navegador ficar sem espaço, apaga as mais antigas até caber
    while (!write(LIST_KEY, all) && all.length > 1) all.pop();
  },

  remove(id) {
    write(LIST_KEY, this.list().filter(c => c.id !== id));
    if (this.currentId() === id) this.setCurrent('');
  },
};
