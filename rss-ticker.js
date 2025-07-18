class RSSTickerElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({
      mode: 'open'
    });
    this.posts = [];
    this.animationId = null;
    this.resizeObserver = null;
    this.lastMeasuredCycleWidth = 0; // Store last measured width
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
      // Re-evaluate animation when container size changes
      if (entries.length > 0 && this.lastMeasuredCycleWidth > 0) { // Only re-measure if content exists
        // Debounce to prevent excessive calls during rapid resizing
        if (this.resizeTimeout) {
          clearTimeout(this.resizeTimeout);
        }
        this.resizeTimeout = setTimeout(() => {
          this.updateTickerContent(); // This will also call startAnimation
        }, 100);
      }
    });
    // Observe the ticker-container to detect overall size changes
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
        // If styles related to size/font change, re-evaluate animation
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
    if (!rssUrl) {
      this.showMessage('No RSS URL provided');
      return;
    }
    this.showMessage('Loading...');

    const requestedMaxPosts = parseInt(this.getAttribute('max-posts'));
    const proxyCount = (isNaN(requestedMaxPosts) || requestedMaxPosts <= 0) ? 100 : Math.min(requestedMaxPosts, 100);

    try {
      const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=${proxyCount}`;
      const response = await fetch(proxyUrl);

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'ok' && data.items && data.items.length > 0) {
          this.parseJSONFeed(data, rssUrl);
          return;
        }
      }
    } catch (error) {
      console.warn('RSS2JSON failed:', error);
    }
    try {
      const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
      const response = await fetch(fallbackUrl);

      if (response.ok) {
        const data = await response.json();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(data.contents, 'text/xml');

        if (!xmlDoc.querySelector('parsererror')) {
          this.parseRSSFeed(xmlDoc, rssUrl);
          return;
        }
      }
    } catch (error) {
      console.warn('AllOrigins fallback failed:', error);
    }
    this.showMessage('Failed to load');
  }

  parseJSONFeed(data, rssUrl) {
    const domain = this.extractDomain(rssUrl);
    const maxPosts = parseInt(this.getAttribute('max-posts'));
    const limit = isNaN(maxPosts) ? Infinity : maxPosts;

    this.posts = data.items
      .slice(0, limit)
      .map(item => {
        const title = item.title || 'No title';
        const date = item.pubDate ? this.formatDate(new Date(item.pubDate)) : 'No date';
        const link = item.link || item.guid || '#';

        return {
          domain,
          date,
          title: title.trim(),
          link
        };
      });
    this.updateTickerContent();
  }

  parseRSSFeed(xmlDoc, rssUrl) {
    const domain = this.extractDomain(rssUrl);

    let items = xmlDoc.querySelectorAll('item');
    if (items.length === 0) {
      items = xmlDoc.querySelectorAll('entry');
    }

    const maxPosts = parseInt(this.getAttribute('max-posts'));
    const limit = isNaN(maxPosts) ? Infinity : maxPosts;

    this.posts = Array.from(items)
      .slice(0, limit)
      .map(item => {
        const title = item.querySelector('title')?.textContent || 'No title';
        const pubDateElement = item.querySelector('pubDate') || item.querySelector('published');
        const pubDate = pubDateElement?.textContent;
        const date = pubDate ? this.formatDate(new Date(pubDate)) : 'No date';
        const linkElement = item.querySelector('link') || item.querySelector('guid');
        const link = linkElement?.textContent || linkElement?.getAttribute('href') || '#';

        return {
          domain,
          date,
          title: title.trim(),
          link
        };
      });
    this.updateTickerContent();
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^(www\.|rss\.)/, '');
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
      this.posts = [];
      this.updateTickerContent();
    }
  }

  updateTickerContent() {
    const separator = this.getAttribute('separator') || '|';
    const tickerContent = this.shadowRoot.querySelector('.ticker-content');

    if (!tickerContent) {
      return;
    }

    if (this.posts.length === 0) {
      if (!tickerContent.textContent.includes('Loading') && !tickerContent.textContent.includes('Failed')) {
        tickerContent.textContent = 'No content available.';
        tickerContent.style.color = '#6c757d';
      }
      tickerContent.style.animation = 'none';
      tickerContent.style.transform = 'translateX(0)';
      this.lastMeasuredCycleWidth = 0; // Reset width
      return;
    }

    const postHtml = this.posts
      .map((post, index) => `<a href="${post.link}" target="_blank" rel="noopener" class="post-link" data-index="${index}"><span class="post-domain">${post.domain}</span><span class="post-date">${post.date}</span><span class="post-title">${post.title}</span></a>`)
      .join(`<span class="separator">${separator}</span>`);

    // Duplicate the content three times for seamless looping
    // ORIGINAL_SET + SEPARATOR + ORIGINAL_SET + SEPARATOR + ORIGINAL_SET
    const fullContentHtml = `${postHtml}<span class="separator">${separator}</span>${postHtml}<span class="separator">${separator}</span>${postHtml}`;
    tickerContent.innerHTML = fullContentHtml;
    tickerContent.style.color = this.getAttribute('title-color') || '#333';

    // Clear previous animation and transform to allow for accurate measurement
    tickerContent.style.animation = 'none';
    tickerContent.style.transform = 'translateX(0)';

    // Request animation frame to ensure DOM is updated before measuring
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

    // *** Crucial: Measure the precise width of ONE full, unique set of content ***
    const separator = this.getAttribute('separator') || '|';
    const postHtml = this.posts
      .map((post, index) => `<a href="${post.link}" target="_blank" rel="noopener" class="post-link" data-index="${index}"><span class="post-domain">${post.domain}</span><span class="post-date">${post.date}</span><span class="post-title">${post.title}</span></a>`)
      .join(`<span class="separator">${separator}</span>`);

    // Temporarily append one full unique content string to accurately measure its width
    const tempDiv = document.createElement('div');
    tempDiv.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: nowrap;
        font-family: ${this.getComputedStyleValue('font-family')};
        font-weight: ${this.getComputedStyleValue('font-weight')};
        font-size: ${this.getComputedStyleValue('font-size')};
        /* Inherit or explicitly set styles that affect width */
        padding: 0;
        margin: 0;
        line-height: 1.4; /* Ensure consistency with .ticker-content */
    `;
    tempDiv.innerHTML = `${postHtml}<span class="separator">${separator}</span>`; // One full cycle including the trailing separator

    this.shadowRoot.appendChild(tempDiv);
    const cycleWidth = tempDiv.offsetWidth; // Use offsetWidth for accurate layout width
    this.shadowRoot.removeChild(tempDiv);

    if (cycleWidth === 0) {
      // If cycleWidth is 0, it means content is empty or not rendered correctly.
      // Stop animation and return.
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
      }
      content.style.animation = 'none';
      content.style.transform = 'translateX(0)';
      this.lastMeasuredCycleWidth = 0;
      return;
    }

    this.lastMeasuredCycleWidth = cycleWidth; // Store for resize observer check

    const speedValue = parseInt(this.getAttribute('speed')) || 5;
    const clampedSpeed = Math.max(1, Math.min(10, speedValue));

    // Calculate duration based on cycleWidth and speed.
    // Higher constant for slower animation (more time per pixel).
    // duration = (distance / speed_pixels_per_second)
    const pixelsPerSecondAtSpeed1 = 25; // Adjust this value to control overall speed
    const duration = cycleWidth / (clampedSpeed * pixelsPerSecondAtSpeed1);

    const styleEl = this.shadowRoot.querySelector('style');
    if (styleEl) {
      const newKeyframes = `
        @keyframes scroll-dynamic {
          0% { transform: translateX(0); }
          100% { transform: translateX(-${cycleWidth}px); }
        }
      `;
      // Use a unique name if you have other keyframes to prevent conflicts
      const currentStyleContent = styleEl.textContent;
      const keyframesRegex = /@keyframes scroll-dynamic \{[^}]*\}/s;
      if (keyframesRegex.test(currentStyleContent)) {
        styleEl.textContent = currentStyleContent.replace(keyframesRegex, newKeyframes);
      } else {
        styleEl.textContent += newKeyframes;
      }
    }

    // Apply the animation
    content.style.animation = `scroll-dynamic ${duration}s linear infinite`;
    // Ensure initial state is 0, though keyframes 0% rule handles this
    content.style.transform = 'translateX(0)';
  }

  // Helper to get computed styles for the temporary measurement div
  getComputedStyleValue(prop) {
    const content = this.shadowRoot.querySelector('.ticker-content');
    if (content) {
      return getComputedStyle(content)[prop];
    }
    return '';
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
        min-height: 1.6em; /* Ensure some height even if content is empty */
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
        transform: translateX(0); /* Ensure initial state is 0 */
        text-shadow: none;
      }
      .ticker-container:hover .ticker-content,
      .ticker-content:hover {
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
        font-size: ${fontSize};
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
        font-size: ${fontSize};
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
          animation: none !important; /* Disable animation entirely */
          transform: translateX(0) !important; /* Keep content static */
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