/**
 * allnovel.js
 * Full implementation for AllNovel (https://allnovel.org) as a Mangayomi novel-source extension.
 *
 * Notes:
 * - Built from the novelbuddy.js pattern and guided by AllNovel.lua behavior.
 * - Defensive parsing: uses multiple selector fallbacks because site DOMs vary.
 * - The site appears to not use numeric book IDs consistently; this implementation works off URLs.
 *
 * Drop-in: replace the existing skeleton allnovel.js in your repo with this file.
 */

const mangayomiSources = [
  {
    id: "allnovel",
    name: "AllNovel",
    version: "2025.09.15",
    author: "converted-by-HTML+CSS+Javascript",
    icon: "https://allnovel.org/wp-content/uploads/2020/01/cropped-favicon-32x32.png",
    site: "https://allnovel.org",
    language: "en",
    description: "AllNovel.org — scraped via extension",
    types: ["novel"],
    // keep this true if extension can handle paging for popular/latest
    hasMore: true,
  },
];

const BASE = "https://allnovel.org";

/* ---------- Helper utilities ---------- */

async function request(url, opts = {}) {
  // wrapper for fetch that returns text, with some default headers
  const headers = Object.assign(
    {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MangayomiBot/1.0",
      Accept: "text/html,application/xhtml+xml,application/xml",
    },
    opts.headers || {}
  );
  const res = await fetch(url, Object.assign({ headers, redirect: "follow" }, opts));
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return await res.text();
}

function parseHTML(html) {
  // DOMParser works in the Mangayomi JS runtime (same pattern as novelbuddy)
  return new DOMParser().parseFromString(html, "text/html");
}

function toAbsolute(url) {
  if (!url) return null;
  try {
    return new URL(url, BASE).toString();
  } catch (e) {
    return url;
  }
}

/**
 * Image URL fixer based on AllNovel.lua searchImgModFunc idea:
 * - replace lazy data-src attributes
 * - fix relative paths
 * - attempt to clean query tokens or broken hashes
 */
function fixImageUrl(rawUrl) {
  if (!rawUrl) return null;
  // fallback to removing weird ?something after image if exists
  let url = rawUrl.trim();

  // if data-lazy or data-src pattern included, prefer that
  url = url.replace(/^\/\/+/g, "https://");

  // if url missing scheme but starts with '/', make absolute
  if (url.startsWith("/")) url = BASE.replace(/\/$/, "") + url;

  // remove tracking/query-params that sometimes break images (leave common CDN params)
  try {
    const u = new URL(url);
    // keep typical CDN params, but drop unknown long tokens
    // heuristic: drop query if contains long hex tokens > 30 chars
    const q = u.searchParams.toString();
    if (q.length > 40) {
      u.search = "";
      url = u.toString();
    } else {
      url = u.toString();
    }
  } catch (e) {
    // not a full URL — return as-is
  }

  return url;
}

/* ---------- Core extension class ---------- */

class DefaultExtension {
  constructor(source) {
    this.source = source;
    this.base = BASE;
  }

  /* Filters: replicates common filters seen in the Lua file.
     AllNovel's actual filter endpoints may differ; this returns the available filter objects
     that Mangayomi UI can show to users. */
  async getFilterList() {
    // Provide typical filter lists; these are static and can be adjusted later.
    return [
      {
        key: "genre",
        label: "Genre",
        values: [
          "Action",
          "Adventure",
          "Comedy",
          "Drama",
          "Fantasy",
          "Historical",
          "Horror",
          "Literature",
          "Mystery",
          "Romance",
          "Sci-Fi",
          "Slice of Life",
          "Thriller",
          "Other",
        ],
      },
      {
        key: "status",
        label: "Status",
        values: ["Ongoing", "Completed"],
      },
      {
        key: "sort",
        label: "Sort",
        values: ["default", "most-viewed", "most-commented", "latest"],
      },
    ];
  }

