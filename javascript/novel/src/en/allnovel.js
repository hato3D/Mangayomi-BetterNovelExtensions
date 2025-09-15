const mangayomiSources = [{
  "name": "AllNovel",
  "lang": "en",
  "baseUrl": "https://allnovel.org",
  "apiUrl": "",
  "iconUrl":
    "https://github.com/hato3D/Mangayomi-BetterNovelExtensions/blob/main/images/AllNovel.png",
  "typeSource": "single",
  "itemType": 2, // Use 0 for manga, 1 for anime and 2 for novel
  "version": "1.0.0",
  "dateFormat": "",
  "dateFormatLocale": "",
  "pkgPath": "novel/src/en/allnovel.js",
  "hasCloudflare": false
}];

class DefaultExtension extends MProvider {
  getHeaders(url) {
      throw new Error("getHeaders not implemented");
  }
  async getPopular(page) {
      throw new Error("getPopular not implemented");
  }
  async getLatestUpdates(page) {
      throw new Error("getLatestUpdates not implemented");
  }
  async search(query, page, filters) {
      throw new Error("search not implemented");
  }
  async getDetail(url) {
      throw new Error("getDetail not implemented");
  }
  // For novel html content
  async getHtmlContent(url) {
      throw new Error("getHtmlContent not implemented");
  }
  // Clean html up for reader
  async cleanHtmlContent(html) {
      throw new Error("cleanHtmlContent not implemented");
  }
  // For anime episode video list
  async getVideoList(url) {
      throw new Error("getVideoList not implemented");
  }
  // For manga chapter pages
  async getPageList(url) {
      throw new Error("getPageList not implemented");
  }
  getFilterList() {
      throw new Error("getFilterList not implemented");
  }
  getSourcePreferences() {
      throw new Error("getSourcePreferences not implemented");
  }
}
