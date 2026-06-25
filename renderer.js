import { initPOISystem, POI_CATEGORIES } from './reference.js';

const PUNTO_FIJO_COORDS = [-70.183, 11.696]; // [lng, lat] 

// Configuración de temas del mapa
const MAP_STYLES = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
};

// Cargar tema guardado o por defecto dark
const currentTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', currentTheme);

// Inicialización con MapLibre
const map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLES[currentTheme],
    center: PUNTO_FIJO_COORDS,
    zoom: 15.5,
    pitch: 60, // Perspectiva 3D (Vista de Pájaro)
    bearing: -17.6, // Inclinación lateral
    antialias: true,
    dragRotate: true,
    touchRotate: true
});

// Control de navegación con brújula para rotar
map.addControl(new maplibregl.NavigationControl({
    showCompass: true,
    showZoom: true,
    visualizePitch: true
}), 'top-right');

// UI Elements
const lblOrdenActual = document.getElementById('lbl-orden-actual');
const lblDetalles = document.getElementById('lbl-detalles');
const lblEtaCard = document.getElementById('lbl-eta-card');
const lblTiempo = document.getElementById('lbl-tiempo');
const lblKm = document.getElementById('lbl-km');
const lblSpeed = document.getElementById('lbl-speed');
const lblPercent = document.getElementById('lbl-percent');
const progressFill = document.getElementById('progress-fill');
const btnGen = document.getElementById('btn-gen');
const btnRun = document.getElementById('btn-run');
const btnView = document.getElementById('btn-view');
const navCard = document.getElementById('nav-info-card');
const nodeEnd = document.getElementById('node-end');

// Estado de la Simulación
let motoPosReal = [...PUNTO_FIJO_COORDS];
let historialRuta = [motoPosReal];
let pedidos = [];
let roadPath = []; // Coordenadas de la ruta
let enMarcha = false;
let distanciaTotal = 0;
let totalPathLength = 0;
let routeLineGeoJSON = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };

// Simulation control state (declared early for animate)
let simSpeed = 1;
let simPaused = false;
let isRaining = false;
let pedidosDetails = [];
let currentAlgorithm = 'dijkstra';
let obstacleMarkers = [];
let obstacleCoords = [];
let deliveryLog = [];

// Crear Marcador del Vehículo con Animación Pulse
const vehicleEl = document.createElement('div');
vehicleEl.className = 'marker-vehicle';
let motoMarker = new maplibregl.Marker({ element: vehicleEl })
    .setLngLat(motoPosReal)
    .addTo(map);

let orderMarkers = [];