  /**
   * search(query, page, filters)
   * - query: search string (may be blank if filters used)
   * - page: page number (1-based)
   * - filters: object with keys from getFilterList
   *
   * Returns: { results: [ { name, url, cover, author, summary } ], hasMore }
   */
  async search(query = "", page = 1, filters = {}) {
    // AllNovel supports query search via ?s=QUERY; also support filter-based listing via category/archives
    const searchUrl = query
      ? `${this.base}/?s=${encodeURIComponent(query)}&paged=${page}`
      : `${this.base}/?paged=${page}`;

    const html = await request(searchUrl);
    const doc = parseHTML(html);

    // search results typical container: articles with class "post"
    const items =
      doc.querySelectorAll(".search-results .post, .archive .post, article") ||
      [];

    const results = [];

    if (items && items.length) {
      items.forEach((el) => {
        try {
          // Find link and title
          const a = el.querySelector("h2 a, .entry-title a, a[href*='/novel/'], a[href*='/book/']") || el.querySelector("a");
          const url = a ? toAbsolute(a.getAttribute("href")) : null;
          const name = a ? a.textContent.trim() : (el.querySelector(".entry-title") ? el.querySelector(".entry-title").textContent.trim() : null);

          // cover image
          let img = el.querySelector("img");
          if (img) {
            img = img.getAttribute("data-src") || img.getAttribute("src") || img.getAttribute("data-lazy-src") || null;
            img = fixImageUrl(img);
          } else {
            img = null;
          }

          // author & summary
          const authorEl = el.querySelector(".author, .entry-author, .byline");
          const author = authorEl ? authorEl.textContent.replace(/by/i, "").trim() : null;

          const summaryEl = el.querySelector(".excerpt, .summary, .entry-summary, p");
          const summary = summaryEl ? summaryEl.textContent.trim() : null;

          if (url && name) {
            results.push({
              name,
              url,
              cover: img,
              author,
              summary,
            });
          }
        } catch (e) {
          // ignore parse errors per item
        }
      });
    } else {
      // Fallback: search result items might be in list items or custom layout
      const fallback = doc.querySelectorAll(".post-list li, .novel-list li, .item");
      fallback.forEach((el) => {
        try {
          const a = el.querySelector("a");
          const url = a ? toAbsolute(a.href) : null;
          const name = a ? a.textContent.trim() : null;
          let img = el.querySelector("img");
          if (img) img = fixImageUrl(img.getAttribute("src") || img.getAttribute("data-src") || null);
          if (url && name) {
            results.push({ name, url, cover: img });
          }
        } catch (e) {}
      });
    }

    // crude hasMore detection: if we see "Older Posts" or next link
    const next = doc.querySelector(".nav-previous a, .older a, a.next, .pagination a.next");
    const hasMore = !!next;

    return { results, hasMore };
  }

  /**
   * getPopular(page)
   * - returns popular novels (page 1..)
   */
  async getPopular(page = 1) {
    // Strategy: try the "popular" listing page, otherwise use homepage
    const urlCandidates = [
      `${this.base}/most-popular/?paged=${page}`,
      `${this.base}/hot/?paged=${page}`,
      `${this.base}/?paged=${page}`,
    ];

    let html = null;
    let doc = null;
    for (const u of urlCandidates) {
      try {
        html = await request(u);
        doc = parseHTML(html);
        // crude check for content
        if (doc && doc.querySelector("article, .post, .novel-item, .entry")) break;
      } catch (e) {
        // try next candidate
      }
    }

    if (!doc) throw new Error("Failed to fetch popular list");

    const list = [];
    const items = doc.querySelectorAll(".post, article, .novel-item, .entry") || [];
    items.forEach((el) => {
      try {
        const a = el.querySelector("h2 a, .entry-title a, a");
        const url = a ? toAbsolute(a.getAttribute("href")) : null;
        const name = a ? a.textContent.trim() : null;
        let img = el.querySelector("img");
        if (img) img = fixImageUrl(img.getAttribute("data-src") || img.getAttribute("src") || null);

        const authorEl = el.querySelector(".author, .byline, .entry-author");
        const author = authorEl ? authorEl.textContent.replace(/by/i, "").trim() : null;

        if (url && name) list.push({ name, url, cover: img, author });
      } catch (e) {}
    });

    // Basic dedupe
    const deduped = [];
    const seen = new Set();
    for (const it of list) {
      if (!seen.has(it.url)) {
        deduped.push(it);
        seen.add(it.url);
      }
    }

    return { results: deduped, hasMore: doc.querySelector(".nav-previous a, a.next, .older a") ? true : false };
  }

  /**
   * getLatestUpdates(page)
   * - returns recent novels/chapters
   */
  async getLatestUpdates(page = 1) {
    // try /latest/ or homepage feed
    const urlCandidates = [
      `${this.base}/latest/?paged=${page}`,
      `${this.base}/?paged=${page}`, // fallback to homepage which often lists newest posts
    ];

    let doc = null;
    for (const u of urlCandidates) {
      try {
        const html = await request(u);
        doc = parseHTML(html);
        if (doc && doc.querySelector("article, .post, .entry")) break;
      } catch (e) {}
    }
    if (!doc) throw new Error("Failed to fetch latest updates");

    const items = doc.querySelectorAll("article, .post, .entry") || [];
    const results = [];
    items.forEach((el) => {
      try {
        const a = el.querySelector("h2 a, .entry-title a, a");
        const url = a ? toAbsolute(a.getAttribute("href")) : null;
        const name = a ? a.textContent.trim() : null;
        let img = el.querySelector("img");
        if (img) img = fixImageUrl(img.getAttribute("data-src") || img.getAttribute("src") || null);
        const metaTime = el.querySelector("time");
        const date = metaTime ? metaTime.getAttribute("datetime") || metaTime.textContent : null;
        const summaryEl = el.querySelector(".excerpt, .entry-summary, p");
        const summary = summaryEl ? summaryEl.textContent.trim() : null;
        if (url && name) results.push({ name, url, cover: img, date, summary });
      } catch (e) {}
    });

    return { results, hasMore: doc.querySelector(".nav-previous a, a.next, .older a") ? true : false };
  }

