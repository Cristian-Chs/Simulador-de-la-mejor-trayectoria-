
const ICONOS_REFERENCIA = {
    'restaurant': 'icons/chef-hat.svg',
    'cafe': 'icons/coffee.svg',
    'pharmacy': 'icons/medicine-syrup.svg',
    'shopping_mall': 'icons/shopping-cart.svg',
    'supermarket': 'icons/building-store.svg',
    'default': 'icons/map-pin.svg'
};

export const POI_CATEGORIES = [
    { id: 'comida', label: 'Restaurantes y Cafés', color: '#ff5722', osmTags: 'node["amenity"~"restaurant|cafe|fast_food"]' },
    { id: 'salud', label: 'Farmacias y Salud', color: '#4caf50', osmTags: 'node["amenity"="pharmacy"]' },
    { id: 'comercio', label: 'Tiendas y Centros C.', color: '#2196f3', osmTags: 'node["shop"]' },
    { id: 'bancos', label: 'Bancos y ATM', color: '#ffeb3b', osmTags: 'node["amenity"="bank"]' }
];



export function initPOISystem(map) {
    return {
        activeCategories: new Set(['comida', 'salud', 'comercio']),
        visible: true,

        setVisible(status) {
            this.visible = status;
            if (!status) this.markersGroup.clearLayers();
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
                this.markersGroup.clearLayers();
                return [];
            }

            const bounds = map.getBounds();
            const southWest = bounds.getSouthWest();
            const northEast = bounds.getNorthEast();
            const bbox = `${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng}`;

            let subQueries = '';
            categoriesArray.forEach(catId => {
                const catConfig = POI_CATEGORIES.find(c => c.id === catId);
                if (catConfig) subQueries += `${catConfig.osmTags}(${bbox});`;
            });

            const query = `[out:json][timeout:25];(${subQueries});out body;`;
            console.log('Query:' + query)
            const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);


            try {
                const response = await fetch(url,{
                    headers:{
                        'User-Agent': 'Logisim-PuntoFijo/1.0'
                    }
                });
                const data = await response.json();

                console.log(data);


                this.markersGroup.clearLayers();
                const poisProcesados = [];

                // reference-points.js

                data.elements.forEach(elemento => {
                    if (elemento.tags && elemento.tags.name) {
                        // 1. Detectamos qué tipo de establecimiento es según OSM
                        const tipoEspecifico = elemento.tags.amenity || elemento.tags.shop || elemento.tags.tourism;
                        
                        // 2. Mapeo a tu categoría de la interfaz
                        let categoriaUI = 'comercio';
                        if (['restaurant', 'cafe', 'fast_food', 'bar'].includes(tipoEspecifico)) categoriaUI = 'comida';
                        else if (['pharmacy', 'hospital', 'clinic', 'doctors'].includes(tipoEspecifico)) categoriaUI = 'salud';
                        else if (['bank', 'atm'].includes(tipoEspecifico)) categoriaUI = 'bancos';

                        const poi = {
                            id: elemento.id,
                            name: elemento.tags.name,
                            lat: elemento.lat,
                            lng: elemento.lon,
                            category: categoriaUI,
                            street: elemento.tags["addr:street"] || "Punto Fijo"
                        };

                        poisProcesados.push(poi);

                        // 3. ASIGNACIÓN DINÁMICA DEL SVG
                        // Buscamos si tenemos el SVG específico (ej: assets/pharmacy.svg), si no, usa el default
                        const svgUrl = ICONOS_REFERENCIA[tipoEspecifico] || ICONOS_REFERENCIA.default;

                        // 4. CREACIÓN DEL CONTENEDOR HTML PARA MAPLIBRE
                        const el = document.createElement('div');
                        el.className = `custom-marker poi-${categoriaUI}`; // Clases útiles para CSS
                        el.style.width = '30px';
                        el.style.height = '30px';
                        el.style.backgroundImage = `url('${svgUrl}')`;
                        el.style.backgroundSize = 'contain';
                        el.style.backgroundRepeat = 'no-repeat';
                        el.style.backgroundPosition = 'center';
                        el.style.filter = 'drop-shadow(0px 3px 4px rgba(0,0,0,0.35))';

                        // Popup al hacer click
                        const popup = new maplibregl.Popup({ offset: 15, closeButton: false })
                            .setHTML(`<div style="font-family: sans-serif;"><strong>${poi.name}</strong><br><small style="color: #666;">${poi.street}</small></div>`);

                        // Insertar en MapLibre [Longitud, Latitud]
                        const marker = new maplibregl.Marker({ element: el })
                            .setLngLat([poi.lng, poi.lat])
                            .setPopup(popup)
                            .addTo(mapaMapLibre);

                        this.activeMarkers.push(marker);
                    }
                });

                return poisProcesados;
            } catch (error) {
                console.error("Error en Overpass:", error);
                throw error;
            }
        }
    };
}