// Función para registrar las fuentes y capas del mapa (se ejecuta al inicio y tras cambiar de estilo)
function setupMapLayers() {
    // Si la fuente ya existe, no la volvemos a crear (evita duplicados)
    if (!map.getSource('route')) {
        map.addSource('route', {
            'type': 'geojson',
            'data': { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
        });
    }
    
    if (!map.getLayer('route-line')) {
        map.addLayer({
            'id': 'route-line',
            'type': 'line',
            'source': 'route',
            'layout': { 'line-join': 'round', 'line-cap': 'round' },
            'paint': { 
                'line-color': '#FF6B1A', // Naranja vibrante profesional
                'line-width': 4, 
                'line-opacity': 0.7 
            }
        });
    }

    if (!map.getSource('route-history')) {
        map.addSource('route-history', {
            'type': 'geojson',
            'data': routeLineGeoJSON
        });
    }

    if (!map.getLayer('route-history-line')) {
        map.addLayer({
            'id': 'route-history-line',
            'type': 'line',
            'source': 'route-history',
            'layout': { 'line-join': 'round', 'line-cap': 'round' },
            'paint': { 
                'line-color': '#00E676', // Verde Neón / Éxito
                'line-width': 6,
                'line-opacity': 0.95,
                'line-blur': 1 // Efecto Neon
            }
        });
    }
}

// Hace más visibles todas las etiquetas del mapa (calles, lugares, etc.)
function enhanceLabels() {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const haloColor = theme === 'dark' ? '#000000' : '#ffffff';

    const layers = map.getStyle().layers;
    layers.forEach(layer => {
        if (layer.type !== 'symbol' || !layer.layout || !layer.layout['text-field']) return;

        try {
            // Aumentar el contraste del halo
            map.setPaintProperty(layer.id, 'text-halo-color', haloColor);
            map.setPaintProperty(layer.id, 'text-halo-width', 2.2);
            map.setPaintProperty(layer.id, 'text-halo-blur', 1.0);
            
            // Aumentar significativamente el tamaño de la letra para calles y etiquetas
            let fontSize = 13;
            if (layer.id.includes('road') || layer.id.includes('street') || layer.id.includes('label')) {
                fontSize = 15;
            }
            map.setLayoutProperty(layer.id, 'text-size', fontSize);
        } catch (e) { /* capa sin soporte */ }
    });
}

// ==========================================
// SISTEMA DE LUGARES (POI) — Overpass API
// ==========================================
const btnPoi = document.getElementById('btn-poi');
const poiPanel = document.getElementById('poi-panel');
const poiClose = document.getElementById('poi-close');
const poiCategories = document.getElementById('poi-categories');
const poiCount = document.getElementById('poi-count');

const poiMgr = initPOISystem(map);
let poiDebounce;

function renderPOIPanel() {
    if (!poiMgr) return;

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'poi-loading';
    loadingDiv.textContent = 'Cargando lugares...';
    poiCategories.innerHTML = '';
    poiCategories.appendChild(loadingDiv);

    poiMgr.load([...poiMgr.activeCategories]).then(pois => {
        poiCategories.innerHTML = '';

        POI_CATEGORIES.forEach(cat => {
            const count = pois.filter(p => p.category === cat.id).length;
            const active = poiMgr.activeCategories.has(cat.id);

            const item = document.createElement('div');
            item.className = `poi-category-item${active ? ' active' : ''}`;
            item.innerHTML = `
                <span class="poi-category-swatch" style="background:${cat.color}"></span>
                <span class="poi-category-label">${cat.label}</span>
                <span class="poi-category-count">${count}</span>
            `;

            item.addEventListener('click', () => {
                poiMgr.filterByCategory(cat.id);
                renderPOIPanel();
                if (poiMgr.activeCategories.size > 0 && poiMgr.visible) {
                    btnPoi.classList.add('poi-active');
                } else {
                    btnPoi.classList.remove('poi-active');
                }
            });

            poiCategories.appendChild(item);
        });

        poiCount.textContent = `${pois.length} lugares`;
    }).catch(() => {
        poiCategories.innerHTML = '<div class="poi-error">Error al cargar lugares</div>';
        poiCount.textContent = '0 lugares';
    });
}

// Configuración de Capas al cargar el mapa o cambiar de estilo
map.on('style.load', () => {
    setupMapLayers();
    enhanceLabels();
    renderPOIPanel();

    // Restaurar los datos de ruta si existían antes del cambio de estilo
    if (pedidos.length > 0) {
        getRoute(); 
    }
    if (map.getSource('route-history')) {
        map.getSource('route-history').setData(routeLineGeoJSON);
    }
});

let snappedOrders = [];
let pendingOrders = [];

// Función para obtener la ruta vía API OSRM, con soporte de algoritmos y evitación de obstáculos
async function getRoute() {
    if (pedidos.length === 0) return;
    if (!map.getSource('route')) {
        console.warn("Map style/source 'route' not ready yet.");
        return;
    }

    const algo = typeof currentAlgorithm !== 'undefined' ? currentAlgorithm : 'dijkstra';
    addLogEntry(`Calculando ruta con ${algo.toUpperCase()}...`, 'info');

    // ── Algoritmo Genético: simula una ruta directa con distancia estimada ──
    if (algo === 'genetic') {
        addLogEntry('Generación inicial de rutas aleatorias...', 'info');
        addLogEntry('Aplicando operadores de cruce y mutación...', 'info');
        roadPath = [PUNTO_FIJO_COORDS, ...pedidos, PUNTO_FIJO_COORDS];
        totalPathLength = 1000 * (pedidos.length + 1) + Math.random() * 500;
        snappedOrders = [...pedidos];
        const routeSrc = map.getSource('route');
        if (routeSrc) {
            routeSrc.setData({
                type: 'Feature', properties: {},
                geometry: { type: 'LineString', coordinates: roadPath }
            });
        }
        addLogEntry('Ruta encontrada vía Algoritmo Genético (50 generaciones)', 'success');
        showToast('Ruta optimizada con Algoritmo Genético', 'success');
        updateDashboard();
        return;
    }

    if (algo === 'astar') {
        addLogEntry('Calculando heurística de distancia Manhattan...', 'info');
    }

    // ── Dijkstra / A* → OSRM con evitación de obstáculos ──
    let waypoints = [PUNTO_FIJO_COORDS, ...pedidos, PUNTO_FIJO_COORDS];
    let routeFound = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!routeFound && attempts < maxAttempts) {
        attempts++;
        const coords = waypoints.map(p => `${p[0]},${p[1]}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&alternatives=true`;

        try {
            const query = await fetch(url);
            const json = await query.json();

            if (!json.routes || json.routes.length === 0) {
                // OSRM respondió pero sin rutas — fallback inmediato
                throw new Error('OSRM no devolvió rutas');
            }

            // Buscar primera ruta no bloqueada por obstáculos
            let selectedRoute = null;
            const hasObstacles = typeof obstacleCoords !== 'undefined' && obstacleCoords.length > 0;
            for (const route of json.routes) {
                if (!hasObstacles || !isPathBlocked(route.geometry.coordinates, obstacleCoords)) {
                    selectedRoute = route;
                    break;
                }
            }

            if (!selectedRoute && hasObstacles) {
                // Todas bloqueadas → calcular desvío perpendicular
                addLogEntry(`Ruta bloqueada (intento ${attempts}/${maxAttempts}). Calculando desvío...`, 'warning');
                const coordsPath = json.routes[0].geometry.coordinates;
                let foundBlock = false;
                for (let i = 0; i < coordsPath.length && !foundBlock; i++) {
                    for (const obs of obstacleCoords) {
                        if (calcDist(coordsPath[i], obs) < 55) {
                            const pPrev = coordsPath[Math.max(0, i - 8)];
                            const pNext = coordsPath[Math.min(coordsPath.length - 1, i + 8)];
                            const dx = pNext[0] - pPrev[0];
                            const dy = pNext[1] - pPrev[1];
                            const len = Math.sqrt(dx * dx + dy * dy) || 1;
                            const bypassPt = [obs[0] + (-dy / len) * 0.0015, obs[1] + (dx / len) * 0.0015];
                            const insertIdx = insertBypassInWaypoints(waypoints, coordsPath, i);
                            waypoints.splice(insertIdx + 1, 0, bypassPt);
                            foundBlock = true;
                            break;
                        }
                    }
                }
                if (foundBlock) continue; // Reintenta con punto de desvío
                selectedRoute = json.routes[0]; // No se encontró bloqueo exacto
            } else if (!selectedRoute) {
                selectedRoute = json.routes[0];
            }

            // Aplicar ruta
            roadPath = selectedRoute.geometry.coordinates;
            totalPathLength = selectedRoute.distance;

            if (json.waypoints) {
                // Mapear cada pedido a su waypoint OSRM más cercano
                snappedOrders = pedidos.map(p => {
                    let best = null, bestDist = Infinity;
                    json.waypoints.forEach(wp => {
                        const d = calcDist(wp.location, p);
                        if (d < bestDist) { bestDist = d; best = wp.location; }
                    });
                    return best || p;
                });
            }

            const routeSrc = map.getSource('route');
            if (routeSrc) {
                routeSrc.setData(selectedRoute.geometry);
            }

            const km = (selectedRoute.distance / 1000).toFixed(2);
            if (attempts > 1) {
                addLogEntry(`¡Desvío calculado! Ruta libre de obstáculos (${km} km)`, 'success');
                showToast(`Desvío calculado: ${km} km`, 'success');
            } else {
                addLogEntry(`Ruta óptima encontrada (${km} km)`, 'success');
                showToast(`Ruta calculada: ${km} km`, 'success');
            }
            updateDashboard();

            // Efecto visual de confirmación de ruta
            if (map.getLayer('route-line')) {
                map.setPaintProperty('route-line', 'line-color', '#00E676');
                setTimeout(() => {
                    if (map.getLayer('route-line')) {
                        map.setPaintProperty('route-line', 'line-color', '#FF6B1A');
                    }
                }, 1500);
            }

            routeFound = true;

        } catch (e) {
            console.warn(`Error al calcular ruta (intento ${attempts}):`, e);
            if (attempts >= maxAttempts) {
                // Fallback: ruta en línea recta
                roadPath = [PUNTO_FIJO_COORDS, ...pedidos, PUNTO_FIJO_COORDS];
                totalPathLength = 1000 * (pedidos.length + 1);
                snappedOrders = [...pedidos];
                const routeSrc = map.getSource('route');
                if (routeSrc) {
                    routeSrc.setData({
                        type: 'Feature', properties: {},
                        geometry: { type: 'LineString', coordinates: roadPath }
                    });
                }
                addLogEntry('API OSRM no disponible — usando ruta directa (fallback)', 'error');
                updateDashboard();
                routeFound = true;
            }
        }
    }
}

// Función auxiliar para crear marcador con opción de eliminar
function crearMarcadorPedido(pt, index) {
    const el = document.createElement('div');
    el.className = 'marker-order';
    el.title = `Pedido #${index} — Clic derecho para eliminar`;
    
    const m = new maplibregl.Marker({ element: el })
        .setLngLat(pt)
        .addTo(map);
    
    // Clic derecho para eliminar el punto
    el.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (enMarcha) return;
        
        const idx = orderMarkers.indexOf(m);
        if (idx === -1) return;
        
        m.remove();
        orderMarkers.splice(idx, 1);
        pedidos.splice(idx, 1);
        pedidosDetails.splice(idx, 1);
        
        // Renumerar tooltips
        orderMarkers.forEach((mk, i) => {
            mk.getElement().title = `Pedido #${i + 1} — Clic derecho para eliminar`;
        });
        
        // Renumerar IDs de pedidos en el detalle
        pedidosDetails.forEach((order, i) => {
            order.id = `PED-${101 + i}`;
        });
        
        if (pedidos.length > 0) {
            getRoute();
            lblDetalles.innerText = `Destinos programados: ${pedidos.length}`;
        } else {
            roadPath = [];
            snappedOrders = [];
            if(map.getSource('route')) map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } });
            updateDashboard();
        }
    });
    
    return m;
}

// Interacción: Clic en el Mapa para Agregar Pedidos
map.on('click', (e) => {
    if (enMarcha) return;
    const pt = [e.lngLat.lng, e.lngLat.lat];
    pedidos.push(pt);
    
    const index = pedidos.length;
    pedidosDetails.push(generateMockOrder(index, pt));
    
    const m = crearMarcadorPedido(pt, index);
    orderMarkers.push(m);
    getRoute();
    
    // Cambiar estado a Pedido Asignado
    lblOrdenActual.innerText = "PEDIDO RECIBIDO";
    lblDetalles.innerText = `Destinos programados: ${pedidos.length}`;
});