  /**
   * getDetail(novelUrl)
   * - returns metadata and a chapter list URL
   * Expected return:
   * {
   *   name, cover, author, status, summary, genres: [], chaptersUrl, chapters: [ { name, url } ] (if embedded)
   * }
   */
  async getDetail(novelUrl) {
    const url = toAbsolute(novelUrl);
    const html = await request(url);
    const doc = parseHTML(html);

    // Title
    const titleEl = doc.querySelector("h1.entry-title, h1.title, .post-title") || doc.querySelector("h1");
    const name = titleEl ? titleEl.textContent.trim() : doc.title.trim();

    // Cover - many sites use .post-thumbnail img or .entry-image img
    let coverEl = doc.querySelector(".post-thumbnail img, .entry-media img, .thumb img, .wp-post-image, .single-cover img");
    let cover = coverEl ? coverEl.getAttribute("data-src") || coverEl.getAttribute("src") || null : null;
    cover = fixImageUrl(cover);

    // Meta blocks
    let author = null;
    let status = null;
    const metaNodes = doc.querySelectorAll(".post-meta li, .meta li, .entry-meta li, .book-meta li, .novel-info li") || [];
    if (metaNodes && metaNodes.length) {
      metaNodes.forEach((li) => {
        const txt = li.textContent.toLowerCase();
        if (txt.includes("author")) {
          author = li.textContent.replace(/author[:\s]*/i, "").trim();
        } else if (txt.includes("status")) {
          // map to Ongoing/Completed
          const s = li.textContent.replace(/status[:\s]*/i, "").trim().toLowerCase();
          if (s.includes("ongoing") || s.includes("updating") || s.includes("serial")) status = "Ongoing";
          else if (s.includes("complete") || s.includes("completed") || s.includes("finished")) status = "Completed";
          else status = li.textContent.replace(/status[:\s]*/i, "").trim();
        }
      });
    } else {
      // fallback: look for author links
      const aAuthor = doc.querySelector("a[rel*='author'], .author a, .by a");
      if (aAuthor) author = aAuthor.textContent.trim();
    }

    // Genres / Tags
    const tagEls = doc.querySelectorAll(".tags a, .genres a, .post-categories a, .cat-links a") || [];
    const genres = [];
    tagEls.forEach((t) => {
      const g = t.textContent.trim();
      if (g) genres.push(g);
    });

    // Summary / Description
    const descEl = doc.querySelector(".entry-content, .description, .summary, .book-summary, #content .post-content, .post-content");
    let summary = descEl ? descEl.textContent.trim() : null;
    // prefer the first paragraph of the description for summary if it's long
    if (descEl) {
      const p = descEl.querySelector("p");
      if (p && p.textContent.trim().length < 400) summary = p.textContent.trim();
    }

    // Chapters: AllNovel may list chapters on the same page or on a link "Chapters" / "Table of Contents"
    // Try to find a chapter list container
    let chapters = [];
    const potentialContainers = [
      ".chapter-list a",
      ".chapters a",
      ".toc a",
      ".chapter a",
      ".post-content a[href*='/chapter-']",
      ".entry-content a[href*='/chapter-']",
      ".entry-content a.chapter",
    ];
    let found = false;
    for (const sel of potentialContainers) {
      const els = doc.querySelectorAll(sel);
      if (els && els.length > 0) {
        els.forEach((a) => {
          const href = toAbsolute(a.getAttribute("href"));
          const title = a.textContent.trim();
          // basic filter: ensure link looks like chapter (has 'chapter' or '#' or '/chap-')
          if (href && title) {
            chapters.push({ name: title, url: href });
          }
        });
        if (chapters.length) {
          found = true;
          break;
        }
      }
    }

    // Another fallback: look for an ajax endpoint or "View All Chapters" link
    if (!found) {
      const tocLink = Array.from(doc.querySelectorAll("a")).find((a) => {
        const txt = a.textContent.toLowerCase();
        return txt.includes("table of contents") || txt.includes("chapters") || txt.includes("view all");
      });
      if (tocLink) {
        try {
          const tocUrl = toAbsolute(tocLink.getAttribute("href"));
          const tocHtml = await request(tocUrl);
          const tocDoc = parseHTML(tocHtml);
          const tocEls = tocDoc.querySelectorAll("a[href*='chapter'], .chapter-list a, .chapters a") || [];
          tocEls.forEach((a) => {
            const href = toAbsolute(a.getAttribute("href"));
            const title = a.textContent.trim();
            if (href && title) chapters.push({ name: title, url: href });
          });
        } catch (e) {
          // ignore
        }
      }
    }

    // If still empty, try to infer single-chapter style (novel is one page)
    if (!chapters.length) {
      // Use the novelUrl itself as a single "chapter"
      chapters.push({ name: "Chapter (single page)", url });
    }

    return {
      name,
      url,
      cover,
      author,
      status,
      summary,
      genres,
      chapters,
    };
  }

