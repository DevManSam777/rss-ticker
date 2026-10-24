(() => {
console.info('rss-ticker v6 loaded');

class RSSTickerElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.posts = [];
    this.resizeObserver = null;
    this.lastMeasuredCycleWidth = 0;
    this.resizeTimeout = null;
    this._fetchDebounceTimeout = null;
    this._fetchPromise = null;
    this._fetchingKey = null;
    this._retryTimer = null;
    this._retryCount = 0;
  }

  static get observedAttributes() {
    return [
      'rss-url', 'separator', 'domain-color', 'date-color', 'title-color',
      'background-color', 'speed', 'google-font', 'font-family', 'font-weight',
      'font-size', 'max-posts'
    ];
  }

  connectedCallback() {
    RSSTickerElement._preconnect();
    this.loadGoogleFont();
    this.render();
    if (this.posts.length) this.updateTickerContent();
    this.debouncedFetchRSSFeed();

    this.resizeObserver = new ResizeObserver(() => {
      if (this.lastMeasuredCycleWidth > 0) {
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => this.updateTickerContent(), 100);
      }
    });
    this.resizeObserver.observe(this.shadowRoot.querySelector('.ticker-container'));
  }

  disconnectedCallback() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    clearTimeout(this.resizeTimeout);
    clearTimeout(this._fetchDebounceTimeout);
    clearTimeout(this._retryTimer);
    this._fetchPromise = null;
    this._fetchingKey = null; // any in-flight result is discarded
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === 'google-font') this.loadGoogleFont();

    if (name === 'rss-url' || name === 'max-posts') {
      this._retryCount = 0;
      this.debouncedFetchRSSFeed();
      return;
    }

    this.updateStyles();
    if (['font-family', 'font-weight', 'font-size', 'separator', 'speed', 'google-font'].includes(name)) {
      this.updateTickerContent();
    }
  }

  loadGoogleFont() {
    const fontName = this.getAttribute('google-font');
    if (!fontName) return;
    const weight = this.getAttribute('font-weight') || '400';
    const family = fontName.replace(/ /g, '+');
    if (document.head.querySelector(`link[href*="${family}"]`)) return;

    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  // ---------------------------------------------------------------------
  // Loading a feed
  // ---------------------------------------------------------------------

  debouncedFetchRSSFeed() {
    if (!this.getAttribute('rss-url')) {
      this.showMessage('No RSS URL provided');
      return;
    }
    clearTimeout(this._fetchDebounceTimeout);
    clearTimeout(this._retryTimer);
    this._fetchDebounceTimeout = setTimeout(() => this.fetchRSSFeed(), 100);
  }

  async fetchRSSFeed() {
    const rssUrl = this.getAttribute('rss-url');
    if (!rssUrl) {
      this.showMessage('No RSS URL provided');
      return;
    }

    const cacheKey = this.getCacheKey(rssUrl);
    if (this._fetchPromise && this._fetchingKey === cacheKey) return this._fetchPromise;

    // Fresh cache: use it and stop
    const fresh = this.loadFromCache(cacheKey);
    if (fresh) {
      this._fetchingKey = null;
      this._retryCount = 0;
      this.posts = fresh;
      this.updateTickerContent();
      return;
    }

    // Expired cache: show it while refreshing, and keep it if the refresh fails
    const stale = this.loadFromCache(cacheKey, true);
    if (stale) {
      this.posts = stale;
      this.updateTickerContent();
    } else if (this._retryCount === 0) {
      this.posts = [];
      this.showMessage('Loading...', '#007bff');
    }

    // Recently found to be unusable: don't ask the network again yet
    const brokenAge = Date.now() - this.getBrokenAt(cacheKey);
    if (brokenAge < RSSTickerElement.BROKEN_COOLDOWN) {
      if (!stale) this.showMessage(this.brokenMessage(rssUrl));
      clearTimeout(this._retryTimer);
      this._retryTimer = setTimeout(() => this.fetchRSSFeed(), RSSTickerElement.BROKEN_COOLDOWN - brokenAge + 500);
      return;
    }

    this._fetchingKey = cacheKey;
    const promise = (async () => {
      try {
        const { posts, route } = await this.fetchPostsShared(rssUrl, cacheKey);
        if (this._fetchingKey !== cacheKey) return; // URL changed or element removed
        this._retryCount = 0;
        this.posts = posts;
        this.saveToCache(cacheKey, posts);
        this.saveRoute(cacheKey, route);
        this.clearBroken(cacheKey);
        this.updateTickerContent();
      } catch (errors) {
        console.warn(`rss-ticker v6: could not load ${rssUrl}\n  ` +
          (Array.isArray(errors) ? errors.map(e => e.message).join('\n  ') : String(errors)));
        if (this._fetchingKey !== cacheKey) return;

        // A route reached the feed but it's missing/invalid/blocked: retry slowly
        const brokenFeed = Array.isArray(errors) && errors.some(e => e.isFeedProblem);
        if (brokenFeed) this.markBroken(cacheKey);
        if (!stale) {
          this.showMessage(brokenFeed
            ? this.brokenMessage(rssUrl)
            : `Unable to load ${this.extractDomain(rssUrl)}. Retrying...`);
        }
        this._retryCount++;
        const wait = brokenFeed ? 600000 : Math.min(15000 * 2 ** (this._retryCount - 1), 300000);
        clearTimeout(this._retryTimer);
        this._retryTimer = setTimeout(() => this.fetchRSSFeed(), wait);
      } finally {
        if (this._fetchPromise === promise) {
          this._fetchPromise = null;
          this._fetchingKey = null;
        }
      }
    })();

    this._fetchPromise = promise;
    return promise;
  }

  // Tickers showing the same feed share a single network attempt
  fetchPostsShared(rssUrl, cacheKey) {
    let p = RSSTickerElement._inflight.get(cacheKey);
    if (!p) {
      p = this.fetchFromSources(rssUrl, cacheKey).finally(() => RSSTickerElement._inflight.delete(cacheKey));
      RSSTickerElement._inflight.set(cacheKey, p);
    }
    return p;
  }

  getSources(rssUrl, cacheKey) {
    const enc = encodeURIComponent(rssUrl);
    const sources = [];

    // Direct only works for feeds that allow it; remember the ones that don't
    if (!RSSTickerElement._noDirect.has(RSSTickerElement._hostOf(rssUrl))) {
      sources.push({ name: 'direct', url: rssUrl, timeout: 5000 });
    }
    sources.push(
      { name: 'allorigins', url: `https://api.allorigins.win/raw?url=${enc}`,
        timeout: 6000, gap: 250, burst: 4 },
      { name: 'allorigins-json', kind: 'allorigins-json', url: `https://api.allorigins.win/get?url=${enc}`,
        timeout: 6000, gap: 250, burst: 4 },
      { name: 'jina', kind: 'jina', url: `https://r.jina.ai/${rssUrl}`,
        timeout: 15000, gap: 3000, burst: 6 } // jina's free tier allows ~20 requests/min
    );

    // Start times: direct and allorigins together, then the slower backups
    // If allorigins has been failing lately (and jina hasn't), go to jina straight away
    const hasDirect = sources.some(x => x.name === 'direct');
    const delays = RSSTickerElement._isDown('allorigins')
      ? { direct: 0, jina: hasDirect ? 400 : 0, allorigins: 2500, 'allorigins-json': 5000 }
      : { direct: 0, allorigins: 0, jina: 1500, 'allorigins-json': 3000 };
    const remembered = this.loadRoute(cacheKey);
    const useMemory = remembered && sources.some(x => x.name === remembered);
    sources.forEach(x => {
      // A route that worked for this feed before goes first; the rest only as backup
      x.delay = useMemory ? (x.name === remembered ? 0 : delays[x.name] + 1500) : delays[x.name];
    });
    return sources;
  }

  // Starts the routes staggered, resolves with the first valid result and cancels the rest.
  // If nothing is still running, the next route starts immediately instead of waiting.
  fetchFromSources(rssUrl, cacheKey) {
    const sources = this.getSources(rssUrl, cacheKey);

    return new Promise((resolve, reject) => {
      const cancel = new AbortController();
      const started = new Array(sources.length).fill(false);
      const errors = [];
      const timers = [];
      const running = new Array(sources.length).fill(false);
      let active = 0;
      let finished = false;

      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout);
        if (fn === resolve) {
          // A service still silent after 1.2s when a later-starting route won is slow or down: remember that
          sources.forEach((src, i) => {
            if (running[i] && src.name !== 'direct' && src.name !== value.route &&
                src.sentAt && Date.now() - src.sentAt > 1200) {
              RSSTickerElement._recordRoute(src.name, false);
            }
          });
        }
        cancel.abort();
        fn(value);
      };

      const soonest = () => {
        let best = -1;
        sources.forEach((src, i) => { if (!started[i] && (best === -1 || src.delay < sources[best].delay)) best = i; });
        return best;
      };

      const start = (i) => {
        if (finished || started[i]) return;
        started[i] = true;
        running[i] = true;
        active++;
        this.fetchSource(sources[i], rssUrl, cancel.signal).then(
          posts => {
            running[i] = false;
            if (sources[i].name !== 'direct') RSSTickerElement._recordRoute(sources[i].name, true);
            finish(resolve, { posts, route: sources[i].name });
          },
          error => {
            active--;
            running[i] = false;
            if (finished) return;
            // 408 means the service couldn't reach THIS feed, which says nothing about the service itself
            const serviceFailure = error instanceof TypeError || error.name === 'AbortError' ||
              [401, 403, 429].includes(error.status) || error.status >= 500;
            if (serviceFailure && sources[i].name !== 'direct') RSSTickerElement._recordRoute(sources[i].name, false);
            if (sources[i].name === 'direct' && error instanceof TypeError) {
              RSSTickerElement._markNoDirect(RSSTickerElement._hostOf(rssUrl));
            }
            const described = this.describeError(sources[i], error);
            errors.push(described);
            // A service reached the feed and it's definitely unusable: don't bother the others
            if (described.isDefinitive) finish(reject, errors);
            else if (started.every(Boolean) && active === 0) finish(reject, errors);
            else if (active === 0) start(soonest());
          }
        );
      };

      sources.forEach((s, i) => timers.push(setTimeout(() => start(i), s.delay)));
    });
  }

  describeError(source, error) {
    let reason = error.message;
    if (error.name === 'AbortError') reason = 'timed out';
    else if (error instanceof TypeError) reason = 'blocked, rate-limited or unreachable';
    const described = new Error(`${source.name}: ${reason}`);
    described.isFeedProblem = !!error.isFeedProblem || [404, 408, 410].includes(error.status);
    described.isDefinitive = !!error.isDefinitive;
    return described;
  }

  // Requests the feed one way and RETURNS the parsed posts (touches no shared state)
  async fetchSource(source, rssUrl, signal) {
    if (source.name !== 'direct') {
      // Space out requests to the same service (several tickers load at once)
      await RSSTickerElement._throttle(RSSTickerElement._hostOf(source.url), source.gap, source.burst);
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    }
    source.sentAt = Date.now();

    const controller = new AbortController();
    const onCancel = () => controller.abort();
    signal.addEventListener('abort', onCancel);
    const timer = setTimeout(() => controller.abort(), source.timeout); // covers the body download too

    try {
      const response = await fetch(source.url, { signal: controller.signal });
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        err.isDefinitive = source.name !== 'direct' && (response.status === 404 || response.status === 410);
        throw err;
      }

      const raw = await response.text();
      let text = raw;
      try {
        if (source.kind === 'jina') return this.parseJina(raw, rssUrl);
        if (source.kind === 'allorigins-json') text = this.decodeContents(JSON.parse(raw).contents);
        return this.parseXMLFeed(text, rssUrl);
      } catch (parseError) {
        // jina re-formats pages, so a failure there says little about the feed itself
        if (source.kind !== 'jina') parseError.isFeedProblem = true;
        const snippet = raw.slice(0, 160).replace(/\s+/g, ' ').trim();
        const type = response.headers.get('content-type') || 'no content-type';
        parseError.message += ` [HTTP ${response.status}, ${type}, starts with: "${snippet}"]`;
        throw parseError;
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onCancel);
    }
  }

  // allorigins' /get endpoint sometimes returns the feed as a data: URI
  decodeContents(contents) {
    if (typeof contents !== 'string' || !contents) throw new Error('empty response');
    if (!contents.startsWith('data:')) return contents;
    const comma = contents.indexOf(',');
    if (comma === -1) throw new Error('bad data URI');
    const body = contents.substring(comma + 1);
    if (contents.substring(5, comma).includes('base64')) {
      return new TextDecoder().decode(Uint8Array.from(atob(body), c => c.charCodeAt(0)));
    }
    return decodeURIComponent(body);
  }

  // jina normally returns a feed as markdown: "### [Headline](link)" per entry, with Title/URL header lines
  parseJina(raw, rssUrl) {
    if (/<(rss|feed|rdf:RDF)\b/i.test(raw)) {
      try { return this.parseXMLFeed(this.extractFeedXml(raw), rssUrl); } catch (e) { /* fall through to markdown */ }
    }
    return this.parseJinaMarkdown(raw, rssUrl);
  }

  parseJinaMarkdown(text, rssUrl) {
    // jina reports when the feed URL itself returned an error (e.g. YouTube's 404)
    const target = (text.match(/Target URL returned error (\d{3})/) || [])[1];
    if (target) {
      const err = new Error(`the feed URL itself returned HTTP ${target}`);
      err.status = Number(target);
      err.isFeedProblem = true;
      err.isDefinitive = target === '404' || target === '410';
      throw err;
    }

    const domain = this.extractDomain(rssUrl);
    const maxPostsAttr = parseInt(this.getAttribute('max-posts'));
    const maxPosts = isNaN(maxPostsAttr) ? Infinity : maxPostsAttr;
    const body = text.split(/Markdown Content:\s*/)[1] || text;

    const headings = [...body.matchAll(/^#{1,4}[ \t]*\[(.*?)\]\((https?:\/\/[^\s)]+)/gm)];
    const seen = new Set();
    const posts = [];

    headings.forEach((m, i) => {
      const link = m[2];
      if (seen.has(link)) return;
      let title = m[1]
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                          // drop inline images
        .replace(/\\([\\`*_{}\[\]()#+\-.!<>~|=])/g, '$1')                // undo markdown escaping
        .trim();
      if (!title) title = this.titleFromUrl(link);                      // some entries have an empty link text
      title = this.stripHtml(title).trim();
      if (title.length <= 3) return;

      const next = headings[i + 1];
      const block = body.slice(m.index + m[0].length, next ? next.index : undefined);
      seen.add(link);
      posts.push({ domain, date: this.findDate(block), title, link });
    });

    if (!posts.length) throw new Error('no feed entries found in reader output');
    return posts.slice(0, maxPosts);
  }

  titleFromUrl(url) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
      const words = last.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').trim();
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
    } catch { return ''; }
  }

  // Best-effort: first date-looking text after a headline; '' when there isn't one
  findDate(block) {
    const patterns = [
      /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/,
      /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?(?:\s+(?:GMT|UTC|[+-]\d{4}))?/,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/
    ];
    for (const pattern of patterns) {
      const m = block.match(pattern);
      if (m) {
        const formatted = this.parseDate(m[0]);
        if (formatted !== 'No date') return formatted;
      }
    }
    return '';
  }

  // jina returns the page as text/markdown: pull the feed XML back out of it
  extractFeedXml(text) {
    let t = text.replace(/\\([\\`*_{}\[\]()#+\-.!<>~|=])/g, '$1'); // undo markdown escaping
    const start = t.search(/<(\?xml|rss|feed|rdf:RDF)\b/i);
    if (start === -1) throw new Error('no feed markup in response');
    t = t.slice(start);
    let end = -1;
    for (const closer of ['</rss>', '</feed>', '</rdf:RDF>']) {
      const i = t.lastIndexOf(closer);
      if (i !== -1 && i + closer.length > end) end = i + closer.length;
    }
    if (end !== -1) t = t.slice(0, end);
    // text shown by a browser is entity-decoded: re-escape bare ampersands so it parses as XML
    return t.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  }

  // ---------------------------------------------------------------------
  // Cache (30 minutes; expired entries are kept as a fallback)
  // ---------------------------------------------------------------------

  getCacheKey(rssUrl) {
    return `rss_ticker_cache_${encodeURIComponent(rssUrl)}_${this.getAttribute('max-posts') || 'all'}`;
  }

  loadFromCache(cacheKey, allowStale = false) {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const { data, timestamp } = JSON.parse(raw);
      const fresh = Date.now() - timestamp < 1000 * 60 * 30;
      if (Array.isArray(data) && data.length && (fresh || allowStale)) return data;
    } catch (e) { /* ignore corrupted or unavailable storage */ }
    return null;
  }

  saveToCache(cacheKey, data) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) { /* silent */ }
  }

  // Which route worked for this feed last time (so it's tried first), and feeds found unusable
  loadRoute(cacheKey) {
    try {
      const r = JSON.parse(localStorage.getItem(cacheKey + '_route'));
      if (r && Date.now() - r.t < 6 * 3600 * 1000) return r.route;
    } catch (e) { /* ignore */ }
    return null;
  }
  saveRoute(cacheKey, route) {
    try { localStorage.setItem(cacheKey + '_route', JSON.stringify({ route, t: Date.now() })); } catch (e) { /* silent */ }
  }
  getBrokenAt(cacheKey) {
    try { return parseInt(localStorage.getItem(cacheKey + '_broken')) || 0; } catch (e) { return 0; }
  }
  markBroken(cacheKey) {
    try { localStorage.setItem(cacheKey + '_broken', String(Date.now())); } catch (e) { /* silent */ }
  }
  clearBroken(cacheKey) {
    try { localStorage.removeItem(cacheKey + '_broken'); } catch (e) { /* silent */ }
  }
  brokenMessage(rssUrl) {
    return `Can't read a feed from ${this.extractDomain(rssUrl)} (invalid, blocked or unavailable).`;
  }

  // ---------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------

  parseXMLFeed(xmlString, rssUrl) {
    if (!/<(rss|feed|channel|rdf:RDF)\b/i.test(xmlString)) {
      throw new Error('not an RSS/Atom feed (URL may be wrong, discontinued or blocked)');
    }

    const xmlDoc = new DOMParser().parseFromString(xmlString, 'text/xml');
    if (xmlDoc.querySelector('parsererror')) throw new Error('invalid XML');

    const domain = this.extractDomain(rssUrl);
    const maxPostsAttr = parseInt(this.getAttribute('max-posts'));
    const maxPosts = isNaN(maxPostsAttr) ? Infinity : maxPostsAttr;

    let items = Array.from(xmlDoc.querySelectorAll('rss > channel > item'));
    if (!items.length) items = Array.from(xmlDoc.querySelectorAll('item'));  // RSS 1.0 / RDF
    if (!items.length) items = Array.from(xmlDoc.querySelectorAll('entry')); // Atom
    if (!items.length) throw new Error('no feed items found');

    const posts = items
      .slice(0, maxPosts)
      .map(item => {
        let title = 'No title';
        let date = 'No date';
        let link = '#';

        const titleEl = item.querySelector('title');
        if (titleEl) title = this.stripHtml(titleEl.textContent || '').trim();

        for (const selector of ['pubDate', 'published', 'updated', 'dc\\:date', 'date']) {
          const dateEl = item.querySelector(selector);
          if (dateEl && dateEl.textContent) {
            const formatted = this.parseDate(dateEl.textContent.trim());
            if (formatted !== 'No date') {
              date = formatted;
              break;
            }
          }
        }

        const linkEl = item.querySelector('link');
        if (linkEl) {
          if (linkEl.textContent && linkEl.textContent.trim()) link = linkEl.textContent.trim();
          else if (linkEl.getAttribute('href')) link = linkEl.getAttribute('href');
        }
        if (link === '#') {
          const guidEl = item.querySelector('guid');
          if (guidEl && guidEl.textContent) link = guidEl.textContent.trim();
        }

        return { domain, date, title, link: link.trim() };
      })
      .filter(post => post.title !== 'No title' && post.title.length > 3);

    if (!posts.length) throw new Error('no valid posts found');
    return posts;
  }

  parseDate(value) {
    if (value === undefined || value === null || value === '') return 'No date';
    if (typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(value)) {
      value = value.replace(' ', 'T'); // Safari can't parse "YYYY-MM-DD HH:MM:SS"
    }
    return this.formatDate(new Date(value));
  }

  stripHtml(html) {
    if (!html) return '';
    // DOMParser never runs scripts or loads images, unlike innerHTML on a live element
    return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  extractDomain(url) {
    try {
      return new URL(url).hostname.replace(/^(www\.|rss\.|feeds\.|api\.)/, '');
    } catch {
      return 'Unknown';
    }
  }

  formatDate(date) {
    if (isNaN(date.getTime())) return 'No date';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---------------------------------------------------------------------
  // Display
  // ---------------------------------------------------------------------

  showMessage(message, color = '#dc3545') {
    const ticker = this.shadowRoot.querySelector('.ticker-content');
    if (ticker) {
      ticker.textContent = message;
      ticker.style.color = color;
      ticker.style.animation = 'none';
      ticker.style.transform = 'translateX(0)';
      this.lastMeasuredCycleWidth = 0;
    }
  }

  // One full cycle: every post followed by a separator
  buildCycleHtml() {
    const separator = this.getAttribute('separator') || '|';
    const sepHtml = `<span class="separator">${separator}</span>`;

    return this.posts
      .map(post => {
        let link = post.link;
        if (link !== '#' && !link.startsWith('http')) link = `https://${link}`;
        return `<a href="${this.escapeHtml(link)}" target="_blank" rel="noopener" class="post-link">` +
          `<span class="post-domain">${this.escapeHtml(post.domain)}</span>` +
          (post.date && post.date !== 'No date' ? `<span class="post-date">${this.escapeHtml(post.date)}</span>` : '') +
          `<span class="post-title">${this.escapeHtml(post.title)}</span>` +
          `</a>${sepHtml}`;
      })
      .join('');
  }

  updateTickerContent() {
    const content = this.shadowRoot.querySelector('.ticker-content');
    if (!content || this.posts.length === 0) return;

    const cycle = this.buildCycleHtml();
    content.innerHTML = cycle + cycle + cycle; // three identical cycles = seamless loop
    content.style.color = this.getAttribute('title-color') || '#333';
    content.style.animation = 'none';
    content.style.transform = 'translateX(0)';

    // Wait for layout (and web fonts) before measuring
    requestAnimationFrame(() => {
      const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      fontsReady.then(() => this.startAnimation());
    });
  }

  startAnimation() {
    const content = this.shadowRoot.querySelector('.ticker-content');
    if (!content || !this.isConnected || this.posts.length === 0) return;

    const cycleWidth = content.getBoundingClientRect().width / 3; // content is exactly 3 cycles
    if (!cycleWidth) return;

    this.lastMeasuredCycleWidth = cycleWidth;
    const speed = Math.max(1, Math.min(10, parseInt(this.getAttribute('speed')) || 5));
    const duration = cycleWidth / (speed * 25);

    content.style.setProperty('--cycle', `${cycleWidth}px`);
    content.style.animation = `scroll-dynamic ${duration}s linear infinite`;
    content.style.transform = 'translateX(0)';
  }

  updateStyles() {
    const style = this.shadowRoot.querySelector('style');
    if (style) style.textContent = this.getStyles();
  }

  getStyles() {
    const domainColor = this.getAttribute('domain-color') || '#007bff';
    const dateColor = this.getAttribute('date-color') || '#6c757d';
    const titleColor = this.getAttribute('title-color') || '#333';
    const backgroundColor = this.getAttribute('background-color') || '#f8f9fa';
    const googleFont = this.getAttribute('google-font');
    const fontFamily = this.getAttribute('font-family') || 'Arial, sans-serif';
    const fontWeight = this.getAttribute('font-weight') || '400';
    const fontSize = this.getAttribute('font-size') || '14px';

    const finalFontFamily = googleFont ? `"${googleFont}", ${fontFamily}` : fontFamily;

    return `
      :host {
        display: block;
        width: 100%;
        overflow: hidden;
        background-color: ${backgroundColor};
        padding: 12px 0;
        box-sizing: border-box;
      }
      .ticker-container {
        white-space: nowrap;
        overflow: hidden;
        position: relative;
        min-height: 1.6em;
        height: auto;
        display: flex;
        align-items: center;
      }
      .ticker-content {
        display: inline-block;
        font-family: ${finalFontFamily};
        font-weight: ${fontWeight};
        font-size: ${fontSize};
        line-height: 1.4;
        color: ${titleColor};
        will-change: transform;
        white-space: nowrap;
        transform: translateX(0);
      }
      @keyframes scroll-dynamic {
        from { transform: translateX(0); }
        to   { transform: translateX(calc(-1 * var(--cycle, 0px))); }
      }
      .ticker-container:hover .ticker-content {
        animation-play-state: paused !important;
      }
      .post-link {
        text-decoration: none;
        color: inherit;
        display: inline-block;
        transition: all 0.2s ease;
        padding: 0 5px;
        border-radius: 4px;
      }
      .post-link:hover {
        transform: translateY(-1px);
        filter: brightness(1.1);
        background-color: rgba(0, 0, 0, 0.05);
      }
      .post-title {
        font-weight: bold;
        color: ${titleColor};
        margin-left: 1.2em;
      }
      .post-domain {
        color: ${domainColor};
        font-weight: 600;
        font-size: 0.85em;
      }
      .post-date {
        color: ${dateColor};
        font-style: italic;
        margin-left: 1.2em;
        font-size: 0.85em;
      }
      .separator {
        color: ${dateColor};
        font-weight: bold;
        margin: 0 2em;
      }
      @media (max-width: 768px) {
        :host { padding: 8px 0; }
        .ticker-content { font-size: calc(${fontSize} * 0.9); }
        .post-title { margin-left: 0.8em; }
        .post-date { margin-left: 0.8em; }
        .separator { margin: 0 1.5em; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ticker-content {
          animation: none !important;
          transform: translateX(0) !important;
        }
      }
    `;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>${this.getStyles()}</style>
      <div class="ticker-container">
        <div class="ticker-content">Loading RSS feed...</div>
      </div>
    `;
  }
}

// Shared by every <rss-ticker> on the page
RSSTickerElement.BROKEN_COOLDOWN = 5 * 60 * 1000; // don't re-request an unusable feed for 5 minutes
RSSTickerElement._inflight = new Map();  // cache key -> in-flight promise
RSSTickerElement._noDirect = new Map();  // feed hostname -> when direct access was found blocked
RSSTickerElement._nextSlot = new Map();  // service hostname -> next free request slot

// Which services have been working lately (shared by all tickers, remembered for 10 minutes)
RSSTickerElement._health = {};
try { RSSTickerElement._health = JSON.parse(localStorage.getItem('rss_ticker_health') || '{}'); } catch (e) { /* ignore */ }

RSSTickerElement._recordRoute = (name, ok) => {
  const group = name.startsWith('allorigins') ? 'allorigins' : name;
  const h = RSSTickerElement._health[group] || { ok: 0, fail: 0, t: 0 };
  if (Date.now() - h.t > 10 * 60 * 1000) { h.ok = 0; h.fail = 0; } // old news: start fresh
  if (ok) h.ok++; else h.fail++;
  h.t = Date.now();
  RSSTickerElement._health[group] = h;
  try { localStorage.setItem('rss_ticker_health', JSON.stringify(RSSTickerElement._health)); } catch (e) { /* silent */ }
};

// "Down" = failed at least twice recently and hasn't succeeded
RSSTickerElement._isDown = (group) => {
  const h = RSSTickerElement._health[group];
  return !!h && Date.now() - h.t < 10 * 60 * 1000 && h.fail >= 2 && h.ok === 0;
};

// Remember (for a week) which feed hosts block direct requests, so we don't retry them each page load
try {
  const saved = JSON.parse(localStorage.getItem('rss_ticker_nodirect') || '{}');
  Object.keys(saved).forEach(h => {
    if (Date.now() - saved[h] < 7 * 24 * 3600 * 1000) RSSTickerElement._noDirect.set(h, saved[h]);
  });
} catch (e) { /* ignore */ }

RSSTickerElement._markNoDirect = (host) => {
  RSSTickerElement._noDirect.set(host, Date.now());
  try {
    localStorage.setItem('rss_ticker_nodirect', JSON.stringify(Object.fromEntries(RSSTickerElement._noDirect)));
  } catch (e) { /* silent */ }
};

RSSTickerElement._hostOf = (url) => {
  try { return new URL(url).hostname; } catch { return ''; }
};

// Per service: `burst` requests go out immediately, after that one every `gap` ms.
// (Many tickers on one page load fast, without tripping the services' rate limits.)
RSSTickerElement._throttle = async (host, gap = 250, burst = 1) => {
  const now = Date.now();
  const next = Math.max(RSSTickerElement._nextSlot.get(host) || 0, now);
  const wait = Math.max(0, next - now - (burst - 1) * gap);
  RSSTickerElement._nextSlot.set(host, next + gap);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
};

// Open the connection to the main proxy early, shaving the handshake off the first request
RSSTickerElement._preconnect = () => {
  if (RSSTickerElement._preconnected) return;
  RSSTickerElement._preconnected = true;
  try {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://api.allorigins.win';
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  } catch (e) { /* silent */ }
};

if (customElements.get('rss-ticker')) {
  console.warn('rss-ticker v6: a different <rss-ticker> is already registered on this page, so THIS copy is not being used. Remove the other script.');
} else {
  customElements.define('rss-ticker', RSSTickerElement);
}
})();