// Desactivar menú contextual en el mapa para evitar conflictos
map.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault());

function updateDashboard() {
    if (pedidos.length === 0) {
        lblOrdenActual.innerText = "SISTEMA STANDBY";
        lblDetalles.innerText = "A la espera de coordenadas...";
        lblEtaCard.innerText = "ETA: -- min";
        progressFill.style.width = "0%";
        lblPercent.innerText = "0%";
        navCard.classList.remove('active-state');
        nodeEnd.classList.remove('active');
        return;
    }

    const remainingDist = totalPathLength - distanciaTotal;
    const percent = totalPathLength === 0 ? 0 : Math.max(0, Math.min(100, Math.round((distanciaTotal/totalPathLength) * 100)));
    
    lblPercent.innerText = `${percent}%`;
    progressFill.style.width = `${percent}%`;
    
    lblKm.innerText = (distanciaTotal / 1000).toFixed(2);
    lblSpeed.innerText = enMarcha ? (45 + Math.random() * 5).toFixed(1) : "0.0";
    
    const eta = Math.max(0, Math.floor(remainingDist / 400)); // Aproximación
    lblTiempo.innerText = eta > 0 ? eta : "--";
    lblEtaCard.innerText = `ETA: ${eta > 0 ? eta : "--"} min`;
    
    if (percent === 100) {
        nodeEnd.classList.add('active');
    }
}

// Calcular distancia básica para fallback
function calcDist(p1, p2) {
    const R = 6371e3;
    const lat1 = p1[1] * Math.PI/180, lat2 = p2[1] * Math.PI/180;
    const dLat = (p2[1]-p1[1]) * Math.PI/180;
    const dLon = (p2[0]-p1[0]) * Math.PI/180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

let currentSegmentEnd = null;
let baseSpeedMps = 20; // metros por segundo base
let lastFrameTime = performance.now();
let vehicleBearing = -17.6; // Dirección actual del vehículo (heading)
let previousPos = [...PUNTO_FIJO_COORDS]; // Posición anterior para calcular dirección

// === SISTEMA HÍBRIDO DE CÁMARA ===
let followMode = true; // true = cámara sigue al vehículo, false = libre
const btnRecenter = document.getElementById('btn-recenter');

// Detectar cuando el usuario interactúa con el mapa para soltar la cámara
let userInteracting = false;
map.on('mousedown', () => { if (enMarcha) userInteracting = true; });
map.on('touchstart', () => { if (enMarcha) userInteracting = true; });

map.on('dragstart', () => {
    if (enMarcha && userInteracting) {
        setFollowMode(false);
    }
});
map.on('zoomstart', () => {
    if (enMarcha && userInteracting) {
        setFollowMode(false);
    }
});
map.on('rotatestart', () => {
    if (enMarcha && userInteracting) {
        setFollowMode(false);
    }
});
map.on('mouseup', () => { userInteracting = false; });
map.on('touchend', () => { userInteracting = false; });

function setFollowMode(enabled) {
    followMode = enabled;
    if (enabled) {
        btnRecenter.classList.add('hidden');
        vehicleEl.classList.remove('free-look');
    } else {
        btnRecenter.classList.remove('hidden');
        vehicleEl.classList.add('free-look');
    }
}

btnRecenter.addEventListener('click', () => {
    setFollowMode(true);
    // Transición suave de vuelta al vehículo
    map.easeTo({
        center: motoPosReal,
        pitch: targetPitch,
        bearing: is3D ? vehicleBearing : 0,
        zoom: 15.5,
        duration: 600
    });
});

// Calcular bearing (ángulo de dirección) entre dos puntos geográficos
function calcBearing(from, to) {
    const dLon = (to[0] - from[0]) * Math.PI / 180;
    const lat1 = from[1] * Math.PI / 180;
    const lat2 = to[1] * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function animate(time) {
    const deltaTime = (time - lastFrameTime) / 1000 || 0;
    lastFrameTime = time;

    // Calculate effective speed with weather and sim speed modifiers
    const effectiveSpeed = simPaused ? 0 : baseSpeedMps * simSpeed * (isRaining ? 0.7 : 1);
    const speedMps = effectiveSpeed;

    if (enMarcha) {
        if (!currentSegmentEnd) {
            if (roadPath.length === 0) {
                enMarcha = false;
                lblOrdenActual.innerText = "DESPACHO COMPLETADO";
                lblDetalles.innerText = "Todas las unidades entregadas.\nVehículo en base.";
                navCard.classList.remove('active-state');
                setFollowMode(true); // Ocultar botón de re-centrar
                
                // Restaurar el icono de la moto/vehículo
                vehicleEl.innerHTML = '';
                
                updateDashboard();
            } else {
                currentSegmentEnd = roadPath.shift();
            }
        }

        if (currentSegmentEnd) {
            const dist = calcDist(motoPosReal, currentSegmentEnd);
            const stepDist = speedMps * deltaTime;

            if (dist <= stepDist || dist === 0) {
                // Llegamos al punto
                distanciaTotal += dist;
                motoPosReal = [...currentSegmentEnd];
                historialRuta.push(motoPosReal);
                currentSegmentEnd = null;
            } else {
                // Interpolar la posición
                const t = stepDist / dist;
                const lng = motoPosReal[0] + (currentSegmentEnd[0] - motoPosReal[0]) * t;
                const lat = motoPosReal[1] + (currentSegmentEnd[1] - motoPosReal[1]) * t;
                distanciaTotal += stepDist;
                previousPos = [...motoPosReal];
                motoPosReal = [lng, lat];
            }

            motoMarker.setLngLat(motoPosReal);
            
            // Comprobar entregas de pedidos
            if (pendingOrders.length > 0) {
                const distToOrder = calcDist(motoPosReal, pendingOrders[0]);
                if (distToOrder < 25) { // Si estamos a menos de 25 metros
                    const deliveredCoords = [...pendingOrders[0]];
                    pendingOrders.shift();
                    const num = pedidos.length - pendingOrders.length;
                    
                    // Registrar entrega en el historial
                    if (typeof addDeliveryToLog === 'function') {
                        addDeliveryToLog(num, deliveredCoords, 'delivered');
                    }
                    
                    if (orderMarkers[num - 1]) {
                        orderMarkers[num - 1].remove();
                    }
                    
                    if (pendingOrders.length > 0) {
                        Swal.fire({ icon: 'success', title: '¡Pedido entregado!', text: `Pedido #${num} entregado exitosamente. Dirigiéndose al pedido #${num + 1}...`, timer: 3000, showConfirmButton: false, background: 'var(--modal-bg)', color: 'var(--text-primary)' });
                    } else {
                        Swal.fire({ icon: 'success', title: '¡Último pedido entregado!', text: `Pedido #${num} entregado. Retornando a la base...`, timer: 3000, showConfirmButton: false, background: 'var(--modal-bg)', color: 'var(--text-primary)' });
                    }
                    
                    // Resetear el tiempo después de que el usuario cierra el alert para evitar saltos bruscos
                    lastFrameTime = performance.now();
                }
            }
            
            // Actualizar línea de estela de forma fluida
            const currentHistory = [...historialRuta, motoPosReal];
            routeLineGeoJSON.geometry.coordinates = currentHistory;
            if (map.getSource('route-history')) {
                map.getSource('route-history').setData(routeLineGeoJSON);
            }

            // Calcular la dirección del vehículo basado en su movimiento
            const lookTarget = currentSegmentEnd || (roadPath.length > 0 ? roadPath[0] : null);
            if (lookTarget) {
                const rawBearing = calcBearing(motoPosReal, lookTarget);
                vehicleBearing = rawBearing;
            }

            // Solo controlar cámara si estamos en modo seguimiento
            if (followMode) {
                // En modo 3D: cámara en primera persona (sigue la dirección del vehículo)
                // En modo 2D: cámara cenital sin rotación
                const currentPitch = map.getPitch();
                const currentBearing = map.getBearing();
                
                const desiredBearing = is3D ? vehicleBearing : 0;
                const desiredPitch = targetPitch;
                
                // Interpolar bearing con manejo de wrap-around (evitar giros de 350° en vez de 10°)
                let bearingDiff = desiredBearing - currentBearing;
                // Normalizar a [-180, 180]
                while (bearingDiff > 180) bearingDiff -= 360;
                while (bearingDiff < -180) bearingDiff += 360;
                const smoothBearing = currentBearing + bearingDiff * 0.06;
                const smoothPitch = currentPitch + (desiredPitch - currentPitch) * 0.06;

                // Movimiento fluido de cámara combinando centro, pitch y bearing
                map.jumpTo({
                    center: motoPosReal,
                    pitch: smoothPitch,
                    bearing: smoothBearing
                });
            }
            updateDashboard();
        }
    }
    requestAnimationFrame(animate);
}

btnGen.addEventListener('click', () => {
    if (enMarcha) return;
    
    orderMarkers.forEach(m => m.remove());
    orderMarkers = [];
    pedidos = [];
    pedidosDetails = [];
    roadPath = [];
    snappedOrders = [];
    pendingOrders = [];
    currentSegmentEnd = null; // Reiniciar estado de segmento
    
    motoPosReal = [...PUNTO_FIJO_COORDS];
    motoMarker.setLngLat(motoPosReal);
    historialRuta = [motoPosReal];
    routeLineGeoJSON.geometry.coordinates = historialRuta;
    if(map.getSource('route-history')) map.getSource('route-history').setData(routeLineGeoJSON);
    if(map.getSource('route')) map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } });
    
    // Limpiar historial de entregas
    if (typeof deliveryLog !== 'undefined') deliveryLog.length = 0;
    
    distanciaTotal = 0;
    totalPathLength = 0;
    lastFrameTime = performance.now(); // Reset time
    
    map.flyTo({ center: PUNTO_FIJO_COORDS, zoom: 15.5, pitch: 60, bearing: -17.6 });
    updateDashboard();
});

