(async function () {
  // Fetch map config from server
  const configResp = await fetch("/api/config");
  const cfg = await configResp.json();

  // Set up audio player with stream URL
  var audio = document.getElementById("stream-audio");
  if (cfg.streamUrl) {
    audio.src = cfg.streamUrl;
  }

  // Initialize Leaflet map
  const map = L.map("map").setView([cfg.mapCenterLat, cfg.mapCenterLng], cfg.mapZoom);

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
    return new Date(ts).toLocaleTimeString();
  }

  function addIncident(incident) {
    var typeClass = classifyType(incident.incidentType);

    // Add marker to map
    var marker = L.marker([incident.lat, incident.lng], {
      icon: createIcon(typeClass),
    }).addTo(map);

    // Build popup using safe DOM construction
    var popupEl = document.createElement("div");
    var strong = document.createElement("strong");
    strong.textContent = incident.incidentType;
    popupEl.appendChild(strong);
    popupEl.appendChild(document.createElement("br"));
    popupEl.appendChild(document.createTextNode(incident.location));
    popupEl.appendChild(document.createElement("br"));
    var em = document.createElement("em");
    em.textContent = "Units: " + incident.units.join(", ");
    popupEl.appendChild(em);
    popupEl.appendChild(document.createElement("br"));
    var small = document.createElement("small");
    small.textContent = formatTime(incident.timestamp);
    popupEl.appendChild(small);
    marker.bindPopup(popupEl);

    // Add to sidebar list using safe DOM methods
    var list = document.getElementById("incident-list");
    var li = document.createElement("li");
    li.className = "type-" + typeClass;

    var typeDiv = document.createElement("div");
    typeDiv.className = "incident-type";
    typeDiv.textContent = incident.incidentType;
    li.appendChild(typeDiv);

    var locDiv = document.createElement("div");
    locDiv.className = "incident-location";
    locDiv.textContent = incident.location;
    li.appendChild(locDiv);

    var unitsDiv = document.createElement("div");
    unitsDiv.className = "incident-units";
    unitsDiv.textContent = incident.units.join(", ");
    li.appendChild(unitsDiv);

    var timeDiv = document.createElement("div");
    timeDiv.className = "incident-time";
    timeDiv.textContent = formatTime(incident.timestamp);
    li.appendChild(timeDiv);

    li.addEventListener("click", function () {
      map.setView([incident.lat, incident.lng], 15);
      marker.openPopup();
    });
    list.prepend(li);

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

  evtSource.onerror = function () {
    statusEl.textContent = "Reconnecting...";
    statusEl.className = "error";
  };
})();
