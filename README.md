# RSS Ticker Component

A web component that displays RSS feeds as a scrolling ticker.

 ![rss ticker example](rss-ticker.gif)

## Features

- Seamless infinite scrolling with no gaps
- Intuitive speed control (1-10 scale)
- Hover to pause functionality
- Clickable articles that open in new tabs
- Fully customizable styling (colors, fonts, separator)
- Smart font hierarchy (titles larger, dates/domains smaller (80%))
- Edge-to-edge display with no margins
- Multi-proxy CORS support with automatic failover
- Intelligent caching system (30-minute localStorage cache)
- Smart retry logic with parallel service racing
- Debounced loading prevents redundant network requests
- Responsive design with mobile optimizations
- Multiple feed formats (RSS 2.0, RSS 1.0/RDF, Atom)
- Google Fonts integration
- Accessibility friendly with reduced motion support
- Dynamic animation optimization for smooth performance

## Reliability Features

The component uses a sophisticated multi-proxy architecture to ensure maximum RSS feed loading reliability:

- **Parallel Service Racing**: Attempts to load from multiple CORS proxy services simultaneously
- **Automatic Retries**: Each service retries failed attempts with exponential backoff
- **Sequential Fallback**: If parallel attempts fail, tries services one by one as backup
- **Smart Caching**: Successful responses are cached for 30 minutes to reduce server load
- **Graceful Error Handling**: Displays user-friendly error messages when all services fail

### Supported Proxy Services

- AllOrigins (with base64 decoding support)
- CodeTabs Proxy (fast RSS processing)
- RSS2JSON (JSON conversion service)

## Feed Format Support

The component automatically detects and parses multiple RSS/Atom feed formats:

- **RSS 2.0**: Standard RSS feeds (`<rss><channel><item>`)
- **RSS 1.0/RDF**: Resource Description Framework feeds (`<item>`)
- **Atom**: Modern XML web feeds (`<entry>`)
- **Custom JSON**: Via RSS2JSON service conversion

## Usage

Import the web component in your HTML head section:

```html
<script src="https://raw.githack.com/DevManSam777/rss-ticker/main/rss-ticker.js"></script>

```

Add the web component in your HTML body where you would like it to be displayed
```html
<rss-ticker rss-url="https://your-blog.com/rss.xml"></rss-ticker>
```

## Attributes

| Attribute | Description | Default | Example |
|-----------|-------------|---------|---------|
| `rss-url` | RSS feed URL (required) | - | `"https://example.com/rss.xml"` |
| `speed` | Animation speed 1-10 (higher = faster) | `5` | `"7"` |
| `separator` | Character between posts | `"\|"` | `"\|"`, `"•"`, `"·"`, `"—"` |
| `max-posts` | Maximum posts to show (optional) | All posts | `"15"`, `"25"` |
| `font-size` | Title text size (domain/date are smaller) | `"14px"` | `"18px"`, `"1.2rem"`, `"16pt"`, `"120%"` |
| `font-family` | Font family | `"Arial, sans-serif"` | `"Georgia, serif"` |
| `font-weight` | Font weight | `"400"` | `"600"`, `"bold"`, `"normal"`, `"lighter"` |
| `google-font` | Google Font name | - | `"Inter"` |
| `domain-color` | Domain text color | `"#007bff"` | `"#ff6600"`, `"rgb(255, 102, 0)"`, `"orange"` |
| `date-color` | Date text color | `"#6c757d"` | `"#888"`, `"rgba(0, 0, 0, 0.5)"`, `"gray"` |
| `title-color` | Title text color | `"#333"` | `"#000"`, `"hsl(0, 0%, 20%)"`, `"black"` |
| `background-color` | Background color | `"#f8f9fa"` | `"#ffffff"`, `"rgb(240, 240, 240)"`, `"white"` |

## Font Sizing

The `font-size` attribute controls the size of article titles and separators. Domain names and dates are automatically sized at 85% of the title size for better visual hierarchy.

## Examples

### Basic

```html
<rss-ticker rss-url="https://blog.example.com/rss.xml" speed="6"></rss-ticker>
```

### Styled

```html
<rss-ticker 
    rss-url="https://blog.example.com/rss.xml"
    speed="7"
    separator="•"
    font-size="1.2rem"
    font-weight="bold"
    google-font="Inter"
    domain-color="rgb(255, 102, 0)"
    date-color="rgba(0, 0, 0, 0.6)"
    title-color="hsl(0, 0%, 20%)"
    background-color="white">
</rss-ticker>
```

## Performance Optimizations

- **Smart Loading**: Prevents unnecessary network requests when settings change
- **Smooth Animations**: Automatically adjusts animation speed based on content length
- **Responsive Updates**: Efficiently handles window resizing without lag
- **Browser Optimization**: Uses modern web standards for smooth scrolling performance

## Accessibility

- **Reduced Motion**: Automatically respects `prefers-reduced-motion` user setting
- **Semantic HTML**: Proper link structure with `rel="noopener"` for security
- **Keyboard Navigation**: Full keyboard accessibility support
- **Color Contrast**: Default colors meet accessibility guidelines
- **Mobile Responsive**: Touch-friendly interactions and optimized spacing

## Caching Behavior

The component implements intelligent caching to improve performance:

- **Cache Duration**: 30 minutes for successful RSS feed responses
- **Cache Key**: Base64 encoded RSS URL for safe localStorage keys
- **Automatic Cleanup**: Expired and corrupted cache entries are automatically removed
- **Cache Bypass**: Failed requests do not override valid cached data

## Error Handling

- **Service Status**: Detailed error messages show which proxy services failed
- **Fallback Messages**: User-friendly error display when all services are unavailable
- **Console Logging**: Comprehensive debugging information for developers
- **Graceful Degradation**: Component remains functional even with feed loading failures

## Features

- Smooth infinite scrolling
- Hover to pause
- Clickable article links
- Customizable attributes
- Works with most RSS/Atom feeds
- Mobile responsive

## License
[LICENSE](LICENSE)  

Copyright (c) 2025 DevManSam