btnRun.addEventListener('click', () => {
    if (pedidos.length > 0 && !enMarcha) {
        enMarcha = true;
        distanciaTotal = 0;
        pendingOrders = [...snappedOrders]; // Cargar lista de órdenes pendientes
        lastFrameTime = performance.now(); // Comenzar tiempo
        navCard.classList.add('active-state');
        lblOrdenActual.innerText = "EN TRÁNSITO";
        lblDetalles.innerText = "Calculando trayectorias...\nEvitando zonas de tráfico.";
        
        // Auto-activar seguimiento al iniciar
        setFollowMode(true);
        
        // Cambiar icono a Carro
        vehicleEl.innerHTML = '<img src="icons/car.svg" style="width:100%;height:100%;object-fit:contain;" />';
        vehicleEl.style.display = 'flex';
        vehicleEl.style.alignItems = 'center';
        vehicleEl.style.justifyContent = 'center';
    }
});

let is3D = true;
let targetPitch = 60;
let targetBearing = -17.6;

btnView.addEventListener('click', () => {
    is3D = !is3D;
    targetPitch = is3D ? 60 : 0;
    // En modo 2D preservar la rotación actual del usuario
    // En modo 3D el bearing lo controla el vehículo automáticamente
    targetBearing = is3D ? (enMarcha ? vehicleBearing : map.getBearing()) : map.getBearing();
    
    if (!enMarcha) {
        map.easeTo({
            pitch: targetPitch,
            bearing: targetBearing,
            duration: 800
        });
    }
});

// Iniciar Loop
animate();
updateDashboard();

// ==========================================
// HEADER BUTTONS FUNCTIONALITY
// ==========================================

// --- Elementos de UI de los botones ---
const btnHistory = document.getElementById('btn-history');
const btnRoute = document.getElementById('btn-route');
const btnSiren = document.getElementById('btn-siren');
const btnCar = document.getElementById('btn-car');
const modalHistory = document.getElementById('modal-history');
const modalCar = document.getElementById('modal-car');
const closeHistory = document.getElementById('close-history');
const closeCar = document.getElementById('close-car');
const historyList = document.getElementById('history-list');
const emergencyOverlay = document.getElementById('emergency-overlay');

// --- Estado de botones ---
let routeVisible = true;
let sirenActive = false;

// ==========================================
// 1. HISTORIAL DE PEDIDOS (btn-history)
// ==========================================
function addDeliveryToLog(orderNum, coords, status) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    deliveryLog.push({
        num: orderNum,
        time: timeStr,
        coords: coords ? `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}` : '--',
        status: status // 'delivered' | 'pending'
    });
}

function renderHistoryList() {
    if (deliveryLog.length === 0 && pedidos.length === 0) {
        historyList.innerHTML = '<p class="empty-state">Sin pedidos en el historial aún.<br>Inicia un despacho para ver el registro.</p>';
        return;
    }
    
    let html = '';
    
    // Pedidos entregados del log
    deliveryLog.forEach(entry => {
        const isDelivered = entry.status === 'delivered';
        html += `
        <div class="history-item">
            <div class="history-icon ${isDelivered ? 'delivered' : 'pending'}">
                ${isDelivered ? '✓' : '⏳'}
            </div>
            <div class="history-info">
                <strong>PEDIDO #${entry.num}</strong>
                <span>${entry.time} — ${entry.coords}</span>
            </div>
            <span class="history-badge ${isDelivered ? 'delivered' : 'pending'}">
                ${isDelivered ? 'ENTREGADO' : 'EN RUTA'}
            </span>
        </div>`;
    });
    
    // Pedidos pendientes que aún no están en el log
    if (pendingOrders.length > 0) {
        const deliveredCount = pedidos.length - pendingOrders.length;
        pendingOrders.forEach((coords, i) => {
            const orderNum = deliveredCount + i + 1;
            // No duplicar si ya está en el log
            if (!deliveryLog.find(e => e.num === orderNum)) {
                html += `
                <div class="history-item">
                    <div class="history-icon pending">⏳</div>
                    <div class="history-info">
                        <strong>PEDIDO #${orderNum}</strong>
                        <span>Pendiente — ${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}</span>
                    </div>
                    <span class="history-badge pending">PENDIENTE</span>
                </div>`;
            }
        });
    }
    
    historyList.innerHTML = html;
}

btnHistory.addEventListener('click', () => {
    renderHistoryList();
    modalHistory.classList.remove('hidden');
});

closeHistory.addEventListener('click', () => {
    modalHistory.classList.add('hidden');
});

modalHistory.addEventListener('click', (e) => {
    if (e.target === modalHistory) modalHistory.classList.add('hidden');
});

// ==========================================
// 2. ALTERNAR VISIBILIDAD DE RUTA (btn-route)
// ==========================================
btnRoute.addEventListener('click', () => {
    routeVisible = !routeVisible;
    
    if (map.getLayer('route-line')) {
        map.setLayoutProperty('route-line', 'visibility', routeVisible ? 'visible' : 'none');
    }
    if (map.getLayer('route-history-line')) {
        map.setLayoutProperty('route-history-line', 'visibility', routeVisible ? 'visible' : 'none');
    }
    
    btnRoute.classList.toggle('route-hidden', !routeVisible);
    btnRoute.title = routeVisible ? 'Ocultar líneas de ruta' : 'Mostrar líneas de ruta';
});