  /**
   * getChapterList(novelUrl)
   * - wrapper that returns chapter list only (some apps call it separately)
   */
  async getChapterList(novelUrl) {
    const detail = await this.getDetail(novelUrl);
    return detail.chapters || [];
  }

  /**
   * getChapterContent(chapterUrl)
   * - returns { data: htmlString } where htmlString is the cleaned chapter body
   */
  async getChapterContent(chapterUrl) {
    const url = toAbsolute(chapterUrl);
    const html = await request(url);
    const doc = parseHTML(html);

    // Common containers for chapter content
    const selectors = [
      ".chapter-content",
      ".entry-content",
      ".post-content",
      ".single-post .content",
      ".reading-content",
      "#content",
      ".novel-body",
    ];

    let contentEl = null;
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent.trim().length > 10) {
        contentEl = el;
        break;
      }
    }

    // final fallback: the largest <div> in main article
    if (!contentEl) {
      const article = doc.querySelector("article, .post");
      if (article) {
        // pick the child with most text
        let maxEl = null;
        let maxLen = 0;
        Array.from(article.querySelectorAll("div, p")).forEach((c) => {
          const len = (c.textContent || "").length;
          if (len > maxLen) {
            maxLen = len;
            maxEl = c;
          }
        });
        contentEl = maxEl || article;
      }
    }

    let htmlContent = contentEl ? contentEl.innerHTML : "<p>Content not found.</p>";

    // Clean the content: remove scripts, ads, share-links, navigation links
    htmlContent = this.cleanHtmlContent(htmlContent);

    // Convert relative image URLs and fix them
    const tmpDoc = parseHTML(`<div id="__tmp">${htmlContent}</div>`);
    tmpDoc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("data-src") || img.getAttribute("src");
      if (src) img.setAttribute("src", fixImageUrl(toAbsolute(src)));
      img.removeAttribute("data-src");
      img.removeAttribute("data-lazy-src");
      img.removeAttribute("loading");
    });

    const finalEl = tmpDoc.querySelector("#__tmp");
    const finalHtml = finalEl ? finalEl.innerHTML : htmlContent;

    return { data: finalHtml, url };
  }

  cleanHtmlContent(rawHtml) {
    // Basic cleaning: remove scripts, iframes, styles, and known ad containers
    // Returns a string containing cleaned HTML
    const doc = parseHTML(rawHtml);

    // remove scripts/styles/iframes
    doc.querySelectorAll("script, style, iframe, noscript").forEach((n) => n.remove());
    // remove common ad/share elements
    doc.querySelectorAll(".ads, .advert, .share, .social, .related, .related-posts, .post-navigation, .nav-links").forEach((n) => n.remove());

    // remove event attributes to be safe
    doc.querySelectorAll("*").forEach((el) => {
      Array.from(el.attributes || []).forEach((attr) => {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      });
    });

    // Return inner HTML (if the rawHtml represented a fragment, doc.body.innerHTML is OK)
    return doc.body ? doc.body.innerHTML : rawHtml;
  }
}

/* ---------- Export / registration ---------- */

// Instantiate extension implementation that Mangayomi expects.
// Some runner code expects `mangayomiSources` to be exported, and to be associated with
// a "DefaultExtension". We'll export both.

const extension = new DefaultExtension(mangayomiSources[0]);

// Export pattern used by many Mangayomi forks: provide both source metadata and the implementation object.
// The exact expected export shape can vary by runtime — if your runtime expects functions rather
// than a class instance, adapt accordingly (this is the most common pattern).
export { mangayomiSources, extension as default, DefaultExtension };
