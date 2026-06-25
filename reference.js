
const ICONOS_REFERENCIA = {
    'restaurant': 'icons/chef-hat.svg',
    'cafe': 'icons/coffee.svg',
    'fast_food': 'icons/chef-hat.svg',
    'bar': 'icons/coffee.svg',
    'pharmacy': 'icons/medicine-syrup.svg',
    'hospital': 'icons/medicine-syrup.svg',
    'clinic': 'icons/medicine-syrup.svg',
    'shopping_mall': 'icons/shopping-cart.svg',
    'mall': 'icons/shopping-cart.svg',
    'supermarket': 'icons/building-store.svg',
    'convenience': 'icons/building-store.svg',
    'bank': 'icons/map-pin.svg',
    'atm': 'icons/map-pin.svg',
    'default': 'icons/map-pin.svg'
};

export const POI_CATEGORIES = [
    { id: 'comida', label: 'Restaurantes y Cafés', color: '#ff5722', osmTags: 'node["amenity"="restaurant"];node["amenity"="cafe"];node["amenity"="fast_food"]' },
    { id: 'salud', label: 'Farmacias y Salud', color: '#4caf50', osmTags: 'node["amenity"="pharmacy"]' },
    { id: 'comercio', label: 'Tiendas y Centros C.', color: '#2196f3', osmTags: 'node["shop"="supermarket"];node["shop"="mall"];node["shop"="convenience"]' },
    { id: 'bancos', label: 'Bancos y ATM', color: '#ffeb3b', osmTags: 'node["amenity"="bank"]' }
];



function clearMarkers(markers) {
    while (markers.length) markers.pop().remove();
}

const MOCK_POIS_DATA = [
    { name: "Pizzería El Sabor de la Plaza", category: "comida", street: "Av. Jacinto Lara", type: "restaurant" },
    { name: "Café Paraguaná", category: "comida", street: "Calle Comercio", type: "cafe" },
    { name: "Burger House Punto Fijo", category: "comida", street: "Av. Ollarvides", type: "restaurant" },
    { name: "Tacos & Burritos", category: "comida", street: "Av. Rafael González", type: "restaurant" },
    { name: "Farmacia SAAS Principal", category: "salud", street: "Av. Jacinto Lara", type: "pharmacy" },
    { name: "Farmahorro Las Margaritas", category: "salud", street: "Sector Las Margaritas", type: "pharmacy" },
    { name: "Droguería El Cardón", category: "salud", street: "Calle Comercio", type: "pharmacy" },
    { name: "Supermercado Hiper Líder", category: "comercio", street: "Av. Ollarvides", type: "supermarket" },
    { name: "C.C. Las Virtudes", category: "comercio", street: "Comunidad Cardón", type: "shopping_mall" },
    { name: "Tienda de Conveniencia Express", category: "comercio", street: "Av. Jacinto Lara", type: "convenience" },
    { name: "Banco de Venezuela", category: "bancos", street: "Calle Comercio", type: "bank" },
    { name: "Banesco Banco Universal", category: "bancos", street: "Av. Jacinto Lara", type: "bank" },
    { name: "Cajero Automático Mercantil", category: "bancos", street: "Av. Ollarvides", type: "atm" }
];

function generateLocalMockPOIs(center) {
    const pois = [];
    MOCK_POIS_DATA.forEach((item, index) => {
        // Scatter around the center within ~1.5km
        const lngOffset = (Math.random() - 0.5) * 0.02;
        const latOffset = (Math.random() - 0.5) * 0.02;
        pois.push({
            id: 900000 + index,
            name: item.name,
            lat: center.lat + latOffset,
            lng: center.lng + lngOffset,
            category: item.category,
            street: item.street,
            type: item.type
        });
    });
    return pois;
}

function crearElementoMarcadorPOI(poi, svgUrl) {
    // Contenedor externo que MapLibre posiciona libremente
    const el = document.createElement('div');
    el.className = `custom-marker-wrapper`; 
    el.style.width = '38px';
    el.style.height = '38px';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';

    // Contenedor interno que tiene el diseño circular y maneja el hover
    const innerEl = document.createElement('div');
    innerEl.className = `custom-marker poi-${poi.category}`;
    innerEl.style.width = '38px';
    innerEl.style.height = '38px';
    innerEl.style.borderRadius = '50%';

    const catConfig = POI_CATEGORIES.find(c => c.id === poi.category);
    const bgColor = catConfig ? catConfig.color : '#666';
    innerEl.style.backgroundColor = bgColor;
    innerEl.style.border = '2px solid #ffffff';
    innerEl.style.boxShadow = '0 4px 10px rgba(0,0,0,0.35)';
    innerEl.style.display = 'flex';
    innerEl.style.alignItems = 'center';
    innerEl.style.justifyContent = 'center';
    innerEl.style.cursor = 'pointer';
    innerEl.style.transition = 'transform 0.2s ease';

    // Hover seguro sobre el contenedor interno
    innerEl.addEventListener('mouseenter', () => {
        innerEl.style.transform = 'scale(1.15)';
    });
    innerEl.addEventListener('mouseleave', () => {
        innerEl.style.transform = 'scale(1.0)';
    });

    const iconImg = document.createElement('img');
    iconImg.src = svgUrl;
    iconImg.style.width = '20px';
    iconImg.style.height = '20px';
    iconImg.style.objectFit = 'contain';
    // Invertimos el icono negro original a blanco para que destaque
    iconImg.style.filter = 'invert(1) brightness(10)';

    innerEl.appendChild(iconImg);
    el.appendChild(innerEl);
    
    return el;
}

