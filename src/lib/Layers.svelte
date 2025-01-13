<script>
    import { createEventDispatcher } from "svelte";

    const layers = [
        {
            label: "OpenStreetMap Default",
            value: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            attribution: "&copy; OpenStreetMap contributors",
        },
        {
            label: "CartoDB Positron",
            value: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            attribution: "&copy; OpenStreetMap contributors &copy; CartoDB",
        },
        {
            label: "CartoDB Dark Matter",
            value: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
            attribution: "&copy; OpenStreetMap contributors &copy; CartoDB",
        },
        {
            label: "OpenTopoMap",
            value: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
            attribution: "&copy; OpenStreetMap contributors &copy; OpenTopoMap",
        },
        {
            label: "ESRI Satellite",
            value: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            attribution:
                "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        },
        {
            label: "ESRI World Imagery",
            value: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            attribution:
                "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        },
        {
            label: "ESRI World Street Map",
            value: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
            attribution:
                "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ",
        },
        {
            label: "ESRI World Topo Map",
            value: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
            attribution:
                "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ",
        },
        // {
        //   label: "OpenRailwayMap",
        //   value: "https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
        //   attribution: "&copy; OpenRailwayMap contributors",
        // },
        // {
        //   label: "OpenSeaMap",
        //   value: "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
        //   attribution: "&copy; OpenSeaMap contributors",
        // },
    ];

    export let selectedLayer = layers[0];
    const dispatch = createEventDispatcher();

    const changeLayer = (layer) => {
        selectedLayer = layer;
        dispatch("change", { layer });
    };
</script>

<div>
    <label for="layer-selector">Select Map Layer:</label>
    <select
        id="layer-selector"
        on:change={(e) => changeLayer(layers[e.target.selectedIndex])}
    >
        {#each layers as layer}
            <option value={layer.value} selected={layer === selectedLayer}>
                {layer.label}
            </option>
        {/each}
    </select>
</div>

<style>
    div {
        padding: 10px 0;
    }
</style>
