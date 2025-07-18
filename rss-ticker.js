class RSSTickerElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({
      mode: 'open'
    });
    this.posts = [];
    this.animationId = null;
    this.resizeObserver = null;
    this.lastMeasuredCycleWidth = 0;
    this.isLoading = false;
  }

  static get observedAttributes() {
    return [
      'rss-url',
      'separator',
      'domain-color',
      'date-color',
      'title-color',
      'background-color',
      'speed',
      'google-font',
      'font-family',
      'font-weight',
      'font-size',
      'max-posts'
    ];
  }

  connectedCallback() {
    this.loadGoogleFont();
    this.render();
    this.fetchRSSFeed();

    this.resizeObserver = new ResizeObserver(entries => {
      if (entries.length > 0 && this.lastMeasuredCycleWidth > 0) {
        if (this.resizeTimeout) {
          clearTimeout(this.resizeTimeout);
        }
        this.resizeTimeout = setTimeout(() => {
          this.updateTickerContent();
        }, 100);
      }
    });
    this.resizeObserver.observe(this.shadowRoot.querySelector('.ticker-container'));
  }

  disconnectedCallback() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    this.isLoading = false;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      if (name === 'google-font') {
        this.loadGoogleFont();
      }
      if (name === 'rss-url' || name === 'max-posts') {
        this.fetchRSSFeed();
      } else {
        this.updateStyles();
        if (['font-family', 'font-weight', 'font-size', 'separator'].includes(name)) {
          this.updateTickerContent();
        }
      }
    }
  }

  loadGoogleFont() {
    const fontName = this.getAttribute('google-font');
    if (!fontName) return;
    const weight = this.getAttribute('font-weight') || '400';
    const existingLink = document.head.querySelector(`link[href*="${fontName.replace(' ', '+')}"]`);

    if (existingLink) return;

    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(' ', '+')}:wght@${weight}&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  async fetchRSSFeed() {
    const rssUrl = this.getAttribute('rss-url');
    if (!rssUrl || this.isLoading) {
      if (!rssUrl) this.showMessage('No RSS URL provided');
      return;
    }

    this.isLoading = true;
    this.showMessage('Loading...', '#007bff');

    // Fast services with aggressive timeouts
    const services = [{
      name: 'allorigins',
      url: `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`,
      timeout: 2500,
      parseXML: true
    }, {
      name: 'jsonp-proxy',
      url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rssUrl)}`,
      timeout: 2000,
      parseXML: true
    }, {
      name: 'proxy-api',
      url: `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`,
      timeout: 2000,
      parseXML: false
    }];

    for (let attempt = 0; attempt < 2; attempt++) {
      for (const service of services) {
        try {
          if (attempt > 0) {
            console.log(`🔄 Retry attempt ${attempt + 1} with ${service.name}...`);
          } else {
            console.log(`🚀 Trying ${service.name}...`);
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), service.timeout);

          const response = await fetch(service.url, {
            signal: controller.signal,
            // NO CUSTOM HEADERS - they trigger CORS preflight
            // Only use simple request headers to avoid preflight
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          let xmlData;
          if (service.parseXML) {
            if (service.name === 'allorigins') {
              const json = await response.json();
              if (!json.contents || json.contents.length < 100) {
                throw new Error('AllOrigins returned empty content');
              }
              xmlData = json.contents;
            } else {
              xmlData = await response.text();
              if (!xmlData || xmlData.length < 100) {
                throw new Error('Empty or too short response');
              }
            }

            // Validate it looks like XML/RSS
            if (!xmlData.includes('<rss') && !xmlData.includes('<feed') && !xmlData.includes('<channel')) {
              throw new Error('Response does not appear to be a valid RSS/XML feed');
            }

            this.parseXMLFeed(xmlData, rssUrl);
          } else {
            // Handle RSS2JSON response
            const jsonData = await response.json();
            if (jsonData.status !== 'ok') {
              throw new Error(jsonData.message || 'RSS2JSON service error');
            }
            this.parseJSONFeed(jsonData, rssUrl);
          }
          console.log(`✅ SUCCESS with ${service.name}! Loaded ${this.posts.length} posts`);
          this.isLoading = false;
          return;

        } catch (error) {
          console.log(`❌ ${service.name} failed:`, error.message);
          continue;
        }
      }
    }

    this.isLoading = false;
    this.showMessage('All RSS services failed. Please check the feed URL.', '#dc3545');
  }

  parseXMLFeed(xmlString, rssUrl) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

      // Check for parsing errors
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        throw new Error('Invalid XML format');
      }

      const domain = this.extractDomain(rssUrl);
      // Get maxPosts, if not a valid number, set to Infinity
      const maxPostsAttr = this.getAttribute('max-posts');
      const maxPosts = (maxPostsAttr && !isNaN(parseInt(maxPostsAttr))) ? parseInt(maxPostsAttr) : Infinity;

      // Try multiple RSS/Atom formats
      let items = [];

      // RSS 2.0 format
      items = Array.from(xmlDoc.querySelectorAll('rss > channel > item'));

      // RSS 1.0 / RDF format
      if (items.length === 0) {
        items = Array.from(xmlDoc.querySelectorAll('item'));
      }

      // Atom format
      if (items.length === 0) {
        items = Array.from(xmlDoc.querySelectorAll('entry'));
      }

      if (items.length === 0) {
        throw new Error('No feed items found in XML');
      }

      this.posts = items
        .slice(0, maxPosts)
        .map(item => {
          let title = 'No title';
          let date = 'No date';
          let link = '#';

          // Get title (try multiple selectors)
          const titleEl = item.querySelector('title') || item.querySelector('title');
          if (titleEl) {
            title = this.stripHtml(titleEl.textContent || titleEl.textContent).trim();
          }

          // Get date (try multiple date fields)
          const dateSelectors = ['pubDate', 'published', 'updated', 'dc\\:date', 'date'];
          for (const selector of dateSelectors) {
            const dateEl = item.querySelector(selector);
            if (dateEl && dateEl.textContent) {
              const pubDate = new Date(dateEl.textContent.trim());
              if (!isNaN(pubDate.getTime())) {
                date = this.formatDate(pubDate);
                break;
              }
            }
          }

          // Get link (try multiple link formats)
          const linkEl = item.querySelector('link');
          if (linkEl) {
            // RSS format: <link>url</link>
            if (linkEl.textContent && linkEl.textContent.trim()) {
              link = linkEl.textContent.trim();
            }
            // Atom format: <link href="url" />
            else if (linkEl.getAttribute('href')) {
              link = linkEl.getAttribute('href');
            }
          }

          // Fallback to guid if no link found
          if (link === '#') {
            const guidEl = item.querySelector('guid');
            if (guidEl && guidEl.textContent) {
              link = guidEl.textContent.trim();
            }
          }

          return {
            domain,
            date,
            title,
            link: link.trim()
          };
        })
        .filter(post => post.title !== 'No title' && post.title.length > 3);

      if (this.posts.length === 0) {
        throw new Error('No valid posts found after filtering');
      }

      console.log(`📰 Parsed ${this.posts.length} posts from XML feed`);
      this.updateTickerContent();

    } catch (error) {
      console.error('XML parsing failed:', error);
      throw new Error(`XML parsing failed: ${error.message}`);
    }
  }

  parseJSONFeed(data, rssUrl) {
    const domain = this.extractDomain(rssUrl);
    // Get maxPosts, if not a valid number, set to Infinity
    const maxPostsAttr = this.getAttribute('max-posts');
    const maxPosts = (maxPostsAttr && !isNaN(parseInt(maxPostsAttr))) ? parseInt(maxPostsAttr) : Infinity;

    let items = [];

    // Handle different JSON formats
    if (data.items) {
      items = data.items; // RSS2JSON format
    } else if (data.entries) {
      items = data.entries; // Some other formats
    } else if (Array.isArray(data)) {
      items = data; // Direct array
    } else {
      throw new Error('Unknown JSON format');
    }

    this.posts = items
      .slice(0, maxPosts)
      .map(item => {
        const title = this.stripHtml(item.title || item.title_detail?.value || 'No title').trim();

        // Handle different date formats
        let date = 'No date';
        const pubDate = item.pubDate || item.published || item.date_published || item.updated;
        if (pubDate) {
          date = this.formatDate(new Date(pubDate));
        }

        // Handle different link formats      
        let link = item.link || item.url || item.guid || '#';
        if (typeof link === 'object') {
          link = link.href || link.url || '#';
        }

        return {
          domain,
          date,
          title,
          link: link.trim()
        };
      })
      .filter(post => post.title !== 'No title' && post.title.length > 3);

    if (this.posts.length === 0) {
      throw new Error('No posts found');
    }

    console.log(`📰 Loaded ${this.posts.length} posts from ${domain}`);
    this.updateTickerContent();
  }

  stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^(www\.|rss\.|feeds\.|api\.)/, '');
    } catch {
      return 'Unknown';
    }
  }

  formatDate(date) {
    if (isNaN(date.getTime())) {
      return 'No date';
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

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

  updateTickerContent() {
    const separator = this.getAttribute('separator') || '|';
    const tickerContent = this.shadowRoot.querySelector('.ticker-content');

    if (!tickerContent || this.posts.length === 0) {
      return;
    }

    const postHtml = this.posts
      .map((post, index) => {
        let safeLink = post.link;
        if (safeLink !== '#' && !safeLink.startsWith('http')) {
          safeLink = `https://${safeLink}`;
        }

        return `<a href="${safeLink}" target="_blank" rel="noopener" class="post-link">
          <span class="post-domain">${post.domain}</span>
          <span class="post-date">${post.date}</span>
          <span class="post-title">${post.title}</span>
        </a>`;
      })
      .join(`<span class="separator">${separator}</span>`);

    // Triple content for seamless loop
    const fullContent = `${postHtml}<span class="separator">${separator}</span>${postHtml}<span class="separator">${separator}</span>${postHtml}`;
    tickerContent.innerHTML = fullContent;
    tickerContent.style.color = this.getAttribute('title-color') || '#333';

    tickerContent.style.animation = 'none';
    tickerContent.style.transform = 'translateX(0)';

    requestAnimationFrame(() => {
      this.startAnimation();
    });
  }

  startAnimation() {
    const container = this.shadowRoot.querySelector('.ticker-container');
    const content = this.shadowRoot.querySelector('.ticker-content');

    if (!container || !content || this.posts.length === 0) {
      return;
    }

    // Measure one cycle width
    const separator = this.getAttribute('separator') || '|';
    const postHtml = this.posts
      .map(post => {
        let safeLink = post.link;
        if (safeLink !== '#' && !safeLink.startsWith('http')) {
          safeLink = `https://${safeLink}`;
        }
        return `<a href="${safeLink}" target="_blank" rel="noopener" class="post-link">
          <span class="post-domain">${post.domain}</span>
          <span class="post-date">${post.date}</span>
          <span class="post-title">${post.title}</span>
        </a>`;
      })
      .join(`<span class="separator">${separator}</span>`);

    const tempDiv = document.createElement('div');
    tempDiv.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: nowrap;
        font-family: ${this.getComputedStyleValue('font-family')};
        font-weight: ${this.getComputedStyleValue('font-weight')};
        font-size: ${this.getComputedStyleValue('font-size')};
        line-height: 1.4;
    `;
    tempDiv.innerHTML = `${postHtml}<span class="separator">${separator}</span>`;

    this.shadowRoot.appendChild(tempDiv);
    const cycleWidth = tempDiv.offsetWidth;
    this.shadowRoot.removeChild(tempDiv);

    if (cycleWidth === 0) return;

    this.lastMeasuredCycleWidth = cycleWidth;

    const speed = Math.max(1, Math.min(10, parseInt(this.getAttribute('speed')) || 5));
    const duration = cycleWidth / (speed * 25); // Faster base speed

    const styleEl = this.shadowRoot.querySelector('style');
    if (styleEl) {
      const keyframes = `
        @keyframes scroll-dynamic {
          0% { transform: translateX(0); }
          100% { transform: translateX(-${cycleWidth}px); }
        }
      `;
      const currentStyle = styleEl.textContent;
      const keyframesRegex = /@keyframes scroll-dynamic \{[^}]*\}/s;
      if (keyframesRegex.test(currentStyle)) {
        styleEl.textContent = currentStyle.replace(keyframesRegex, keyframes);
      } else {
        styleEl.textContent += keyframes;
      }
    }

    content.style.animation = `scroll-dynamic ${duration}s linear infinite`;
    content.style.transform = 'translateX(0)';
  }

  getComputedStyleValue(prop) {
    const content = this.shadowRoot.querySelector('.ticker-content');
    return content ? getComputedStyle(content)[prop] : '';
  }

  updateStyles() {
    const style = this.shadowRoot.querySelector('style');
    if (style) {
      style.textContent = this.getStyles();
    }
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
      .ticker-container:hover .ticker-content {
        animation-play-state: paused !important;
      }
      .post-link {
        text-decoration: none;
        color: inherit;
        display: inline-block;
        transition: all 0.2s ease;
      }
      .post-link:hover {
        transform: translateY(-1px);
        filter: brightness(1.1);
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
        :host {
          padding: 8px 0;
        }
        .ticker-content {
          font-size: calc(${fontSize} * 0.9);
        }
        .post-title {
          margin-left: 0.8em;
        }
        .post-date {
          margin-left: 0.8em;
        }
        .separator {
          margin: 0 1.5em;
        }
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

customElements.define('rss-ticker', RSSTickerElement);