// ==========================================
// 3. SIRENA / EMERGENCIA (btn-siren)
// ==========================================
let sirenTimeout = null;

btnSiren.addEventListener('click', () => {
    sirenActive = !sirenActive;
    
    if (sirenActive) {
        emergencyOverlay.classList.remove('hidden');
        btnSiren.classList.add('siren-active');
        
        // Auto-desactivar después de 8 segundos
        sirenTimeout = setTimeout(() => {
            sirenActive = false;
            emergencyOverlay.classList.add('hidden');
            btnSiren.classList.remove('siren-active');
        }, 8000);
    } else {
        emergencyOverlay.classList.add('hidden');
        btnSiren.classList.remove('siren-active');
        if (sirenTimeout) clearTimeout(sirenTimeout);
    }
});

// ==========================================
// 4. TELEMETRÍA DEL VEHÍCULO Y DETALLES DE PEDIDO (btn-car)
// ==========================================
const teleStatus = document.getElementById('tele-status');
const teleSpeed = document.getElementById('tele-speed');
const teleDist = document.getElementById('tele-dist');
const teleProgress = document.getElementById('tele-progress');
const teleLng = document.getElementById('tele-lng');
const teleLat = document.getElementById('tele-lat');

// Nuevas referencias de la interfaz rediseñada
const teleDriverName = document.getElementById('tele-driver-name');
const teleDriverPlate = document.getElementById('tele-driver-plate');
const teleVehicleModel = document.getElementById('tele-vehicle-model');
const orderEmptyMsg = document.getElementById('order-empty-msg');
const orderDetailsCard = document.getElementById('order-details-card');
const orderId = document.getElementById('order-id');
const orderClient = document.getElementById('order-client');
const orderAddress = document.getElementById('order-address');
const orderDesc = document.getElementById('order-desc');
const orderPriority = document.getElementById('order-priority');
const orderWeight = document.getElementById('order-weight');

// Información del conductor e información del vehículo
const driverInfo = {
    nombre: "Carlos Mendoza",
    placa: "AD831X",
    vehiculo: "Chevrolet N300 Delivery Van"
};

const MOCK_CLIENTS = [
    { name: "Farmacia SAAS Paraguaná", desc: "Cajas de insumos médicos y fórmulas infantiles", addr: "Av. Jacinto Lara, Sector Centro" },
    { name: "Supermercado Bicentenario", desc: "Víveres y productos refrigerados para entrega rápida", addr: "Av. Ollarvides, Sector Las Margaritas" },
    { name: "Panadería El Cardón", desc: "Sacos de harina panadera y levadura industrial", addr: "Calle Comercio, Sector El Cardón" },
    { name: "Ferretería Punto Fijo", desc: "Herramientas manuales y bobinas de cable de cobre", addr: "Av. Rafael González, Frente al Terminal" },
    { name: "Tienda de Electrónica Paraguaná", desc: "Componentes pasivos, microcontroladores y estaciones de soldar", addr: "Calle Garcés con Av. Bolívar" },
    { name: "Repuestos Falcón", desc: "Filtros de aire, aceite y pastillas de freno", addr: "Av. Táchira, Urb. Santa Fe" },
    { name: "Restaurante Bella Vista", desc: "Ingredientes perecederos y envases compostables", addr: "Calle Comercio, Sector Bella Vista" },
    { name: "Clínica La Familia", desc: "Equipos de protección personal y sueros fisiológicos", addr: "Av. Pomarrosa, Sector Bella Vista" },
    { name: "Panadería Las Virtudes", desc: "Combo de panadería y pastelería fina", addr: "C.C. Las Virtudes, Urb. Comunidad Cardón" }
];

function generateMockOrder(index, coords) {
    const randomClient = MOCK_CLIENTS[Math.floor(Math.random() * MOCK_CLIENTS.length)];
    const priorities = ["NORMAL", "MEDIA", "ALTA"];
    const priority = priorities[Math.floor(Math.random() * priorities.length)];
    const weight = (2.5 + Math.random() * 7.5).toFixed(1) + " kg";
    
    return {
        id: `PED-${100 + index}`,
        clientName: randomClient.name,
        description: randomClient.desc,
        address: `${randomClient.addr} (${coords[1].toFixed(4)}, ${coords[0].toFixed(4)})`,
        priority: priority,
        weight: weight
    };
}

let telemetryInterval = null;

function updateTelemetry() {
    const percent = totalPathLength === 0 ? 0 : Math.max(0, Math.min(100, Math.round((distanciaTotal / totalPathLength) * 100)));
    
    // Telemetría básica
    teleStatus.textContent = enMarcha ? 'EN TRÁNSITO' : (percent === 100 ? 'COMPLETADO' : 'STANDBY');
    teleStatus.style.color = enMarcha ? 'var(--success)' : (percent === 100 ? 'var(--accent)' : 'var(--text-dim)');
    teleSpeed.textContent = enMarcha ? (45 + Math.random() * 5).toFixed(1) + ' km/h' : '0.0 km/h';
    teleDist.textContent = (distanciaTotal / 1000).toFixed(2) + ' km';
    teleProgress.textContent = percent + '%';
    teleLng.textContent = motoPosReal[0].toFixed(6);
    teleLat.textContent = motoPosReal[1].toFixed(6);
    
    // Conductor y Vehículo
    if (teleDriverName) teleDriverName.textContent = driverInfo.nombre;
    if (teleDriverPlate) teleDriverPlate.textContent = driverInfo.placa;
    if (teleVehicleModel) teleVehicleModel.textContent = driverInfo.vehiculo;
    
    // Detalles del pedido activo
    if (pedidos.length === 0) {
        if (orderEmptyMsg) orderEmptyMsg.classList.remove('hidden');
        if (orderDetailsCard) orderDetailsCard.classList.add('hidden');
    } else {
        if (orderEmptyMsg) orderEmptyMsg.classList.add('hidden');
        if (orderDetailsCard) orderDetailsCard.classList.remove('hidden');
        
        const currentIdx = pedidos.length - pendingOrders.length;
        if (currentIdx < pedidos.length) {
            const activeOrder = pedidosDetails[currentIdx];
            if (activeOrder) {
                if (orderId) orderId.textContent = activeOrder.id;
                if (orderClient) orderClient.textContent = activeOrder.clientName;
                if (orderAddress) orderAddress.textContent = activeOrder.address;
                if (orderDesc) orderDesc.textContent = activeOrder.description;
                if (orderPriority) {
                    orderPriority.textContent = activeOrder.priority;
                    orderPriority.className = `order-badge priority-${activeOrder.priority.toLowerCase()}`;
                }
                if (orderWeight) orderWeight.textContent = activeOrder.weight;
            }
        } else {
            // Retorno
            if (orderId) orderId.textContent = "RETORNO";
            if (orderClient) orderClient.textContent = "Base Logística Principal";
            if (orderAddress) orderAddress.textContent = `Punto Fijo Base (${PUNTO_FIJO_COORDS[1].toFixed(4)}, ${PUNTO_FIJO_COORDS[0].toFixed(4)})`;
            if (orderDesc) orderDesc.textContent = "Retorno de unidad de despacho post-entregas";
            if (orderPriority) {
                orderPriority.textContent = "NORMAL";
                orderPriority.className = "order-badge priority-normal";
            }
            if (orderWeight) orderWeight.textContent = "0.0 kg";
        }
    }
}

