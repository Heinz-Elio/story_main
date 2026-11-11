(function () {
  "use strict";

  const WIDE_LAYOUT_QUERY = "(min-width: 1200px)";
  const PANE_ORDER = ["toc", "reading", "glossary"];
  const PANE_LABELS = { toc: "目錄", reading: "正文", glossary: "縮寫" };
  const AXIS_SLOP = 12;
  const AXIS_RATIO = 1.8;
  const COMMIT_DISTANCE_RATIO = 0.22;
  const COMMIT_FLICK_DISTANCE = 56;
  const COMMIT_FLICK_VELOCITY = 0.5;
  const SCENE_CHAR_TARGET = 4000;
  const SCENE_MIN_TAIL = 800;
  const LAST_READ_KEY = "outsiders.last-read";

  const shell = document.querySelector(".site-shell");
  const viewport = document.querySelector(".reader-viewport");
  const track = document.getElementById("reader-track");
  const toolbar = document.querySelector(".reader-toolbar");
  const announcer = document.getElementById("reader-announcer");
  const article = document.getElementById("article");
  const articleBody = document.getElementById("article-body") || article;
  const toc = document.getElementById("toc");
  const glossary = document.getElementById("glossary");
  const wideMedia = window.matchMedia(WIDE_LAYOUT_QUERY);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const paneElements = {
    toc: document.getElementById("toc-sidebar"),
    reading: article,
    glossary: document.getElementById("glossary-sidebar"),
  };

  const sidebars = [
    {
      id: "toc",
      name: "目錄",
      shellClass: "toc-collapsed",
      sidebar: paneElements.toc,
      content: document.getElementById("toc-sidebar-content"),
      toggle: document.getElementById("toc-toggle"),
      storageKey: "outsiders.toc-collapsed",
    },
    {
      id: "glossary",
      name: "縮寫",
      shellClass: "glossary-collapsed",
      sidebar: paneElements.glossary,
      content: document.getElementById("glossary-sidebar-content"),
      toggle: document.getElementById("glossary-toggle"),
      storageKey: "outsiders.glossary-collapsed",
    },
  ];

  const collapsedState = { toc: false, glossary: false };
  let paneIndex = PANE_ORDER.indexOf("reading");
  let gesture = null;
  let suppressClick = false;
  let announcerReady = false;
  let pager = null;
  let turnScene = function () {};
  let syncPagerMode = function () {};
  let scrollTocToCurrent = function () {};

  function isWide() {
    return wideMedia.matches;
  }

  function readStoredCollapse(config) {
    try {
      const stored = window.localStorage.getItem(`${config.storageKey}.desktop`);
      if (stored !== null) {
        return stored === "true";
      }
    } catch (error) {
      // localStorage may be unavailable in private browsing contexts.
    }

    return false;
  }

  function setSidebarCollapsed(config, collapsed, persist) {
    collapsedState[config.id] = collapsed;
    const showCollapsed = collapsed && isWide();
    config.sidebar.classList.toggle("is-collapsed", showCollapsed);
    config.content.hidden = showCollapsed;
    config.toggle.setAttribute("aria-expanded", String(!showCollapsed));
    config.toggle.setAttribute(
      "aria-label",
      showCollapsed ? `展開${config.name}` : `收合${config.name}`,
    );
    shell.classList.toggle(config.shellClass, showCollapsed);
    syncPagerMode();

    if (persist) {
      try {
        window.localStorage.setItem(
          `${config.storageKey}.desktop`,
          String(collapsed),
        );
      } catch (error) {
        // localStorage may be unavailable in private browsing contexts.
      }
    }
  }

  function applySidebarChrome() {
    sidebars.forEach(function (config) {
      setSidebarCollapsed(config, collapsedState[config.id], false);
    });
  }

  function announcePane(name) {
    if (!announcer || !announcerReady || isWide()) {
      return;
    }

    announcer.textContent = "";
    window.requestAnimationFrame(function () {
      announcer.textContent = PANE_LABELS[name] || "";
    });
  }

  function updateToolbar() {
    if (!toolbar) {
      return;
    }

    const current = PANE_ORDER[paneIndex];
    toolbar.querySelectorAll("[data-goto-pane]").forEach(function (button) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.gotoPane === current),
      );
    });
  }

  function focusWithoutScroll(element) {
    if (!element || typeof element.focus !== "function") {
      return;
    }

    try {
      element.focus({ preventScroll: true });
    } catch (error) {
      element.focus();
    }
  }

  function applyPaneA11y() {
    const wide = isWide();
    const active = paneElements[PANE_ORDER[paneIndex]];

    if (!wide && active && document.activeElement) {
      PANE_ORDER.forEach(function (name, index) {
        if (index === paneIndex) {
          return;
        }

        const pane = paneElements[name];
        if (
          pane === document.activeElement ||
          pane.contains(document.activeElement)
        ) {
          focusWithoutScroll(active);
        }
      });
    }

    PANE_ORDER.forEach(function (name, index) {
      const pane = paneElements[name];
      const exposed = wide || index === paneIndex;
      pane.classList.toggle("is-active", !wide && index === paneIndex);

      if (exposed) {
        pane.removeAttribute("inert");
        pane.removeAttribute("aria-hidden");
      } else {
        pane.setAttribute("inert", "");
        pane.setAttribute("aria-hidden", "true");
      }
    });

    updateToolbar();
  }

  function viewportWidth() {
    return viewport ? viewport.clientWidth : window.innerWidth;
  }

  function placeTrack(index, pixelDelta, animate) {
    if (!track || isWide()) {
      return;
    }

    const width = viewportWidth();
    const reduce = reduceMotion.matches;
    const shouldAnimate = Boolean(animate) && !reduce;
    const transform =
      "translate3d(" + (-index * width + pixelDelta) + "px, 0, 0)";

    if (!shouldAnimate) {
      track.classList.add("is-dragging");
      track.style.transform = transform;
      return;
    }

    track.classList.remove("is-dragging");
    // Commit the current position with the transition enabled, then move.
    void track.offsetWidth;
    track.style.transform = transform;
  }

  function layoutPanes() {
    if (!track) {
      return;
    }

    if (isWide()) {
      track.style.transform = "";
      track.classList.remove("is-dragging");
      return;
    }

    // Position instantly, then drop the drag class so the next move can animate.
    placeTrack(paneIndex, 0, false);
    void track.offsetWidth;
    track.classList.remove("is-dragging");
  }

  function goToPane(name, options) {
    const optionsBag = options || {};
    const index = PANE_ORDER.indexOf(name);
    if (index < 0) {
      return;
    }

    const changed = index !== paneIndex;
    paneIndex = index;

    if (!isWide()) {
      placeTrack(index, 0, optionsBag.animate !== false);
    }

    applyPaneA11y();
    syncPagerMode();

    if (name === "toc") {
      window.requestAnimationFrame(function () {
        scrollTocToCurrent();
      });
    }

    if (optionsBag.announce !== false && changed) {
      announcePane(name);
    }

    if (optionsBag.focus) {
      focusWithoutScroll(paneElements[name]);
    }
  }

  function inHorizontalScroller(target) {
    let node = target && target.nodeType === 1 ? target : null;
    if (!node && target && target.parentElement) {
      node = target.parentElement;
    }

    while (node && node !== viewport) {
      if (node.scrollWidth - node.clientWidth > 8) {
        const overflowX = window.getComputedStyle(node).overflowX;
        if (
          overflowX === "auto" ||
          overflowX === "scroll" ||
          overflowX === "overlay"
        ) {
          return true;
        }
      }

      node = node.parentElement;
    }

    return false;
  }

  function resetGesture() {
    gesture = null;
    if (track) {
      track.classList.remove("is-dragging");
    }
  }

  function onPointerDown(event) {
    if (isWide() || !viewport || event.pointerType === "mouse") {
      return;
    }

    if (event.button !== 0 || gesture) {
      return;
    }

    const pointed = document.elementFromPoint(event.clientX, event.clientY);
    if (inHorizontalScroller(event.target) || inHorizontalScroller(pointed)) {
      return;
    }

    gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      started: Date.now(),
      locked: null,
    };
  }

  function onPointerMove(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;

    if (!gesture.locked) {
      if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) {
        return;
      }

      if (Math.abs(dx) > Math.abs(dy) * AXIS_RATIO) {
        gesture.locked = "x";
        try {
          viewport.setPointerCapture(event.pointerId);
        } catch (error) {
          // Synthetic or already-released pointers cannot be captured.
        }
      } else {
        gesture.locked = "y";
        return;
      }
    }

    if (gesture.locked !== "x") {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    let delta = dx;
    const atStart = paneIndex === 0 && dx > 0;
    const atEnd = paneIndex === PANE_ORDER.length - 1 && dx < 0;
    if (atStart || atEnd) {
      delta = dx * 0.32;
    }

    placeTrack(paneIndex, delta, false);
  }

  function finishGesture(event) {
    if (!gesture || event.pointerId !== gesture.id) {
      return;
    }

    const locked = gesture.locked;
    const dx = gesture.lastX - gesture.startX;
    const elapsed = Math.max(1, Date.now() - gesture.started);
    const velocity = dx / elapsed;
    const width = viewportWidth();

    if (viewport.releasePointerCapture) {
      try {
        if (viewport.hasPointerCapture(event.pointerId)) {
          viewport.releasePointerCapture(event.pointerId);
        }
      } catch (error) {
        // The pointer may already have been released.
      }
    }

    resetGesture();

    if (locked !== "x") {
      return;
    }

    if (Math.abs(dx) > AXIS_SLOP) {
      suppressClick = true;
      window.setTimeout(function () {
        suppressClick = false;
      }, 500);
    }

    let next = paneIndex;
    const distanceCommit = Math.abs(dx) >= width * COMMIT_DISTANCE_RATIO;
    const flickCommit =
      Math.abs(dx) >= COMMIT_FLICK_DISTANCE &&
      Math.abs(velocity) >= COMMIT_FLICK_VELOCITY;

    if (distanceCommit || flickCommit) {
      if (dx < 0) {
        next = Math.min(PANE_ORDER.length - 1, paneIndex + 1);
      } else if (dx > 0) {
        next = Math.max(0, paneIndex - 1);
      }
    }

    goToPane(PANE_ORDER[next], { animate: true, announce: true });
  }

  function typingTarget(target) {
    return Boolean(
      target &&
        target.closest &&
        target.closest("input, textarea, select, [contenteditable='true']"),
    );
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || typingTarget(event.target)) {
      return;
    }

    const plain =
      !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    // Arrows turn scenes. [ and ] move between the directory and glossary.
    // Alt+Arrow stays with the browser back/forward shortcuts.
    if (plain && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      turnScene(event.key === "ArrowRight" ? 1 : -1);
      return;
    }

    const backward = plain && event.key === "[";
    const forward = plain && event.key === "]";

    if (!backward && !forward) {
      return;
    }

    event.preventDefault();

    if (!isWide()) {
      const direction = forward ? 1 : -1;
      const next = Math.min(
        PANE_ORDER.length - 1,
        Math.max(0, paneIndex + direction),
      );
      goToPane(PANE_ORDER[next], { focus: true, announce: true });
      return;
    }

    const config = backward ? sidebars[0] : sidebars[1];
    if (collapsedState[config.id]) {
      setSidebarCollapsed(config, false, true);
    }
    focusWithoutScroll(config.sidebar);
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
      Array.from(document.querySelectorAll("[id]")).map(function (element) {
        return element.id;
      }),
    );
    const list = document.createElement("ul");
    list.className = "toc-list";

    headings.forEach(function (heading, index) {
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

  function nodeTextLength(node) {
    return (node.textContent || "").length;
  }

  function splitSceneNodes(nodes) {
    const chunks = [];
    let current = [];
    let count = 0;

    nodes.forEach(function (node) {
      const hasBody = current.some(function (item) {
        return !item.tagName || !/^H[1-6]$/.test(item.tagName);
      });
      if (hasBody && count >= SCENE_CHAR_TARGET) {
        chunks.push(current);
        current = [];
        count = 0;
      }
      current.push(node);
      count += nodeTextLength(node);
    });

    if (current.length) {
      chunks.push(current);
    }

    if (chunks.length > 1) {
      const tailLength = chunks[chunks.length - 1].reduce(function (sum, node) {
        return sum + nodeTextLength(node);
      }, 0);
      if (tailLength < SCENE_MIN_TAIL) {
        const tail = chunks.pop();
        chunks[chunks.length - 1] = chunks[chunks.length - 1].concat(tail);
      }
    }

    return chunks;
  }

  function paginateByHeading() {
    if (!articleBody) {
      return [];
    }

    const title = articleBody.querySelector("h1");
    const nodes = Array.from(articleBody.children).filter(function (node) {
      return node !== title;
    });
    const pages = [];
    let currentNodes = [];
    let pendingH2 = null;
    let sceneCount = 0;

    function addScene(sceneNodes) {
      if (sceneNodes.length === 0) {
        return;
      }

      const heading = sceneNodes.find(function (node) {
        return node.tagName && /^H[2-4]$/.test(node.tagName);
      });
      const headingId = heading && heading.id ? heading.id : "";
      const chunks = splitSceneNodes(sceneNodes);
      sceneCount += 1;

      chunks.forEach(function (chunk, index) {
        const page = document.createElement("section");
        page.className = "story-page";
        page.hidden = true;
        chunk.forEach(function (node) {
          page.appendChild(node);
        });
        page.dataset.scene = String(sceneCount);
        page.dataset.part = String(index + 1);
        page.dataset.partCount = String(chunks.length);
        if (headingId) {
          page.dataset.headingId = headingId;
          if (index === 0) {
            page.id = `page-${headingId}`;
          }
        }
        pages.push(page);
      });
    }

    function closePage() {
      addScene(currentNodes);
      currentNodes = [];
    }

    nodes.forEach(function (node) {
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

    articleBody.replaceChildren(...[title, ...pages].filter(Boolean));
    return pages;
  }

  let hashPin = 0;
  let adjustingScroll = false;

  function setLocationHash(id) {
    if (!id) {
      return;
    }

    // Chrome scrolls to a matching id shortly after replaceState, which hides
    // the book title. Hold the id off the element until that lookup has passed.
    const heading = document.getElementById(id);
    if (heading) {
      heading.removeAttribute("id");
    }

    try {
      history.replaceState(null, "", `#${id}`);
    } catch (error) {
      // Ignore history failures in restricted contexts.
    }

    const token = ++hashPin;
    const pinToStart = function () {
      if (token !== hashPin) {
        return;
      }
      scrollReadingToStart();
    };

    window.addEventListener("scroll", pinToStart, true);
    if (article) {
      article.addEventListener("scroll", pinToStart);
    }
    if (viewport) {
      viewport.addEventListener("scroll", pinToStart);
    }

    window.setTimeout(function () {
      window.removeEventListener("scroll", pinToStart, true);
      if (article) {
        article.removeEventListener("scroll", pinToStart);
      }
      if (viewport) {
        viewport.removeEventListener("scroll", pinToStart);
      }
      if (token !== hashPin) {
        return;
      }
      if (heading && !heading.id) {
        heading.id = id;
      }
      pinToStart();
    }, 100);
  }

  function scrollReadingToStart() {
    if (adjustingScroll) {
      return;
    }

    adjustingScroll = true;
    const scroller = isWide() ? viewport : article;
    if (scroller) {
      scroller.scrollTop = 0;
    }
    adjustingScroll = false;
  }

  function setupPagination(pages) {
    if (!article || !shell || pages.length === 0) {
      return;
    }

    const sceneTotal = pages.reduce(function (max, page) {
      return Math.max(max, Number(page.dataset.scene) || 0);
    }, 0);
    let currentIndex = 0;
    let rememberReads = false;
    let lastScrollTop = 0;

    pager = document.createElement("nav");
    pager.className = "page-nav";
    pager.setAttribute("aria-label", "章節分頁");
    pager.innerHTML =
      '<div class="page-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="閱讀進度">' +
      '<span class="page-progress-bar"></span></div>' +
      '<div class="page-nav-row">' +
      '<button type="button" data-page-prev>上一幕</button>' +
      '<p class="page-status" aria-live="polite"></p>' +
      '<button type="button" data-page-next>下一幕</button>' +
      "</div>";
    shell.appendChild(pager);

    const prevButton = pager.querySelector("[data-page-prev]");
    const nextButton = pager.querySelector("[data-page-next]");
    const status = pager.querySelector(".page-status");
    const progress = pager.querySelector(".page-progress");
    const progressBar = pager.querySelector(".page-progress-bar");

    function positionLabel(page) {
      if (!page) {
        return "";
      }
      if (page.dataset.partCount === "1") {
        return page.dataset.scene;
      }
      return page.dataset.scene + "-" + page.dataset.part;
    }

    function parseLocationHash() {
      const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
      const marked = raw.match(/^(.*)~(\d+)$/);
      if (marked) {
        return { id: marked[1], part: marked[2] };
      }
      return { id: raw, part: "" };
    }

    function pageIndexForId(id) {
      if (!id) {
        return 0;
      }

      const stored = pages.findIndex(function (page) {
        return page.dataset.headingId === id;
      });
      if (stored >= 0) {
        return stored;
      }

      const heading = document.getElementById(id);
      if (!heading) {
        return 0;
      }

      return Math.max(
        0,
        pages.findIndex(function (page) {
          return page.contains(heading);
        }),
      );
    }

    function pageIndexForLocation() {
      const parsed = parseLocationHash();
      if (!parsed.id) {
        return 0;
      }
      if (parsed.part) {
        const exact = pages.findIndex(function (page) {
          return (
            page.dataset.headingId === parsed.id &&
            page.dataset.part === parsed.part
          );
        });
        if (exact >= 0) {
          return exact;
        }
      }
      return pageIndexForId(parsed.id);
    }

    function readingScroller() {
      return isWide() ? viewport : article;
    }

    function readingScroll() {
      const scroller = readingScroller();
      if (!scroller) {
        return { top: 0, max: 0 };
      }
      return {
        top: scroller.scrollTop,
        max: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      };
    }

    function updateProgress() {
      const metrics = readingScroll();
      const fraction = metrics.max <= 1 ? 1 : Math.min(1, metrics.top / metrics.max);
      const overall = (currentIndex + fraction) / pages.length;
      const percent = Math.round(overall * 1000) / 10;
      progressBar.style.transform = "scaleX(" + overall + ")";
      progress.setAttribute("aria-valuenow", String(Math.round(percent)));
      return metrics;
    }

    function setPagerDismissed(dismissed) {
      pager.classList.toggle("is-dismissed", dismissed);
    }

    function placePager() {
      if (!pager || !article) {
        return;
      }
      const row = pager.querySelector(".page-nav-row");
      const progress = pager.querySelector(".page-progress");
      if (isWide()) {
        const rect = article.getBoundingClientRect();
        const pagerRect = pager.getBoundingClientRect();
        const offset = Math.max(0, rect.left - pagerRect.left);
        if (row) {
          row.style.width = rect.width + "px";
          row.style.marginLeft = offset + "px";
        }
        if (progress) {
          progress.style.width = rect.width + "px";
          progress.style.marginLeft = offset + "px";
        }
      } else {
        if (row) {
          row.style.width = "";
          row.style.marginLeft = "";
        }
        if (progress) {
          progress.style.width = "";
          progress.style.marginLeft = "";
        }
      }
      const hidden =
        pager.classList.contains("is-dismissed") ||
        pager.classList.contains("is-unavailable");
      document.documentElement.style.setProperty(
        "--pager-space",
        hidden ? "0px" : pager.offsetHeight + "px",
      );
    }

    syncPagerMode = function () {
      if (!pager) {
        return;
      }
      const available = isWide() || PANE_ORDER[paneIndex] === "reading";
      pager.classList.toggle("is-unavailable", !available);
      if (available) {
        const metrics = readingScroll();
        if (metrics.top <= 48 || metrics.top >= metrics.max - 8) {
          setPagerDismissed(false);
        }
      }
      window.requestAnimationFrame(placePager);
    };

    scrollTocToCurrent = function () {
      const link = toc && toc.querySelector("a.is-current");
      const scroller = paneElements.toc;
      if (!link || !scroller || scroller.classList.contains("is-collapsed")) {
        return;
      }
      const delta =
        link.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const next =
        scroller.scrollTop + delta - (scroller.clientHeight - link.offsetHeight) / 2;
      scroller.scrollTo({
        top: Math.max(0, next),
        behavior: reduceMotion.matches ? "auto" : "smooth",
      });
    };

    function remember(page) {
      if (!rememberReads) {
        return;
      }
      try {
        window.localStorage.setItem(
          LAST_READ_KEY,
          JSON.stringify({
            headingId: page.dataset.headingId || "",
            part: page.dataset.part || "1",
            label: positionLabel(page),
          }),
        );
      } catch (error) {
        // localStorage may be unavailable in private browsing contexts.
      }
    }

    function showPage(index, headingId) {
      currentIndex = Math.min(Math.max(index, 0), pages.length - 1);
      const page = pages[currentIndex];

      pages.forEach(function (candidate, pageIndex) {
        candidate.hidden = pageIndex !== currentIndex;
      });

      prevButton.disabled = currentIndex === 0;
      nextButton.disabled = currentIndex === pages.length - 1;
      status.textContent = positionLabel(page) + " / " + sceneTotal;

      if (toc) {
        toc.querySelectorAll("a").forEach(function (link) {
          const targetId = decodeURIComponent(link.hash.replace(/^#/, ""));
          link.classList.toggle(
            "is-current",
            Boolean(page.dataset.headingId) && targetId === page.dataset.headingId,
          );
        });
      }

      const hashId =
        page.dataset.part && page.dataset.part !== "1" && page.dataset.headingId
          ? page.dataset.headingId + "~" + page.dataset.part
          : (headingId && page.querySelector(`#${CSS.escape(headingId)}`)
              ? headingId
              : page.dataset.headingId);
      if (hashId) {
        setLocationHash(hashId);
      }

      scrollReadingToStart();
      lastScrollTop = 0;
      setPagerDismissed(false);
      updateProgress();
      remember(page);

      if (isWide() || PANE_ORDER[paneIndex] === "toc") {
        scrollTocToCurrent();
      }
    }

    function readLastRead() {
      try {
        const raw = window.localStorage.getItem(LAST_READ_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    }

    function offerResume() {
      const saved = readLastRead();
      if (!saved || !saved.headingId) {
        return;
      }
      const index = pages.findIndex(function (page) {
        return (
          page.dataset.headingId === saved.headingId &&
          page.dataset.part === String(saved.part || "1")
        );
      });
      if (index <= 0) {
        return;
      }

      const offer = document.createElement("div");
      offer.className = "resume-offer";
      const label = saved.label || positionLabel(pages[index]);
      offer.innerHTML =
        "<p>上次讀到 <strong></strong></p>" +
        '<button type="button" data-resume>繼續閱讀</button>' +
        '<button type="button" data-resume-dismiss>留在開頭</button>';
      offer.querySelector("strong").textContent = label;
      const title = articleBody.querySelector("h1");
      if (title) {
        title.insertAdjacentElement("afterend", offer);
      } else {
        articleBody.prepend(offer);
      }

      offer.querySelector("[data-resume]").addEventListener("click", function () {
        offer.remove();
        showPage(index);
      });
      offer.querySelector("[data-resume-dismiss]").addEventListener("click", function () {
        try {
          window.localStorage.removeItem(LAST_READ_KEY);
        } catch (error) {
          // Ignore storage failures.
        }
        offer.remove();
      });
    }

    function onReaderScroll() {
      const metrics = readingScroll();
      if (!adjustingScroll) {
        const atEnd = metrics.top >= metrics.max - 8;
        if (atEnd || metrics.top < lastScrollTop - 6) {
          setPagerDismissed(false);
        } else if (metrics.top > lastScrollTop + 12 && metrics.top > 48) {
          setPagerDismissed(true);
        }
      }
      lastScrollTop = metrics.top;
      updateProgress();
    }

    prevButton.addEventListener("click", function () {
      showPage(currentIndex - 1);
    });

    nextButton.addEventListener("click", function () {
      showPage(currentIndex + 1);
    });

    turnScene = function (delta) {
      showPage(currentIndex + delta);
    };

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
        const heading = document.getElementById(id);
        showPage(pageIndexForId(id), id);
        if (!isWide()) {
          goToPane("reading", { announce: true });
          if (heading) {
            if (!heading.hasAttribute("tabindex")) {
              heading.setAttribute("tabindex", "-1");
            }
            focusWithoutScroll(heading);
          }
        }
      });
    }

    window.addEventListener("hashchange", function () {
      showPage(pageIndexForLocation());
      if (!isWide()) {
        goToPane("reading", { announce: false });
      }
    });

    article.addEventListener("scroll", onReaderScroll, { passive: true });
    if (viewport) {
      viewport.addEventListener("scroll", onReaderScroll, { passive: true });
    }

    const openedWithHash = location.hash.length > 1;
    showPage(openedWithHash ? pageIndexForLocation() : 0);
    rememberReads = true;
    syncPagerMode();
    if (!openedWithHash) {
      offerResume();
    }
  }

  function buildGlossary() {
    if (!article || !glossary) {
      return;
    }

    const entries = new Map();
    article.querySelectorAll(".abbr-term").forEach(function (term) {
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
    entries.forEach(function (entry, key) {
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

  sidebars.forEach(function (config) {
    collapsedState[config.id] = readStoredCollapse(config);
    config.toggle.addEventListener("click", function () {
      setSidebarCollapsed(config, !collapsedState[config.id], true);
    });
  });

  if (toolbar) {
    toolbar.addEventListener("click", function (event) {
      const button = event.target.closest("[data-goto-pane]");
      if (!button || !toolbar.contains(button)) {
        return;
      }

      goToPane(button.dataset.gotoPane, { announce: true });
    });
  }

  if (viewport) {
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove, { passive: false });
    viewport.addEventListener("pointerup", finishGesture);
    viewport.addEventListener("pointercancel", function (event) {
      if (!gesture || event.pointerId !== gesture.id) {
        return;
      }

      const locked = gesture.locked;
      const index = paneIndex;
      resetGesture();
      if (locked === "x") {
        placeTrack(index, 0, true);
      }
    });
    viewport.addEventListener(
      "click",
      function (event) {
        if (!suppressClick) {
          return;
        }

        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  }

  document.addEventListener("keydown", onKeyDown);

  const skipLink = document.querySelector(".skip-link");
  if (skipLink) {
    skipLink.addEventListener("click", function () {
      goToPane("reading", { announce: false });
    });
  }

  function onLayoutChange() {
    applySidebarChrome();
    applyPaneA11y();
    layoutPanes();
  }

  wideMedia.addEventListener("change", onLayoutChange);
  window.addEventListener("resize", function () {
    layoutPanes();
    syncPagerMode();
  });

  applySidebarChrome();
  buildTableOfContents();
  buildGlossary();
  setupPagination(paginateByHeading());
  applyPaneA11y();
  layoutPanes();
  announcerReady = true;
})();
