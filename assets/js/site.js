(function () {
  "use strict";

  const article = document.getElementById("article");
  const toc = document.getElementById("toc");
  const glossary = document.getElementById("glossary");
  const sidebar = document.getElementById("reading-sidebar");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const storageKey = "outsiders.sidebar-collapsed";

  function setSidebarCollapsed(collapsed, persist) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    sidebarToggle.textContent = collapsed ? "顯示側欄" : "收合側欄";
    sidebar.setAttribute("aria-hidden", String(collapsed));

    if (persist) {
      try {
        window.localStorage.setItem(storageKey, String(collapsed));
      } catch (error) {
        // localStorage may be unavailable in private browsing contexts.
      }
    }
  }

  function initialSidebarState() {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored !== null) {
        return stored === "true";
      }
    } catch (error) {
      // Fall back to the responsive default.
    }

    return window.matchMedia("(max-width: 800px)").matches;
  }

  function makeHeadingId(heading, index, usedIds) {
    if (heading.id) {
      usedIds.add(heading.id);
      return heading.id;
    }

    const normalized = heading.textContent
      .trim()
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    const base = normalized || `section-${index + 1}`;
    let id = base;
    let suffix = 2;

    while (usedIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }

    heading.id = id;
    usedIds.add(id);
    return id;
  }

  function buildTableOfContents() {
    if (!article || !toc) {
      return;
    }

    const headings = Array.from(article.querySelectorAll("h2, h3, h4"));
    const usedIds = new Set(
      Array.from(document.querySelectorAll("[id]")).map((element) => element.id),
    );
    const list = document.createElement("ol");
    list.className = "toc-list";

    headings.forEach((heading, index) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      item.dataset.level = heading.tagName.slice(1);
      link.href = `#${makeHeadingId(heading, index, usedIds)}`;
      link.textContent = heading.textContent.trim();
      item.appendChild(link);
      list.appendChild(item);
    });

    toc.replaceChildren(list);
  }

  function buildGlossary() {
    if (!article || !glossary) {
      return;
    }

    const entries = new Map();
    article.querySelectorAll(".abbr-term").forEach((term) => {
      const key = term.dataset.key;
      if (!key || entries.has(key)) {
        return;
      }

      entries.set(key, {
        chinese: term.dataset.zh || "",
        english: term.dataset.en || "",
      });
    });

    if (entries.size === 0) {
      return;
    }

    const list = document.createElement("dl");
    list.className = "glossary-list";
    entries.forEach((entry, key) => {
      const name = document.createElement("dt");
      const meaning = document.createElement("dd");
      name.textContent = key;
      meaning.textContent = [entry.chinese, entry.english]
        .filter(Boolean)
        .join(" / ");
      list.append(name, meaning);
    });
    glossary.replaceChildren(list);
  }

  sidebarToggle.addEventListener("click", function () {
    const collapsed = document.body.classList.contains("sidebar-collapsed");
    setSidebarCollapsed(!collapsed, true);
  });

  setSidebarCollapsed(initialSidebarState(), false);
  buildTableOfContents();
  buildGlossary();
})();
