# AuctionComps

Filter completed Bring a Trailer auctions by mileage, price, model year, transmission, body, color, country and more, for any model. BaT's own results page has none of these filters.

Search for a model, or paste a model page URL like `https://bringatrailer.com/porsche/996-gt3/`. You can add several models to compare them. Umbrella pages such as `/mazda/miata/` expand into their generations automatically.

## How it works

It's a static site with no backend. Each visitor's browser calls Bring a Trailer's public JSON API directly; that API allows cross-origin requests.

| Endpoint | Used for |
|---|---|
| `/wp-json/bringatrailer/1.0/data/autocomplete?term=…` | Model search, and turning a pasted URL into its model id |
| `/wp-json/bringatrailer/1.0/data/listings-filter?base_filter[keyword_pages][]=<id>&per_page=60&page=N&get_items=1` | Completed auctions, 60 per request |

- Results are cached in the visitor's `localStorage` for 12 hours. **Refresh from BaT** forces a reload.
- Requests are spaced 0.5 s apart, and the loader backs off when BaT throttles.
- Sharing a link (`?m=bmw/e46-m3,bmw/e92-m3`) reopens the same models.

`core.js` holds the API calls and parsing and has no DOM code, so it runs in Node too. `index.html` holds the interface.

## What's parsed, and its limits

The API gives title, price, sold/unsold, end date, thumbnail, no-reserve flag, country, and a description excerpt of about 400 characters. These fields are read from the title and excerpt:

- **Mileage:** from "29k-Mile" in the title, otherwise the largest "N miles" figure in the excerpt. Coverage is around 50–60% of cars. Exact mileage is only on the listing page, which browsers can't read cross-origin.
- **Transmission, body, color, interior, "modified":** keyword heuristics. These are sometimes wrong or missing, especially when the excerpt is cut off before it mentions them.

## Run locally

```sh
python3 -m http.server 8765
# open http://127.0.0.1:8765
```

## Host it

Upload the folder as-is to any static host: GitHub Pages, Netlify (drag and drop), or Cloudflare Pages. There's no build step.

## Terms

Bring a Trailer's Terms of Use prohibit automated aggregation and derivative works of its content. This project stores and serves no BaT data, and every listing links back to BaT, but it isn't endorsed by them. Read their terms, and consider asking them before promoting the site widely.
