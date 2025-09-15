/**
 * allnovel.js
 * Mangayomi / BetterNovel extension for https://allnovel.org
 *
 * - Uses runtime Client and Document (per CONTRIBUTING-JS.md)
 * - Exposes top-level functions the app expects:
 *     getFilterList, getPopular, getLatestUpdates, search, getDetail,
 *     getChapterList, getPageList
 * - Return shapes follow CONTRIBUTING doc:
 *     getPopular / search => { list: [{ url, name, link, cover?, author? }], hasNextPage }
 *     getDetail => { title, description, author, genre:[], status:int, chapters:[] }
 *     getPageList => [string | {url, headers}]
 *
 * Notes:
 * - Some selectors use fallbacks; tweak if AllNovel site changes.
 * - AllNovel appears to often use the page URL itself instead of separate numeric IDs; we work off URLs.
 */

const mangayomiSources = [
  {
    id: "allnovel",
    name: "AllNovel",
    version: "2025.09.15",
    author: "converted-by-HTML+CSS+Javascript",
    icon: "https://allnovel.org/wp-content/uploads/2020/01/cropped-favicon-32x32.png",
    site: "https://allnovel.org",
    lang: "en",
    description: "AllNovel.org — scraped via extension",
    types: ["novel"],
    hasMore: true,
  },
];

const BASE = "https://allnovel.org";

/* ----------------- Helpers ----------------- */

function toAbsolute(url) {
  if (!url) return null;
  try {
    return new URL(url, BASE).toString();
  } catch (e) {
    return url;
  }
}

function fixImageUrl(raw) {
  if (!raw) return null;
  let u = raw.trim();

  // handle protocol-less //domain/path
  if (u.startsWith("//")) u = "https:" + u;

  // relative path
  if (u.startsWith("/")) u = BASE.replace(/\/$/, "") + u;

  // remove extremely long query tokens which can break some clients
  try {
    const parsed = new URL(u);
    const q = parsed.search;
    if (q && q.length > 80) parsed.search = "";
    u = parsed.toString();
  } catch (e) {
    // ignore
  }

  return u;
}

function mapStatusToInt(statusText) {
  if (!statusText) return 5; // unknown
  const s = statusText.toLowerCase();
  if (s.includes("ongoing") || s.includes("updating") || s.includes("serial")) return 0;
  if (s.includes("complete") || s.includes("completed") || s.includes("finished")) return 1;
  if (s.includes("hiatus")) return 2;
  if (s.includes("canceled") || s.includes("cancelled")) return 3;
  if (s.includes("publishingfinished") || s.includes("publishing finished")) return 4;
  return 5; // unknown
}

function cleanText(t) {
  if (!t) return null;
  return t.replace(/\s+/g, " ").trim();
}

/* ----------------- Runtime helpers ----------------- */

/**
 * Shortcuts to runtime Client / Document
 * The environment provides `Client` and `Document` constructors (per CONTRIBUTING doc)
 */
function clientGet(url, headers = {}) {
  const client = new Client();
  return client.get(url, headers); // returns response with `.body`
}

/* ----------------- Core functions ----------------- */

/**
 * getFilterList()
 * Return an array of filter objects for UI (non-mandatory but helpful)
 */
