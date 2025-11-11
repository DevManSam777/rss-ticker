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
    this._fetchPromise = null; 
    this.resizeTimeout = null;
    this._fetchDebounceTimeout = null; 
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
    // Debounce the initial fetch. This is crucial if connectedCallback fires multiple times.
    this.debouncedFetchRSSFeed();

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
    if (this._fetchDebounceTimeout) {
      clearTimeout(this._fetchDebounceTimeout);
    }
    this.isLoading = false;
    this._fetchPromise = null; // Clear the promise on disconnect
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      if (name === 'google-font') {
        this.loadGoogleFont();
      }
      if (name === 'rss-url' || name === 'max-posts') {
        // Debounce fetch calls triggered by attribute changes
        this.debouncedFetchRSSFeed();
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

  // Debounces calls to fetchRSSFeed to prevent excessive requests.
  debouncedFetchRSSFeed() {
    const rssUrl = this.getAttribute('rss-url');
    if (!rssUrl) {
      this.showMessage('No RSS URL provided');
      return;
    }

    // If a fetch is already in progress for this URL, do not schedule a new one.
   

    if (this._fetchDebounceTimeout) {
      clearTimeout(this._fetchDebounceTimeout);
    }
    this._fetchDebounceTimeout = setTimeout(() => {
      this.fetchRSSFeed();
    }, 100); 
  }


  // Fetches the RSS feed using multiple proxy services in parallel.  Prioritizes the fastest successful response. Includes caching.
  
  async fetchRSSFeed() {
    const rssUrl = this.getAttribute('rss-url');
    if (!rssUrl) {
      this.showMessage('No RSS URL provided');
      return;
    }

    // This prevents redundant fetches if fetchRSSFeed is called multiple times quickly.
    if (this.isLoading && this._fetchPromise) {
      return this._fetchPromise;
    }

    // Attempt to load from cache first
    const cachedData = this.loadFromCache(rssUrl);
    if (cachedData) {
      this.posts = cachedData;
      this.updateTickerContent();
      this.isLoading = false; // Ensure loading state is reset
      this._fetchPromise = Promise.resolve(); // Create a resolved promise to signal completion
      return this._fetchPromise; // Exit if cached data is found and valid
    }

    this.isLoading = true;
    this.showMessage('Loading...', '#007bff');
    this.posts = []; // Clear previous posts immediately

    // Define all proxy services. No hardcoding specific URLs.
    const services = [{
      name: 'allorigins',
      url: `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`,
      timeout: 3500, 
      parseXML: true
    }, {
      name: 'jsonp-proxy',
      url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rssUrl)}`,
      timeout: 3000, 
      parseXML: true
    }, {
      name: 'rss2json', // This proxy is now always included
      url: `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`,
      timeout: 3000,
      parseXML: false
    }];

    let success = false;
    let errors = [];

    // Store the promise to prevent concurrent calls
    this._fetchPromise = (async () => {
      try {
        // Attempt 1: Race all services in parallel, each with retries
        await Promise.race(services.map(service => this.fetchServiceWithRetries(service, rssUrl, 2))); // 2 retries per service
        success = true;
      } catch (error) {
        // This catch block will only be hit if the *first* promise to settle in the race rejects.
        // It doesn't mean all failed, just that the first one to finish failed.
        // Proceed to sequential fallback for more detailed attempts.
       null;
      }

      // If the race didn't result in a success, try services sequentially as a fallback
      if (!success) {
        for (const service of services) {
          try {
            await this.fetchServiceWithRetries(service, rssUrl, 2); // 2 retries per service
            success = true;
            break; // Stop on the first successful sequential fetch
          } catch (error) {
            errors.push(`${service.name}: ${error.message}`);
          }
        }
      }

      this.isLoading = false;
      this._fetchPromise = null; // Clear the promise once all attempts are done

      if (success) {
        this.saveToCache(rssUrl, this.posts); // Save successful fetch to cache
        this.updateTickerContent();
      } else {
        // Display error message if all attempts fail
        this.showMessage(`All RSS services failed for ${this.extractDomain(rssUrl)}. Errors: ${errors.map(e => e.split(':')[0]).join(', ')}.`, '#dc3545');
      }
    })();

    return this._fetchPromise; // Return the promise for external chaining if needed
  }

  // Attempts to fetch from a service with a specified number of retries.
  async fetchServiceWithRetries(service, rssUrl, retriesLeft) {
    try {
      return await this.fetchService(service, rssUrl);
    } catch (error) {
      if (retriesLeft > 0) {
        await new Promise(resolve => setTimeout(resolve, 500)); 
        return this.fetchServiceWithRetries(service, rssUrl, retriesLeft - 1);
      } else {
        throw error; // No retries left, re-throw the error
      }
    }
  }

  // Helper function to fetch from a single service.
  
  async fetchService(service, rssUrl) {
    const controller = new AbortController();
    // Set up a timeout to abort the fetch if it takes too long
    const timeoutId = setTimeout(() => controller.abort(), service.timeout);

    try {
      const response = await fetch(service.url, {
        signal: controller.signal,
        // No custom headers to avoid CORS preflight issues with proxies
      });

      clearTimeout(timeoutId); // Clear the timeout if fetch completes in time

      if (!response.ok) {
        // Attempt to read response body for more detailed error logging
        const errorText = await response.text().catch(() => 'No response body');
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Unknown Error'}`);
      }

      let rawData;
      if (service.parseXML) {
        // Handle XML parsing for allorigins and codetabs
        if (service.name === 'allorigins') {
          const json = await response.json();
          if (!json.contents || typeof json.contents !== 'string' || json.contents.length < 100) {
            throw new Error('AllOrigins returned empty, non-string, or too short content');
          }
          rawData = json.contents;

          // Handle data: URI returned by allorigins
          if (rawData.startsWith('data:')) {
              const parts = rawData.split(',');
              if (parts.length > 1) {
                  const mimeTypeAndEncoding = parts[0].substring(5); // Remove 'data:'
                  const base64Content = parts[1];
                  // Check if it's base64 encoded
                  if (mimeTypeAndEncoding.includes('base64')) {
                      try {
                          rawData = atob(base64Content); // Decode base64
                      } catch (e) {
                          throw new Error('Failed to decode base64 content from allorigins');
                      }
                  } else {
                      // If not base64, assume it's URL-encoded or plain text
                      rawData = decodeURIComponent(base64Content);
                  }
              }
          }

        } else { // jsonp-proxy
          rawData = await response.text();
          if (!rawData || rawData.length < 100) {
            throw new Error('Empty or too short response from proxy');
          }
        }

        // More robust check for non-XML content
        if (!rawData.trim().startsWith('<') || (!rawData.includes('<rss') && !rawData.includes('<feed') && !rawData.includes('<channel'))) {
            throw new Error('Response does not appear to be a valid RSS/XML feed');
        }
        this.parseXMLFeed(rawData, rssUrl);
      } else { // JSON service (rss2json)
        const jsonData = await response.json();
        if (jsonData.status !== 'ok') {
          throw new Error(jsonData.message || 'RSS2JSON service error');
        }
        this.parseJSONFeed(jsonData, jsonData, rssUrl); // Pass jsonData twice, first for data, second for original response for context
      }
      return true;
    } catch (error) {
      clearTimeout(timeoutId); // Ensure timeout is cleared even on error
      throw error; // Re-throw the error to be caught by Promise.race or the sequential loop
    }
  }

  // --- Caching Logic ---
  loadFromCache(rssUrl) {
    try {
      const cacheKey = `rss_ticker_cache_${btoa(rssUrl)}`; // Base64 encode URL for safe key
      const cachedItem = localStorage.getItem(cacheKey);
      if (cachedItem) {
        const {
          data,
          timestamp
        } = JSON.parse(cachedItem);
        const cacheDuration = 1000 * 60 * 30; // 30 minutes cache duration
        if (Date.now() - timestamp < cacheDuration) {
          return data;
        } else {
          localStorage.removeItem(cacheKey);
        }
      }
    } catch (e) {
      localStorage.removeItem(`rss_ticker_cache_${btoa(rssUrl)}`); // Clear corrupted cache
    }
    return null;
  }

  saveToCache(rssUrl, data) {
    try {
      const cacheKey = `rss_ticker_cache_${btoa(rssUrl)}`;
      const item = {
        data: data,
        timestamp: Date.now()
      };
      localStorage.setItem(cacheKey, JSON.stringify(item));
    } catch (e) {
      // Silent fail
    }
  }
  // --- End Caching Logic ---

  parseXMLFeed(xmlString, rssUrl) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

      // Check for parsing errors in the XML document itself
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        throw new Error(`Invalid XML format: ${parserError.textContent.substring(0, Math.min(parserError.textContent.length, 100))}...`);
      }

      const domain = this.extractDomain(rssUrl);
      const maxPostsAttr = this.getAttribute('max-posts');
      const maxPosts = (maxPostsAttr && !isNaN(parseInt(maxPostsAttr))) ? parseInt(maxPostsAttr) : Infinity;

      let items = [];
      // Try to find items in common RSS/Atom structures
      items = Array.from(xmlDoc.querySelectorAll('rss > channel > item'));
      if (items.length === 0) items = Array.from(xmlDoc.querySelectorAll('item')); // RSS 1.0 / RDF
      if (items.length === 0) items = Array.from(xmlDoc.querySelectorAll('entry')); // Atom

      if (items.length === 0) {
        throw new Error('No feed items found in XML');
      }

      this.posts = items
        .slice(0, maxPosts)
        .map(item => {
          let title = 'No title';
          let date = 'No date';
          let link = '#';

          // Extract title, handling potential CDATA or text content
          const titleEl = item.querySelector('title');
          if (titleEl) {
            title = this.stripHtml(titleEl.textContent || '').trim();
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
        .filter(post => post.title !== 'No title' && post.title.length > 3); // Filter out invalid posts

      if (this.posts.length === 0) {
        throw new Error('No valid posts found after parsing and filtering');
      }


    } catch (error) {
      throw new Error(`XML parsing failed: ${error.message}`);
    }
  }

  parseJSONFeed(data, originalResponseData, rssUrl) { // Added originalResponseData for more context
    const domain = this.extractDomain(rssUrl);
    const maxPostsAttr = this.getAttribute('max-posts');
    const maxPosts = (maxPostsAttr && !isNaN(parseInt(maxPostsAttr))) ? parseInt(maxPostsAttr) : Infinity;

    let items = [];
    if (data.items) {
      items = data.items;
    } else if (data.entries) {
      items = data.entries;
    } else if (Array.isArray(data)) {
      items = data;
    } else {
      throw new Error('Unknown JSON format');
    }

    this.posts = items
      .slice(0, maxPosts)
      .map(item => {
        const title = this.stripHtml(item.title || item.title_detail?.value || 'No title').trim();

        let date = 'No date';
        const pubDate = item.pubDate || item.published || item.date_published || item.updated;
        if (pubDate) {
          const parsedDate = new Date(pubDate);
          if (!isNaN(parsedDate.getTime())) {
            date = this.formatDate(parsedDate);
          }
        }

        let link = item.link || item.url || item.guid || '#';
        if (typeof link === 'object' && link !== null) { // Handle cases where link might be an object
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
      throw new Error('No valid posts found after parsing and filtering');
    }
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
      ticker.style.animation = 'none'; // Stop animation for messages
      ticker.style.transform = 'translateX(0)';
      this.lastMeasuredCycleWidth = 0; // Reset width to force re-measurement
    }
  }

  updateTickerContent() {
    const separator = this.getAttribute('separator') || '|';
    const tickerContent = this.shadowRoot.querySelector('.ticker-content');

    if (!tickerContent || this.posts.length === 0) {
      this.showMessage('No posts to display.');
      return;
    }

    // Generate HTML for each post
    const postHtml = this.posts
      .map((post, index) => {
        let safeLink = post.link;
        // Ensure links are absolute and valid
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

    // Triple the content to create a seamless looping effect
    const fullContent = `${postHtml}<span class="separator">${separator}</span>${postHtml}<span class="separator">${separator}</span>${postHtml}`;
    tickerContent.innerHTML = fullContent;
    tickerContent.style.color = this.getAttribute('title-color') || '#333';

    // Reset animation and transform to prepare for new animation calculation
    tickerContent.style.animation = 'none';
    tickerContent.style.transform = 'translateX(0)';

    // Use requestAnimationFrame to ensure DOM is ready before measuring and starting animation
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

    // Create a temporary element to accurately measure the width of one full cycle of content
    const separator = this.getAttribute('separator') || '|';
    const postHtml = this.posts
      .map(post => { // Using post.link here, which is safer
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
    // Apply relevant styles to the temporary div for accurate measurement
    tempDiv.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: nowrap;
        font-family: ${this.getComputedStyleValue('font-family')};
        font-weight: ${this.getComputedStyleValue('font-weight')};
        font-size: ${this.getComputedStyleValue('font-size')};
        line-height: 1.4;
    `;
    // Content for one cycle (posts + one separator)
    tempDiv.innerHTML = `${postHtml}<span class="separator">${separator}</span>`;

    this.shadowRoot.appendChild(tempDiv);
    const cycleWidth = tempDiv.offsetWidth;
    this.shadowRoot.removeChild(tempDiv); // Clean up the temporary div

    if (cycleWidth === 0) {
      return;
    }

    this.lastMeasuredCycleWidth = cycleWidth; // Store for resize observer

    // Calculate animation duration based on speed attribute and content width
    const speed = Math.max(1, Math.min(10, parseInt(this.getAttribute('speed')) || 5));
    const duration = cycleWidth / (speed * 25); // Adjust multiplier for desired base speed

    // Dynamically update CSS keyframes for the scrolling animation
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
        // Replace existing keyframes
        styleEl.textContent = currentStyle.replace(keyframesRegex, keyframes);
      } else {
        styleEl.textContent += keyframes;
      }
    }

    // Apply the animation to the ticker content
    content.style.animation = `scroll-dynamic ${duration}s linear infinite`;
    content.style.transform = 'translateX(0)'; // Ensure initial position is correct
  }

  // Helper to get computed style values for accurate measurement
  getComputedStyleValue(prop) {
    const content = this.shadowRoot.querySelector('.ticker-content');
    return content ? getComputedStyle(content)[prop] : '';
  }

  // Updates the component's internal styles based on attributes
  updateStyles() {
    const style = this.shadowRoot.querySelector('style');
    if (style) {
      style.textContent = this.getStyles();
    }
  }

  // Generates the CSS styles for the component
  getStyles() {
    const domainColor = this.getAttribute('domain-color') || '#007bff';
    const dateColor = this.getAttribute('date-color') || '#6c757d';
    const titleColor = this.getAttribute('title-color') || '#333';
    const backgroundColor = this.getAttribute('background-color') || '#f8f9fa';
    const googleFont = this.getAttribute('google-font');
    const fontFamily = this.getAttribute('font-family') || 'Arial, sans-serif';
    const fontWeight = this.getAttribute('font-weight') || '400';
    const fontSize = this.getAttribute('font-size') || '14px';

    // Prioritize Google Font if specified, otherwise use fallback
    const finalFontFamily = googleFont ? `"${googleFont}", ${fontFamily}` : fontFamily;

    return `
      :host {
        display: block;
        width: 100%;
        overflow: hidden;
        background-color: ${backgroundColor};
        padding: 12px 0;
        box-sizing: border-box; /* Include padding in width calculation */
      }
      .ticker-container {
        white-space: nowrap;
        overflow: hidden;
        position: relative;
        min-height: 1.6em; /* Ensure minimum height even with no content */
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
        will-change: transform; /* Hint to browser for animation optimization */
        white-space: nowrap;
        transform: translateX(0);
      }
      .ticker-container:hover .ticker-content {
        animation-play-state: paused !important; /* Pause animation on hover */
      }
      .post-link {
        text-decoration: none;
        color: inherit;
        display: inline-block;
        transition: all 0.2s ease;
        padding: 0 5px; /* Add some internal padding for better clickability */
        border-radius: 4px; /* Slightly rounded corners for links */
      }
      .post-link:hover {
        transform: translateY(-1px);
        filter: brightness(1.1);
        background-color: rgba(0, 0, 0, 0.05); /* Subtle hover background */
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
      /* Responsive adjustments */
      @media (max-width: 768px) {
        :host {
          padding: 8px 0;
        }
        .ticker-content {
          font-size: calc(${fontSize.replace('px', '')} * 0.9px); /* Scale down font size */
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
      /* Accessibility: reduce motion preference */
      @media (prefers-reduced-motion: reduce) {
        .ticker-content {
          animation: none !important;
          transform: translateX(0) !important;
        }
      }
    `;
  }

  // Renders the initial structure of the web component
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