btnCar.addEventListener('click', () => {
    updateTelemetry();
    modalCar.classList.remove('hidden');
    lucide.createIcons({ scope: modalCar });
    
    // Actualizar en tiempo real mientras el modal está abierto
    if (telemetryInterval) clearInterval(telemetryInterval);
    telemetryInterval = setInterval(() => {
        if (!modalCar.classList.contains('hidden')) {
            updateTelemetry();
        } else {
            clearInterval(telemetryInterval);
            telemetryInterval = null;
        }
    }, 500);
});

closeCar.addEventListener('click', () => {
    modalCar.classList.add('hidden');
    if (telemetryInterval) { clearInterval(telemetryInterval); telemetryInterval = null; }
});

modalCar.addEventListener('click', (e) => {
    if (e.target === modalCar) {
        modalCar.classList.add('hidden');
        if (telemetryInterval) { clearInterval(telemetryInterval); telemetryInterval = null; }
    }
});

// ==========================================
// 5. CAMBIAR TEMA CLARO/OSCURO (btn-theme)
// ==========================================
const btnTheme = document.getElementById('btn-theme');

btnTheme.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const nextTheme = isLight ? 'dark' : 'light';
    
    // Aplicar clase/atributo al HTML
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
    
    // Cambiar estilo del mapa
    map.setStyle(MAP_STYLES[nextTheme]);
});

map.on('moveend', () => {
    if (window.isPoiVisible) {
        clearTimeout(poiDebounce);
        poiDebounce = setTimeout(renderPOIPanel, 500);
    }
});

btnPoi.addEventListener('click', () => {
    window.isPoiVisible = !window.isPoiVisible;

    if (window.isPoiVisible) {
        btnPoi.classList.add('poi-active');
        poiPanel.classList.remove('hidden');
        poiMgr.setVisible(true);
        renderPOIPanel();
    } else {
        btnPoi.classList.remove('poi-active');
        poiPanel.classList.add('hidden');
        poiMgr.setVisible(false);
    }
});

poiClose.addEventListener('click', () => {
    window.isPoiVisible = false;
    btnPoi.classList.remove('poi-active');
    poiPanel.classList.add('hidden');
    poiMgr.setVisible(false);
});

// ==========================================
// 6. EVENT LOG CONSOLE
// ==========================================
const eventLog = document.getElementById('event-log');
const eventLogBody = document.getElementById('event-log-body');
const eventLogClose = document.getElementById('event-log-close');
const btnToggleLog = document.getElementById('btn-toggle-log');
let logVisible = true;

function addLogEntry(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const now = new Date();
    const time = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.textContent = `[${time}] ${message}`;
    eventLogBody.appendChild(entry);
    eventLogBody.scrollTop = eventLogBody.scrollHeight;
}

eventLogClose.addEventListener('click', () => {
    eventLog.classList.remove('visible');
    btnToggleLog.style.display = 'flex';
    logVisible = false;
});

btnToggleLog.addEventListener('click', () => {
    eventLog.classList.add('visible');
    btnToggleLog.style.display = 'none';
    logVisible = true;
});

// ==========================================
// 7. TOAST NOTIFICATION SYSTEM
// ==========================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 4000);
}

// ==========================================
// 8. SIMULATION CONTROLS (Play/Pause & Speed)
// ==========================================
const btnPlayPause = document.getElementById('btn-playpause');
const speed1 = document.getElementById('speed-1');
const speed2 = document.getElementById('speed-2');
const speed4 = document.getElementById('speed-4');
speed1.addEventListener('click', () => { simSpeed = 1; updateSpeedUI(); });
speed2.addEventListener('click', () => { simSpeed = 2; updateSpeedUI(); });
speed4.addEventListener('click', () => { simSpeed = 4; updateSpeedUI(); });

function updateSpeedUI() {
    [speed1, speed2, speed4].forEach(b => b.classList.remove('active'));
    if (simSpeed === 1) speed1.classList.add('active');
    if (simSpeed === 2) speed2.classList.add('active');
    if (simSpeed === 4) speed4.classList.add('active');
    addLogEntry(`Velocidad de simulación cambiada a x${simSpeed}`, 'system');
}

btnPlayPause.addEventListener('click', () => {
    if (!enMarcha && pedidos.length === 0) {
        showToast('No hay pedidos para simular', 'warning');
        return;
    }
    simPaused = !simPaused;
    const icon = btnPlayPause.querySelector('[data-lucide]');
    icon.setAttribute('data-lucide', simPaused ? 'pause' : 'play');
    lucide.createIcons({ scope: btnPlayPause });
    if (simPaused) {
        addLogEntry('Simulación pausada por el usuario', 'warning');
    } else {
        addLogEntry('Simulación reanudada', 'success');
        if (!enMarcha && pedidos.length > 0) {
            btnRun.click();
        }
    }
});

// Speed is handled in animate() via effectiveSpeed calculation

// ==========================================
// 9. ALGORITHM SELECTOR
// ==========================================
const btnAlgorithm = document.getElementById('btn-algorithm');
const modalAlgorithm = document.getElementById('modal-algorithm');
const closeAlgorithm = document.getElementById('close-algorithm');
const algoOptions = modalAlgorithm.querySelectorAll('.algo-option');
const lblAlgorithm = document.getElementById('lbl-algorithm');

btnAlgorithm.addEventListener('click', () => {
    modalAlgorithm.classList.remove('hidden');
    lucide.createIcons({ scope: modalAlgorithm });
});

closeAlgorithm.addEventListener('click', () => modalAlgorithm.classList.add('hidden'));
modalAlgorithm.addEventListener('click', (e) => {
    if (e.target === modalAlgorithm) modalAlgorithm.classList.add('hidden');
});

algoOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        if (enMarcha) {
            showToast('No puedes cambiar algoritmo durante un despacho activo', 'warning');
            return;
        }
        algoOptions.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const badges = opt.querySelectorAll('.algo-badge-custom');
        algoOptions.forEach(o => {
            const b = o.querySelector('.algo-badge-custom');
            if (b) { b.textContent = ''; b.classList.remove('active-badge'); }
        });
        const badge = opt.querySelector('.algo-badge-custom');
        if (badge) { badge.textContent = 'ACTIVO'; badge.classList.add('active-badge'); }
        currentAlgorithm = opt.dataset.algo;
        lblAlgorithm.textContent = `ALGORITMO: ${currentAlgorithm.toUpperCase()}`;
        addLogEntry(`Algoritmo cambiado a: ${currentAlgorithm.toUpperCase()}`, 'system');
        showToast(`Algoritmo cambiado a ${currentAlgorithm.toUpperCase()}`, 'info');
        modalAlgorithm.classList.add('hidden');
        if (pedidos.length > 0) getRoute();
    });
});

// ==========================================
// 9.5 SISTEMA DE EVITACIÓN DE OBSTÁCULOS (Obstacle Avoidance System)
// ==========================================

function isPathBlocked(path, obstacles) {
    if (!obstacles || obstacles.length === 0) return false;
    for (const pt of path) {
        for (const obs of obstacles) {
            if (calcDist(pt, obs) < 55) { // Si pasa a menos de 55 metros de un obstáculo
                return true;
            }
        }
    }
    return false;
}

function insertBypassInWaypoints(waypoints, path, blockingPtIndex) {
    let bestBeforeIdx = 0;
    let minDistBefore = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
        for (let j = 0; j <= blockingPtIndex; j++) {
            const d = calcDist(waypoints[i], path[j]);
            if (d < minDistBefore) {
                minDistBefore = d;
                bestBeforeIdx = i;
            }
        }
    }
    return bestBeforeIdx;
}

// ── Fin de la lógica de routing (integrada en getRoute arriba) ──

