<script>
  import { clippedGeoJSON } from "./lib/stores";
  import Layers from "./lib/Layers.svelte";
  import Map from "./lib/Map.svelte";
  import Exporter from "./lib/Exporter.svelte";

  let area = null;
  let selectedLayer;
  let latlngs = [];

  const handleLayerChange = (event) => {
    selectedLayer = event.detail.layer;
  };

  const handleShapeDrawn = (event) => {
    const drawnLayer = event.detail.layer;
    area = L.GeometryUtil.geodesicArea(drawnLayer._latlngs[0]);
    latlngs = drawnLayer._latlngs[0];
  };

  const handleShapeEdited = (event) => {
    area = event.detail.area;
    latlngs = event.detail.latlngs;
    $clippedGeoJSON = latlngs;
  };
</script>

<div>
  <h1>Vantage Scene Setup</h1>
  <p>Export the relevant data to setup Vantage.</p>
  <Layers bind:selectedLayer on:change={handleLayerChange} />
  <Map
    {selectedLayer}
    on:shapeDrawn={handleShapeDrawn}
    on:shapeEdited={handleShapeEdited}
  />
  <Exporter {area} {latlngs} {selectedLayer} />
</div>

<style>
  :global(html) {
    --highlite: lime;
    --stroke: black;
  }
  :global(body) {
    font-family: space, sans-serif;
    font-feature-settings: "liga", "ss03", "ss02";
    text-rendering: geometricprecision;
    background-color: white;
    padding: 10px;
    margin: 0;
  }

  :global(::selection) {
    background-color: var(--highlite);
  }

  :global(h1, p) {
    margin: 0;
    padding: 0;
  }

  @font-face {
    font-family: space;
    src: url("/SpaceGrotesk-Regular.woff2");
    font-weight: normal;
  }

  @font-face {
    font-family: space;
    src: url("/SpaceGrotesk-Medium.woff2");
    font-weight: bold;
  }
</style>
