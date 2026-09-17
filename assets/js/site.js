(function () {
  "use strict";

  const article = document.getElementById("article");
  const toc = document.getElementById("toc");
  const glossary = document.getElementById("glossary");
  const sidebars = [
    {
      name: "目錄",
      sidebar: document.getElementById("toc-sidebar"),
      content: document.getElementById("toc-sidebar-content"),
      toggle: document.getElementById("toc-toggle"),
      storageKey: "outsiders.toc-collapsed",
    },
    {
      name: "縮寫",
      sidebar: document.getElementById("glossary-sidebar"),
      content: document.getElementById("glossary-sidebar-content"),
      toggle: document.getElementById("glossary-toggle"),
      storageKey: "outsiders.glossary-collapsed",
    },
  ];

  function responsiveStorageKey(config) {
    const viewport = window.matchMedia("(max-width: 800px)").matches
      ? "mobile"
      : "desktop";
    return `${config.storageKey}.${viewport}`;
  }

  function setSidebarCollapsed(config, collapsed, persist) {
    config.sidebar.classList.toggle("is-collapsed", collapsed);
    config.toggle.setAttribute("aria-expanded", String(!collapsed));
    config.toggle.setAttribute(
      "aria-label",
      collapsed ? `展開${config.name}` : `收合${config.name}`,
    );
    config.content.hidden = collapsed;

    if (persist) {
      try {
        window.localStorage.setItem(
          responsiveStorageKey(config),
          String(collapsed),
        );
      } catch (error) {
        // localStorage may be unavailable in private browsing contexts.
      }
    }
  }

  function initialSidebarState(config) {
    try {
      const stored = window.localStorage.getItem(
        responsiveStorageKey(config),
      );
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
    const list = document.createElement("ul");
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

  sidebars.forEach((config) => {
    config.toggle.addEventListener("click", function () {
      const collapsed = config.sidebar.classList.contains("is-collapsed");
      setSidebarCollapsed(config, !collapsed, true);
    });

    setSidebarCollapsed(config, initialSidebarState(config), false);
  });

  buildTableOfContents();
  buildGlossary();
})();
