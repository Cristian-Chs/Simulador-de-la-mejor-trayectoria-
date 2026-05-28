/**
 * SIMULADOR DE TRAYECTORIA - MODULO DE REFERENCIAS (PUNTO FIJO)
 * Este script llena un array dinámico con locales reales de la ciudad.
 */
export const POI_CATEGORIES = [
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


// 1. Diccionario de iconos (Asegúrate de tener estas imágenes en tu carpeta assets)
const ICONOS_REFERENCIA = {
    'restaurant': 'assets/food.png',
    'cafe': 'assets/coffee.png',
    'pharmacy': 'assets/health.png',
    'shopping_mall': 'assets/mall.png',
    'supermarket': 'assets/shop.png',
    'default': 'assets/marker-grey.png'
};

// 2. Nuestro Array Dinámico (Se llena solo al consultar la API)
let puntosDeReferencia = [];

/**
 * Función Principal: Busca locales en Punto Fijo usando la API de Overpass
 * @param {L.Map} mapaInstancia - Tu objeto de mapa de Leaflet
 */
async function cargarPuntosReferencia(mapaInstancia) {
    // Coordenadas centrales de Punto Fijo (aprox)
    const lat = 11.6912;
    const lng = -70.1834;
    const radio = 0.02; // Rango de búsqueda

    // Consulta Overpass: Buscamos tiendas, comida y farmacias
    const query = `[out:json];
    (
      node["shop"](${lat-radio},${lng-radio},${lat+radio},${lng+radio});
      node["amenity"~"restaurant|cafe|pharmacy|bank"](${lat-radio},${lng-radio},${lat+radio},${lng+radio});
    );
    out body;`;

    const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);

    try {
        const response = await fetch(url);
        const data = await response.json();

        // Limpiar array antes de llenarlo
        puntosDeReferencia = [];

        // 3. Procesar resultados y llenar el array dinámico
        data.elements.forEach(elemento => {
            if (elemento.tags.name) { // Solo si el local tiene nombre
                const tipo = elemento.tags.shop || elemento.tags.amenity;
                
                puntosDeReferencia.push({
                    id: elemento.id,
                    nombre: elemento.tags.name,
                    lat: elemento.lat,
                    lng: elemento.lon,
                    categoria: tipo,
                    referencia_calle: elemento.tags["addr:street"] || "Calle no especificada"
                });
            }
        });

        // 4. Pintar en el mapa
        renderizarPuntos(mapaInstancia);
        console.log("Array dinámico actualizado:", puntosDeReferencia);

    } catch (error) {
        console.error("Error al obtener datos de Punto Fijo:", error);
    }
}

/**
 * Dibuja los marcadores en el mapa usando el array dinámico
 */
function renderizarPuntos(mapa) {
    puntosDeReferencia.forEach(punto => {
        // Elegir icono basado en la categoría
        const iconUrl = ICONOS_REFERENCIA[punto.categoria] || ICONOS_REFERENCIA.default;

        const customIcon = L.icon({
            iconUrl: iconUrl,
            iconSize: [25, 25],
            iconAnchor: [12, 25]
        });

        // Crear marcador y añadirlo al mapa
        L.marker([punto.lat, punto.lng], { icon: customIcon })
            .addTo(mapa)
            .bindPopup(`
                <b>${punto.nombre}</b><br>
                <span>Ref: ${punto.referencia_calle}</span>
            `);
    });
}

// Ejemplo de uso:
// cargarPuntosReferencia(miMapaLeaflet);