export function initPOISystem(map) {
    return {
        activeCategories: new Set(['comida', 'salud', 'comercio']),
        visible: true,
        activeMarkers: [],

        setVisible(status) {
            this.visible = status;
            if (!status) clearMarkers(this.activeMarkers);
        },

        filterByCategory(catId) {
            if (this.activeCategories.has(catId)) {
                this.activeCategories.delete(catId);
            } else {
                this.activeCategories.add(catId);
            }
        },

        async load(categoriesArray) {
            if (!this.visible || categoriesArray.length === 0) {
                clearMarkers(this.activeMarkers);
                return [];
            }

            const bounds = map.getBounds();
            const southWest = bounds.getSouthWest();
            const northEast = bounds.getNorthEast();
            const bbox = `${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng}`;

            let subQueries = '';
            categoriesArray.forEach(catId => {
                const catConfig = POI_CATEGORIES.find(c => c.id === catId);
                if (catConfig) {
                    const parts = catConfig.osmTags.split(';');
                    parts.forEach(part => {
                        if (part.trim()) {
                            subQueries += `${part.trim()}(${bbox});`;
                            const wayPart = part.trim().replace(/^node/, 'way');
                            if (wayPart !== part.trim()) {
                                subQueries += `${wayPart}(${bbox});`;
                            }
                        }
                    });
                }
            });

            const query = `[out:json][timeout:25];(${subQueries});out body center;`;
            const url = "https://overpass-api.de/api/interpreter";

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `data=${encodeURIComponent(query)}`
                });
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`Overpass ${res.status}: ${text.slice(0, 200)}`);
                }
                const data = await res.json();

                clearMarkers(this.activeMarkers);
                const poisProcesados = [];

                data.elements.forEach(elemento => {
                    if (!elemento.tags || !elemento.tags.name) return;

                    const lat = elemento.lat ?? elemento.center?.lat;
                    const lng = elemento.lon ?? elemento.center?.lon;
                    if (lat == null || lng == null) return;

                    const tipoEspecifico = elemento.tags.amenity || elemento.tags.shop || elemento.tags.tourism;

                    let categoriaUI = 'comercio';
                    if (['restaurant', 'cafe', 'fast_food', 'bar'].includes(tipoEspecifico)) categoriaUI = 'comida';
                    else if (['pharmacy', 'hospital', 'clinic', 'doctors'].includes(tipoEspecifico)) categoriaUI = 'salud';
                    else if (['bank', 'atm'].includes(tipoEspecifico)) categoriaUI = 'bancos';

                    const poi = {
                        id: elemento.id,
                        name: elemento.tags.name,
                        lat,
                        lng,
                        category: categoriaUI,
                        street: elemento.tags["addr:street"] || "Punto Fijo"
                    };

                    poisProcesados.push(poi);

                    const svgUrl = ICONOS_REFERENCIA[tipoEspecifico] || ICONOS_REFERENCIA.default;
                    const el = crearElementoMarcadorPOI(poi, svgUrl);

                    const popup = new maplibregl.Popup({ offset: 15, closeButton: false })
                        .setHTML(`<div style="font-family: sans-serif;"><strong>${poi.name}</strong><br><small style="color: #666;">${poi.street}</small></div>`);

                    const marker = new maplibregl.Marker({ element: el })
                        .setLngLat([lng, lat])
                        .setPopup(popup)
                        .addTo(map);

                    this.activeMarkers.push(marker);
                });

                return poisProcesados;
            } catch (error) {
                console.warn("Error en Overpass API, usando lugares locales de fallback:", error);
                
                const center = map.getCenter();
                const poisProcesados = [];
                const mockPois = generateLocalMockPOIs(center);
                
                clearMarkers(this.activeMarkers);
                
                mockPois.forEach(poi => {
                    if (categoriesArray.includes(poi.category)) {
                        poisProcesados.push(poi);
                        
                        const svgUrl = ICONOS_REFERENCIA[poi.type] || ICONOS_REFERENCIA.default;
                        
                        const el = crearElementoMarcadorPOI(poi, svgUrl);

                        const popup = new maplibregl.Popup({ offset: 15, closeButton: false })
                            .setHTML(`<div style="font-family: sans-serif;"><strong>${poi.name}</strong><br><small style="color: #666;">${poi.street} (Simulado)</small></div>`);

                        const marker = new maplibregl.Marker({ element: el })
                            .setLngLat([poi.lng, poi.lat])
                            .setPopup(popup)
                            .addTo(map);

                        this.activeMarkers.push(marker);
                    }
                });
                
                return poisProcesados;
            }
        }
    };
}