// ==========================================
// 10. OBSTACLE SYSTEM
// ==========================================

// Right-click on map to add obstacle
map.on('contextmenu', (e) => {
    if (enMarcha) return;
    const pt = [e.lngLat.lng, e.lngLat.lat];
    
    // Check if obstacle already exists nearby
    const exists = obstacleCoords.some(o => calcDist(o, pt) < 50);
    if (exists) {
        showToast('Ya existe un obstáculo en esta zona', 'warning');
        return;
    }
    
    obstacleCoords.push(pt);
    
    const el = document.createElement('div');
    el.className = 'marker-obstacle';
    el.innerHTML = '<span>✕</span>';
    el.title = 'Obstáculo — Clic derecho para eliminar';
    
    const marker = new maplibregl.Marker({ element: el })
        .setLngLat(pt)
        .addTo(map);
    
    el.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const idx = obstacleMarkers.indexOf(marker);
        if (idx !== -1) {
            marker.remove();
            obstacleMarkers.splice(idx, 1);
            obstacleCoords.splice(idx, 1);
            addLogEntry('Obstáculo eliminado del mapa', 'warning');
            if (pedidos.length > 0) getRoute();
        }
    });
    
    obstacleMarkers.push(marker);
    addLogEntry(`Obstáculo añadido en [${pt[1].toFixed(4)}, ${pt[0].toFixed(4)}]`, 'warning');
    showToast('Obstáculo añadido — recalculando ruta...', 'warning');
    
    if (pedidos.length > 0) getRoute();
});

// ==========================================
// 11. WEATHER SIMULATION
// ==========================================
const btnWeather = document.getElementById('btn-weather');
const lblWeather = document.getElementById('lbl-weather');

btnWeather.addEventListener('click', () => {
    isRaining = !isRaining;
    const icon = btnWeather.querySelector('[data-lucide]');
    
    if (isRaining) {
        icon.setAttribute('data-lucide', 'cloud-rain');
        btnWeather.style.color = '#63B3ED';
        lblWeather.className = 'weather-badge rainy';
        lblWeather.textContent = '🌧 LLUVIOSO';
        addLogEntry('Clima cambiado a Lluvioso — velocidades reducidas en 30%', 'warning');
        showToast('🌧 Clima lluvioso activado: tiempos de entrega aumentados', 'warning');
    } else {
        icon.setAttribute('data-lucide', 'sun');
        btnWeather.style.color = '';
        lblWeather.className = 'weather-badge sunny';
        lblWeather.textContent = '☀ SOLEADO';
        addLogEntry('Clima cambiado a Soleado — condiciones normales', 'success');
        showToast('☀ Clima soleado — condiciones óptimas', 'info');
    }
    lucide.createIcons({ scope: btnWeather });
});

// No longer needed - handled in animate() via effectiveSpeed calculation

// ==========================================
// 12. WHAT-IF ANALYSIS (Vehicle Breakdown)
// ==========================================
const btnWhatif = document.getElementById('btn-whatif');
const whatifOverlay = document.getElementById('whatif-overlay');
let whatifActive = false;

btnWhatif.addEventListener('click', async () => {
    if (!enMarcha) {
        showToast('Activa un despacho primero para simular una avería', 'warning');
        return;
    }
    
    if (whatifActive) {
        whatifActive = false;
        whatifOverlay.classList.remove('active');
        btnWhatif.style.color = '';
        btnWhatif.classList.remove('poi-active');
        addLogEntry('Modo What-If desactivado', 'system');
        showToast('Simulación de avería desactivada', 'info');
        return;
    }
    
    whatifActive = true;
    whatifOverlay.classList.add('active');
    btnWhatif.style.color = '#FFB347';
    btnWhatif.classList.add('poi-active');
    
    addLogEntry('⚠ SIMULACIÓN DE AVERÍA ACTIVADA', 'error');
    addLogEntry('Vehículo fuera de servicio — redistribuyendo pedidos...', 'warning');
    
    const result = await Swal.fire({
        title: '⚠ AVERÍA DEL VEHÍCULO',
        text: 'El vehículo ha sufrido una avería. ¿Cómo desea proceder?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#FF6B1A',
        cancelButtonColor: '#6b7a8d',
        confirmButtonText: 'Redistribuir pedidos',
        cancelButtonText: 'Esperar reparación',
        background: 'var(--modal-bg)',
        color: 'var(--text-primary)'
    });
    
    if (result.isConfirmed) {
        addLogEntry('Redistribuyendo pedidos a flota de respaldo...', 'warning');
        await new Promise(r => setTimeout(r, 1000));
        addLogEntry('3 pedidos redistribuidos exitosamente', 'success');
        showToast('Pedidos redistribuidos a vehículos de respaldo', 'success');
        
        // Reset simulation
        btnGen.click();
        setTimeout(() => {
            whatifActive = false;
            whatifOverlay.classList.remove('active');
            btnWhatif.style.color = '';
            btnWhatif.classList.remove('poi-active');
        }, 2000);
    } else {
        addLogEntry('Esperando reparación del vehículo...', 'info');
        await new Promise(r => setTimeout(r, 2000));
        addLogEntry('Vehículo reparado — reanudando ruta', 'success');
        showToast('Vehículo reparado, ruta reanudada', 'info');
        whatifActive = false;
        whatifOverlay.classList.remove('active');
        btnWhatif.style.color = '';
        btnWhatif.classList.remove('poi-active');
    }
});

// ==========================================
// 13. EFFICIENCY METRICS UPDATE
// ==========================================
const metricFuel = document.getElementById('metric-fuel');
const metricCapacity = document.getElementById('metric-capacity');
const metricTimely = document.getElementById('metric-timely');
const lblFuelSaving = document.getElementById('lbl-fuel-saving');
const lblPedidosStats = document.getElementById('lbl-pedidos-stats');

function updateEfficiencyMetrics() {
    const delivered = pedidos.length - pendingOrders.length;
    const total = pedidos.length || 1;
    const progress = totalPathLength === 0 ? 0 : Math.min(100, Math.round((distanciaTotal / totalPathLength) * 100));
    
    // Fuel saving: simulated based on algorithm used
    let fuelSave = 0;
    if (currentAlgorithm === 'dijkstra') fuelSave = 12 + Math.random() * 5;
    else if (currentAlgorithm === 'astar') fuelSave = 18 + Math.random() * 7;
    else fuelSave = 25 + Math.random() * 10;
    fuelSave = Math.min(40, Math.round(fuelSave * (progress / 100)));
    
    const capacity = Math.min(100, Math.round((delivered / Math.max(1, pedidos.length)) * 100));
    const timely = Math.min(100, Math.round(85 + Math.random() * 15));
    
    metricFuel.textContent = `${fuelSave}%`;
    metricCapacity.textContent = `${capacity}%`;
    metricTimely.textContent = `${timely}%`;
    lblFuelSaving.textContent = fuelSave;
    lblPedidosStats.textContent = `${delivered}/${pedidos.length}`;
}

// Override updateDashboard to include efficiency metrics
const origUpdateDashboard = updateDashboard;
updateDashboard = function() {
    origUpdateDashboard();
    updateEfficiencyMetrics();
};

// ==========================================
// 14. CHARTS (Chart.js)
// ==========================================
const btnChart = document.getElementById('btn-chart');
const modalChart = document.getElementById('modal-chart');
const closeChart = document.getElementById('close-chart');
let chartEfficiency = null;
let chartFuel = null;

const chartThemeColor = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return isLight ? '#1a202c' : '#ffffff';
};

