(function () {
  "use strict";

  const form = document.getElementById("map-form");
  const submitBtn = document.getElementById("submit-btn");
  const submitLabel = submitBtn.querySelector(".btn-label");
  const errorBanner = document.getElementById("error-banner");
  const loadingOverlay = document.getElementById("map-loading");
  const summaryEl = document.getElementById("result-summary");
  const panel = document.getElementById("control-panel");
  const panelToggle = document.getElementById("panel-toggle");
  const drawer = document.getElementById("stop-drawer");
  const drawerClose = document.getElementById("drawer-close");
  const drawerTitle = document.getElementById("drawer-title");
  const drawerSteps = document.getElementById("drawer-steps");
  const mapEl = document.getElementById("map");

  const MOBILE_QUERY = window.matchMedia("(max-width: 900px)");

  let initialCenter = [32.7767, -96.797];
  try {
    initialCenter = JSON.parse(mapEl.dataset.center);
  } catch (e) {
    // fall back to default center
  }

  const map = L.map(mapEl, { zoomControl: true }).setView(initialCenter, 11);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  }).addTo(map);

  const resultsLayer = L.layerGroup().addTo(map);

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitLabel.textContent = isLoading ? "Searching…" : "Find hiding spots";
    loadingOverlay.hidden = !isLoading;
  }

  function showError(message) {
    if (!message) {
      errorBanner.hidden = true;
      errorBanner.textContent = "";
      return;
    }
    errorBanner.hidden = false;
    errorBanner.textContent = message;
  }

  function closeDrawer() {
    drawer.classList.remove("open");
  }

  function stepBadgeClass(type) {
    switch (type) {
      case "start":
        return "stop-drawer__step-badge--start";
      case "walk":
        return "stop-drawer__step-badge--walk";
      case "wait":
        return "stop-drawer__step-badge--wait";
      default:
        return "stop-drawer__step-badge--transit";
    }
  }

  function openDrawerForStop(stop) {
    drawerTitle.textContent = stop.name;
    drawerSteps.innerHTML = "";

    stop.steps.forEach((step) => {
      const li = document.createElement("li");
      li.className = "stop-drawer__step";

      const badge = document.createElement("span");
      badge.className = "stop-drawer__step-badge " + stepBadgeClass(step.type);
      li.appendChild(badge);

      const textWrap = document.createElement("div");
      if (step.type === "start") {
        textWrap.innerHTML =
          '<div class="stop-drawer__step-label">Start at ' +
          escapeHtml(step.stop_name) +
          "</div>" +
          '<div class="stop-drawer__step-meta">' +
          escapeHtml(step.time) +
          "</div>";
      } else {
        const verb = step.type === "walk" || step.type === "wait" ? "" : "Take ";
        textWrap.innerHTML =
          '<div class="stop-drawer__step-label">' +
          verb +
          escapeHtml(step.label) +
          "</div>" +
          '<div class="stop-drawer__step-meta">' +
          escapeHtml(step.duration) +
          " · arrive " +
          escapeHtml(step.arrival_time) +
          " at " +
          escapeHtml(step.stop_name) +
          "</div>";
      }
      li.appendChild(textWrap);
      drawerSteps.appendChild(li);
    });

    drawer.classList.add("open");
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function invalidateMapSize() {
    // Leaflet needs a nudge after its container is resized by a CSS transition.
    setTimeout(() => map.invalidateSize(), 260);
  }

  function setPanelCollapsed(collapsed) {
    panel.classList.toggle("collapsed", collapsed);
    panelToggle.setAttribute("aria-expanded", String(!collapsed));
    panelToggle.querySelector(".panel-toggle__label").textContent = collapsed
      ? "Search options"
      : "Hide options";
    invalidateMapSize();
  }

  panelToggle.addEventListener("click", () => {
    setPanelCollapsed(!panel.classList.contains("collapsed"));
  });

  drawerClose.addEventListener("click", closeDrawer);

  window.addEventListener("resize", () => map.invalidateSize());

  function renderStops(data) {
    resultsLayer.clearLayers();
    closeDrawer();

    const bounds = [];
    data.stops.forEach((stop) => {
      const isHiding = stop.is_hiding_spot;
      const circle = L.circle([stop.lat, stop.lon], {
        radius: stop.hiding_radius_m,
        color: "#1a1f26",
        weight: 1,
        fillColor: isHiding ? "#0a5fc2" : "#c62f2f",
        fillOpacity: isHiding ? 0.22 : 0.55,
      });
      circle.bindTooltip(stop.name, { direction: "top", sticky: true });
      circle.on("click", () => openDrawerForStop(stop));
      circle.addTo(resultsLayer);
      bounds.push([stop.lat, stop.lon]);
    });

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }

    summaryEl.hidden = false;
    const stopWord = data.stop_count === 1 ? "stop" : "stops";
    const spotWord = data.hiding_spot_count === 1 ? "spot" : "spots";
    summaryEl.textContent =
      "Found " +
      data.stop_count +
      " reachable " +
      stopWord +
      " — " +
      data.hiding_spot_count +
      " valid hiding " +
      spotWord +
      ".";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError(null);
    summaryEl.hidden = true;
    setLoading(true);

    const formData = new FormData(form);

    const travelModes = Array.from(
      form.querySelectorAll('input[name="travel_mode_option"]:checked')
    ).map((el) => el.value);
    const hidingModes = Array.from(
      form.querySelectorAll('input[name="hiding_mode_option"]:checked')
    ).map((el) => el.value);

    if (travelModes.length) {
      formData.set("travel_modes", travelModes.join(","));
    }
    if (hidingModes.length) {
      formData.set("hiding_modes", hidingModes.join(","));
    }

    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      renderStops(data);

      if (MOBILE_QUERY.matches) {
        setPanelCollapsed(true);
      }
    } catch (err) {
      showError(err.message || "Network error — please try again.");
    } finally {
      setLoading(false);
    }
  });
})();
