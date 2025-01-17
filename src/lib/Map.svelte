<script>
  import { onMount, createEventDispatcher } from "svelte";
  import { osmGeoJSON, clippedGeoJSON } from "./stores";
  import L from "leaflet";
  import "leaflet/dist/leaflet.css";
  import "leaflet-draw/dist/leaflet.draw.css";
  import "leaflet-draw";

  export let selectedLayer;
  let mapContainer;
  let map = null;
  let currentLayer = null;
  let geoJSONLayer = null;

  let lat = 52.474;
  let lng = 13.43;

  const dispatch = createEventDispatcher();

  const setupLayer = (layer) => {
    if (map) {
      if (currentLayer) {
        map.removeLayer(currentLayer);
      }
      if (layer) {
        currentLayer = L.tileLayer(layer.value, {
          attribution: layer.attribution,
        });
        currentLayer.addTo(map);
      } else {
        currentLayer = L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            attribution: "&copy; OpenStreetMap contributors",
          }
        );
        currentLayer.addTo(map);
      }
    }
  };

  const addGeoJSONToMap = (geoJSON) => {
    if (geoJSONLayer) {
      map.removeLayer(geoJSONLayer);
    }
    geoJSONLayer = L.geoJSON(geoJSON, {
      style: {
        color: "blue",
        fillColor: "blue",
        fillOpacity: 0.6,
        weight: 2,
      },
    }).addTo(map);
  };

  $: osmGeoJSON.subscribe((geoJSON) => {
    if (geoJSON && map) {
      addGeoJSONToMap(geoJSON);
    }
  });

  $: clippedGeoJSON.subscribe((geoJSON) => {
    if (geoJSON && map) {
      addGeoJSONToMap(geoJSON);
    }
  });

  onMount(() => {
    if (L.GeometryUtil) {
      L.GeometryUtil.readableArea = function (area, isMetric) {
        const units = isMetric ? ["m²", "ha", "km²"] : ["ft²", "ac", "mi²"];
        const thresholds = isMetric ? [10000, 1000000] : [43560, 27878400];

        let unitIndex = 0;
        while (
          area > thresholds[unitIndex] &&
          unitIndex < thresholds.length - 1
        ) {
          area /= thresholds[unitIndex];
          unitIndex++;
        }

        return `${area.toFixed(2)} ${units[unitIndex]}`;
      };
    }

    // Initialize map with lat/lng from our variables
    map = L.map(mapContainer).setView([lat, lng], 13);
    setupLayer(selectedLayer);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      draw: {
        polyline: false,
        polygon: {
          shapeOptions: {
            color: "var(--highlite)",
            fillColor: "var(--highlite)",
            fillOpacity: 0.2,
            weight: 2,
          },
        },
        rectangle: {
          shapeOptions: {
            color: "var(--highlite)",
            fillColor: "var(--highlite)",
            fillOpacity: 0.2,
            weight: 2,
          },
        },
        circle: true,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: drawnItems,
        edit: {
          selectedPathOptions: {
            color: "var(--stroke)",
            fillColor: "var(--highlite)",
            fillOpacity: 0.2,
            weight: 2,
          },
        },
      },
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (event) => {
      const { layer } = event;
      drawnItems.clearLayers();

      layer.setStyle({
        color: "var(--stroke)",
        fillColor: "var(--highlite)",
        fillOpacity: 0.2,
        weight: 2,
      });

      drawnItems.addLayer(layer);

      dispatch("shapeDrawn", {
        layer,
      });
    });

    map.on("draw:edited", (event) => {
      const layers = event.layers;
      layers.eachLayer((layer) => {
        const area = L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]);
        const latlngs = layer.getLatLngs()[0];
        dispatch("shapeEdited", {
          layer,
          area,
          latlngs,
        });
      });
    });

    map.on("zoomend", () => {
      dispatch("mapZoomed", { zoom: map.getZoom() });
    });
  });

  function moveMap() {
    map.setView([lat, lng], 13);
  }

  $: if (selectedLayer) {
    setupLayer(selectedLayer);
  }
</script>

<div class="controls">
  <label>Latitude:</label>
  <input type="number" bind:value={lat} step="0.0001" />
  <label>Longitude:</label>
  <input type="number" bind:value={lng} step="0.0001" />
  <button on:click={moveMap}>Move Map</button>
</div>

<div bind:this={mapContainer} style="height: 600px; width: 100%;"></div>

<style>
  .controls {
    margin-bottom: 1rem;
  }

  div {
    width: 100%;
  }
</style>
