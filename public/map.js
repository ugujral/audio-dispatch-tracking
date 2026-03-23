(async function () {
  // Fetch map config from server
  const configResp = await fetch("/api/config");
  const cfg = await configResp.json();

  // Set up audio player with stream URL
  var audio = document.getElementById("stream-audio");
  if (cfg.streamUrl) {
    audio.src = cfg.streamUrl;
  }

  // Stream name label
  if (cfg.streamName) {
    document.getElementById("stream-name").textContent = cfg.streamName;
  }

  // Pipeline status indicator
  var pipelineEl = document.getElementById("pipeline-status");

  function updatePipelineIndicator(state) {
    pipelineEl.textContent = state === "processing" ? "Processing" : "Idle";
    pipelineEl.className = state === "processing" ? "processing" : "idle";
  }

  // Sync audio play/pause with backend pipeline
  // Track user intent to avoid stopping on buffer stalls
  var userClickedPlay = false;

  audio.addEventListener("play", function () {
    userClickedPlay = true;
    fetch("/api/stream/start", { method: "POST" })
      .catch(function (err) { console.error("Failed to start stream:", err); });
  });

  audio.addEventListener("pause", function () {
    // Only stop pipeline if user intentionally paused (not a buffer stall)
    if (userClickedPlay) {
      userClickedPlay = false;
      fetch("/api/stream/stop", { method: "POST" })
        .catch(function (err) { console.error("Failed to stop stream:", err); });
    }
  });

  // Initialize Leaflet map
  const map = L.map("map", { minZoom: 3, maxBoundsViscosity: 1.0 }).setView([cfg.mapCenterLat, cfg.mapCenterLng], cfg.mapZoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  // Marker color by incident type
  const TYPE_COLORS = {
    fire: "#e94560",
    medical: "#4895ef",
    traffic: "#f9c74f",
    alarm: "#f8961e",
    other: "#43aa8b",
  };

  function classifyType(type) {
    const t = type.toLowerCase();
    if (t.includes("fire") || t.includes("smoke") || t.includes("burn")) return "fire";
    if (t.includes("medical") || t.includes("ems") || t.includes("overdose") || t.includes("cardiac") || t.includes("injury")) return "medical";
    if (t.includes("vehicle") || t.includes("mvc") || t.includes("mva") || t.includes("traffic") || t.includes("accident")) return "traffic";
    if (t.includes("alarm") || t.includes("afa")) return "alarm";
    return "other";
  }

  function createIcon(typeClass) {
    const color = TYPE_COLORS[typeClass] || TYPE_COLORS.other;
    return L.divIcon({
      className: "custom-marker",
      html: '<div style="width:14px;height:14px;background:' + color +
        ';border:2px solid white;border-radius:50%;box-shadow:0 0 6px ' + color + '88;"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function formatTime(ts) {
    var d = new Date(ts);
    return isNaN(d.getTime()) ? ts || "Unknown" : d.toLocaleTimeString();
  }

  var incidentMarkers = {};

  function removeIncident(id) {
    // Remove marker from map
    if (incidentMarkers[id]) {
      map.removeLayer(incidentMarkers[id]);
      delete incidentMarkers[id];
    }
    // Remove from sidebar
    var li = document.querySelector('[data-incident-id="' + id + '"]');
    if (li) li.remove();
    // Update count
    var list = document.getElementById("incident-list");
    var count = list.children.length;
    document.getElementById("count").textContent = count + " incident" + (count !== 1 ? "s" : "");
  }

  function addIncident(incident) {
    var typeClass = classifyType(incident.incidentType);

    // Add marker to map
    var marker = L.marker([incident.lat, incident.lng], {
      icon: createIcon(typeClass),
    }).addTo(map);

    // Build popup using safe DOM construction
    var popupEl = document.createElement("div");
    var lines = [
      { label: "Incident", value: incident.incidentType },
      { label: "Location", value: incident.location },
      { label: "Units", value: incident.units.join(", ") },
      { label: "Time", value: formatTime(incident.timestamp) },
    ];
    lines.forEach(function (line, i) {
      var b = document.createElement("strong");
      b.textContent = line.label + ": ";
      popupEl.appendChild(b);
      popupEl.appendChild(document.createTextNode(line.value));
      if (i < lines.length - 1) popupEl.appendChild(document.createElement("br"));
    });
    marker.bindPopup(popupEl);

    // Add to sidebar list using safe DOM methods
    var list = document.getElementById("incident-list");
    var li = document.createElement("li");
    li.className = "type-" + typeClass;

    var fields = [
      { cls: "incident-type", label: "Incident", value: incident.incidentType },
      { cls: "incident-location", label: "Location", value: incident.location },
      { cls: "incident-units", label: "Units", value: incident.units.join(", ") },
      { cls: "incident-time", label: "Time", value: formatTime(incident.timestamp) },
    ];
    fields.forEach(function (f) {
      var div = document.createElement("div");
      div.className = f.cls;
      div.textContent = f.label + ": " + f.value;
      li.appendChild(div);
    });

    // Delete button
    var deleteBtn = document.createElement("button");
    deleteBtn.className = "incident-delete";
    deleteBtn.textContent = "\u00d7";
    deleteBtn.title = "Remove incident";
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      fetch("/api/incidents/" + incident.id, { method: "DELETE" });
    });
    li.appendChild(deleteBtn);

    li.addEventListener("click", function () {
      map.setView([incident.lat, incident.lng], 15);
      marker.openPopup();
    });
    li.dataset.incidentId = incident.id;
    list.prepend(li);

    // Track marker for removal
    incidentMarkers[incident.id] = marker;

    // Update count
    var count = list.children.length;
    document.getElementById("count").textContent = count + " incident" + (count !== 1 ? "s" : "");
  }

  // Load existing incidents
  try {
    var resp = await fetch("/api/incidents");
    var incidents = await resp.json();
    incidents.forEach(addIncident);
  } catch (err) {
    console.error("Failed to load existing incidents:", err);
  }

  // Subscribe to real-time updates via SSE
  var statusEl = document.getElementById("status");
  var evtSource = new EventSource("/api/incidents/stream");

  evtSource.onopen = function () {
    statusEl.textContent = "Live";
    statusEl.className = "connected";
  };

  evtSource.onmessage = function (event) {
    try {
      var incident = JSON.parse(event.data);
      addIncident(incident);
    } catch (err) {
      console.error("Failed to parse SSE message:", err);
    }
  };

  evtSource.addEventListener("remove-incident", function (event) {
    var data = JSON.parse(event.data);
    removeIncident(data.id);
  });

  evtSource.addEventListener("pipeline-status", function (event) {
    var data = JSON.parse(event.data);
    updatePipelineIndicator(data.state);
  });

  evtSource.onerror = function () {
    statusEl.textContent = "Reconnecting...";
    statusEl.className = "error";
  };
})();
