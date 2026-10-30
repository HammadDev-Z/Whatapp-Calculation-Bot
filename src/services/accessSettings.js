const { normalizeNumber } = require('../utils/phone');

const DEFAULT_TTL_MS = 5000;

// What the bot reads on every message: the active numbers and the group labels. They are edited
// from the website (a separate process), so they are cached for a few seconds instead of
// queried per message. Replies stay instant and website changes apply within the TTL.
class AccessSettings {
  constructor(repository, { ttlMs = DEFAULT_TTL_MS, now = Date.now, logger = null } = {}) {
    this.repository = repository;
    this.ttlMs = ttlMs;
    this.now = now;
    this.logger = logger;
    this.snapshot = null;
    this.loading = null;
  }

  async load() {
    if (this.snapshot && this.now() - this.snapshot.loadedAt < this.ttlMs) return this.snapshot;
    if (!this.loading) {
      this.loading = this.refresh().finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  async refresh() {
    try {
      const [numbers, labels] = await Promise.all([
        this.repository.listActiveNumbers(),
        this.repository.listGroupLabels()
      ]);
      this.snapshot = {
        loadedAt: this.now(),
        numbers: new Set(numbers.map(normalizeNumber)),
        labels: new Map(labels.map((row) => [row.group_id, String(row.label).trim()]))
      };
    } catch (error) {
      // Keep serving the last good copy; with none, the caller's error is logged and the
      // message is dropped silently.
      if (!this.snapshot) throw error;
      if (this.logger) this.logger.warn('Could not refresh access settings', { error: error.message });
      this.snapshot.loadedAt = this.now();
    }
    return this.snapshot;
  }

  // `identifiers` are every id the sender is known by (phone number, @lid, ...), digits only.
  async isSenderAllowed(identifiers) {
    const { numbers } = await this.load();
    return identifiers.some((id) => numbers.has(id));
  }

  async getGroupLabel(groupId) {
    const { labels } = await this.load();
    return labels.get(groupId) || null;
  }
}

module.exports = AccessSettings;
