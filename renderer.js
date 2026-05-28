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
            map.setPaintProperty(layer.id, 'text-halo-color', haloColor);
            map.setPaintProperty(layer.id, 'text-halo-width', 1.8);
            map.setPaintProperty(layer.id, 'text-halo-blur', 0.8);
        } catch (e) { /* capa sin soporte */ }
    });
}

// Configuración de Capas al cargar el mapa o cambiar de estilo
map.on('style.load', () => {
    setupMapLayers();
    enhanceLabels();
    renderPOIPanel();

    // Restaurar los datos de ruta si existían antes del cambio de estilo
    if (roadPath.length > 0) {
        getRoute(); 
    }
    if (map.getSource('route-history')) {
        map.getSource('route-history').setData(routeLineGeoJSON);
    }
});

let snappedOrders = [];
let pendingOrders = [];

// Función para obtener la ruta vía API OSRM (Open Source, Gratis)
async function getRoute() {
    if (pedidos.length === 0) return;
    
    // Ruta desde base, pasando por pedidos, y volviendo a base
    const waypoints = [PUNTO_FIJO_COORDS, ...pedidos, PUNTO_FIJO_COORDS];
    const coords = waypoints.map(p => `${p[0]},${p[1]}`).join(';');
    // OSRM Public API
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson`;

    try {
        const query = await fetch(url);
        const json = await query.json();
        
        if (json.routes && json.routes.length > 0) {
            const data = json.routes[0];
            roadPath = data.geometry.coordinates;
            totalPathLength = data.distance; // en metros
            
            // Extraer las coordenadas exactas de la ruta donde están los pedidos
            if (json.waypoints) {
                snappedOrders = json.waypoints.slice(1, json.waypoints.length - 1).map(wp => wp.location);
            }
            
            // Dibujar ruta planificada
            map.getSource('route').setData(data.geometry);
            updateDashboard();
        }
    } catch (e) {
        console.warn("Error al calcular la ruta:", e);
        // Fallback básico: línea recta
        roadPath = [PUNTO_FIJO_COORDS, ...pedidos, PUNTO_FIJO_COORDS];
        totalPathLength = 1000 * (pedidos.length + 1);
        snappedOrders = [...pedidos];
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
        
        // Renumerar tooltips
        orderMarkers.forEach((mk, i) => {
            mk.getElement().title = `Pedido #${i + 1} — Clic derecho para eliminar`;
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
const speedMps = 20; // metros por segundo (aprox 72 km/h simulados para que se vea bien y fluido)
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
                        alert(`¡Pedido #${num} entregado exitosamente!\nDirigiéndose al pedido #${num + 1}...`);
                    } else {
                        alert(`¡Último pedido (#${num}) entregado!\nRetornando a la base...`);
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
        vehicleEl.innerHTML = 'icons/car.svg';
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
let deliveryLog = []; // Registro de entregas { num, time, coords, status }

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
// 4. TELEMETRÍA DEL VEHÍCULO (btn-car)
// ==========================================
const teleStatus = document.getElementById('tele-status');
const teleSpeed = document.getElementById('tele-speed');
const teleDist = document.getElementById('tele-dist');
const telePending = document.getElementById('tele-pending');
const teleDelivered = document.getElementById('tele-delivered');
const teleProgress = document.getElementById('tele-progress');
const teleLng = document.getElementById('tele-lng');
const teleLat = document.getElementById('tele-lat');

let telemetryInterval = null;

function updateTelemetry() {
    const delivered = pedidos.length - pendingOrders.length;
    const percent = totalPathLength === 0 ? 0 : Math.max(0, Math.min(100, Math.round((distanciaTotal / totalPathLength) * 100)));
    
    teleStatus.textContent = enMarcha ? 'EN TRÁNSITO' : (percent === 100 ? 'COMPLETADO' : 'STANDBY');
    teleStatus.style.color = enMarcha ? 'var(--success)' : (percent === 100 ? 'var(--accent)' : 'var(--text-dim)');
    teleSpeed.textContent = enMarcha ? (45 + Math.random() * 5).toFixed(1) + ' km/h' : '0.0 km/h';
    teleDist.textContent = (distanciaTotal / 1000).toFixed(2) + ' km';
    telePending.textContent = pendingOrders.length;
    teleDelivered.textContent = delivered >= 0 ? delivered : 0;
    teleProgress.textContent = percent + '%';
    teleLng.textContent = motoPosReal[0].toFixed(6);
    teleLat.textContent = motoPosReal[1].toFixed(6);
}

btnCar.addEventListener('click', () => {
    updateTelemetry();
    modalCar.classList.remove('hidden');
    
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

// ==========================================
// SISTEMA DE LUGARES (POI) — Overpass API
// ==========================================
const btnPoi = document.getElementById('btn-poi');
const poiPanel = document.getElementById('poi-panel');
const poiClose = document.getElementById('poi-close');
const poiCategories = document.getElementById('poi-categories');
const poiCount = document.getElementById('poi-count');

const poiMgr = initPOISystem(map);

map.on('moveend', () => {
    if (isPoiVisible) {
        clearTimeout(poiDebounce);
        poiDebounce = setTimeout(renderPOIPanel, 500); // Evita saturar la API con debounce
    }
});

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

// Listeners de la interfaz
btnPoi.addEventListener('click', () => {
    window.isPoiVisible = !window.isPoiVisible;

    if (isPoiVisible) {
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


