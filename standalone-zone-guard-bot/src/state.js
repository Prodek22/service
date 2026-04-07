const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'zone-state.json');

const DEFAULT_STATE = {
  panel: {
    channelId: null,
    messageId: null
  },
  lastAction: null,
  active: {},
  totals: {},
  history: []
};

const ensureDataDir = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
};

const loadState = () => {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return structuredClone(DEFAULT_STATE);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      panel: {
        ...DEFAULT_STATE.panel,
        ...(parsed?.panel ?? {})
      },
      active: parsed?.active ?? {},
      totals: parsed?.totals ?? {},
      history: Array.isArray(parsed?.history) ? parsed.history : []
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
};

const saveState = (state) => {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
};

module.exports = {
  loadState,
  saveState
};
