const POI_CATEGORIES = [
    { id: 'mall', label: 'Centros Comerciales', icon: 'store', color: '#FF6B1A', query: 'shop=mall' },
    { id: 'restaurant', label: 'Restaurantes', icon: 'utensils-crossed', color: '#E53E3E', query: 'amenity=restaurant' },
    { id: 'cafe', label: 'Cafeterías', icon: 'coffee', color: '#6B46C1', query: 'amenity=cafe' },
    { id: 'fast_food', label: 'Comida Rápida', icon: 'utensils', color: '#D69E2E', query: 'amenity=fast_food' },
    { id: 'bank', label: 'Bancos', icon: 'landmark', color: '#38A169', query: 'amenity=bank' },
    { id: 'pharmacy', label: 'Farmacias', icon: 'pill', color: '#00B5D8', query: 'amenity=pharmacy' },
    { id: 'supermarket', label: 'Supermercados', icon: 'shopping-cart', color: '#319795', query: 'shop=supermarket' },
    { id: 'hotel', label: 'Hoteles', icon: 'building-2', color: '#9F7AEA', query: 'tourism=hotel' },
    { id: 'hospital', label: 'Hospitales', icon: 'heart-pulse', color: '#F56565', query: 'amenity=hospital' },
    { id: 'school', label: 'Escuelas', icon: 'graduation-cap', color: '#ED8936', query: 'amenity=school' },
];

class POIService {
    constructor() {
        this.apiUrl = 'https://overpass-api.de/api/interpreter';
        this.cache = new Map();
    }

    async fetchPOIs(categoryIds, bbox) {
        const cacheKey = `${categoryIds.join(',')}-${bbox.join(',')}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const categories = POI_CATEGORIES.filter(c => categoryIds.includes(c.id));
        const queries = categories.map(c => this._buildQuery(c.query, bbox)).join('\n');

        const overpassQuery = `[out:json][timeout:25];\n(${queries}\n);\nout center qt;`;

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `data=${encodeURIComponent(overpassQuery)}`
            });

            if (!response.ok) {
                throw new Error(`Overpass API error: ${response.status}`);
            }

            const data = await response.json();
            const pois = this._parseResponse(data, categories);
            this.cache.set(cacheKey, pois);

            setTimeout(() => this.cache.delete(cacheKey), 300000);

            return pois;
        } catch (error) {
            console.error('Error fetching POIs:', error);
            throw error;
        }
    }

    _buildQuery(tag, bbox) {
        const [minLng, minLat, maxLng, maxLat] = bbox;
        const formattedTag = tag.replace('=', '"="');
        return `  node["${formattedTag}"](${minLat},${minLng},${maxLat},${maxLng});\n  way["${formattedTag}"](${minLat},${minLng},${maxLat},${maxLng});`;
    }

    _parseResponse(data, categories) {
        const pois = [];

        for (const element of data.elements) {
            const tags = element.tags || {};
            const lat = element.lat || (element.center && element.center.lat);
            const lng = element.lon || (element.center && element.center.lon);

            if (!lat || !lng) continue;

            const category = categories.find(c => {
                const [key, value] = c.query.split('=');
                return tags[key] === value;
            });

            if (!category) continue;

            pois.push({
                id: element.id,
                type: element.type,
                name: tags.name || `${category.label} (sin nombre)`,
                lat,
                lng,
                category: category.id,
                address: tags['addr:street']
                    ? `${tags['addr:street']}${tags['addr:housenumber'] ? ` #${tags['addr:housenumber']}` : ''}`
                    : null,
                phone: tags.phone || null,
                website: tags.website || null,
                openingHours: tags.opening_hours || null,
                cuisine: tags.cuisine || null,
            });
        }

        return pois;
    }
}

class POIManager {
    constructor(map, onSelect) {
        this.map = map;
        this.onSelect = onSelect;
        this.markers = [];
        this.pois = [];
        this.service = new POIService();
        this.activeCategories = new Set(POI_CATEGORIES.map(c => c.id));
        this.visible = false;
    }

    async load(categoryIds) {
        const bbox = this._getBbox();
        this.activeCategories = new Set(categoryIds || POI_CATEGORIES.map(c => c.id));

        try {
            this.pois = await this.service.fetchPOIs(
                [...this.activeCategories],
                bbox
            );
            this._renderMarkers();
            return this.pois;
        } catch (error) {
            console.warn('No se pudieron cargar los POIs');
            return [];
        }
    }

    toggleVisibility() {
        this.visible = !this.visible;
        if (this.visible) {
            this.load([...this.activeCategories]);
        } else {
            this.clearMarkers();
        }
        return this.visible;
    }

    setVisible(visible) {
        this.visible = visible;
        if (visible) {
            this.load([...this.activeCategories]);
        } else {
            this.clearMarkers();
        }
    }

    filterByCategory(categoryId) {
        if (this.activeCategories.has(categoryId)) {
            this.activeCategories.delete(categoryId);
        } else {
            this.activeCategories.add(categoryId);
        }

        if (this.activeCategories.size === 0) {
            this.clearMarkers();
            return;
        }

        if (this.visible) {
            this.load([...this.activeCategories]);
        }
    }

    clearMarkers() {
        this.markers.forEach(m => m.remove());
        this.markers = [];
        this.pois = [];
    }

    _renderMarkers() {
        this.clearMarkers();
        this.pois.forEach(poi => this._createMarker(poi));
    }

    _createMarker(poi) {
        const category = POI_CATEGORIES.find(c => c.id === poi.category);
        if (!category) return;

        const el = document.createElement('div');
        el.className = 'poi-marker';
        el.style.setProperty('--poi-color', category.color);

        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', category.icon);
        icon.style.cssText = `width:14px;height:14px;color:#fff;`;
        el.appendChild(icon);

        const popup = new maplibregl.Popup({
            offset: 25,
            closeButton: true,
            className: 'poi-popup'
        }).setHTML(this._buildPopupContent(poi, category));

        const marker = new maplibregl.Marker({ element: el })
            .setLngLat([poi.lng, poi.lat])
            .setPopup(popup)
            .addTo(this.map);

        el.addEventListener('click', () => {
            if (typeof this.onSelect === 'function') {
                this.onSelect(poi);
            }
            marker.togglePopup();
        });

        this.markers.push(marker);

        requestAnimationFrame(() => {
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
                lucide.createIcons({ scope: el });
            }
        });
    }

    _buildPopupContent(poi, category) {
        const lines = [
            `<div class="poi-popup-header" style="border-left:3px solid ${category.color}">`,
            `  <strong>${poi.name}</strong>`,
            `  <span class="poi-popup-category">${category.label}</span>`,
            `</div>`,
            `<div class="poi-popup-body">`,
        ];

        if (poi.address) lines.push(`  <p>📍 ${poi.address}</p>`);
        if (poi.phone) lines.push(`  <p>📞 ${poi.phone}</p>`);
        if (poi.cuisine) lines.push(`  <p>🍲 ${poi.cuisine}</p>`);
        if (poi.openingHours) lines.push(`  <p>🕐 ${poi.openingHours}</p>`);
        if (poi.website) lines.push(`  <p>🌐 <a href="${poi.website}" target="_blank">${poi.website}</a></p>`);

        lines.push(`</div>`);
        return lines.join('\n');
    }

    _getBbox() {
        const bounds = this.map.getBounds();
        return [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth()
        ];
    }
}

let poiManager = null;

function initPOISystem(map) {
    poiManager = new POIManager(map, (poi) => {
        console.log('POI seleccionado:', poi.name);
    });

    return poiManager;
}