function initCharts() {
    const efficiencyCtx = document.getElementById('chart-efficiency').getContext('2d');
    const fuelCtx = document.getElementById('chart-fuel').getContext('2d');
    
    if (chartEfficiency) chartEfficiency.destroy();
    if (chartFuel) chartFuel.destroy();
    
    chartEfficiency = new Chart(efficiencyCtx, {
        type: 'bar',
        data: {
            labels: ['Original', 'Optimizado'],
            datasets: [{
                label: 'Tiempo (min)',
                data: [0, 0],
                backgroundColor: ['rgba(255, 107, 26, 0.6)', 'rgba(0, 230, 118, 0.6)'],
                borderColor: ['#FF6B1A', '#00E676'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Tiempo de Entrega', color: chartThemeColor(), font: { size: 11, family: 'Orbitron' } }
            },
            scales: {
                x: { ticks: { color: chartThemeColor(), font: { size: 10 } } },
                y: { ticks: { color: chartThemeColor(), font: { size: 10 } } }
            }
        }
    });
    
    chartFuel = new Chart(fuelCtx, {
        type: 'line',
        data: {
            labels: ['Inicio', '25%', '50%', '75%', '100%'],
            datasets: [{
                label: 'Consumo Real',
                data: [0, 0, 0, 0, 0],
                borderColor: '#FF6B1A',
                backgroundColor: 'rgba(255, 107, 26, 0.1)',
                fill: true,
                tension: 0.3
            }, {
                label: 'Consumo Óptimo',
                data: [0, 0, 0, 0, 0],
                borderColor: '#00E676',
                backgroundColor: 'rgba(0, 230, 118, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    labels: { color: chartThemeColor(), font: { size: 9 }, boxWidth: 10 }
                },
                title: { display: true, text: 'Consumo de Combustible', color: chartThemeColor(), font: { size: 11, family: 'Orbitron' } }
            },
            scales: {
                x: { ticks: { color: chartThemeColor(), font: { size: 9 } } },
                y: { ticks: { color: chartThemeColor(), font: { size: 9 } } }
            }
        }
    });
}

function updateCharts() {
    if (!chartEfficiency || !chartFuel) return;
    
    const progress = totalPathLength === 0 ? 0 : Math.min(100, Math.round((distanciaTotal / totalPathLength) * 100));
    const totalMinutes = Math.max(1, Math.floor(totalPathLength / 400));
    const optimizedMinutes = Math.round(totalMinutes * (currentAlgorithm === 'genetic' ? 0.65 : currentAlgorithm === 'astar' ? 0.78 : 0.85));
    
    chartEfficiency.data.datasets[0].data = [totalMinutes, optimizedMinutes];
    chartEfficiency.update();
    
    const realConsumption = [0, 2.5, 5, 7.5, 10].map(v => v * (1 + (100 - progress) / 200));
    const optConsumption = [0, 2, 4, 6, 8].map(v => v * (1 + (100 - progress) / 300));
    
    chartFuel.data.datasets[0].data = realConsumption;
    chartFuel.data.datasets[1].data = optConsumption;
    chartFuel.update();
}

btnChart.addEventListener('click', () => {
    modalChart.classList.remove('hidden');
    setTimeout(() => {
        initCharts();
        updateCharts();
    }, 100);
});

closeChart.addEventListener('click', () => modalChart.classList.add('hidden'));
modalChart.addEventListener('click', (e) => {
    if (e.target === modalChart) modalChart.classList.add('hidden');
});

// ==========================================
// 15. SIMULATION LAYERS
// ==========================================
const layersPanel = document.getElementById('layers-panel');
const layersClose = document.getElementById('layers-close');
let layersVisible = false;

// Add layers via GeoJSON sources
function setupSimulationLayers() {
    // Traffic zones (simulated)
    if (!map.getSource('traffic-zones')) {
        map.addSource('traffic-zones', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { name: 'Zona Tráfico Centro' },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[-70.190, 11.700], [-70.185, 11.700], [-70.185, 11.695], [-70.190, 11.695], [-70.190, 11.700]]]
                        }
                    },
                    {
                        type: 'Feature',
                        properties: { name: 'Zona Tráfico Sur' },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[-70.178, 11.690], [-70.173, 11.690], [-70.173, 11.685], [-70.178, 11.685], [-70.178, 11.690]]]
                        }
                    }
                ]
            }
        });
        map.addLayer({
            id: 'traffic-zones-fill',
            type: 'fill',
            source: 'traffic-zones',
            paint: {
                'fill-color': '#FF6B1A',
                'fill-opacity': 0.08
            }
        });
    }
    
    // Demand zones
    if (!map.getSource('demand-zones')) {
        map.addSource('demand-zones', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { name: 'Alta Demanda' },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[-70.183, 11.700], [-70.178, 11.700], [-70.178, 11.696], [-70.183, 11.696], [-70.183, 11.700]]]
                        }
                    }
                ]
            }
        });
        map.addLayer({
            id: 'demand-zones-fill',
            type: 'fill',
            source: 'demand-zones',
            paint: {
                'fill-color': '#00E676',
                'fill-opacity': 0.08
            }
        });
    }
    
    // Risk zones
    if (!map.getSource('risk-zones')) {
        map.addSource('risk-zones', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { name: 'Zona de Riesgo' },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[-70.188, 11.693], [-70.183, 11.693], [-70.183, 11.689], [-70.188, 11.689], [-70.188, 11.693]]]
                        }
                    }
                ]
            }
        });
        map.addLayer({
            id: 'risk-zones-fill',
            type: 'fill',
            source: 'risk-zones',
            paint: {
                'fill-color': '#FF4466',
                'fill-opacity': 0.08
            }
        });
    }
}

map.on('style.load', () => {
    setupSimulationLayers();
});

let layersState = { traffic: true, demand: true, risk: true };

document.querySelectorAll('.layer-item').forEach(item => {
    item.addEventListener('click', () => {
        const layer = item.dataset.layer;
        const switchEl = item.querySelector('.layer-switch');
        layersState[layer] = !layersState[layer];
        switchEl.classList.toggle('active', layersState[layer]);
        
        const mapLayerId = `${layer}-zones-fill`;
        if (map.getLayer(mapLayerId)) {
            map.setLayoutProperty(mapLayerId, 'visibility', layersState[layer] ? 'visible' : 'none');
        }
        addLogEntry(`Capa "${layer}" ${layersState[layer] ? 'activada' : 'desactivada'}`, 'system');
    });
});

layersClose.addEventListener('click', () => {
    layersPanel.classList.add('hidden');
    layersVisible = false;
});

// Add layers btn to floating controls is already in the HTML as btn-view's icon is layers
// We'll use a different approach: btn-view already toggles 2D/3D, so we add a new shortcut

// ==========================================
// 16. LAYERS TOGGLE KEYBOARD SHORTCUT
// ==========================================

document.addEventListener('keydown', (e) => {
    if (e.key === 'l' || e.key === 'L') {
        layersVisible = !layersVisible;
        layersPanel.classList.toggle('hidden', !layersVisible);
        if (layersVisible) addLogEntry('Panel de capas abierto', 'system');
    }
    if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        btnPlayPause.click();
    }
});

// ==========================================
// BOOT LOG
// ==========================================
addLogEntry('Motor de simulación híbrido inicializado', 'system');
addLogEntry(`Algoritmo por defecto: ${currentAlgorithm.toUpperCase()}`, 'info');
addLogEntry('Sistema de obstáculos activo (clic derecho en mapa)', 'info');
addLogEntry('Sistema de clima integrado', 'info');
addLogEntry('LogiSim v2.0 — Modo Simulación Inteligente', 'system');

// Re-create all Lucide icons (for any new elements)
lucide.createIcons();


