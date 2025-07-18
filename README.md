# RSS Ticker Component

A web component that displays RSS feeds as a scrolling ticker.

## Features

- Seamless infinite scrolling with no gaps
- Intuitive speed control (1-10 scale)
- Hover to pause functionality
- Clickable articles that open in new tabs
- Fully customizable styling (colors, fonts, spacing)
- Smart font hierarchy (titles larger, dates/domains smaller)
- Edge-to-edge display with no margins
- CORS proxy support for accessing RSS feeds
- Responsive design with mobile optimizations
- Multiple feed formats (RSS 2.0, Atom)
- Google Fonts integration
- Accessibility friendly with reduced motion support

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

### News Ticker

```html
<rss-ticker 
    rss-url="https://feeds.reuters.com/reuters/topNews"
    speed="8"
    separator="•"
    font-size="14px"
    font-weight="normal"
    domain-color="red"
    background-color="white"
    max-posts="20">
</rss-ticker>
```

## Features

- Smooth infinite scrolling
- Hover to pause
- Clickable article links
- Works with most RSS/Atom feeds
- Mobile responsive