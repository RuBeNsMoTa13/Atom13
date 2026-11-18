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
    const prev = this.get(id);
    let all = this.list().filter(c => c.id !== id);
    // Se a pessoa renomeou, o nome dela fica
    const title = prev && prev.renamed ? prev.title : titleFrom(messages);
    all.unshift({ id, title, renamed: !!(prev && prev.renamed), updated: Date.now(), messages });
    all = all.slice(0, MAX_CONVERSAS);
    // Se o navegador ficar sem espaço, apaga as mais antigas até caber
    while (!write(LIST_KEY, all) && all.length > 1) all.pop();
  },

  remove(id) {
    write(LIST_KEY, this.list().filter(c => c.id !== id));
    if (this.currentId() === id) this.setCurrent('');
  },

  /** Troca o nome da conversa (vazio volta ao nome automático). */
  rename(id, title) {
    const all = read(LIST_KEY, []);
    const c = Array.isArray(all) && all.find(x => x.id === id);
    if (!c) return false;
    const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    c.title = t || titleFrom(c.messages);
    c.renamed = !!t;
    write(LIST_KEY, all);
    // os arquivos mostram o nome novo da conversa
    Arquivos.list().forEach(a => { if (a.convId === id) a.convTitle = c.title; });
    write(FILES_KEY, Arquivos.list());
    return true;
  },
};

/**
 * Arquivos Markdown salvos no navegador, com a conversa de onde vieram.
 * Online (Vercel) o servidor não guarda arquivos entre uma visita e outra, então a lista vive aqui.
 * Cada arquivo: { filename, title, content, created, convId, convTitle }
 */
const FILES_KEY = 'atom_arquivos';
const MAX_ARQUIVOS = 80;

export const Arquivos = {
  list() {
    const all = read(FILES_KEY, []);
    return Array.isArray(all) ? all.sort((a, b) => b.created - a.created) : [];
  },
  get(filename) {
    return this.list().find(a => a.filename === filename) || null;
  },
  add(item) {
    if (!item || !item.filename || !item.content) return;
    let all = this.list().filter(a => a.filename !== item.filename);
    all.unshift({ created: Date.now(), ...item });
    all = all.slice(0, MAX_ARQUIVOS);
    while (!write(FILES_KEY, all) && all.length > 1) all.pop();
  },
  remove(filename) {
    write(FILES_KEY, this.list().filter(a => a.filename !== filename));
  },
};
