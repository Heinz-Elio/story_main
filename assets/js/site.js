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
      return [];
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
    return headings;
  }

  function paginateByHeading() {
    if (!article) {
      return [];
    }

    const title = article.querySelector("h1");
    const nodes = Array.from(article.children).filter((node) => node !== title);
    const pages = [];
    let currentNodes = [];
    let pendingH2 = null;

    function closePage() {
      if (currentNodes.length === 0) {
        return;
      }

      const page = document.createElement("section");
      page.className = "story-page";
      page.hidden = true;
      currentNodes.forEach((node) => page.appendChild(node));
      pages.push(page);
      currentNodes = [];
    }

    nodes.forEach((node) => {
      if (node.tagName === "H2") {
        closePage();
        pendingH2 = node;
        return;
      }

      if (node.tagName === "H3") {
        closePage();
        if (pendingH2) {
          currentNodes.push(pendingH2);
          pendingH2 = null;
        }
        currentNodes.push(node);
        return;
      }

      if (currentNodes.length === 0 && pendingH2) {
        currentNodes.push(pendingH2);
        pendingH2 = null;
      }

      currentNodes.push(node);
    });

    if (pendingH2) {
      currentNodes.unshift(pendingH2);
    }

    closePage();

    pages.forEach((page, index) => {
      page.dataset.page = String(index + 1);
      const heading = page.querySelector("h3, h2, h4");
      if (heading && heading.id) {
        page.id = `page-${heading.id}`;
      }
    });

    const pager = document.createElement("nav");
    pager.className = "page-nav";
    pager.setAttribute("aria-label", "章節分頁");
    pager.innerHTML =
      '<button type="button" data-page-prev>上一頁</button>' +
      '<p class="page-status" aria-live="polite"></p>' +
      '<button type="button" data-page-next>下一頁</button>';

    article.replaceChildren(...[title, ...pages, pager].filter(Boolean));
    return pages;
  }

  function setupPagination(pages) {
    if (!article || pages.length === 0) {
      return;
    }

    const prevButton = article.querySelector("[data-page-prev]");
    const nextButton = article.querySelector("[data-page-next]");
    const status = article.querySelector(".page-status");
    let currentIndex = 0;

    function pageIndexForId(id) {
      if (!id) {
        return 0;
      }

      const heading = document.getElementById(id);
      if (!heading) {
        return 0;
      }

      return Math.max(
        0,
        pages.findIndex((page) => page.contains(heading)),
      );
    }

    function showPage(index, headingId) {
      currentIndex = Math.min(Math.max(index, 0), pages.length - 1);
      const page = pages[currentIndex];

      pages.forEach((candidate, pageIndex) => {
        candidate.hidden = pageIndex !== currentIndex;
      });

      prevButton.disabled = currentIndex === 0;
      nextButton.disabled = currentIndex === pages.length - 1;
      status.textContent = `${currentIndex + 1} / ${pages.length}`;

      if (toc) {
        toc.querySelectorAll("a").forEach((link) => {
          const targetId = decodeURIComponent(link.hash.replace(/^#/, ""));
          const target = targetId ? document.getElementById(targetId) : null;
          link.classList.toggle("is-current", Boolean(target && page.contains(target)));
        });
      }

      const activeHeading =
        (headingId && page.querySelector(`#${CSS.escape(headingId)}`)) ||
        page.querySelector("h3, h2, h4");
      if (activeHeading && activeHeading.id) {
        history.replaceState(null, "", `#${activeHeading.id}`);
      }

      window.scrollTo(0, 0);
    }

    prevButton.addEventListener("click", function () {
      showPage(currentIndex - 1);
    });

    nextButton.addEventListener("click", function () {
      showPage(currentIndex + 1);
    });

    if (toc) {
      toc.addEventListener("click", function (event) {
        const link = event.target.closest("a");
        if (!link || !toc.contains(link)) {
          return;
        }

        const id = decodeURIComponent(link.hash.replace(/^#/, ""));
        if (!id) {
          return;
        }

        event.preventDefault();
        showPage(pageIndexForId(id), id);
      });
    }

    window.addEventListener("hashchange", function () {
      const id = decodeURIComponent(location.hash.replace(/^#/, ""));
      showPage(pageIndexForId(id), id);
    });

    const initialId = decodeURIComponent(location.hash.replace(/^#/, ""));
    showPage(pageIndexForId(initialId), initialId);
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
  setupPagination(paginateByHeading());
})();