async function getFilterList() {
  // Derived from AllNovel.lua and typical site categories
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
 * parseListFromDoc(document)
 * Generic parser used by getPopular/getLatest/search to produce list items.
 * Returns array of { url, name, link, cover?, author? }
 */
function parseListFromDoc(document) {
  const out = [];

  // Try common article/card selectors
  const candidates = [
    "article",
    ".post",
    ".novel-item",
    ".entry",
    ".post-item",
    ".list-item",
    ".novel-list li",
  ];

  for (const sel of candidates) {
    const nodes = document.select && document.select(sel);
    if (!nodes || nodes.length === 0) continue;

    for (let i = 0; i < nodes.length; i++) {
      try {
        const node = nodes[i];
        // title link
        let a = node.selectFirst && (node.selectFirst("h2 a") || node.selectFirst(".entry-title a") || node.selectFirst("a"));
        let url = a ? a.attr("href") : null;
        if (!url) {
          // sometimes href is in nested link
          const linkEl = node.selectFirst && node.selectFirst("a[href]");
          url = linkEl ? linkEl.attr("href") : null;
        }
        url = toAbsolute(url);

        // name/title
        let name = null;
        if (a) name = cleanText(a.text || a.textContent || "");
        if (!name) {
          const titleNode = node.selectFirst && (node.selectFirst("h2") || node.selectFirst(".entry-title") || node.selectFirst(".title"));
          if (titleNode) name = cleanText(titleNode.text || titleNode.textContent || "");
        }

        // cover image
        let cover = null;
        const imgEl = node.selectFirst && (node.selectFirst("img") || node.selectFirst(".thumb img"));
        if (imgEl) {
          cover = imgEl.attr
            ? imgEl.attr("data-src") || imgEl.attr("src") || imgEl.attr("data-lazy-src")
            : (imgEl.getAttribute && (imgEl.getAttribute("data-src") || imgEl.getAttribute("src")));
          cover = fixImageUrl(cover);
        }

        // author (best-effort)
        let author = null;
        const authNode = node.selectFirst && (node.selectFirst(".author") || node.selectFirst(".byline") || node.selectFirst(".entry-author"));
        if (authNode) author = cleanText(authNode.text || authNode.textContent || "");

        if (url && name) {
          out.push({
            url,
            name,
            link: url, // the CONTRIBUTING doc expects 'link' field as well
            cover,
            author,
          });
        }
      } catch (e) {
        // ignore single item parsing errors
      }
    }

    if (out.length) break; // stop after first successful candidate
  }

  // final fallback: try parsing article links globally
  if (!out.length) {
    const anchors = document.select && document.select("a[href*='/novel/'], a[href*='/book/']");
    if (anchors && anchors.length) {
      const seen = new Set();
      for (let i = 0; i < anchors.length; i++) {
        try {
          const a = anchors[i];
          const href = toAbsolute(a.attr ? a.attr("href") : a.getAttribute("href"));
          const text = cleanText(a.text || a.textContent || "");
          if (href && text && !seen.has(href)) {
            seen.add(href);
            out.push({ url: href, name: text, link: href });
          }
        } catch (e) {}
      }
    }
  }

  return out;
}

/**
 * getPopular(page)
 * Returns { list: [ {url, name, link, cover?, author? } ], hasNextPage }
 */
async function getPopular(page = 1) {
  // try endpoints known from Lua: /most-popular/, /hot/, homepage
  const candidates = [
    `${BASE}/most-popular/?paged=${page}`,
    `${BASE}/hot/?paged=${page}`,
    `${BASE}/?paged=${page}`,
  ];

  for (const url of candidates) {
    try {
      const res = await clientGet(url);
      const document = new Document(res.body);
      const list = parseListFromDoc(document);
      const hasNextPage = !!(document.selectFirst && (document.selectFirst(".nav-previous a") || document.selectFirst("a.next") || document.selectFirst(".older a")));
      if (list && list.length) return { list, hasNextPage };
    } catch (e) {
      // try next candidate
    }
  }

  // fallback: empty list
  return { list: [], hasNextPage: false };
}

/**
 * getLatestUpdates(page)
 * Returns same shape as getPopular; tries /latest/ then homepage
 */
async function getLatestUpdates(page = 1) {
  const candidates = [`${BASE}/latest/?paged=${page}`, `${BASE}/?paged=${page}`];

  for (const url of candidates) {
    try {
      const res = await clientGet(url);
      const document = new Document(res.body);
      const list = parseListFromDoc(document);
      const hasNextPage = !!(document.selectFirst && (document.selectFirst(".nav-previous a") || document.selectFirst("a.next") || document.selectFirst(".older a")));
      if (list && list.length) return { list, hasNextPage };
    } catch (e) {}
  }

  return { list: [], hasNextPage: false };
}

/**
 * search(query, page, filters)
 * - query (string)
 * - page (int)
 * - filters (object)   // optional; currently not used to build filter URLs but scaffolded
 *
 * Returns: { list: [...], hasNextPage }
 */
async function search(query = "", page = 1, filters = {}) {
  // AllNovel supports ?s= query searching
  let url = `${BASE}/?s=${encodeURIComponent(query)}&paged=${page}`;
  // If filters include a known sort/status/genre we could try building URL paths — left as simple implementation now
  try {
    const res = await clientGet(url);
    const document = new Document(res.body);
    const list = parseListFromDoc(document);

    const hasNextPage = !!(document.selectFirst && (document.selectFirst(".nav-previous a") || document.selectFirst("a.next") || document.selectFirst(".older a")));
    return { list, hasNextPage };
  } catch (e) {
    return { list: [], hasNextPage: false };
  }
}

/**
 * getDetail(novelUrl)
 * Returns:
 * {
 *   title, description, author, genre:[], status:int, chapters: [ { name, url, scanlator, dateUpload } ]
 * }
 */
async function getDetail(novelUrl) {
  const url = toAbsolute(novelUrl);
  const res = await clientGet(url);
  const document = new Document(res.body);

  // Title
  let title = null;
  const tEl = document.selectFirst && (document.selectFirst("h1.entry-title") || document.selectFirst("h1.title") || document.selectFirst(".post-title") || document.selectFirst("h1"));
  if (tEl) title = cleanText(tEl.text || tEl.textContent || "");

  // Cover
  let cover = null;
  const coverEl = document.selectFirst && (document.selectFirst(".post-thumbnail img") || document.selectFirst(".entry-media img") || document.selectFirst(".thumb img") || document.selectFirst(".wp-post-image") || document.selectFirst(".single-cover img"));
  if (coverEl) {
    cover = coverEl.attr ? (coverEl.attr("data-src") || coverEl.attr("src") || coverEl.attr("data-lazy-src")) : (coverEl.getAttribute && (coverEl.getAttribute("data-src") || coverEl.getAttribute("src")));
    cover = fixImageUrl(cover);
  }

  // Description (try entry-content / summary / post-content)
  let description = null;
  const descEl = document.selectFirst && (document.selectFirst(".entry-content") || document.selectFirst(".description") || document.selectFirst(".summary") || document.selectFirst(".post-content") || document.selectFirst("#content .post-content"));
  if (descEl) {
    // prefer first paragraph
    const p = descEl.selectFirst && (descEl.selectFirst("p") || descEl);
    description = cleanText(p ? (p.text || p.textContent || "") : (descEl.text || descEl.textContent || ""));
  }

  // Author & Status & Genres
  let author = null;
  let statusInt = 5; // unknown
  const genres = [];

  // Look for meta lists
  const metaNodes = document.select && (document.select(".post-meta li") || document.select(".meta li") || document.select(".entry-meta li") || document.select(".book-meta li") || document.select(".novel-info li"));

  if (metaNodes && metaNodes.length) {
    for (let i = 0; i < metaNodes.length; i++) {
      try {
        const li = metaNodes[i];
        const text = (li.text || li.textContent || "").toLowerCase();
        const fullText = cleanText(li.text || li.textContent || "");
        if (text.includes("author")) {
          author = fullText.replace(/author[:\s]*/i, "").trim();
        } else if (text.includes("status")) {
          // map to int
          statusInt = mapStatusToInt(fullText);
        } else if (text.includes("genre") || text.includes("category")) {
          // collect comma-separated
          const g = fullText.replace(/genre[:\s]*/i, "").trim();
          if (g) g.split(",").map((x) => x.trim()).forEach((gg) => gg && genres.push(gg));
        }
      } catch (e) {}
    }
  } else {
    // fallback author selector
    const aAuthor = document.selectFirst && (document.selectFirst("a[rel*='author']") || document.selectFirst(".author a") || document.selectFirst(".by a"));
    if (aAuthor) author = cleanText(aAuthor.text || aAuthor.textContent || "");
  }

  // Tags/genres from tag links
  const tagEls = document.select && (document.select(".tags a") || document.select(".genres a") || document.select(".post-categories a") || document.select(".cat-links a"));
  if (tagEls && tagEls.length) {
    for (let i = 0; i < tagEls.length; i++) {
      const t = cleanText(tagEls[i].text || tagEls[i].textContent || "");
      if (t) genres.push(t);
    }
  }

  // Chapters extraction (many variants)
  const chapters = [];
  const chapterCandidates = [
    ".chapter-list a",
    ".chapters a",
    ".toc a",
    ".chapter a",
    ".post-content a[href*='chapter']",
    ".entry-content a[href*='chapter']",
    ".entry-content a.chapter",
    ".table-of-content a",
  ];

  let foundChapters = false;
  for (const sel of chapterCandidates) {
    const els = document.select && document.select(sel);
    if (!els || !els.length) continue;
    for (let i = 0; i < els.length; i++) {
      try {
        const a = els[i];
        const href = toAbsolute(a.attr ? a.attr("href") : a.getAttribute("href"));
        const name = cleanText(a.text || a.textContent || "");
        if (href && name) {
          chapters.push({ name, url: href, scanlator: null, dateUpload: null });
        }
      } catch (e) {}
    }
    if (chapters.length) {
      foundChapters = true;
      break;
    }
  }

  // Fallback: there might be a "Table of Contents" link to a separate page
  if (!foundChapters) {
    const tocLink = (document.select && Array.from(document.select("a")).find((a) => {
      const txt = (a.text || a.textContent || "").toLowerCase();
      return txt.includes("table of contents") || txt.includes("chapters") || txt.includes("view all");
    }));
    if (tocLink) {
      try {
        const tocUrl = toAbsolute(tocLink.attr ? tocLink.attr("href") : tocLink.getAttribute("href"));
        if (tocUrl) {
          const tocRes = await clientGet(tocUrl);
          const tocDoc = new Document(tocRes.body);
          const tocEls = tocDoc.select && (tocDoc.select("a[href*='chapter'], .chapter-list a, .chapters a") || []);
          for (let i = 0; i < tocEls.length; i++) {
            const a = tocEls[i];
            const href = toAbsolute(a.attr ? a.attr("href") : a.getAttribute("href"));
            const name = cleanText(a.text || a.textContent || "");
            if (href && name) chapters.push({ name, url: href, scanlator: null, dateUpload: null });
          }
        }
      } catch (e) {}
    }
  }

  // If still no chapters, use the page itself as a single-chapter novel
  if (!chapters.length) {
    chapters.push({ name: "Chapter (single page)", url, scanlator: null, dateUpload: null });
  }

  return {
    title: title || "",
    url,
    cover,
    description: description || "",
    author: author || "",
    genre: genres,
    status: statusInt,
    chapters,
  };
}

/**
 * getChapterList(novelUrl)
 * Returns array of chapters (same as detail.chapters)
 */
async function getChapterList(novelUrl) {
  const detail = await getDetail(novelUrl);
  return detail.chapters || [];
}

/**
 * getPageList(chapterUrl)
 * For a given chapter page, returns an array of image URLs (or objects with {url, headers})
 * This function extracts images inside the chapter content container.
 */
async function getPageList(chapterUrl) {
  const url = toAbsolute(chapterUrl);
  const res = await clientGet(url);
  const document = new Document(res.body);

  const contentSelectors = [
    ".chapter-content",
    ".entry-content",
    ".post-content",
    ".single-post .content",
    ".reading-content",
    "#content",
    ".novel-body",
    ".post-body",
  ];

  let contentNode = null;
  for (const sel of contentSelectors) {
    const node = document.selectFirst && document.selectFirst(sel);
    if (node && (node.text || node.textContent || "").trim().length > 0) {
      contentNode = node;
      break;
    }
  }

  // If no specific content node, use the main article
  if (!contentNode) contentNode = document.selectFirst && (document.selectFirst("article") || document.selectFirst(".post"));

  const pages = [];
  if (contentNode) {
    // select images inside content node
    const imgs = contentNode.select && (contentNode.select("img") || []);
    if (imgs && imgs.length) {
      for (let i = 0; i < imgs.length; i++) {
        try {
          const img = imgs[i];
          let src = img.attr ? (img.attr("data-src") || img.attr("src") || img.attr("data-lazy-src")) : (img.getAttribute && (img.getAttribute("data-src") || img.getAttribute("src")));
          src = toAbsolute(src);
          src = fixImageUrl(src);
          if (src) pages.push(src);
        } catch (e) {}
      }
    } else {
      // fallback: try to parse paragraphs as text-based chapters and return them as HTML strings wrapped in data URLs
      const paragraphs = contentNode.select && contentNode.select("p");
      if (paragraphs && paragraphs.length) {
        // Return as data URLs (html) — app supports strings (image urls) or objects; many apps accept HTML chunk too.
        for (let i = 0; i < paragraphs.length; i++) {
          const html = `<p>${(paragraphs[i].text || paragraphs[i].textContent || "").trim()}</p>`;
          pages.push(`data:text/html,${encodeURIComponent(html)}`);
        }
      }
    }
  }

  return pages;
}

/* ----------------- Exports ----------------- */

// The CONTRIBUTING doc expects top-level functions; mangayomi also expects the source metadata
// Exporting mangayomiSources for the app to register the source.
export {
  mangayomiSources,
  getFilterList,
  getPopular,
  getLatestUpdates,
  search,
  getDetail,
  getChapterList,
  getPageList,
};
