<script>
    import { osmGeoJSON, clippedGeoJSON } from "./stores";
    import { fetchData, clipData, downloadData } from "./utils.js";

    export let area;
    export let latlngs;
    export let selectedLayer;

    let southWest, northEast;
    let canDownload = false;

    $: canDownload = area && area <= 8000000;

    function setSouthWest(val) {
        southWest = val;
    }

    function setNorthEast(val) {
        northEast = val;
    }

    function getData() {
        fetchData(latlngs, osmGeoJSON, setSouthWest, setNorthEast);
    }

    function clip() {
        clipData(latlngs, osmGeoJSON, clippedGeoJSON);
    }

    async function download() {
        await downloadData({
            clippedGeoJSON: $clippedGeoJSON,
            latlngs,
            southWest,
            northEast,
            selectedLayer,
        });
    }
</script>

<div>
    {#if !area}
        <p>Draw a shape on the map.</p>
    {/if}

    {#if area && !canDownload}
        <p>The selected area is too large. Please reduce the area.</p>
    {/if}
    <button on:click={getData} disabled={!area}>Fetch Data</button>
    <button on:click={clip} disabled={!$osmGeoJSON}>Clip Data</button>
    <button on:click={download} disabled={!$clippedGeoJSON}
        >Download Data</button
    >
</div>

<style>
    div {
        margin: 10px 0;
    }
    button {
        cursor: pointer;
        opacity: 1;
    }
    button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    p {
        margin-top: 10px;
        color: red;
    }
</style>
